"""每一輪更新的流程：抓官方資料 → 存進 state 分支 → 算觀點與戰績 → 輸出 App 用的 JSON。"""
import bisect
import datetime as dt
import hashlib
import json
import math
import pathlib
import re
import shutil
import threading
import time
import traceback

from . import backtest, engine, gitstate, holdings, narrative, tape
from . import sources as src
from .series import CATEGORY_NAMES, Series, d2i, i2d
from .state import State
from .util import TW, Http, now_tw, write_json

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / 'site'
PUBLIC = ROOT / 'public'
STATE_DIR = '.state'

MIN_BARS = 70
# 歷史資料從 2020 年起：回測要包含 2022 年的大跌，不能只看一段多頭
HISTORY_START = dt.date(2020, 1, 1)
DIV_HISTORY_START = dt.date(2019, 1, 1)   # 還原權息要比價格早一點開始
DONE_KEEP = 6000                           # 回補完成日期清單保留的筆數（要大於歷史交易日數）


def backfill_months(today: dt.date) -> int:
    return (today.year - HISTORY_START.year) * 12 + today.month - HISTORY_START.month + 1


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
        if len(lst) > DONE_KEEP:
            del lst[:len(lst) - DONE_KEEP]


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
    step(log, 'taiex_months', update_taiex, state, http, _months_back(now.date(), backfill_months(now.date())))
    days = sorted(trading_days(state), reverse=True)
    days = [d for d in days if d2i(HISTORY_START) <= d <= d2i(now.date())]
    plan = [('daily', days), ('flows', days), ('margin', days)]
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
    step(log, 'yields_history', update_yields, state, Http(1.5), list(range(DIV_HISTORY_START.year, now.year + 1)))


def twse_dividend_history(state, http, today):
    got = 0
    cur = DIV_HISTORY_START
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


def tpex_dividend_history(state, today):
    """櫃買中心 除權除息計算結果表，每季查一段，補齊上櫃 ETF（多為債券 ETF）的歷史配息。"""
    http = Http(2.3)
    got = 0
    cur = DIV_HISTORY_START
    while cur <= today:
        nxt = dt.date(cur.year + (cur.month + 3 > 12), (cur.month + 2) % 12 + 1, 1)
        end = min(nxt - dt.timedelta(days=1), today)
        try:
            for r in src.tpex_dividends(http, cur, end):
                add_div(state, r['code'], d2i(r['d']), r['cash'])
                got += 1
        except Exception as e:  # noqa: BLE001
            print(f'[tpex_div {cur}] {e!r}', flush=True)
        cur = nxt
    state.mark('tpex_div', when=now_tw().isoformat(timespec='minutes'))
    state['backfill']['tpex_div_hist'] = [d2i(today)]
    return got


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
    pre += step(log, 'tpex_div_pre', src.tpex_dividend_preview, http_x) or []
    if not state['backfill'].get('tpex_div_hist'):
        step(log, 'tpex_div_history', tpex_dividend_history, state, today)
    tp = step(log, 'tpex_div', src.tpex_dividends, http_tp, today - dt.timedelta(days=45), today) or []
    for r in tp:
        add_div(state, r['code'], d2i(r['d']), r['cash'])
    if tp:
        state.mark('tpex_div', when=when)
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
    # ETF 成分股（投信投顧公會每月前十大、每季明細）：17:00 以後那幾輪才做（一天檢查一次，不拖慢 14:25 的收盤計算）
    if weekly or now.hour >= 17 or not state['hold'].get('m'):
        got = step(log, 'sitca_holdings', holdings.update, state, Http(2.3), today)
        if got and got != 'skip':
            state.mark('sitca', when=when)
    # 成分股的官方收盤、本益比、月營收：每一輪都檢查，直到是最新交易日的資料（不是一天一次，免得卡在舊的）
    days = trading_days(state)
    sk = step(log, 'stocks', holdings.update_stocks, state, Http(1.5), Http(1.5), today, target=days[-1] if days else None)
    if sk and sk not in ('skip', 'no-holdings'):
        state.mark('stocks', when=when)
    # 成分股的即時行情（收盤後是當天收盤時的資料；官方收盤資料還沒出來之前 App 先用它）
    sq = step(log, 'stock_quotes', holdings.stock_quotes, state)
    # 沙盤用：交易日曆、盤後零股與盤後定價結果、今天的 tape 收尾並封存
    step(log, 'sandtable_cal', tape.update_cal, state, log, http_tw)
    step(log, 'sandtable_after', tape.update_after, state, log, http_tw)
    step(log, 'sandtable_finish', tape.finish_day, state, log)
    # 證交所即時資料的日期（判斷今天有沒有開市用，颱風假也一樣；失敗就當作不知道）
    tx = step(log, 'mis_taiex', src.mis_quotes, http_x, ['tse_t00.tw']) or {}
    state['_extra'] = {'mis': mis, 'pre': pre, 'risk': risk, 'news': news, 'taiex_live': tx.get('t00'), 'stockq': sq}
    store_news(state, news)


