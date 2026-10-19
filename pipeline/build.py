"""每一輪更新的流程：抓官方資料 → 存進 state 分支 → 算觀點與戰績 → 輸出 App 用的 JSON。"""
import bisect
import datetime as dt
import json
import math
import pathlib
import re
import shutil
import threading
import time
import traceback

from . import backtest, engine, gitstate, narrative
from . import sources as src
from .series import CATEGORY_NAMES, Series, d2i, i2d
from .state import State
from .util import TW, Http, now_tw, write_json

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / 'site'
PUBLIC = ROOT / 'public'
STATE_DIR = '.state'

MIN_BARS = 70
BACKFILL_MONTHS = 26
FLOW_DAYS = 260


def run(mode: str) -> bool:
    started = time.time()
    st_path = gitstate.open_branch('state', STATE_DIR)
    state = State(st_path)
    now = now_tw()
    log = {'mode': mode, 'started': now.isoformat(timespec='seconds'), 'steps': [], 'errors': []}
    ok_build = False
    try:
        if mode == 'backfill':
            backfill(state, log, budget_s=125 * 60)
            eod(state, log, weekly=True)
        elif mode in ('eod', 'weekly'):
            eod(state, log, weekly=(mode == 'weekly'))
        elif mode == 'intraday':
            intraday(state, log)
        elif mode == 'deploy':
            intraday(state, log)   # 只更新介面時，順便抓一次即時淨值
        ok_build = publish(state, log, mode)
    except Exception:  # noqa: BLE001
        log['errors'].append(traceback.format_exc()[-2000:])
        traceback.print_exc()
    finally:
        log['finished'] = now_tw().isoformat(timespec='seconds')
        log['seconds'] = round(time.time() - started)
        runs = state['status'].setdefault('_runs', [])
        runs.append(log)
        state['status']['_runs'] = runs[-30:]
        if mode != 'intraday' or log['errors'] or log.get('news_changed'):
            state.save()
            gitstate.save_branch('state', STATE_DIR, f'{mode} {now:%Y-%m-%d %H:%M}')
    return ok_build


def step(log, name, fn, *a, **kw):
    t0 = time.time()
    try:
        r = fn(*a, **kw)
        log['steps'].append({'name': name, 'ok': True, 's': round(time.time() - t0, 1)})
        return r
    except Exception as e:  # noqa: BLE001
        log['steps'].append({'name': name, 'ok': False, 's': round(time.time() - t0, 1), 'err': repr(e)[:300]})
        print(f'[step:{name}] FAILED {e!r}', flush=True)
        return None


# ================================================================== 抓資料

def _months_back(today: dt.date, n: int):
    y, m = today.year, today.month
    out = []
    for _ in range(n):
        out.append((y, m))
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return out


def update_taiex(state, http, months):
    tx = state['taiex']
    by = {d: (c, v) for d, c, v in zip(tx['d'], tx['c'], tx.get('val') or [None] * len(tx['d']))}
    got = 0
    for y, m in months:
        for r in src.twse_market_month(http, y, m):
            by[d2i(r['d'])] = (r['close'], r['val'])
            got += 1
    ds = sorted(by)
    state['taiex'] = {'d': ds, 'c': [by[d][0] for d in ds], 'val': [by[d][1] for d in ds]}
    return got


def trading_days(state):
    return state['taiex']['d']


def _done(state, key):
    return set(state['backfill'].setdefault(key, []))


def _mark_done(state, key, d):
    lst = state['backfill'].setdefault(key, [])
    if d not in lst:
        lst.append(d)
        lst.sort()
        if len(lst) > 900:
            del lst[:len(lst) - 900]


def fetch_day(state, http, market, kind, d: int, when):
    """抓某市場、某類資料、某一天。回傳 True 表示成功（或確定那天沒有資料）。"""
    day = i2d(d)
    if kind == 'daily':
        data = (src.twse_etf_daily if market == 'tse' else src.tpex_etf_daily)(http, day)
        if not data:
            return False
        for code, row in data.items():
            state.put_daily(code, d, row, name=row.get('name'), market=market)
        state.mark(f'{"twse" if market == "tse" else "tpex"}_daily', when=when)
    elif kind == 'flows':
        data = (src.twse_flows if market == 'tse' else src.tpex_flows)(http, day)
        if not data:
            return False
        for code, row in data.items():
            state.put_map('flows', code, d, row)
        state.mark(f'{"twse" if market == "tse" else "tpex"}_flows', when=when)
    elif kind == 'margin':
        data = (src.twse_margin if market == 'tse' else src.tpex_margin)(http, day)
        if not data:
            return False
        for code, row in data.items():
            state.put_map('margin', code, d, row)
        state.mark(f'{"twse" if market == "tse" else "tpex"}_margin', when=when)
    return True


