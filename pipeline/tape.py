"""給《沙盤 SANDTABLE》（PZ 的台股 ETF 模擬操盤 App，另一個 repo）用的行情資料。

冷眼與沙盤共用同一套官方資料；這個模組只「多輸出」沙盤需要、冷眼用不到的東西，全部失敗也不影響冷眼：
- 盤中每一輪：證交所 MIS 的最佳五檔、開高低、漲跌停（整股），以及盤中零股的五檔與成交。
- tape：當天每一輪的快照（存在 repo 的 tape 分支，每次只留一個 commit），沙盤用它判斷委託有沒有成交。
  每一筆快照記兩個時間：t＝後台去問的時間、q＝證交所這筆資料本身的時間（MIS 的 tlong）。
  MIS 的整股資料常常落後一兩分鐘（偶爾更久），沙盤一律用 q 判斷先後，不然會把「委託之前」的行情當成之後的。
- 收完盤的交易日封存到 tape-days 分支（{日期}/{代號}.json，保留最近 ARCHIVE_KEEP 個交易日），
  沙盤好幾天沒打開，也能用當天的逐筆快照判斷那幾天的委託（不會因為「什麼時候打開 App」而有不同結果）。
- 收盤後：K 線（開高低收量）、交易日曆（證交所開休市日期）、盤後零股與盤後定價的成交結果。

輸出（都在網站的 data/ 底下）：quotes.json、tape/{代號}.json、k/{代號}.json、cal.json、after.json、after/{日期}.json。
"""
import datetime as dt
import gzip
import json
import pathlib
import shutil
import time
import traceback

from . import gitstate
from .series import d2i
from .util import TW, Http, now_tw, num, roc_date, tables_of, find_col, write_json

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIS = 'https://mis.twse.com.tw/stock'
TWSE = 'https://www.twse.com.tw/rwd/zh'
BRANCH = 'tape'
DIR = '.tape'
FILE = 'tape.json.gz'
ARCHIVE_BRANCH = 'tape-days'   # 收完盤的交易日：{日期}/{代號}.json（沙盤從 raw.githubusercontent.com 讀）
ARCHIVE_DIR = '.tape-days'
ARCHIVE_KEEP = 40      # 封存最近 40 個交易日（約兩個月）
BATCH = 120            # 一次查 120 檔（實測 121 檔可以，100 檔以上單次約 6～11 秒）
TAPE_FROM = 825        # 只記交易時段（08:25～13:45）的快照
TAPE_TO = 1345
K_BARS = 500           # K 線輸出最近 500 個交易日
AFTER_KEEP = 40        # 盤後零股／定價結果保留最近 40 個交易日（after/{日期}.json）
AFTER_INLINE = 3       # after.json 直接帶最近 3 天


# ================================================================== 抓 MIS

def _levels(px, vol, scale=1):
    """MIS 的五檔是 '108.4500_108.5000_..._' 和 '1123_3419_..._' 兩個字串。"""
    ps = [num(x) for x in str(px or '').split('_') if x != '']
    vs = [num(x) for x in str(vol or '').split('_') if x != '']
    out = []
    for i, p in enumerate(ps):
        v = vs[i] if i < len(vs) else None
        if p is None or p <= 0 or v is None or v <= 0:
            continue
        out.append([round(p, 4), int(v * scale)])
    return out[:5]


def _hms(s):
    s = str(s or '')
    if len(s) >= 8 and s[2] == ':' and s[5] == ':':
        return int(s[:2]) * 10000 + int(s[3:5]) * 100 + int(s[6:8])
    return None