def trickle_backfill(state, http_tw, http_tp, when, per_market):
    """大量回補若被中斷，平常每次收盤後的更新順便補幾天，幾天內就能補齊。"""
    days = sorted([d for d in trading_days(state) if d2i(HISTORY_START) <= d <= d2i(now_tw().date())], reverse=True)
    plan = [('daily', days), ('flows', days), ('margin', days)]
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
    # 成分股的即時行情（ETF 透視的成分股小卡用）
    sq = step(log, 'stock_quotes', holdings.stock_quotes, state)
    # 沙盤用的五檔與 tape（失敗也不影響冷眼）
    tp = step(log, 'sandtable_tape', tape.intraday, state, log)
    state['_extra'] = {'mis': mis, 'taiex_live': tx.get('t00'), 'news_changed': bool(fresh), 'tape': tp, 'stockq': sq}


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


def active_codes(state):
    """最近 10 個交易日內有成交紀錄的 ETF；更早就停止交易的（下市、合併、暫停）不列入。"""
    days = trading_days(state)
    cutoff = days[-10] if len(days) >= 10 else 0
    return {c for c, d in state['daily'].items() if d['d'] and d['d'][-1] >= cutoff}


def make_series(state, inactive=False):
    """預設只做還在交易的 ETF；inactive=True 只做已經下市、停止交易的（回測要算進去，避免只看「活下來的」造成高估）。"""
    out = {}
    active = active_codes(state)
    for code, daily in state['daily'].items():
        if (code in active) == inactive or len(daily['d']) < MIN_BARS:
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
    step(log, 'sandtable_publish', tape.publish, PUBLIC / 'data', extra.get('tape'))
    live = make_live(state, extra, now, mode)
    write_json(PUBLIC / 'data' / 'live.json', live)
    if extra.get('stockq'):
        write_json(PUBLIC / 'data' / 'stockq.json', extra['stockq'])
    # 各份資料的時間戳：App 每分鐘看一次這個小檔，哪一份變了就只重抓那一份（幾分鐘內就同步）
    write_json(PUBLIC / 'data' / 'version.json', {'built': now.isoformat(timespec='seconds'), 'mode': mode,
                                                  'files': file_stamps(PUBLIC / 'data')})
    (PUBLIC / '.nojekyll').write_text('', encoding='utf-8')
    # service worker 的版本號 = 介面檔案內容的指紋：程式真的有改才換新版，
    # 盤中每 5 分鐘一次的資料更新不會讓手機每次打開都重新下載整個 App
    sw = PUBLIC / 'sw.js'
    if sw.exists():
        sw.write_text(sw.read_text(encoding='utf-8').replace('__BUILD__', site_fingerprint()), encoding='utf-8')
    return True


STAMPS = (('summary', 'generated'), ('live', 'at'), ('news', 'generated'), ('stockq', 'at'), ('stocks', 'at'), ('hold', 'at'))


def file_stamps(data_dir):
    """每一份資料自己帶的時間（summary 的 generated、live 的 at…）。App 拿手上那一份的同一個欄位來比，
    不一樣就重抓。讀不到的不列（App 會照舊方式定時更新）。"""
    out = {}
    for name, key in STAMPS:
        try:
            v = json.loads((data_dir / f'{name}.json').read_text(encoding='utf-8')).get(key)
        except Exception:  # noqa: BLE001
            continue
        if v:
            out[name] = str(v)
    return out


def site_fingerprint():
    h = hashlib.sha1()
    for f in sorted(SITE.rglob('*')):
        if f.is_file() and f.name != 'sw.js' and '__pycache__' not in f.parts:
            h.update(str(f.relative_to(SITE)).encode('utf-8'))
            h.update(f.read_bytes())
    h.update((SITE / 'sw.js').read_bytes())
    return h.hexdigest()[:12]