def backfill(state, log, budget_s):
    t_end = time.time() + budget_s
    now = now_tw()
    when = now.isoformat(timespec='minutes')
    http = Http(2.3)
    step(log, 'taiex_months', update_taiex, state, http, _months_back(now.date(), BACKFILL_MONTHS))
    days = sorted(trading_days(state), reverse=True)
    days = [d for d in days if d <= d2i(now.date())]
    plan = [('daily', days), ('flows', days[:FLOW_DAYS]), ('margin', days[:FLOW_DAYS])]
    counters = {}

    def worker(market):
        h = Http(2.3)
        fails = 0
        for kind, ds in plan:
            key = f'{market}_{kind}'
            done = _done(state, key)
            n_ok = 0
            for d in ds:
                if d in done:
                    continue
                if time.time() > t_end or fails >= 8:
                    counters[key] = (n_ok, 'stopped')
                    return
                try:
                    if fetch_day(state, h, market, kind, d, when):
                        _mark_done(state, key, d)
                        n_ok += 1
                        fails = 0
                    else:
                        _mark_done(state, key, d)  # 官方回覆查無資料，視為完成
                except Exception as e:  # noqa: BLE001
                    fails += 1
                    print(f'[backfill {key} {d}] {e!r}', flush=True)
                    time.sleep(20 * fails)
            counters[key] = (n_ok, 'done')

    threads = [threading.Thread(target=worker, args=(m,)) for m in ('tse', 'otc')]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    log['backfill'] = counters
    # 配息歷史（證交所可一次查一段期間）
    step(log, 'twse_div_history', twse_dividend_history, state, http, now.date())
    step(log, 'tpex_div_history', tpex_dividend_history, state, now.date())
    step(log, 'derive_otc_div', derive_otc_dividends, state)
    step(log, 'yields_history', update_yields, state, Http(1.5), [now.year - 2, now.year - 1, now.year])


def twse_dividend_history(state, http, today):
    start = dt.date(today.year - 3, 1, 1)
    got = 0
    cur = start
    while cur <= today:
        nxt = dt.date(cur.year + (cur.month + 3 > 12), (cur.month + 2) % 12 + 1, 1)
        end = min(nxt - dt.timedelta(days=1), today)
        try:
            for r in src.twse_dividends(http, cur, end):
                add_div(state, r['code'], d2i(r['d']), r['cash'])
                got += 1
        except Exception as e:  # noqa: BLE001
            print(f'[twse_div {cur}] {e!r}', flush=True)
        cur = nxt
    state.mark('twse_div', when=now_tw().isoformat(timespec='minutes'))
    return got


def derive_otc_dividends(state):
    """上櫃行情的「漲跌」是相對除息參考價計算；前一日收盤 −（收盤 − 漲跌）＝ 當天除息金額。"""
    found = 0
    for code, meta in state['meta'].items():
        if meta.get('market') != 'otc':
            continue
        dd = state['daily'].get(code)
        if not dd or 'ch' not in dd:
            continue
        known = {x[0] for x in state['divs'].get(code, [])}
        for k in range(1, len(dd['d'])):
            c0, c1, ch = dd['c'][k - 1], dd['c'][k], dd['ch'][k]
            if c0 is None or c1 is None or ch is None:
                continue
            ref = c1 - ch
            cash = round(c0 - ref, 4)
            if cash >= 0.005 and cash < c0 * 0.2 and dd['d'][k] not in known:
                o = dd['o'][k] or c1
                if c0 and (o / c0 < 1 / 1.45 or o / c0 > 1.45):
                    continue  # 分割，不是配息
                add_div(state, code, dd['d'][k], cash)
                found += 1
    return found


