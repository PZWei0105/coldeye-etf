"""護欄（2026/11/21，痞子葳：「以後不管我怎麼更改、更新、增加新功能，都不會把冷眼……搞壞」）

介面（site/）要先通過自動驗收，才會換到手機上；沒過就繼續用上一個好的版本，資料照樣是最新的。
在 GitHub Actions 的 run 工作裡、publish() 做好 public/ 之後、上傳網站之前執行：python -m pipeline.guard

- 介面的指紋（build.site_fingerprint，跟 sw.js 的 BUILD 同一個）已經驗收過 → 什麼都不做（每 5 分鐘一輪的盤中更新只多一兩秒）。
- 新的指紋 → 用這一輪剛做好的真實資料，在無頭瀏覽器裡照痞子葳的用法打開：手機、電腦，六個分頁、設定頁、單檔頁、
  上鎖的門、換裝。沒有程式錯誤、每一頁都有內容、沒有 undefined／NaN 才算過。
  - 過了 → 記成「好的版本」（guard 分支的 good.json：指紋、commit、時間；留最近 20 個），照常上線。
  - 沒過 → 先用同一份資料驗上一個好的版本：它過了＝新介面的問題 → 網站的介面換回上一個好的版本（資料照樣最新），
    記下沒過的原因與截圖（Actions 的 guard-shots），同一個指紋之後不再重驗，直到程式又改了；
    它也沒過＝這一輪資料的問題 → 照原本的做法上線，不怪新介面。
- 驗收的工具裝不起來（網路、GitHub 的狀況）→ 照原本的做法上線（不會比以前差），30 分鐘後再試。護欄自己出任何錯也一樣。
- 回滾（一鍵）：python -m pipeline.guard rollback [n]  → 釘住第 n 個好的版本（1＝上一個），寫 control/ui-pin.json；
  推上去之後每一輪都用那個版本的介面，直到 python -m pipeline.guard unpin。看狀態：python -m pipeline.guard status。
測試：python3 tests/guard_test.py（判斷邏輯、換回好的版本、本機瀏覽器驗收一次好的、一次壞的）。
"""
import datetime as dt
import hashlib
import http.server
import json
import os
import pathlib
import shutil
import socketserver
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import traceback
import functools

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / 'site'
PUBLIC = ROOT / 'public'
PIN = ROOT / 'control' / 'ui-pin.json'
BRANCH, FOLDER = 'guard', '.guard'
KEEP = 20
INFRA_RETRY_S = 30 * 60
SHOTS = ROOT / 'guard-shots'
TW = dt.timezone(dt.timedelta(hours=8))
TABS = ['home', 'pf', 'radar', 'aide', 'news', 'track']
BAD_TEXT = ('undefined', 'NaN', '[object Object]')


def now_iso():
    return dt.datetime.now(TW).isoformat(timespec='seconds')


def fingerprint(site_dir):
    """跟 build.site_fingerprint 同一個算法（sw.js 的 BUILD）：介面檔案內容的指紋。"""
    site_dir = pathlib.Path(site_dir)
    h = hashlib.sha1()
    for f in sorted(site_dir.rglob('*')):
        if f.is_file() and f.name != 'sw.js' and '__pycache__' not in f.parts:
            h.update(str(f.relative_to(site_dir)).encode('utf-8'))
            h.update(f.read_bytes())
    h.update((site_dir / 'sw.js').read_bytes())
    return h.hexdigest()[:12]