def market_day(extra):
    """證交所即時成交資料本身的日期（加權指數 t00、沙盤 tape 那一輪多數 ETF 的 d），取比較早的那個。
    投信的預估淨值檔（all_etf.txt）在颱風假也會標「今天」的日期，價格卻是前一個交易日的，不能拿來判斷今天有沒有開市。"""
    days = []
    tx = extra.get('taiex_live') or {}
    if str(tx.get('d') or '').isdigit():
        days.append(int(tx['d']))
    reg = ((extra.get('tape') or {}).get('last') or {}).get('reg') or {}
    ds = [q.get('d') for q in reg.values() if isinstance(q, dict) and q.get('d')]
    if ds:
        days.append(max(set(ds), key=ds.count))
    return min(days) if days else None


def make_live(state, extra, now, mode):
    mis = extra.get('mis') or {}
    mday = market_day(extra)
    etfs = {}
    for code, m in mis.items():
        if not m.get('px') or not m.get('est_nav'):
            continue
        d = int(m['date']) if str(m.get('date', '')).isdigit() else None
        if d and mday and d > mday:
            d = mday          # 價格不可能比市場最新的成交日還新（颱風假時投信檔的日期是今天）
        etfs[code] = [m.get('px'), m.get('est_nav'), m.get('premium'), m.get('time'), m.get('units_chg'), d]
    tx = extra.get('taiex_live')
    hm = now.hour * 100 + now.minute
    open_now = now.weekday() < 5 and 900 <= hm <= 1335
    mis_day = max((int(m['date']) for m in mis.values() if str(m.get('date', '')).isdigit()), default=None)
    return {'at': now.isoformat(timespec='seconds'), 'mode': mode, 'open': open_now,
            'date': mday or mis_day,
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
    series_bt = {**make_series(state, inactive=True), **series}
    mis = extra.get('mis') or {}
    pre = extra.get('pre') or []
    next_div = {}
    for p in sorted(pre, key=lambda x: x['d'] or dt.date.max):
        if p['d'] and p['d'] >= now.date() and p['code'] not in next_div:
            next_div[p['code']] = {'d': d2i(p['d']), 'cash': p['cash'], 'tba': p['tba']}

    # ---- 回測（全部 ETF）
    bt_rows = {}
    for code, s in series_bt.items():
        try:
            bt_rows[code] = backtest.run_series(s, ctx)
        except Exception:  # noqa: BLE001
            traceback.print_exc()
    cats = {c: s.cat for c, s in series_bt.items()}
    ctx['cat_edge'] = backtest.category_edge(bt_rows, cats)
    pos_cat = backtest.pos_stats_by_cat(bt_rows, cats)
    overall_edge = backtest.category_edge({'*': [r for rows in bt_rows.values() for r in rows]}, {'*': '*'}, min_n=1).get('*', {})

    def similar_of(cat, stance):
        if stance == 0:
            return None
        e = (ctx['cat_edge'].get(cat) or {}).get(stance)
        if e:
            return {**e, 'scope': 'cat'}
        e = overall_edge.get(stance)
        return {**e, 'scope': 'all'} if e else None

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
        if mis_ok(m, d) and m.get('premium') is not None:
            live = {'premium': m['premium'], 'nav': m.get('est_nav'), 'time': m.get('time'), 'kind': 'est'}
        elif not mis_ok(m, d):
            m = None
        try:
            r = engine.analyze(s, i, ctx, live=live, hist_cache=hist_cache)
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            continue
        if r is None:
            continue
        r['summary'] = narrative.summarize(s.name, r)
        r['similar'] = similar_of(s.cat, r['stance'])
        views_today[code] = [r['stance'], r['score'], r['conf'], r['ps']]
        write_detail(out_dir, s, r, state, bt_rows.get(code) or [], next_div.get(code), m, ctx,
                     pos_cat.get(s.cat) or pos_cat.get('*'))
        summary_rows.append(summary_row(s, r, m, next_div.get(code), state))

    # 上市不久、資料不足的 ETF 也列出來（沒有觀點）
    active = active_codes(state)
    for code, daily in state['daily'].items():
        if code in series or not daily['d'] or code not in active:
            continue
        meta = state['meta'].get(code, {})
        k = len(daily['d']) - 1
        prev = daily['c'][k - 1] if k > 0 else None
        m = mis.get(code)
        summary_rows.append({
            'c': code, 'n': meta.get('name', code), 'k': meta.get('cat') or _cat(code, meta.get('name', '')),
            'm': meta.get('market', 'tse'), 'p': daily['c'][k], 'pc': r4((daily['c'][k] / prev - 1) * 100, 2) if prev else None,
            'st': None, 'young': len(daily['d']), 'd': daily['d'][k],
            'pr': m.get('premium') if mis_ok(m, daily['d'][k]) else None, 'sp': [r4(x, 3) for x in daily['c'][-40:]],
            'dv': next_div.get(code),
        })

    # ---- 記錄今天的觀點，供日後驗證（只在收盤資料到齊後）
    if asof_all and views_today:
        state['views'][str(asof_all)] = {c: v for c, v in views_today.items()
                                         if series[c].dates[-1] == asof_all}
        keys = sorted(state['views'].keys())
        for k in keys[:-420]:
            del state['views'][k]

    live_rows, pending = backtest.live_record(state['views'], series)
    track = make_track(bt_rows, live_rows, pending, cats, series_bt)
    track['delisted_n'] = sum(1 for c in series_bt if c not in series)
    track['pos'] = pos_cat
    track['pos_adj'] = backtest.pos_adjusted(pos_cat)
    live_all = [r for rows in live_rows.values() for r in rows]
    track['live_pos'] = backtest.pos_stats(live_all) if live_all else None
    write_json(out_dir / 'track.json', track)
    write_json(out_dir / 'divs.json', make_divs(state, series, summary_rows, now))
    write_hist(out_dir, series, bt_rows, ctx)

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
    # 沙盤用：K 線、交易日曆、盤後結果（失敗不影響冷眼）
    try:
        tape.write_outputs(out_dir, state, sorted(series.keys()))
    except Exception:  # noqa: BLE001
        traceback.print_exc()
    # ETF 透視：成分股與個股資料（失敗不影響其他輸出）
    try:
        holdings.write_out(state, out_dir)
    except Exception:  # noqa: BLE001
        traceback.print_exc()


def mis_ok(m, d):
    """MIS 的預估淨值與折溢價，只有在資料日期等於該 ETF 最後交易日、而且有成交價時才可信。"""
    return bool(m) and str(m.get('date')) == str(d) and bool(m.get('px')) and bool(m.get('est_nav'))


def _cat(code, name):
    from .series import infer_category
    return infer_category(code, name)


def perf_stats(s, i, days=250):
    """近一年（250 個交易日）的含息報酬、年化波動、最大回檔，都用還原權息價計算。資料不滿一年回傳 None。"""
    if i < days:
        return None, None, None
    c = s.c[i - days:i + 1]
    r1y = c[-1] / c[0] - 1
    rets = [math.log(c[k] / c[k - 1]) for k in range(1, len(c)) if c[k] and c[k - 1]]
    mu = sum(rets) / len(rets)
    vol = math.sqrt(sum((x - mu) ** 2 for x in rets) / max(1, len(rets) - 1)) * math.sqrt(250)
    peak, mdd = c[0], 0.0
    for x in c:
        peak = max(peak, x)
        mdd = max(mdd, 1 - x / peak)
    return r1y, vol, mdd


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
    pos = r.get('position') or {}
    yp = comps.get('yield', {}).get('facts', {}).get('pctl') if 'yield' in comps else None
    pb = lv.get('pullback')
    r1y, vol1y, mdd1y = perf_stats(s, i)
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
        # 部位訊號與個人化計算要用的價位（實際成交價格）
        'ps': pos.get('key'), 'dl': pos.get('dl'), 'pb': pb['price'] if pb else None,
        'atr': (r.get('risk') or {}).get('atr'), 'rsi': pos.get('rsi'), 'm20': pos.get('ma20'),
        'yp': r4(yp, 3), 'hot': pos.get('hot'), 'blw': pos.get('below'), 'fx': s.foreign,
        # ETF 對決用：近一年含息報酬、年化波動、最大回檔（小數，0.12 = 12%）
        'r1y': r4(r1y), 'vol': r4(vol1y), 'mdd': r4(mdd1y), 'since': s.dates[0],
    }