def tpex_dividend_history(state, today):
    """櫃買中心的除權息歷史查詢沒有穩定的 JSON 介面時，改用官方 OpenAPI 的最近資料逐日累積。"""
    http = Http(1.5)
    done, _ = src.tpex_dividends_api(http)
    for r in done:
        add_div(state, r['code'], d2i(r['d']), r['cash'])
    return len(done)


def add_div(state, code, d, cash):
    lst = state['divs'].setdefault(code, [])
    for row in lst:
        if row[0] == d:
            row[1] = cash
            return
    lst.append([d, cash])
    lst.sort()


def update_yields(state, http, years):
    y = state['yields']
    got = 0
    for year in years:
        for d, v in src.us_yields(http, year).items():
            y[str(d)] = v
            got += 1
    state.mark('ust', when=now_tw().isoformat(timespec='minutes'))
    return got


def eod(state, log, weekly=False):
    now = now_tw()
    when = now.isoformat(timespec='minutes')
    today = now.date()
    http_tw, http_tp, http_x = Http(2.3), Http(2.3), Http(1.2)
    step(log, 'taiex', update_taiex, state, http_tw, _months_back(today, 2))
    cand = [d for d in trading_days(state) if d <= d2i(today)][-6:]
    if today.weekday() < 5 and d2i(today) not in cand:
        cand.append(d2i(today))
    for kind in ('daily', 'flows', 'margin'):
        for market, http in (('tse', http_tw), ('otc', http_tp)):
            key = f'{market}_{kind}'
            done = _done(state, key)
            for d in cand:
                if d in done:
                    continue
                r = step(log, f'{key}:{d}', fetch_day, state, http, market, kind, d, when)
                if r:
                    _mark_done(state, key, d)
    for d in cand[-3:]:
        if str(d) not in state['mflows']:
            mf = step(log, f'mflows:{d}', src.twse_market_flows, http_tw, i2d(d))
            if mf:
                state['mflows'][str(d)] = mf
                state.mark('twse_mflows', when=when)
    step(log, 'trickle_backfill', trickle_backfill, state, http_tw, http_tp, when, 24)
    mis = step(log, 'mis_etf', src.mis_etf, http_x) or {}
    if mis:
        record_mis(state, mis)
        state.mark('mis_etf', when=when)
    divs = step(log, 'twse_div', src.twse_dividends, http_tw, today - dt.timedelta(days=45), today) or []
    for r in divs:
        add_div(state, r['code'], d2i(r['d']), r['cash'])
    if divs:
        state.mark('twse_div', when=when)
    pre = step(log, 'twse_div_pre', src.twse_dividend_preview, http_tw) or []
    tp_done, _ = step(log, 'tpex_div', src.tpex_dividends_api, http_x) or ([], [])
    for r in tp_done:
        add_div(state, r['code'], d2i(r['d']), r['cash'])
    step(log, 'yields', update_yields, state, http_x, [today.year])
    risk = (step(log, 'twse_risk', src.twse_risk, http_tw) or []) + (step(log, 'tpex_risk', src.tpex_risk, http_x) or [])
    if risk:
        state.mark('twse_risk', when=when)
    news = []
    for name, fn in (('twse_news', src.twse_news), ('cna', src.cna_finance), ('fsc', src.fsc_news), ('cbc', src.cbc_news)):
        items = step(log, name, fn, http_x)
        if items:
            news.extend(items)
            state.mark(name, when=when)
    if weekly or today.weekday() >= 4 or not state['holders']:
        r = step(log, 'tdcc', src.tdcc_holders, http_x)
        if r and r[0]:
            hd, rows = r
            for code, (n, units) in rows.items():
                lst = state['holders'].setdefault(code, [])
                if not lst or lst[-1][0] != hd:
                    lst.append([hd, n, units])
                    del lst[:-60]
            state.mark('tdcc', when=when)
    step(log, 'derive_otc_div', derive_otc_dividends, state)
    state['_extra'] = {'mis': mis, 'pre': pre, 'risk': risk, 'news': news}
    store_news(state, news)