# ---------------------------------------------------------------- 判斷（純函式，tests/guard_test.py）
def decide(fp, g, pin, now):
    """回傳 (動作, 細節)：
    ok        這個指紋驗收過，照常上線
    pinned    釘住了某個好的版本（細節：那一筆 {fp, sha}）
    verify    新的指紋，要驗收
    fallback  這個指紋驗收沒過，用上一個好的版本（細節：那一筆）
    asis      照原本的做法上線（還沒有好的版本、或剛剛工具裝不起來；細節：原因）"""
    g = g or {}
    good = g.get('good') or []
    if pin and pin.get('sha'):
        return ('ok', None) if pin.get('fp') == fp else ('pinned', pin)
    if any(x.get('fp') == fp for x in good):
        return 'ok', None
    fail = g.get('fail') or {}
    if fail.get('fp') == fp:
        return ('fallback', good[0]) if good else ('asis', '還沒有驗收過的好版本')
    infra = g.get('infra') or {}
    if infra.get('fp') == fp and now - float(infra.get('t') or 0) < INFRA_RETRY_S:
        return 'asis', '驗收工具剛剛裝不起來，30 分鐘後再試'
    return 'verify', None


def record_good(g, fp, sha, now_s):
    g = dict(g or {})
    good = [x for x in (g.get('good') or []) if x.get('fp') != fp]
    g['good'] = ([{'fp': fp, 'sha': sha, 'at': now_s}] + good)[:KEEP]
    if (g.get('fail') or {}).get('fp') == fp:
        g.pop('fail', None)
    g.pop('infra', None)
    return g


def record_fail(g, fp, sha, why, now_s):
    g = dict(g or {})
    g['fail'] = {'fp': fp, 'sha': sha, 'at': now_s, 'why': why[:12]}
    g.pop('infra', None)
    return g


# ---------------------------------------------------------------- git
def _git(*args, cwd=ROOT, check=False):
    r = subprocess.run(['git', *args], cwd=cwd, text=True, capture_output=True)
    if check and r.returncode:
        raise RuntimeError(f'git {" ".join(args)}: {r.stderr.strip()}')
    return r


def load_guard():
    from .gitstate import open_branch
    path = open_branch(BRANCH, FOLDER)
    try:
        return json.loads((path / 'good.json').read_text(encoding='utf-8'))
    except Exception:  # noqa: BLE001 — 第一次（還沒有分支）
        return {}


def save_guard(g, message):
    from .gitstate import save_branch
    path = ROOT / FOLDER
    (path / 'good.json').write_text(json.dumps(g, ensure_ascii=False, indent=1), encoding='utf-8')
    (path / 'README.md').write_text('冷眼的護欄紀錄（pipeline/guard.py）：驗收過的介面版本（指紋、commit、時間）與最近一次沒過的原因。'
                                     '每次只留一個 commit，不要手改。\n', encoding='utf-8')
    return save_branch(BRANCH, FOLDER, message)


def read_pin():
    try:
        p = json.loads(PIN.read_text(encoding='utf-8'))
        return p if isinstance(p, dict) and p.get('sha') else None
    except Exception:  # noqa: BLE001
        return None


def site_at(sha, dest):
    """把某個 commit 的 site/ 拿出來放到 dest（淺層 clone 也行：GitHub 可以直接抓指定 commit）。"""
    if _git('cat-file', '-e', f'{sha}^{{commit}}').returncode != 0:
        _git('fetch', '--depth=1', 'origin', sha, check=True)
    dest = pathlib.Path(dest)
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    tar = dest.parent / (dest.name + '.tar')
    with open(tar, 'wb') as f:
        r = subprocess.run(['git', 'archive', sha, 'site'], cwd=ROOT, stdout=f)
    if r.returncode:
        raise RuntimeError(f'git archive {sha} 失敗')
    with tarfile.open(tar) as t:
        t.extractall(dest.parent / (dest.name + '-x'), filter='data')
    shutil.move(str(dest.parent / (dest.name + '-x') / 'site'), str(dest / 'site'))
    shutil.rmtree(dest.parent / (dest.name + '-x'), ignore_errors=True)
    tar.unlink()
    return dest / 'site'