def write_detail(out_dir, s, r, state, bt, nd, m, ctx, pos_bt=None):
    i = s.n - 1
    k0 = max(0, s.n - 260)
    f = s.raw_price_factor(i)

    def arr(a, n=3, scale=True):
        return [r4(x * f if (scale and x is not None) else x, n) for x in a[k0:]]

    # 過去 120 天每天的觀點（畫在圖上看規則的軌跡）
    hist = []
    cache = {}
    ctx_hist = {k: v for k, v in ctx.items() if k != 'cat_edge'}
    for k in range(max(130, s.n - 120), s.n):
        try:
            v = engine.analyze(s, k, ctx_hist, live=None, hist_cache=cache, full=False)
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
        'pos_bt': pos_bt, 'pos_bt_self': backtest.pos_stats(bt) if bt else None,
    }
    write_json(out_dir / 'etf' / f'{s.code}.json', detail)


def write_hist(out_dir, series, bt_rows, ctx):
    """存股時光機用：每檔 ETF 的完整日收盤（實際成交價，非還原）、配息、分割，
    以及每 5 個交易日一次的部位訊號（和回測同一套取樣；最後 20 天回測沒有樣本，另外補算）。"""
    hdir = out_dir / 'hist'
    hdir.mkdir(parents=True, exist_ok=True)
    ctx_hist = {k: v for k, v in ctx.items() if k != 'cat_edge'}
    for code, s in series.items():
        sig = [[r[0], r[5]] for r in (bt_rows.get(code) or []) if r[5]]
        k = (s.idx(sig[-1][0]) + backtest.STEP) if sig else 130
        cache = {}
        while k < s.n:
            try:
                v = engine.analyze(s, k, ctx_hist, live=None, hist_cache=cache, full=False)
            except Exception:  # noqa: BLE001
                v = None
            if v and v.get('ps'):
                sig.append([s.dates[k], v['ps']])
            k += backtest.STEP
        write_json(hdir / f'{code}.json', {
            'c': code, 'd': s.dates, 'p': [r4(x, 3) for x in s.raw_c], 'sig': sig,
            'splits': [list(x) for x in s.splits], 'divs': [list(x) for x in s.divs if x[1]],
        })