def trickle_backfill(state, http_tw, http_tp, when, per_market):
    """大量回補若被中斷，平常每次收盤後的更新順便補幾天，幾天內就能補齊。"""
    days = sorted([d for d in trading_days(state) if d <= d2i(now_tw().date())], reverse=True)
    plan = [('daily', days), ('flows', days[:FLOW_DAYS]), ('margin', days[:FLOW_DAYS])]
    done_n = 0
    for market, http in (('tse', http_tw), ('otc', http_tp)):
        budget = per_market
        for kind, ds in plan:
            key = f'{market}_{kind}'
            done = _done(state, key)
            for d in ds[6:]:
                if budget <= 0:
                    break
                if d in done:
                    continue
                budget -= 1
                try:
                    fetch_day(state, http, market, kind, d, when)
                    _mark_done(state, key, d)
                    done_n += 1
                except Exception as e:  # noqa: BLE001
                    print(f'[trickle {key} {d}] {e!r}', flush=True)
                    budget = 0
    return done_n


def record_mis(state, mis):
    """MIS 的 h 是「前一營業日」官方淨值；c 是已發行單位數。"""
    days = trading_days(state)
    for code, m in mis.items():
        try:
            d = int(m['date'])
        except (TypeError, ValueError):
            continue
        k = bisect.bisect_left(days, d) - 1
        prev = days[k] if k >= 0 else None
        if prev and m.get('prev_nav'):
            state.put_map('nav', code, prev, m['prev_nav'])
        if m.get('units'):
            state.put_map('units', code, d, m['units'])
        meta = state['meta'].setdefault(code, {})
        if not meta.get('name') and m.get('name'):
            meta['name'] = m['name']


NOISE = ('今彩539', '威力彩', '大樂透', '統一發票', '樂透', '刮刮樂', '雙贏彩', '賓果')
OPINION = ('預估', '預期', '看好', '看旺', '樂觀', '悲觀', '有望', '可望', '恐將', '恐怕', '專家', '分析師',
           '法人看', '建議', '布局', '存股', '怎麼', '如何', '必買', '推薦', '目標價', '喊', '飆', '暴漲',
           '暴跌', '狂', '懶人包', '一次看', '攻略', '？', '?', '揭密', '秘訣', '首選', '抱緊', '押寶', '搶進',
           '機會來', '別錯過', '大師', '老師')
RELEVANT = ('ETF', '台股', '加權', '指數', '股市', '證交所', '櫃買', '金管會', '央行', '利率', '聯準會', 'Fed',
            '美債', '殖利率', '匯率', '新台幣', '台幣', '外資', '投信', '除息', '配息', '股息', '債券', '通膨',
            'CPI', '景氣', '出口', '半導體', '台積電', '美股', '道瓊', '那斯達克', '那指', '標普', '費半',
            '油價', '黃金', '降息', '升息', '股價', '市值', '漲', '跌', '收盤', '上市', '櫃')


TWSE_ADMIN = ('股份有限公司', '競價拍賣', '上市審議', '創新板', '承銷', '招募', '職得你來', '奪', '頭版', '研討會',
              '講座', '徵才', '論壇', '頒獎', '得為融資融券', '開始上市買賣', '終止上市', '公開申購')


def classify(item):
    t = item['t']
    if any(k in t for k in NOISE):
        return None
    if item['src'] == 'twse_news' and 'ETF' not in t.upper() and any(k in t for k in TWSE_ADMIN):
        return None   # 個別公司的上市、承銷行政公告與活動新聞，和 ETF 投資無關
    if item['kind'] == 'official':
        return 'official'
    if not any(k in t or k in (item.get('desc') or '') for k in RELEVANT):
        return None
    if any(k in t for k in OPINION):
        return 'opinion'
    return 'fact'


def store_news(state, items):
    keep = {x['url']: x for x in state['news'] if x.get('url')}
    for it in items:
        k = classify(it)
        if not k or not it.get('url'):
            continue
        d = it.get('d')
        rec = {'t': it['t'], 'url': it['url'], 'src': it['src'], 'kind': k,
               'd': d2i(d) if isinstance(d, dt.date) else d, 'ts': it.get('ts')}
        if it['url'] in keep:
            continue
        keep[it['url']] = rec
    lst = sorted(keep.values(), key=lambda x: (x.get('d') or 0, x.get('ts') or ''), reverse=True)
    state['news'] = lst[:400]