def put_site(site_dir, public=PUBLIC):
    """把 public/ 的介面換成 site_dir 的（data/、.nojekyll 不動），sw.js 的 BUILD 換成那一版的指紋。
    順序：先蓋過去、再拿掉新版多出來的、sw.js 最後寫——任何時候 public/ 都有資料和一份完整的介面（萬一中途被停掉也不會整個空掉）。"""
    site_dir, public = pathlib.Path(site_dir), pathlib.Path(public)
    keep = {'data', '.nojekyll'}
    for p in site_dir.iterdir():
        if p.name in keep or p.name == 'sw.js':
            continue
        dst = public / p.name
        if p.is_dir():
            shutil.copytree(p, dst, dirs_exist_ok=True)
        else:
            shutil.copy2(p, dst)
    want = {str(f.relative_to(site_dir)) for f in site_dir.rglob('*') if f.is_file()}
    for f in sorted(public.rglob('*'), reverse=True):
        rel = f.relative_to(public)
        if rel.parts[0] in keep:
            continue
        if f.is_file() and str(rel) not in want:
            f.unlink()
        elif f.is_dir() and not any(f.iterdir()):
            f.rmdir()
    sw = site_dir / 'sw.js'
    if sw.exists():
        (public / 'sw.js').write_text(sw.read_text(encoding='utf-8').replace('__BUILD__', fingerprint(site_dir)), encoding='utf-8')


# ---------------------------------------------------------------- 驗收（無頭瀏覽器）
class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def _serve(root):
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(_Quiet, directory=str(root)))
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def ensure_browser():
    """裝 Playwright 和 Chromium（Actions 上第一次約 1～2 分鐘）。裝不起來回傳 False（＝工具的問題，不是介面的問題）。"""
    try:
        import playwright  # noqa: F401
    except ImportError:
        r = subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', 'playwright==1.49.1'], capture_output=True, text=True)
        if r.returncode:
            print('[guard] pip install playwright 失敗', r.stderr[-500:], flush=True)
            return False
    if os.environ.get('GITHUB_ACTIONS'):
        r = subprocess.run([sys.executable, '-m', 'playwright', 'install', '--with-deps', 'chromium'], capture_output=True, text=True)
        if r.returncode:
            print('[guard] playwright install 失敗', r.stderr[-800:], flush=True)
            return False
    return True


def lock_record():
    """上鎖（site/lock.js）：驗收用的瀏覽器當作已經用密語打開過（記住這支手機），用 Node 算出跟 App 一模一樣的紀錄。"""
    js = ("import(process.argv[1]).then((m) => process.stdout.write(JSON.stringify(m.LockCore.trust(null, m.RING, Date.now()))))"
          ".catch((e) => { console.error(e); process.exit(1); })")
    lock = pathlib.Path(os.environ.get('GUARD_LOCK_JS') or (SITE / 'lock.js'))
    if not lock.exists():
        return None
    r = subprocess.run(['node', '-e', js, lock.as_uri()], capture_output=True, text=True, timeout=30)
    return r.stdout.strip() if r.returncode == 0 and r.stdout.strip().startswith('{') else None