def _epoch(d, hms):
    """台灣日期 YYYYMMDD ＋ 時刻 HHMMSS → epoch 秒。"""
    if not d or hms is None:
        return None
    try:
        x = dt.datetime(d // 10000, d // 100 % 100, d % 100, hms // 10000, hms // 100 % 100, hms % 100, tzinfo=TW)
    except ValueError:
        return None
    return int(x.timestamp())


def parse_quote(m, odd=False):
    """把 MIS 一檔的原始欄位整理成沙盤用的格式。整股的量是「張」、零股是「股」，這裡一律換成「股」。"""
    unit = 1 if odd else 1000
    trade = m.get('trade') if isinstance(m.get('trade'), dict) else {}
    z = num(m.get('z'))
    zt = _hms(m.get('t')) if z is not None else None
    if z is None and trade:
        z = num(trade.get('z'))
        zt = _hms(trade.get('t'))
    v = num(m.get('v'))
    u = num(m.get('u'))
    d = int(m['d']) if str(m.get('d', '')).isdigit() else None
    # 這筆資料本身的時間（MIS 的 tlong，毫秒）；沒有就用 t（時:分:秒）
    q = None
    try:
        tl = m.get('tlong')
        if tl not in (None, '', '-'):
            q = int(int(tl) // 1000)
    except (TypeError, ValueError):
        q = None
    if q is None:
        q = _epoch(d, _hms(m.get('t')))
    return {
        'z': z, 'zt': zt,
        'o': num(m.get('o')), 'h': num(m.get('h')), 'l': num(m.get('l')),
        'y': num(m.get('y')),
        'u': u if u is not None and u < 9999 else None,
        'w': num(m.get('w')),
        'v': int(v * unit) if v is not None else 0,
        'a': _levels(m.get('a'), m.get('f'), unit),
        'b': _levels(m.get('b'), m.get('g'), unit),
        'pz': num(m.get('pz')),            # 試撮價（開盤前、收盤前、盤中零股第一次撮合前）
        't': _hms(m.get('t')),
        'q': q,
        'd': d,
    }


def _fetch(http, api, channels):
    url = f'{MIS}/api/{api}?json=1&delay=0&ex_ch=' + '|'.join(channels)
    js = http.json(url, timeout=60)
    qt = js.get('queryTime') or {}
    try:
        sd, st = str(qt.get('sysDate')), str(qt.get('sysTime'))
        at = int(dt.datetime.strptime(sd + st, '%Y%m%d%H:%M:%S').replace(tzinfo=TW).timestamp())
    except Exception:  # noqa: BLE001
        at = int(time.time())
    return at, js.get('msgArray') or []


def fetch_books(state):
    """抓所有還在交易的 ETF：整股（getStockInfo）與盤中零股（getOddInfo）。回傳 {at, reg:{}, odd:{}, at_of:{}}。"""
    from .build import active_codes   # 避免循環 import
    meta = state['meta']
    codes = sorted(active_codes(state))
    chans = [f"{'otc' if (meta.get(c) or {}).get('market') == 'otc' else 'tse'}_{c}.tw" for c in codes]
    http = Http(2.0)
    try:
        http.get(f'{MIS}/index.jsp', timeout=20)   # 取得 cookie
    except Exception:  # noqa: BLE001
        pass
    out = {'reg': {}, 'odd': {}, 'at_of': {'reg': {}, 'odd': {}}, 'errors': []}
    for api, key in (('getStockInfo.jsp', 'reg'), ('getOddInfo.jsp', 'odd')):
        for i in range(0, len(chans), BATCH):
            part = chans[i:i + BATCH]
            for attempt in range(2):
                try:
                    at, arr = _fetch(http, api, part)
                    for m in arr:
                        c = m.get('c')
                        if c:
                            out[key][c] = parse_quote(m, odd=(key == 'odd'))
                            out['at_of'][key][c] = at
                    break
                except Exception as e:  # noqa: BLE001
                    out['errors'].append(f'{api}[{i}] {e!r}'[:200])
                    time.sleep(3)
    ats = [a for k in ('reg', 'odd') for a in out['at_of'][k].values()]
    out['at'] = max(ats) if ats else int(time.time())
    return out


# ================================================================== tape 分支

def _empty_series():
    return {'t': [], 'q': [], 'z': [], 'zt': [], 'h': [], 'l': [], 'v': [], 'a': [], 'b': [], 'pz': []}


def load_tape():
    path = gitstate.open_branch(BRANCH, DIR)
    p = path / FILE
    if p.exists():
        try:
            with gzip.open(p, 'rt', encoding='utf-8') as f:
                return path, json.load(f)
        except Exception:  # noqa: BLE001
            traceback.print_exc()
    return path, {'cur': None, 'prev': None, 'last': None}


def save_tape(path, tape, msg):
    with gzip.open(path / FILE, 'wt', encoding='utf-8', compresslevel=6) as f:
        f.write(json.dumps(tape, ensure_ascii=False, separators=(',', ':')))
    return gitstate.save_branch(BRANCH, DIR, msg)


def append(tape, books, today: int, hm: int):
    """把這一輪快照加進當天的 tape。換日時，前一天的整份變成 prev（標成「完成」）。
    證交所這一檔的資料時間（q）沒變，就是資料沒更新，不重複記。"""
    tape['last'] = {'at': books['at'], 'reg': books['reg'], 'odd': books['odd']}
    cur = tape.get('cur')
    if cur and cur.get('d') == today and hm > TAPE_TO:
        cur['done'] = True    # 今天的盤中行情結束了，之後不會再加快照
    days = [q.get('d') for q in books['reg'].values() if q.get('d')]
    data_day = max(set(days), key=days.count) if days else None
    if data_day != today or not (TAPE_FROM <= hm <= TAPE_TO):
        return False          # 休市（資料停在之前的日期）或不在交易時段：只更新 last
    if not cur or cur.get('d') != today:
        if cur and cur.get('codes'):
            cur['done'] = True
            old = tape.get('prev')
            # 要被擠掉的那一天如果還沒封存（收盤後那一輪失敗了），先交給 intraday() 封存
            if old and old.get('codes') and old.get('d') not in (tape.get('archived') or []):
                tape.setdefault('_drop', []).append(old)
            tape['prev'] = cur
        cur = tape['cur'] = {'d': today, 'codes': {}}
    for key in ('reg', 'odd'):
        for c, q in books[key].items():
            if q.get('d') != today:
                continue
            rec = cur['codes'].setdefault(c, {})
            s = rec.setdefault(key, _empty_series())
            if len(s.get('q') or []) != len(s['t']):
                s['q'] = (s.get('q') or []) + [None] * (len(s['t']) - len(s.get('q') or []))   # 舊資料沒有 q
            at = books['at_of'][key].get(c, books['at'])
            if s['t'] and s['t'][-1] >= at:
                continue
            qt = q.get('q')
            last_q = next((x for x in reversed(s['q']) if x is not None), None)
            if qt is not None and last_q is not None and qt <= last_q:
                continue          # 證交所這一檔的資料沒有更新
            s['t'].append(at)
            s['q'].append(qt)
            for f in ('z', 'zt', 'h', 'l', 'v', 'a', 'b', 'pz'):
                s[f].append(q.get(f))
            if key == 'reg':
                for f in ('y', 'u', 'w', 'o'):
                    if q.get(f) is not None:
                        rec[f] = q[f]
            elif q.get('o') is not None:
                rec['oo'] = q['o']
    return True


def intraday(state, log):
    """盤中每一輪：抓五檔、加進 tape、推回 tape 分支。回傳給 publish 用的 tape（記憶體裡的最新版）。"""
    books = fetch_books(state)
    if books['errors']:
        log.setdefault('tape_errors', books['errors'][:5])
    if not books['reg']:
        return None
    path, tape = load_tape()
    now = now_tw()
    added = append(tape, books, d2i(now.date()), now.hour * 100 + now.minute)
    drop = tape.pop('_drop', None)
    if drop:
        try:
            if archive_days(drop):
                _mark_archived(tape, [x['d'] for x in drop])
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            log.setdefault('tape_errors', []).append(f'archive {e!r}'[:200])
    save_tape(path, tape, f"tape {now:%Y-%m-%d %H:%M}{'' if added else ' (last only)'}")
    return tape


def _mark_archived(tape, days):
    tape['archived'] = sorted(set(tape.get('archived') or []) | set(days))[-ARCHIVE_KEEP:]


def archive_days(recs):
    """把收完盤的交易日存進 tape-days 分支：{日期}/{代號}.json，格式和 tape/{代號}.json 的 cur／prev 一樣。
    保留最近 ARCHIVE_KEEP 個交易日；index.json 列出有哪幾天。"""
    recs = [r for r in recs if r and r.get('codes')]
    if not recs:
        return False
    path = gitstate.open_branch(ARCHIVE_BRANCH, ARCHIVE_DIR)
    write_archive(path, recs)
    return gitstate.save_branch(ARCHIVE_BRANCH, ARCHIVE_DIR, 'tape days ' + ','.join(str(r['d']) for r in recs))


def write_archive(path: pathlib.Path, recs):
    for rec in recs:
        ddir = path / str(rec['d'])
        ddir.mkdir(parents=True, exist_ok=True)
        for c, r in rec['codes'].items():
            write_json(ddir / f'{c}.json', {'d': rec['d'], 'done': True, **r})
    days = sorted(int(p.name) for p in path.iterdir() if p.is_dir() and p.name.isdigit() and len(p.name) == 8)
    for d in days[:-ARCHIVE_KEEP]:
        shutil.rmtree(path / str(d), ignore_errors=True)
    write_json(path / 'index.json', {'days': days[-ARCHIVE_KEEP:]})
    return days[-ARCHIVE_KEEP:]


def finish_day(state, log):
    """收盤後（eod）：今天的 tape 標成「完成」（13:45 以後不會再有快照），並把完成、還沒封存的交易日存進 tape-days。"""
    now = now_tw()
    if now.hour * 100 + now.minute <= TAPE_TO:
        return 0
    today = d2i(now.date())
    path, tape = load_tape()
    cur = tape.get('cur')
    changed = False
    if cur and cur.get('d') == today and cur.get('codes') and not cur.get('done'):
        cur['done'] = True
        changed = True
    done_days = set(tape.get('archived') or [])
    todo = [x for x in (tape.get('prev'), cur) if x and x.get('codes') and (x.get('done') or x.get('d', 0) < today)
            and x.get('d') not in done_days]
    if todo and archive_days(todo):
        _mark_archived(tape, [x['d'] for x in todo])
        changed = True
    if changed:
        save_tape(path, tape, f'tape done {now:%Y-%m-%d %H:%M}')
    return len(todo)


# ================================================================== 輸出

def _code_file(cur, prev, c):
    def pick(day, done):
        if not day:
            return None
        rec = (day.get('codes') or {}).get(c)
        if not rec:
            return None
        return {'d': day['d'], 'done': bool(done or day.get('done')), **rec}
    return {'c': c, 'cur': pick(cur, False), 'prev': pick(prev, True)}


def publish(data_dir: pathlib.Path, tape=None):
    """寫出 quotes.json 與 tape/{代號}.json。tape 沒傳進來就從分支讀（收盤後的部署也要有這些檔）。"""
    if tape is None:
        try:
            _, tape = load_tape()
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            return False
    last = tape.get('last')
    if last:
        write_json(data_dir / 'quotes.json', {'at': last['at'], 'reg': last['reg'], 'odd': last['odd']})
    cur, prev = tape.get('cur'), tape.get('prev')
    codes = set((cur or {}).get('codes', {}).keys()) | set((prev or {}).get('codes', {}).keys())
    tdir = data_dir / 'tape'
    tdir.mkdir(parents=True, exist_ok=True)
    for c in codes:
        write_json(tdir / f'{c}.json', _code_file(cur, prev, c))
    return True


def write_k(out_dir: pathlib.Path, state, codes):
    """K 線：最近 K_BARS 個交易日的開高低收量（原始價格，沒有還原權息；分割另外列出）。量的單位是股。"""
    kdir = out_dir / 'k'
    kdir.mkdir(parents=True, exist_ok=True)
    divs = state['divs']
    n = 0
    for c in codes:
        s = state['daily'].get(c)
        if not s or not s.get('d'):
            continue
        k = -K_BARS
        write_json(kdir / f'{c}.json', {
            'c': c, 'd': s['d'][k:], 'o': s['o'][k:], 'h': s['h'][k:], 'l': s['l'][k:], 'c_': s['c'][k:],
            'v': [int(x) if x else 0 for x in s['v'][k:]],
            'div': [x for x in divs.get(c, []) if x and x[0] >= s['d'][k:][0]],
        })
        n += 1
    return n


# ---------------------------------------------------------------- 交易日曆

def fetch_holidays(http, year):
    js = http.json(f'{TWSE}/holidaySchedule/holidaySchedule?date={year}0101&response=json')
    out = []
    for t in tables_of(js):
        f = t['fields']
        idt, iname = find_col(f, '日期'), find_col(f, '名稱')
        if idt is None:
            continue
        for row in t['data']:
            d = roc_date(row[idt])
            if d:
                out.append([d2i(d), str(row[iname]).strip() if iname is not None else ''])
    return out


def update_cal(state, log, http):
    """證交所「市場開休市日期」：一年抓一次（年底順便抓下一年），平常每週更新一次就好。"""
    cal = state.data.setdefault('cal', {})
    now = now_tw()
    years = [now.year] + ([now.year + 1] if now.month >= 11 else [])
    for y in years:
        key = str(y)
        got = cal.get(key)
        if got and got.get('at') and (now - dt.datetime.fromisoformat(got['at'])).days < 7:
            continue
        rows = fetch_holidays(http, y)
        if rows:
            cal[key] = {'at': now.isoformat(timespec='seconds'), 'rows': rows}
    return len(cal)


def make_cal(state):
    """休市日：證交所表上的平日（「開始交易日」「最後交易日」那種是有開市的，不算）；
    「僅辦理結算交割」的日子不交易但照樣交割。open／closed 是用實際成交紀錄推出來的（颱風假也會在 closed 裡）。"""
    hol, settle_only = set(), set()
    for y in (state.data.get('cal') or {}).values():
        for d, name in y.get('rows', []):
            if '交易日' in name and '無交易' not in name:
                continue
            if '結算交割' in name:
                settle_only.add(d)
            hol.add(d)
    days = state['taiex']['d']
    recent = days[-80:]
    closed = []
    if recent:
        d0 = dt.date(recent[0] // 10000, recent[0] // 100 % 100, recent[0] % 100)
        last = recent[-1]
        x = d0
        rs = set(recent)
        while d2i(x) <= last:
            di = d2i(x)
            if x.weekday() < 5 and di not in rs and di not in hol:
                closed.append(di)
            x += dt.timedelta(days=1)
    return {'holidays': sorted(hol), 'settle_only': sorted(settle_only), 'open': recent, 'closed': closed,
            'generated': now_tw().isoformat(timespec='seconds')}


# ---------------------------------------------------------------- 盤後零股、盤後定價

def fetch_after(http, d: int):
    """證交所 盤後零股交易行情單（TWT53U）與 盤後定價交易（BFT41U）。只有上市的；上櫃的沙盤用收盤價代替。
    每檔 [盤後零股成交價, 成交股數, 盤後定價成交股數, 盤後定價最後揭示買量, 盤後定價最後揭示賣量]（量一律換成股）。"""
    ds = str(d)
    out = {}

    def row_of(c):
        return out.setdefault(c, [None, 0, 0, 0, 0])

    js = http.json(f'{TWSE}/afterTrading/TWT53U?date={ds}&selectType=ALL&response=json')
    for t in tables_of(js):
        f = t['fields']
        ic, ish, ipx = find_col(f, '證券代號'), find_col(f, '成交股數'), find_col(f, '成交價')
        if ic is None or ipx is None:
            continue
        for row in t['data']:
            r = row_of(str(row[ic]).strip())
            r[0] = num(row[ipx])
            r[1] = int(num(row[ish]) or 0)
    time.sleep(2.5)
    js = http.json(f'{TWSE}/afterTrading/BFT41U?date={ds}&selectType=ALL&response=json')
    for t in tables_of(js):
        f = t['fields']
        ic, ish = find_col(f, '證券代號'), find_col(f, '成交數量')
        ib, ia = find_col(f, '最後揭示買量'), find_col(f, '最後揭示賣量')
        if ic is None or ish is None:
            continue
        for row in t['data']:
            r = row_of(str(row[ic]).strip())
            r[2] = int(num(row[ish]) or 0) * 1000          # 盤後定價以「張」為單位，換成股
            r[3] = int(num(row[ib]) or 0) * 1000 if ib is not None else 0
            r[4] = int(num(row[ia]) or 0) * 1000 if ia is not None else 0
    return out


def update_after(state, log, http):
    """14:35 以後才有今天的盤後結果；每個交易日抓一次。只留 ETF。"""
    now = now_tw()
    if now.hour * 100 + now.minute < 1435:
        return 0
    days = state['taiex']['d']
    today = d2i(now.date())
    if not days or days[-1] != today:
        return 0
    store = state.data.setdefault('after', {})
    if str(today) in store:
        return 0
    got = fetch_after(http, today)
    etfs = _etf_codes(state)
    got = {c: v for c, v in got.items() if c in etfs}
    if got:
        store[str(today)] = got
        for k in sorted(store.keys())[:-AFTER_KEEP]:
            store.pop(k, None)
    return len(got)


def _etf_codes(state):
    return set(state['daily'].keys()) | set(state['meta'].keys())


def write_after(out_dir: pathlib.Path, state):
    """after/{日期}.json 每天一個檔；after.json 帶 _days（有哪幾天）和最近 AFTER_INLINE 天的內容。"""
    store = state.data.get('after') or {}
    etfs = _etf_codes(state)
    days = sorted(k for k in store.keys() if k.isdigit())[-AFTER_KEEP:]
    adir = out_dir / 'after'
    adir.mkdir(parents=True, exist_ok=True)
    keep = set()
    clean = {}
    for d in days:
        clean[d] = {c: v for c, v in (store[d] or {}).items() if c in etfs}
        write_json(adir / f'{d}.json', clean[d])
        keep.add(f'{d}.json')
    for p in adir.glob('*.json'):
        if p.name not in keep:
            p.unlink()
    write_json(out_dir / 'after.json', {'_days': [int(d) for d in days], **{d: clean[d] for d in days[-AFTER_INLINE:]}})


def write_outputs(out_dir: pathlib.Path, state, codes):
    write_k(out_dir, state, codes)
    write_json(out_dir / 'cal.json', make_cal(state))
    write_after(out_dir, state)