def intraday(state, log):
    http = Http(1.2)
    mis = step(log, 'mis_etf', src.mis_etf, http) or {}
    tx = step(log, 'mis_taiex', src.mis_quotes, http, ['tse_t00.tw']) or {}
    before = {x['url'] for x in state['news']}
    news = []
    for name, fn in (('twse_news', src.twse_news), ('cna', src.cna_finance)):
        items = step(log, name, fn, http)
        if items:
            news.extend(items)
    store_news(state, news)
    fresh = {x['url'] for x in state['news']} - before
    state['_extra'] = {'mis': mis, 'taiex_live': tx.get('t00'), 'news_changed': bool(fresh)}


# ================================================================== 計算與輸出

def build_ctx(state):
    tx = state['taiex']
    from .indicators import sma
    ma60 = sma([c for c in tx['c']], 60)
    tdays = tx['d']

    def taiex_at(d):
        k = bisect.bisect_right(tdays, d) - 1
        if k < 0:
            return None
        return (tx['c'][k], ma60[k], ma60[k - 20] if k >= 20 else None)

    yd = sorted(int(k) for k in state['yields'].keys())
    y20 = [state['yields'][str(k)].get('y20') for k in yd]

    def us20y_before(d):
        k = bisect.bisect_left(yd, d) - 1   # 只用台灣日期之前（美國前一日）已公布的數字
        if k < 0 or y20[k] is None:
            return None
        return (y20[k], y20[k - 20] if k >= 20 else None, y20[k - 60] if k >= 60 else None)

    return {'taiex_at': taiex_at, 'us20y_before': us20y_before, 'extra_flags': {}}


def make_series(state):
    out = {}
    for code, daily in state['daily'].items():
        if len(daily['d']) < MIN_BARS:
            continue
        meta = state['meta'].get(code, {})
        try:
            s = Series(code, meta, daily, flows=state['flows'].get(code), margin=state['margin'].get(code),
                       nav=state['nav'].get(code), divs=[tuple(x) for x in state['divs'].get(code, [])],
                       holders=state['holders'].get(code))
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            continue
        if s.n >= MIN_BARS:
            out[code] = s
    return out


def r4(x, n=4):
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return None
    return round(x, n)


def publish(state, log, mode):
    now = now_tw()
    extra = state.data.pop('_extra', {}) if '_extra' in state.data else {}
    out_dir = state.root / 'out'
    if mode in ('eod', 'weekly', 'backfill'):
        step(log, 'compute', compute, state, extra, out_dir, now)
    elif mode == 'intraday' and extra.get('news_changed') and (out_dir / 'news.json').exists():
        old = json.loads((out_dir / 'news.json').read_text(encoding='utf-8'))
        fresh = make_news(state, [], [], {}, now)
        old['items'] = fresh['items']
        old['generated'] = fresh['generated']
        write_json(out_dir / 'news.json', old)
        log['news_changed'] = True
    if not (out_dir / 'summary.json').exists():
        print('[publish] 尚無計算結果，略過部署', flush=True)
        return False
    if PUBLIC.exists():
        shutil.rmtree(PUBLIC)
    shutil.copytree(SITE, PUBLIC)
    shutil.copytree(out_dir, PUBLIC / 'data', dirs_exist_ok=True)
    live = make_live(state, extra, now, mode)
    write_json(PUBLIC / 'data' / 'live.json', live)
    write_json(PUBLIC / 'data' / 'version.json', {'built': now.isoformat(timespec='seconds'), 'mode': mode})
    (PUBLIC / '.nojekyll').write_text('', encoding='utf-8')
    # 讓 service worker 每次部署都能偵測到新版本
    sw = PUBLIC / 'sw.js'
    if sw.exists():
        sw.write_text(sw.read_text(encoding='utf-8').replace('__BUILD__', now.strftime('%Y%m%d%H%M%S')),
                      encoding='utf-8')
    return True


def make_live(state, extra, now, mode):
    mis = extra.get('mis') or {}
    etfs = {}
    for code, m in mis.items():
        if m.get('px') is None:
            continue
        etfs[code] = [m.get('px'), m.get('est_nav'), m.get('premium'), m.get('time'), m.get('units_chg')]
    tx = extra.get('taiex_live')
    hm = now.hour * 100 + now.minute
    open_now = now.weekday() < 5 and 900 <= hm <= 1335
    return {'at': now.isoformat(timespec='seconds'), 'mode': mode, 'open': open_now,
            'date': max((int(m['date']) for m in mis.values() if str(m.get('date', '')).isdigit()), default=None),
            'etfs': etfs,
            'taiex': {'z': tx.get('z'), 'y': tx.get('y'), 't': tx.get('t')} if tx else None}