def verify(public, tag='new', shots=SHOTS, lock_rec=None):
    """用 public/ 裡的介面＋資料照痞子葳的用法打開一遍。回傳 (過了沒, 原因清單)。"""
    from playwright.sync_api import sync_playwright
    import re
    public = pathlib.Path(public)
    shots = pathlib.Path(shots)
    shots.mkdir(parents=True, exist_ok=True)
    stage = pathlib.Path(tempfile.mkdtemp(prefix='guard-'))
    (stage / 'coldeye-etf').symlink_to(public.resolve(), target_is_directory=True)
    srv = _serve(stage)
    base = f'http://127.0.0.1:{srv.server_address[1]}/coldeye-etf/'
    why = []
    try:
        latest = re.search(r"id: '([^']+)'", (public / 'updates.js').read_text(encoding='utf-8')).group(1)
    except Exception:  # noqa: BLE001
        latest = ''
    prefs = {'boot': False, 'sfx': False, 'voice': False, 'bgm': False, 'fx': False, 'theme': 'dark', 'watch': ['0050', '0056', '00878']}

    def seed(ctx, rec, extra=None):
        st = dict(prefs, **(extra or {}))
        ctx.add_init_script('((st, latest, rec) => { try { if (!localStorage.getItem("coldeye.settings")) {'
                            ' localStorage.setItem("coldeye.settings", JSON.stringify(st)); localStorage.setItem("coldeye.seenUpd", JSON.stringify(latest));'
                            ' localStorage.setItem("coldeye.eyeIntro", "1"); }'
                            ' if (rec && !localStorage.getItem("coldeye-lock")) localStorage.setItem("coldeye-lock", rec); } catch (e) {} })('
                            + json.dumps(st) + ',' + json.dumps(latest) + ',' + json.dumps(rec) + ')')

    def newctx(b, w, h, mobile):
        c = b.new_context(viewport={'width': w, 'height': h}, is_mobile=mobile, has_touch=mobile, service_workers='block',
                          locale='zh-TW', timezone_id='Asia/Taipei')
        c.set_default_timeout(25000)
        return c

    def page_bad(pg, where):
        try:
            txt = pg.locator('#view').inner_text(timeout=5000)
        except Exception:  # noqa: BLE001
            return f'{where}：畫面是空的'
        if len(txt.strip()) < 20:
            return f'{where}：畫面幾乎是空的'
        for w in BAD_TEXT:
            if re.search(r'(^|[^A-Za-z])' + re.escape(w) + r'($|[^A-Za-z])', txt):
                return f'{where}：畫面上出現「{w}」'
        return None

    with sync_playwright() as p:
        b = p.chromium.launch(args=['--no-sandbox'])
        try:
            for vw, vh, mobile, tabs in ((390, 844, True, TABS), (1440, 900, False, ['home', 'pf', 'radar'])):
                dev = '手機' if mobile else '電腦'
                c = newctx(b, vw, vh, mobile)
                seed(c, lock_rec)
                errs = []
                pg = c.new_page()
                pg.on('pageerror', lambda e, errs=errs: errs.append(str(e)[:160]))
                try:
                    pg.goto(base, wait_until='domcontentloaded')
                    pg.wait_for_selector('#view .panel, #view section', timeout=30000)
                    time.sleep(1.5)
                    for t in tabs:
                        pg.click(f'.dock button[data-tab="{t}"]')
                        time.sleep(1.6)
                        bad = page_bad(pg, f'{dev}・{t}')
                        if bad:
                            why.append(bad)
                        pg.screenshot(path=str(shots / f'{tag}-{dev}-{t}.png'))
                    if mobile:
                        pg.evaluate("location.hash = '#settings'")
                        pg.wait_for_selector('#sheet:not([hidden]) #s-lock', timeout=15000)
                        time.sleep(0.8)
                        if len(pg.locator('#sheet').inner_text().strip()) < 200:
                            why.append('手機・設定頁幾乎是空的')
                        pg.screenshot(path=str(shots / f'{tag}-{dev}-settings.png'))
                        pg.go_back()
                        time.sleep(0.8)
                        pg.evaluate("location.hash = '#0050'")
                        pg.wait_for_selector('#sheet:not([hidden]) .sheet-body', timeout=15000)
                        time.sleep(1.5)
                        st = pg.locator('#sheet').inner_text()
                        if len(st.strip()) < 200:
                            why.append('手機・單檔頁 0050 幾乎是空的')
                        for w in BAD_TEXT:
                            if re.search(r'(^|[^A-Za-z])' + re.escape(w) + r'($|[^A-Za-z])', st):
                                why.append(f'手機・單檔頁 0050 出現「{w}」')
                        pg.screenshot(path=str(shots / f'{tag}-{dev}-0050.png'))
                except Exception as e:  # noqa: BLE001
                    why.append(f'{dev}：{type(e).__name__} {str(e)[:140]}')
                    try:
                        pg.screenshot(path=str(shots / f'{tag}-{dev}-stuck.png'))
                    except Exception:  # noqa: BLE001
                        pass
                why += [f'{dev}・程式錯誤：{e}' for e in errs[:4]]
                c.close()
            # 換裝（交易終端）＋沒打開過的手機：要停在上鎖的門，門後面什麼都沒畫
            for extra, rec, kind in (({'skin': 'term'}, lock_rec, 'skin'), (None, None, 'lock')):
                c = newctx(b, 390, 844, True)
                seed(c, rec, extra)
                errs = []
                pg = c.new_page()
                pg.on('pageerror', lambda e, errs=errs: errs.append(str(e)[:160]))
                try:
                    pg.goto(base, wait_until='domcontentloaded')
                    if kind == 'lock':
                        if (public / 'lock.js').exists():   # 這一版有上鎖才驗門（回滾到更早的版本就沒有門）
                            pg.wait_for_selector('#cx-lock .lk-input', timeout=20000)
                            if pg.locator('#view').count():
                                why.append('上鎖：門後面已經畫出冷眼了')
                    else:
                        pg.wait_for_selector('#view .panel, #view section', timeout=30000)
                        time.sleep(1.2)
                        bad = page_bad(pg, '換裝（交易終端）')
                        if bad:
                            why.append(bad)
                    pg.screenshot(path=str(shots / f'{tag}-{kind}.png'))
                except Exception as e:  # noqa: BLE001
                    why.append(f'{"上鎖的門" if kind == "lock" else "換裝"}：{type(e).__name__} {str(e)[:140]}')
                why += [f'{kind}・程式錯誤：{e}' for e in errs[:3]]
                c.close()
        finally:
            b.close()
            srv.shutdown()
            shutil.rmtree(stage, ignore_errors=True)
    return (not why), why