def make_divs(state, series, rows, now):
    """給 App 算持股配息用：每檔 ETF 完整歷史的除息紀錄（除息日、每單位現金）與分割紀錄。"""
    today = d2i(now.date())
    out = {}
    for row in rows:
        code = row['c']
        s = series.get(code)
        divs = [list(x) for x in (s.divs if s else state['divs'].get(code, [])) if x[1]]
        splits = [list(x) for x in (s.splits if s else [])]
        if divs or splits:
            out[code] = {'d': divs, 's': splits}
    return out


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
    edge = backtest.category_edge(bt_rows, cats)
    by_cat_stats = {k: backtest.stats(sorted(v)) for k, v in by_cat.items() if v}
    live_by_cat = {}
    for code, rows in live_rows.items():
        live_by_cat.setdefault(cats.get(code), []).extend(rows)
    live_cat_stats = {k: backtest.stats(sorted(v)) for k, v in live_by_cat.items() if v}
    return {
        'edge': edge,
        'method': {'step': backtest.STEP, 'horizon': engine.HORIZON,
                   'note': '每 5 個交易日取一次樣本，只用當天以前的資料；報酬為 20 個交易日後的含息報酬。'
                           '樣本期間彼此部分重疊，實際獨立樣本約為筆數的四分之一。'},
        'overall': backtest.stats(sorted(allrows)),
        'overall_adj': backtest.adjusted_base(by_cat_stats),
        'calib': backtest.calibration_by_cat(bt_rows, cats),
        'by_cat': by_cat_stats,
        'live': backtest.stats(sorted(live_all)) if live_all else None,
        'live_adj': backtest.adjusted_base(live_cat_stats) if live_cat_stats else None,
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
    items = []
    for x in state['news']:
        if not x.get('d') or x['d'] < d2i(now.date() - dt.timedelta(days=21)):
            continue
        k = classify(x)   # 過濾規則更新後，舊資料也重新套用一次
        if k:
            items.append({**x, 'kind': k})
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
        'version': engine.VERSION, 'horizon': engine.HORIZON, 'weights': engine.WEIGHTS, 'weak_edge': engine.WEAK_EDGE,
        'names': engine.COMPONENT_NAMES, 'bull': engine.BULL_TH, 'bear': engine.BEAR_TH,
        'position': {'chandelier_n': engine.CHANDELIER_N, 'chandelier_k': engine.CHANDELIER_K,
                     'extended_atr': engine.EXTENDED_ATR, 'names': engine.POS_NAMES},
    }