def compute(state, extra, out_dir, now):
    if out_dir.exists():
        shutil.rmtree(out_dir)
    (out_dir / 'etf').mkdir(parents=True, exist_ok=True)
    ctx = build_ctx(state)
    risk = extra.get('risk') or []
    for r in risk:
        if src.is_etf_code(r['code']):
            ctx['extra_flags'].setdefault(r['code'], []).append(
                {'key': r['kind'], 'text': ('處置中：' if r['kind'] == 'disposal' else '列入注意股：') + (r.get('period') or r.get('text') or '')[:80]})
    series = make_series(state)
    mis = extra.get('mis') or {}
    pre = extra.get('pre') or []
    next_div = {}
    for p in sorted(pre, key=lambda x: x['d'] or dt.date.max):
        if p['d'] and p['d'] >= now.date() and p['code'] not in next_div:
            next_div[p['code']] = {'d': d2i(p['d']), 'cash': p['cash'], 'tba': p['tba']}

    # ---- 回測（全部 ETF）
    bt_rows = {}
    for code, s in series.items():
        try:
            bt_rows[code] = backtest.run_series(s, ctx)
        except Exception:  # noqa: BLE001
            traceback.print_exc()
    cats = {c: s.cat for c, s in series.items()}
    sim_idx = backtest.similar_index(bt_rows, cats)

    # ---- 今天的觀點
    views_today = {}
    summary_rows = []
    hist_cache = {}
    asof_all = 0
    for code, s in series.items():
        i = s.n - 1
        d = s.dates[i]
        asof_all = max(asof_all, d)
        m = mis.get(code)
        live = None
        if m and m.get('premium') is not None and str(m.get('date')) == str(d):
            live = {'premium': m['premium'], 'nav': m.get('est_nav'), 'time': m.get('time'), 'kind': 'est'}
        try:
            r = engine.analyze(s, i, ctx, live=live, hist_cache=hist_cache)
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            continue
        if r is None:
            continue
        r['summary'] = narrative.summarize(s.name, r)
        r['similar'] = backtest.similar_lookup(sim_idx, s.cat, r['stance'], r['conf'])
        views_today[code] = [r['stance'], r['score'], r['conf']]
        write_detail(out_dir, s, r, state, bt_rows.get(code) or [], next_div.get(code), m, ctx)
        summary_rows.append(summary_row(s, r, m, next_div.get(code), state))

    # 上市不久、資料不足的 ETF 也列出來（沒有觀點）
    for code, daily in state['daily'].items():
        if code in series or not daily['d']:
            continue
        meta = state['meta'].get(code, {})
        k = len(daily['d']) - 1
        prev = daily['c'][k - 1] if k > 0 else None
        m = mis.get(code)
        summary_rows.append({
            'c': code, 'n': meta.get('name', code), 'k': meta.get('cat') or _cat(code, meta.get('name', '')),
            'm': meta.get('market', 'tse'), 'p': daily['c'][k], 'pc': r4((daily['c'][k] / prev - 1) * 100, 2) if prev else None,
            'st': None, 'young': len(daily['d']), 'd': daily['d'][k],
            'pr': m.get('premium') if m else None, 'sp': [r4(x, 3) for x in daily['c'][-40:]],
        })

    # ---- 記錄今天的觀點，供日後驗證（只在收盤資料到齊後）
    if asof_all and views_today:
        state['views'][str(asof_all)] = {c: v for c, v in views_today.items()
                                         if series[c].dates[-1] == asof_all}
        keys = sorted(state['views'].keys())
        for k in keys[:-420]:
            del state['views'][k]

    live_rows, pending = backtest.live_record(state['views'], series)
    track = make_track(bt_rows, live_rows, pending, cats, series)
    write_json(out_dir / 'track.json', track)

    summary_rows.sort(key=lambda x: x['c'])
    tx = state['taiex']
    market = None
    if tx['d']:
        k = len(tx['d']) - 1
        ma = ctx['taiex_at'](tx['d'][k])
        market = {'d': tx['d'][k], 'close': tx['c'][k],
                  'chg': r4(tx['c'][k] - tx['c'][k - 1], 2) if k else None,
                  'pct': r4((tx['c'][k] / tx['c'][k - 1] - 1) * 100, 2) if k else None,
                  'ma60': r4(ma[1], 2) if ma else None,
                  'val': tx['val'][k] if tx.get('val') else None,
                  'spark': [r4(x, 1) for x in tx['c'][-60:]]}
        mf_days = sorted(state['mflows'].keys())
        if mf_days:
            market['insti'] = {**state['mflows'][mf_days[-1]], 'date': int(mf_days[-1])}
    summary = {
        'generated': now.isoformat(timespec='seconds'), 'asof': asof_all, 'engine': engine.VERSION,
        'horizon': engine.HORIZON, 'market': market, 'etfs': summary_rows,
        'sources': sources_status(state), 'cats': CATEGORY_NAMES,
    }
    write_json(out_dir / 'summary.json', summary)
    write_json(out_dir / 'news.json', make_news(state, pre, risk, series, now))
    write_json(out_dir / 'rules.json', rules_doc())