# ---------------------------------------------------------------- 主流程
def summary(lines):
    path = os.environ.get('GITHUB_STEP_SUMMARY')
    text = '\n'.join(lines)
    print(text, flush=True)
    if path:
        with open(path, 'a', encoding='utf-8') as f:
            f.write('### 冷眼護欄\n' + text + '\n')


def run(public=PUBLIC):
    if not (public / 'index.html').exists():
        print('[guard] 這一輪沒有網站要上線', flush=True)
        return 'skip'
    sha = os.environ.get('GITHUB_SHA') or _git('rev-parse', 'HEAD').stdout.strip()
    fp = fingerprint(SITE)
    g = load_guard()
    act, info = decide(fp, g, read_pin(), time.time())
    print(f'[guard] 介面指紋 {fp}（{sha[:7]}）→ {act} {info or ""}', flush=True)
    if act == 'ok':
        return act
    if act == 'asis':
        summary([f'- 介面 {fp}：照原本的做法上線（{info}）'])
        return act
    if act in ('pinned', 'fallback'):
        put_site(site_at(info['sha'], pathlib.Path(tempfile.mkdtemp(prefix='guard-good-')) / 'v'), public)
        word = '釘住的版本' if act == 'pinned' else '上一個好的版本'
        summary([f'- 介面用{word}：{info.get("fp")}（{str(info.get("sha"))[:7]}）；這一輪的資料照樣最新。'
                 + ('' if act == 'pinned' else f' 新的介面 {fp} 沒過：' + '；'.join((g.get("fail") or {}).get("why") or []))])
        return act
    # verify
    if not ensure_browser():
        g['infra'] = {'fp': fp, 't': time.time(), 'at': now_iso()}
        save_guard(g, f'guard: 驗收工具裝不起來（{fp}）')
        summary([f'- 介面 {fp}：驗收工具裝不起來，照原本的做法上線，30 分鐘後再試'])
        return 'asis'
    rec = lock_record()
    ok, why = verify(public, 'new', lock_rec=rec)
    if ok:
        g = record_good(g, fp, sha, now_iso())
        save_guard(g, f'guard: 驗收通過 {fp}（{sha[:7]}）')
        summary([f'- 新的介面 {fp}（{sha[:7]}）驗收通過，上線。'])
        return 'good'
    good = (g.get('good') or [None])[0]
    if not good:
        g = record_fail(g, fp, sha, why, now_iso())
        save_guard(g, f'guard: 驗收沒過 {fp}，還沒有好的版本可以換')
        summary([f'- 新的介面 {fp} 驗收沒過，但還沒有驗收過的好版本，照原本的做法上線：'] + [f'  - {w}' for w in why])
        return 'asis'
    # 用同一份資料驗上一個好的版本：它也沒過＝資料的問題，不怪新介面
    tmp = pathlib.Path(tempfile.mkdtemp(prefix='guard-old-'))
    old_site = site_at(good['sha'], tmp / 'v')
    trial = tmp / 'pub'
    shutil.copytree(public, trial, symlinks=True, ignore=shutil.ignore_patterns('data'))
    (trial / 'data').symlink_to((public / 'data').resolve(), target_is_directory=True)
    put_site(old_site, trial)
    os.environ['GUARD_LOCK_JS'] = str(old_site / 'lock.js')
    ok_old, why_old = verify(trial, 'good', lock_rec=lock_record() if (old_site / 'lock.js').exists() else None)
    os.environ.pop('GUARD_LOCK_JS', None)
    if not ok_old:
        summary([f'- 新的介面 {fp} 和上一個好的版本 {good["fp"]} 用這一輪的資料都沒過：是資料的問題，照原本的做法上線。'] + [f'  - {w}' for w in why])
        return 'asis'
    g = record_fail(g, fp, sha, why, now_iso())
    save_guard(g, f'guard: 驗收沒過 {fp}，換回 {good["fp"]}')
    put_site(old_site, public)
    summary([f'- **新的介面 {fp}（{sha[:7]}）驗收沒過，網站換回上一個好的版本 {good["fp"]}（{good["sha"][:7]}）**，資料照樣最新。沒過的原因：']
            + [f'  - {w}' for w in why] + ['  截圖在這一輪的 guard-shots。修好程式推上去會重新驗收。'])
    return 'fallback'


