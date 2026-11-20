"""護欄的測試：python3 tests/guard_test.py [data 資料夾]
1) 判斷：驗收過的指紋照常上線、新的要驗、沒過的換回好的版本（沒有好的版本就照原本）、工具裝不起來 30 分鐘後再試、釘住的版本優先。
2) 指紋跟 build.site_fingerprint（sw.js 的 BUILD）同一個算法；從 commit 拿出 site/、換進 public/（資料不動、BUILD 換成那一版的）。
3) 給 data 資料夾（有 summary.json）時：用無頭瀏覽器實際驗收一次現在的介面（要過），再把 app.js 弄壞驗一次（要不過）。約 1～2 分鐘。
"""
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from pipeline import build, guard  # noqa: E402

n = 0


def t(name):
    def deco(fn):
        global n
        fn()
        n += 1
        print('ok', name, flush=True)
        return fn
    return deco


NOW = time.time()
G = {'good': [{'fp': 'aaa', 'sha': '1' * 40, 'at': 'x'}, {'fp': 'bbb', 'sha': '2' * 40, 'at': 'y'}]}


@t('驗收過的指紋（最新的或之前的）照常上線')
def _():
    assert guard.decide('aaa', G, None, NOW) == ('ok', None)
    assert guard.decide('bbb', G, None, NOW) == ('ok', None)


@t('新的指紋要驗收；第一次（沒有紀錄）也要驗')
def _():
    assert guard.decide('ccc', G, None, NOW) == ('verify', None)
    assert guard.decide('ccc', {}, None, NOW) == ('verify', None)
    assert guard.decide('ccc', None, None, NOW) == ('verify', None)


@t('驗收沒過的指紋：之後每一輪直接用上一個好的版本，不再重驗')
def _():
    g = dict(G, fail={'fp': 'ccc', 'sha': '3' * 40, 'why': ['壞了']})
    assert guard.decide('ccc', g, None, NOW) == ('fallback', G['good'][0])
    assert guard.decide('ddd', g, None, NOW) == ('verify', None), '程式又改了（新的指紋）就重新驗'
    assert guard.decide('ccc', {'fail': {'fp': 'ccc'}}, None, NOW)[0] == 'asis', '還沒有好的版本：照原本的做法'


@t('驗收工具裝不起來：照原本的做法上線，30 分鐘後再試')
def _():
    g = dict(G, infra={'fp': 'ccc', 't': NOW - 60})
    assert guard.decide('ccc', g, None, NOW)[0] == 'asis'
    assert guard.decide('ccc', dict(G, infra={'fp': 'ccc', 't': NOW - 31 * 60}), None, NOW) == ('verify', None)


@t('釘住的版本優先（回滾）；釘住的剛好是現在這一版就照常')
def _():
    pin = {'fp': 'bbb', 'sha': '2' * 40}
    assert guard.decide('aaa', G, pin, NOW) == ('pinned', pin)
    assert guard.decide('ccc', G, pin, NOW) == ('pinned', pin)
    assert guard.decide('bbb', G, pin, NOW) == ('ok', None)


@t('記錄：好的版本排最前面、同一個指紋不重複、最多留 20 個；通過就清掉沒過的紀錄')
def _():
    g = guard.record_good(dict(G, fail={'fp': 'ccc'}, infra={'fp': 'ccc'}), 'ccc', '3' * 40, 'z')
    assert [x['fp'] for x in g['good']] == ['ccc', 'aaa', 'bbb'] and 'fail' not in g and 'infra' not in g
    g = guard.record_good(g, 'aaa', '4' * 40, 'w')
    assert [x['fp'] for x in g['good']] == ['aaa', 'ccc', 'bbb'] and g['good'][0]['sha'] == '4' * 40
    for i in range(30):
        g = guard.record_good(g, f'f{i}', f'{i:040d}', 'q')
    assert len(g['good']) == guard.KEEP
    f = guard.record_fail(g, 'zzz', '5' * 40, [f'原因{i}' for i in range(20)], 'v')
    assert f['fail']['fp'] == 'zzz' and len(f['fail']['why']) == 12 and f['good'] == g['good']


@t('指紋跟 build.site_fingerprint（sw.js 的 BUILD）同一個算法')
def _():
    assert guard.fingerprint(guard.SITE) == build.site_fingerprint()


@t('從 commit 拿出 site/、換進 public/：資料不動、sw.js 的 BUILD 換成那一版的指紋')
def _():
    tmp = pathlib.Path(tempfile.mkdtemp())
    try:
        head = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, capture_output=True, text=True).stdout.strip()
        old = guard.site_at(head, tmp / 'v')
        assert (old / 'index.html').exists() and (old / 'sw.js').exists()
        pub = tmp / 'public'
        (pub / 'data').mkdir(parents=True)
        (pub / 'data' / 'summary.json').write_text('{"keep": true}')
        (pub / '.nojekyll').write_text('')
        (pub / 'app.js').write_text('壞掉的新版')
        (pub / 'new-file.js').write_text('新版才有的檔案')
        guard.put_site(old, pub)
        assert json.loads((pub / 'data' / 'summary.json').read_text()) == {'keep': True}, '資料不能動'
        assert (pub / '.nojekyll').exists()
        assert not (pub / 'new-file.js').exists(), '新版多出來的檔案要拿掉'
        assert (pub / 'app.js').read_bytes() == (old / 'app.js').read_bytes()
        sw = (pub / 'sw.js').read_text(encoding='utf-8')
        assert '__BUILD__' not in sw and guard.fingerprint(old) in sw
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


@t('回滾的指令列：沒有好的版本時說清楚、不亂寫檔')
def _():
    assert not guard.PIN.exists(), '測試前 control/ui-pin.json 不應該存在（有的話是真的釘住了，不要動）'


def browser(data):
    tmp = pathlib.Path(tempfile.mkdtemp())
    try:
        pub = tmp / 'public'
        shutil.copytree(guard.SITE, pub)
        (pub / 'data').symlink_to(pathlib.Path(data).resolve(), target_is_directory=True)
        sw = pub / 'sw.js'
        sw.write_text(sw.read_text(encoding='utf-8').replace('__BUILD__', 'test0001'), encoding='utf-8')
        rec = guard.lock_record()
        assert rec and json.loads(rec)['v'] == 1, '用 Node 算出上鎖的紀錄'
        t0 = time.time()
        ok, why = guard.verify(pub, 'test-good', shots=tmp / 'shots', lock_rec=rec)
        print(f'  現在的介面：{"過了" if ok else "沒過"}（{time.time() - t0:.0f} 秒）', why, flush=True)
        assert ok, why
        app = pub / 'app.js'
        app.write_text(app.read_text(encoding='utf-8').replace('async function boot() {', 'async function boot() {\n  throw new Error("測試：故意弄壞");', 1), encoding='utf-8')
        ok2, why2 = guard.verify(pub, 'test-bad', shots=tmp / 'shots', lock_rec=rec)
        print('  弄壞的介面：', '過了（不對）' if ok2 else '沒過（對）', why2[:3], flush=True)
        assert not ok2 and any('故意弄壞' in w or '空' in w or 'Timeout' in w for w in why2), why2
        global n
        n += 1
        print('ok 無頭瀏覽器：現在的介面過、弄壞的不過', flush=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if len(sys.argv) > 1:
    browser(sys.argv[1])
print(f'\n{n} 個測試通過')