def _cat(code, name):
    from .series import infer_category
    return infer_category(code, name)


def summary_row(s, r, m, nd, state):
    i = s.n - 1
    raw = s.raw_c
    prev = raw[i - 1] * (s.adj[i - 1] / s.adj[i]) if i > 0 else None   # 前一日價格換算成今天的基準
    lv = r['levels']
    comps = {c['key']: c for c in r['components']}
    y = comps.get('yield', {}).get('facts', {}).get('yield') if 'yield' in comps else None
    if y is None:
        ttm = s.ttm_dividend(s.dates[i])
        y = ttm / raw[i] * 100 if ttm else None
    units = (state['units'].get(s.code) or {})
    u_last = units[max(units, key=int)] if units else None
    nav = (m or {}).get('est_nav') or s.nav[i]
    h = s.holders[-1] if s.holders else None
    return {
        'c': s.code, 'n': s.name, 'k': s.cat, 'm': s.market, 'd': s.dates[i],
        'p': raw[i], 'pc': r4((s.c[i] / s.c[i - 1] - 1) * 100, 2) if i else None,
        'ch': r4(raw[i] - prev, 3) if prev else None,
        'v': r4(s.v[i] / 1000, 0), 'val': r4(s.val[i], 0),
        'pr': r4((m or {}).get('premium'), 2) if m else None,
        'st': r['stance'], 'sc': r['score'], 'cf': r['conf'], 'a': r['advice']['action'],
        'iv': lv['invalid']['price'] if lv.get('invalid') else None,
        's1': lv['support'][0]['price'] if lv['support'] else None,
        'r1': lv['resistance'][0]['price'] if lv['resistance'] else None,
        'sp': [r4(x * s.raw_price_factor(i), 3) for x in s.c[-40:]],
        'dv': nd, 'fl': [f['key'] for f in r['flags']], 'y': r4(y, 2),
        'aum': r4(u_last * nav, 0) if (u_last and nav) else None,
        'hd': h[1] if h else None, 'cov': r['coverage'],
        'sim': r.get('similar'),
    }


def write_detail(out_dir, s, r, state, bt, nd, m, ctx):
    i = s.n - 1
    k0 = max(0, s.n - 260)
    f = s.raw_price_factor(i)

    def arr(a, n=3, scale=True):
        return [r4(x * f if (scale and x is not None) else x, n) for x in a[k0:]]

    # 過去 120 天每天的觀點（畫在圖上看規則的軌跡）
    hist = []
    cache = {}
    for k in range(max(130, s.n - 120), s.n):
        try:
            v = engine.analyze(s, k, ctx, live=None, hist_cache=cache, full=False)
        except Exception:  # noqa: BLE001
            v = None
        if v:
            hist.append([s.dates[k], v['stance'], v['score'], v['conf']])
    fl_k0 = max(0, s.n - 60)
    detail = {
        'code': s.code, 'name': s.name, 'cat': s.cat, 'market': s.market, 'asof': s.dates[i],
        'price': s.raw_c[i], 'adjusted_note': '圖表價格已還原權息與分割，以目前價格為基準',
        'bars': {'d': s.dates[k0:], 'o': arr(s.o), 'h': arr(s.h), 'l': arr(s.l), 'c': arr(s.c),
                 'v': [r4(x / 1000, 0) for x in s.v_adj[k0:]]},
        'ma': {'20': arr(s.ma20), '60': arr(s.ma60), '120': arr(s.ma120)},
        'view': r, 'hist': hist,
        'flows': {'d': s.dates[fl_k0:], 'f': s.flow_f[fl_k0:], 't': s.flow_t[fl_k0:], 'dl': s.flow_d[fl_k0:]},
        'margin': {'d': s.dates[fl_k0:], 'm': s.margin[fl_k0:]},
        'nav': {'d': s.dates[fl_k0:], 'nav': s.nav[fl_k0:], 'c': s.raw_c[fl_k0:]},
        'divs': [list(x) for x in s.divs if x[0] >= s.dates[i] - 30000],
        'div_next': nd, 'splits': s.splits,
        'holders': s.holders[-26:],
        'units': sorted([[int(k), v] for k, v in (state['units'].get(s.code) or {}).items()])[-60:],
        'mis': m, 'bt': backtest.stats(bt), 'bt_calib': backtest.calibration(bt) if bt else None,
    }
    write_json(out_dir / 'etf' / f'{s.code}.json', detail)