def cli(argv):
    cmd = argv[1] if len(argv) > 1 else 'run'
    if cmd == 'run':
        try:
            run()
        except Exception:  # noqa: BLE001 — 護欄自己出錯：照原本的做法上線（public/ 沒動過就是 HEAD 的介面）
            traceback.print_exc()
            summary(['- 護欄自己出錯，這一輪照原本的做法上線（見 log）'])
        return 0
    if cmd == 'status':
        g = load_guard()
        print(json.dumps({'pin': read_pin(), 'head': fingerprint(SITE), **g}, ensure_ascii=False, indent=1))
        return 0
    if cmd == 'rollback':
        n = int(argv[2]) if len(argv) > 2 else 1
        g = load_guard()
        good = g.get('good') or []
        head = fingerprint(SITE)
        cands = [x for x in good if x.get('fp') != head]
        if n < 1 or n > len(cands):
            print(f'沒有第 {n} 個好的版本（有 {len(cands)} 個）', file=sys.stderr)
            return 1
        pick = cands[n - 1]
        PIN.write_text(json.dumps({'fp': pick['fp'], 'sha': pick['sha'], 'at': now_iso(),
                                   'why': ' '.join(argv[3:]) or '痞子葳要退回'}, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
        print(f'釘住 {pick["fp"]}（{pick["sha"][:7]}，{pick["at"]} 驗收過）。commit、推上 main 之後下一輪就換。', flush=True)
        return 0
    if cmd == 'unpin':
        if PIN.exists():
            PIN.unlink()
        print('取消釘住：推上 main 之後回到最新的介面（照樣要先通過驗收）。', flush=True)
        return 0
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(cli(sys.argv))