def make_track(bt_rows, live_rows, pending, cats, series):
    allrows = [r for rows in bt_rows.values() for r in rows]
    by_cat = {}
    for code, rows in bt_rows.items():
        by_cat.setdefault(cats.get(code), []).extend(rows)
    live_all = [r for rows in live_rows.values() for r in rows]
    best = []
    for code, rows in bt_rows.items():
        st = backtest.stats(rows)
        if st and st['bull']['n'] >= 15:
            best.append({'c': code, 'n': series[code].name, 'k': cats.get(code), 'bull_hit': st['bull']['hit'],
                         'base': st['base_up'], 'bull_n': st['bull']['n'], 'bear_hit': st['bear']['hit'],
                         'bear_n': st['bear']['n'], 'edge': r4((st['bull']['avg'] or 0) - (st['bear']['avg'] or 0), 4)})
    return {
        'method': {'step': backtest.STEP, 'horizon': engine.HORIZON,
                   'note': '每 5 個交易日取一次樣本，只用當天以前的資料；報酬為 20 個交易日後的含息報酬。'
                           '樣本期間彼此部分重疊，實際獨立樣本約為筆數的四分之一。'},
        'overall': backtest.stats(sorted(allrows)),
        'calib': backtest.calibration(allrows),
        'by_cat': {k: backtest.stats(sorted(v)) for k, v in by_cat.items() if v},
        'live': backtest.stats(sorted(live_all)) if live_all else None,
        'live_pending': pending,
        'per_etf': sorted(best, key=lambda x: x['c']),
    }


def sources_status(state):
    out = {}
    for key, (name, url) in src.SOURCE_INFO.items():
        st = state['status'].get(key, {})
        out[key] = {'name': name, 'url': url, 'ok_at': st.get('ok_at'), 'err_at': st.get('err_at')}
    return out


def make_news(state, pre, risk, series, now):
    items = [x for x in state['news'] if x.get('d') and x['d'] >= d2i(now.date() - dt.timedelta(days=21))]
    names = {c: (s.name if hasattr(s, 'name') else s) for c, s in series.items()} or \
        {c: m.get('name', c) for c, m in state['meta'].items()}
    for it in items:
        it['codes'] = sorted({c for c in re.findall(r'00\d{2,4}[A-Z]?', it['t']) if c in names})
    upcoming = []
    for p in pre:
        if p['d'] and p['d'] >= now.date() - dt.timedelta(days=1):
            upcoming.append({'c': p['code'], 'n': p['name'], 'd': d2i(p['d']), 'cash': p['cash'], 'tba': p['tba']})
    upcoming.sort(key=lambda x: (x['d'], x['c']))
    etf_risk = [x for x in risk if src.is_etf_code(x['code'])]
    return {'generated': now.isoformat(timespec='seconds'), 'items': items[:250], 'divs': upcoming,
            'risk': etf_risk, 'risk_total': len(risk)}


def rules_doc():
    return {
        'version': engine.VERSION, 'horizon': engine.HORIZON, 'weights': engine.WEIGHTS,
        'names': engine.COMPONENT_NAMES, 'bull': engine.BULL_TH, 'bear': engine.BEAR_TH,
    }
