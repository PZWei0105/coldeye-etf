"""全球市場與市場溫度：美股指數、費城半導體、VIX、新台幣匯率、台指期夜盤（加碼計畫的「市場溫度」用）。

來源（官方一手；2026/10/30 PZ 同意把來源名單擴大到這幾個）：
- Cboe 芝加哥選擇權交易所（VIX 的編製者、S&P 500 指數選擇權的交易所）：VIX 歷史收盤、S&P 500 歷史、兩者的延遲報價
- Nasdaq 那斯達克（那斯達克 100、費城半導體指數的編製者）：歷史收盤與延遲報價
- 中央銀行：新台幣對美元匯率日資料（BP01D01，每天 16:00 銀行間即期匯率）
- 臺灣期貨交易所 MIS：台指期一般（日盤）、盤後（夜盤）行情
- 美國財政部：10 年期公債殖利率（既有的 state['yields']）
GitHub Actions 上實測過（2026/10/30 probe）；FRED（聖路易聯準銀行）從 GitHub Actions 連不上，沒有用。

市場溫度：七個「風險升高」的警訊數一數（固定門檻在 TEMP），2 個以上「陰」、4 個以上或 VIX ≥ 35「雨」；
台指期夜盤沒有歷史可以回測，只當作「今天開盤」的提醒，不算進警訊數。
陰、雨時加碼計畫的「單筆最多虧損」預算打折（倍數在 TEMP['levels']；回測見 tests/temp_backtest.py 的說明）。
"""
import bisect
import datetime as dt
import re

from .util import now_tw

START = 20190101               # 歷史從 2019 年起（2020 年開始就算得出 200 日均線）
CBOE_Q = 'https://cdn.cboe.com/api/global/delayed_quotes/quotes/_{sym}.json'
CBOE_VIX_HIST = 'https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv'
CBOE_CHART = 'https://cdn.cboe.com/api/global/delayed_quotes/charts/historical/_{sym}.json'
NQ_HIST = 'https://api.nasdaq.com/api/quote/{sym}/historical?assetclass=index&fromdate={start}&limit=9999'
NQ_INFO = 'https://api.nasdaq.com/api/quote/{sym}/info?assetclass=index'
NQ_HEADERS = {'Accept': 'application/json, text/plain, */*', 'Origin': 'https://www.nasdaq.com',
              'Referer': 'https://www.nasdaq.com/'}
CBC_FX = 'https://cpx.cbc.gov.tw/API/DataAPI/Get?FileName=BP01D01'
TAIFEX_MIS = 'https://mis.taifex.com.tw/futures/api/getQuoteList'
TAIFEX_HEADERS = {'Content-Type': 'application/json;charset=UTF-8', 'Origin': 'https://mis.taifex.com.tw',
                  'Referer': 'https://mis.taifex.com.tw/futures/AfterHoursSession/EquityIndices/FuturesDomestic/'}

SOURCES = {
    'cboe': ('Cboe 芝加哥選擇權交易所 VIX、S&P 500', 'https://www.cboe.com/tradable_products/vix/vix_historical_data/'),
    'nasdaq': ('Nasdaq 那斯達克 100、費城半導體指數', 'https://www.nasdaq.com/market-activity/index/sox'),
    'cbc_fx': ('中央銀行 新台幣對美元匯率', 'https://cpx.cbc.gov.tw/Data/DataMain?pxfilename=BP01D01.px'),
    'taifex': ('臺灣期貨交易所 台指期行情（含夜盤）', 'https://mis.taifex.com.tw/futures/'),
}
NAMES = {'spx': 'S&P 500', 'ndx': '那斯達克 100', 'sox': '費城半導體', 'vix': 'VIX 恐慌指數', 'twd': '新台幣（每美元）'}

# 市場溫度的固定門檻（改了要同步 App 設定頁的說明，calc.js 的 tempRulesHTML 照 global.json 裡的 rule 寫）
TEMP = {
    'ma_tw': 60,          # 加權指數的季線
    'ma_us': 200,         # 美股、費半的 200 日均線
    'breadth_low': 0.5,   # 一半以上的 ETF（不含反向型）收盤在自己的季線之下
    'vix_hi': 25,         # VIX 25 以上：市場緊張
    'vix_panic': 35,      # VIX 35 以上：恐慌，直接算「雨」
    'twd_weak': 2.0,      # 新台幣 20 個交易日貶值超過 2%（外資匯出的壓力）
    'ust_jump': 0.5,      # 美國 10 年期公債殖利率 20 個交易日上升超過 0.5 個百分點
    'night_drop': -1.5,   # 台指期夜盤跌超過 1.5%：只提醒隔天開盤的壓力，不算進警訊數
    # 幾個警訊以上算哪一級：(門檻, 名稱, 單筆最多虧損預算的倍數)
    'levels': [(0, '晴', 1.0), (2, '陰', 0.75), (4, '雨', 0.5)],
}


# ---------------------------------------------------------------- 解析（純函式，tests/global_test.py 會測）

def _num(s):
    if s is None:
        return None
    t = str(s).replace(',', '').replace('%', '').replace('$', '').strip()
    if t in ('', '--', '-', 'N/A'):
        return None
    try:
        return float(t)
    except ValueError:
        return None


def _mdy(s):
    """'10/28/2026' → 20261028"""
    m = re.match(r'^\s*(\d{1,2})/(\d{1,2})/(\d{4})\s*$', str(s or ''))
    return int(m.group(3)) * 10000 + int(m.group(1)) * 100 + int(m.group(2)) if m else None


def _ymd(s):
    """'2026-10-28' 或 '2026-10-28T13:37:31' → 20261028"""
    m = re.match(r'^\s*(\d{4})-(\d{2})-(\d{2})', str(s or ''))
    return int(m.group(1)) * 10000 + int(m.group(2)) * 100 + int(m.group(3)) if m else None


def parse_vix_csv(text, start=START):
    """Cboe VIX_History.csv：DATE,OPEN,HIGH,LOW,CLOSE（日期 MM/DD/YYYY）→ [(yyyymmdd, 收盤)]"""
    out = []
    for line in (text or '').splitlines()[1:]:
        p = line.split(',')
        if len(p) < 5:
            continue
        d, c = _mdy(p[0]), _num(p[4])
        if d and c is not None and d >= start:
            out.append((d, c))
    return sorted(set(out))


def parse_cboe_chart(js, start=START):
    """Cboe 歷史圖表 JSON：{data: [{date: 'YYYY-MM-DD', close}]} → [(yyyymmdd, 收盤)]"""
    out = []
    for r in (js or {}).get('data') or []:
        d, c = _ymd(r.get('date')), _num(r.get('close'))
        if d and c and d >= start:
            out.append((d, c))
    return sorted(set(out))


def parse_nasdaq_hist(js, start=START):
    """Nasdaq 歷史：{data: {tradesTable: {rows: [{date: 'MM/DD/YYYY', close: '11,684.00'}]}}} → [(yyyymmdd, 收盤)]"""
    rows = (((js or {}).get('data') or {}).get('tradesTable') or {}).get('rows') or []
    out = []
    for r in rows:
        d, c = _mdy(r.get('date')), _num(r.get('close'))
        if d and c and d >= start:
            out.append((d, c))
    return sorted(set(out))


def parse_cboe_quote(js):
    """Cboe 延遲報價 → {px, prev, pct, d（美東日期）, t（美東時間 HH:MM）}；格式不對回傳 None"""
    q = (js or {}).get('data') or {}
    px, prev = _num(q.get('current_price')), _num(q.get('prev_day_close'))
    lt = str(q.get('last_trade_time') or '')
    d = _ymd(lt)
    if not (px and d):
        return None
    return {'px': px, 'prev': prev, 'pct': _num(q.get('price_change_percent')), 'd': d, 't': lt[11:16] or None}


_MONTHS = {m: i + 1 for i, m in enumerate(('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'))}


def parse_nasdaq_info(js):
    """Nasdaq 即時資料（延遲）→ {px, prev, pct, d, t, open（盤中與否）}"""
    data = (js or {}).get('data') or {}
    p = data.get('primaryData') or {}
    px = _num(p.get('lastSalePrice'))
    prev = _num((((data.get('keyStats') or {}).get('previousclose') or {}).get('value')))
    ts = str(p.get('lastTradeTimestamp') or '')
    m = re.match(r'^\s*([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*([AP]M))?', ts)
    if not (px and m and m.group(1) in _MONTHS):
        return None
    d = int(m.group(3)) * 10000 + _MONTHS[m.group(1)] * 100 + int(m.group(2))
    t = None
    if m.group(4):
        h = int(m.group(4)) % 12 + (12 if m.group(6) == 'PM' else 0)
        t = f'{h:02d}:{m.group(5)}'
    return {'px': px, 'prev': prev, 'pct': _num(p.get('percentageChange')), 'd': d, 't': t,
            'open': str(data.get('marketStatus') or '').lower() == 'open'}


def parse_cbc_fx(js, start=START):
    """中央銀行 BP01D01：dataSets 每列 [日期, 新台幣, 日圓, …]（每美元兌換多少）→ [(yyyymmdd, 新台幣)]。
    第 1 欄是新台幣；匯率不在 20～50 之間就當作格式變了、不收。"""
    rows = ((js or {}).get('data') or {}).get('dataSets') or []
    out = []
    for r in rows:
        if not isinstance(r, list) or len(r) < 2:
            continue
        try:
            d = int(str(r[0]))
        except ValueError:
            continue
        v = _num(r[1])
        if d >= start and v is not None and 20 < v < 50:
            out.append((d, v))
    return sorted(set(out))


def parse_taifex(js):
    """期交所 MIS 台指期：成交量最大的那一個月份（近月）→ {sym, px, ref, pct, d, t, vol}；沒有成交回傳 None"""
    ql = (((js or {}).get('RtData') or {}).get('QuoteList')) or []
    best = None
    for q in ql:
        sym = str(q.get('SymbolID') or '')
        if not re.match(r'^TXF[A-L]\d-[MF]$', sym):
            continue
        vol = _num(q.get('CTotalVolume')) or 0
        px = _num(q.get('CLastPrice'))
        if not px:
            continue
        if best is None or vol > best['vol']:
            t = str(q.get('CTime') or '')
            best = {'sym': sym, 'name': q.get('DispCName'), 'px': px, 'ref': _num(q.get('CRefPrice')),
                    'pct': _num(q.get('CDiffRate')), 'd': int(q.get('CDate')) if str(q.get('CDate') or '').isdigit() else None,
                    't': f'{t[:2]}:{t[2:4]}' if len(t) >= 4 else None, 'vol': vol}
    return best


# ---------------------------------------------------------------- 抓資料

def _merge(series, pairs):
    """series：{d: [...], c: [...]}；pairs：[(d, c)]。同一天以新的為準，照日期排序。"""
    m = dict(zip(series.get('d') or [], series.get('c') or []))
    for d, c in pairs:
        m[d] = c
    ks = sorted(k for k in m if k >= START)
    series['d'] = ks
    series['c'] = [m[k] for k in ks]
    return series


def fetch_history(http):
    """全部的歷史（一天抓一次）：{spx, ndx, sox, vix, twd: [(d, c)]}；抓不到的那一個不放"""
    out = {}
    errs = {}
    jobs = {
        'vix': lambda: parse_vix_csv(http.get(CBOE_VIX_HIST, timeout=40).text),
        'spx': lambda: parse_cboe_chart(http.json(CBOE_CHART.format(sym='SPX'), timeout=60)),
        'ndx': lambda: parse_nasdaq_hist(http.json(NQ_HIST.format(sym='NDX', start='2019-01-01'), headers=NQ_HEADERS)),
        'sox': lambda: parse_nasdaq_hist(http.json(NQ_HIST.format(sym='SOX', start='2019-01-01'), headers=NQ_HEADERS)),
        'twd': lambda: parse_cbc_fx(http.json(CBC_FX, timeout=60)),
    }
    for k, fn in jobs.items():
        try:
            xs = fn()
            if xs:
                out[k] = xs
            else:
                errs[k] = 'empty'
        except Exception as e:  # noqa: BLE001 — 一個來源失敗不影響其他的
            errs[k] = repr(e)[:200]
    return out, errs


def fetch_quotes(http):
    """最新報價（每一輪都抓，很小）：S&P 500、VIX（Cboe）、那斯達克 100、費半（Nasdaq）、台指期日盤與夜盤（期交所）"""
    out = {}
    errs = {}
    jobs = {
        'spx': lambda: parse_cboe_quote(http.json(CBOE_Q.format(sym='SPX'))),
        'vix': lambda: parse_cboe_quote(http.json(CBOE_Q.format(sym='VIX'))),
        'ndx': lambda: parse_nasdaq_info(http.json(NQ_INFO.format(sym='NDX'), headers=NQ_HEADERS)),
        'sox': lambda: parse_nasdaq_info(http.json(NQ_INFO.format(sym='SOX'), headers=NQ_HEADERS)),
    }
    for k, fn in jobs.items():
        try:
            q = fn()
            if q:
                out[k] = q
            else:
                errs[k] = 'empty'
        except Exception as e:  # noqa: BLE001
            errs[k] = repr(e)[:200]
    for k, mt in (('txf_day', '0'), ('txf_night', '1')):
        try:
            body = {'MarketType': mt, 'SymbolType': 'F', 'KindID': '1', 'CID': 'TXF', 'ExpireMonth': '',
                    'RowSize': '全部', 'PageNo': '', 'SortColumn': '', 'AscDesc': 'A'}
            r = http.post(TAIFEX_MIS, json=body, headers=TAIFEX_HEADERS)
            q = parse_taifex(r.json())
            if q:
                out[k] = q
            else:
                errs[k] = 'empty'
        except Exception as e:  # noqa: BLE001
            errs[k] = repr(e)[:200]
    return out, errs


def update(state, http, now=None, force_history=False):
    """更新 state['global']：報價每一輪都抓；歷史一天抓一次（或 force_history）。回傳 {quotes, history, errors}"""
    now = now or now_tw()
    g = state['global']
    g.setdefault('s', {})
    g.setdefault('q', {})
    stamp = now.isoformat(timespec='minutes')
    errors = {}
    got_h = []
    if force_history or g.get('hist_day') != now.strftime('%Y%m%d') or not g['s']:
        hist, e1 = fetch_history(http)
        errors.update({f'h_{k}': v for k, v in e1.items()})
        for k, xs in hist.items():
            _merge(g['s'].setdefault(k, {'d': [], 'c': []}), xs)
            got_h.append(k)
        if hist:
            g['hist_day'] = now.strftime('%Y%m%d')
    quotes, e2 = fetch_quotes(http)
    errors.update({f'q_{k}': v for k, v in e2.items()})
    for k, q in quotes.items():
        q['at'] = stamp
        g['q'][k] = q
        # 美股收盤之後（不是盤中）的報價，當作那一天的收盤補進歷史：盤後就算得到最新的均線
        if k in ('spx', 'vix', 'ndx', 'sox') and q.get('d') and not q.get('open', False):
            if k in ('ndx', 'sox') or _us_closed(now):
                _merge(g['s'].setdefault(k, {'d': [], 'c': []}), [(q['d'], q['px'])])
    g['at'] = stamp
    g['errors'] = errors
    return {'quotes': sorted(quotes), 'history': got_h, 'errors': errors}


def _us_closed(now):
    """台灣時間 05:10～21:20 美股一定休市（含夏令時間的差別）：這時候 Cboe 的報價就是收盤"""
    hm = now.hour * 100 + now.minute
    return 510 <= hm <= 2120


# ---------------------------------------------------------------- 指標與市場溫度（純函式）

def _ma(xs, n):
    return sum(xs[-n:]) / n if len(xs) >= n else None


def _at(series, d):
    """d 這天（含）以前最後一筆的位置；沒有回傳 -1"""
    return bisect.bisect_right(series['d'], d) - 1


def indicator(series, d, ma):
    """一個指數在 d（含）以前的狀態：最新收盤、那天的日期、均線、在不在均線之下、20 個交易日漲跌（%）"""
    if not series or not series.get('d'):
        return None
    i = _at(series, d)
    if i < 0:
        return None
    cs = series['c'][:i + 1]
    m = _ma(cs, ma)
    r20 = (cs[-1] / cs[-21] - 1) * 100 if len(cs) > 20 and cs[-21] else None
    return {'d': series['d'][i], 'c': cs[-1], 'ma': m, 'below': (cs[-1] < m) if m else None, 'r20': r20,
            'chg': (cs[-1] / cs[-2] - 1) * 100 if len(cs) > 1 and cs[-2] else None}


def temp_level(flags, vix=None):
    """警訊數 → (等級名稱, 倍數)；VIX 恐慌直接算最冷的一級"""
    levels = TEMP['levels']
    n = len(flags)
    lv = levels[0]
    for x in levels:
        if n >= x[0]:
            lv = x
    if vix is not None and vix >= TEMP['vix_panic']:
        lv = levels[-1]
    return lv[1], lv[2]


def market_temp(ind):
    """ind：{ taiex: indicator(季線), breadth: 收在季線之下的比例, spx/sox/ndx: indicator(200 日), vix: 數字,
    twd: indicator（r20＝新台幣每美元的 20 日變化 %，正的是台幣貶值）, ust: 10 年期殖利率 20 日變化（百分點）, night: 夜盤漲跌 % }
    回傳 { level, mult, flags: [{k, t}], n }"""
    flags = []
    add = lambda k, t: flags.append({'k': k, 't': t})  # noqa: E731
    tx = ind.get('taiex')
    if tx and tx.get('below'):
        add('taiex', '加權指數收在季線之下')
    b = ind.get('breadth')
    if b is not None and b >= TEMP['breadth_low']:
        add('breadth', f'一半以上的 ETF 收在自己的季線之下（{b * 100:.0f}%）')
    for k, nm in (('spx', 'S&P 500'), ('sox', '費城半導體')):
        x = ind.get(k)
        if x and x.get('below'):
            add(k, f'{nm}在 200 日均線之下')
    vix = ind.get('vix')
    if vix is not None and vix >= TEMP['vix_hi']:
        add('vix', f'VIX {vix:.1f}，市場{"恐慌" if vix >= TEMP["vix_panic"] else "緊張"}')
    tw = ind.get('twd')
    if tw and tw.get('r20') is not None and tw['r20'] >= TEMP['twd_weak']:
        add('twd', f'新台幣 20 個交易日貶值 {tw["r20"]:.1f}%')
    u = ind.get('ust')
    if u is not None and u >= TEMP['ust_jump']:
        add('ust', f'美國 10 年期公債殖利率 20 個交易日上升 {u:.2f} 個百分點')
    # 台指期夜盤：只反映隔天開盤的壓力，沒有歷史可以回測，只提醒、不算進警訊數
    notes = []
    nt = ind.get('night')
    if nt is not None and nt <= TEMP['night_drop']:
        notes.append({'k': 'night', 't': f'台指期夜盤跌 {abs(nt):.1f}%，今天開盤可能有壓力'})
    name, mult = temp_level(flags, vix)
    return {'level': name, 'mult': mult, 'flags': flags, 'n': len(flags), 'notes': notes}


def ust_change(yields, d, k=20):
    """美國 10 年期殖利率 d（含）以前最後一天，和 k 個交易日前比（百分點）"""
    ks = sorted(x for x in yields if int(x) <= d and (yields[x] or {}).get('y10') is not None)
    if len(ks) <= k:
        return None
    return yields[ks[-1]]['y10'] - yields[ks[-1 - k]]['y10']


def breadth_below(daily, meta_cat, d, n=60):
    """d 這天，ETF（不含反向型、成交天數夠的）收在自己季線之下的比例；回傳 (比例, 檔數)"""
    below = tot = 0
    for code, s in daily.items():
        if meta_cat.get(code) == 'inv':
            continue
        ds = s.get('d') or []
        i = bisect.bisect_right(ds, d) - 1
        if i < n - 1 or ds[i] != d:
            continue
        cs = [x for x in s['c'][i - n + 1:i + 1] if x]
        if len(cs) < n:
            continue
        tot += 1
        if cs[-1] < sum(cs) / n:
            below += 1
    return (below / tot if tot else None), tot


# ---------------------------------------------------------------- 輸出給 App

def build_out(state, summary=None, now=None):
    """data/global.json：每個指數的最新狀態、市場溫度（含每一個警訊）、規則門檻、最近 60 天的走勢。"""
    now = now or now_tw()
    g = state['global'] or {}
    S_ = g.get('s') or {}
    today = int(now.strftime('%Y%m%d'))
    idx = {}
    for k, ma in (('spx', TEMP['ma_us']), ('ndx', TEMP['ma_us']), ('sox', TEMP['ma_us']), ('vix', 20), ('twd', 20)):
        x = indicator(S_.get(k), today, ma)
        if not x:
            continue
        q = (g.get('q') or {}).get(k)
        live = None
        if q and q.get('d') and q['d'] >= x['d'] and q.get('open'):
            live = {'px': q['px'], 'pct': q.get('pct'), 't': q.get('t'), 'd': q['d']}
        idx[k] = {'name': NAMES[k], **{kk: _r(v) for kk, v in x.items()}, 'live': live,
                  'spark': [_r(v) for v in (S_.get(k) or {}).get('c', [])[-60:]]}
    # 台灣這一側：加權指數、ETF 收在季線之下的比例（和回測同一個算法）
    tdays = state['taiex']['d'] if state['taiex'] else []
    taiex = indicator({'d': tdays, 'c': state['taiex']['c']}, today, TEMP['ma_tw']) if tdays else None
    meta_cat = {c: (m or {}).get('cat') for c, m in (state['meta'] or {}).items()}
    last_td = tdays[-1] if tdays else None
    br, nbr = breadth_below(state['daily'] or {}, meta_cat, last_td) if last_td else (None, 0)
    ust = ust_change(state['yields'] or {}, today)
    q = g.get('q') or {}
    night = q.get('txf_night')
    night_pct = night['pct'] if night and night.get('d') and last_td and night['d'] >= last_td else None
    vix = idx.get('vix', {}).get('c')
    if (q.get('vix') or {}).get('d') and idx.get('vix') and q['vix']['d'] >= idx['vix']['d']:
        vix = q['vix']['px']
    ind = {'taiex': taiex, 'breadth': br, 'spx': idx.get('spx'), 'sox': idx.get('sox'), 'vix': vix,
           'twd': idx.get('twd'), 'ust': ust, 'night': night_pct}
    temp = market_temp(ind)
    temp['asof'] = {'tw': last_td, 'us': (idx.get('spx') or {}).get('d')}
    return {
        'at': g.get('at') or now.isoformat(timespec='minutes'),
        'idx': idx,
        'tw': {'taiex': {kk: _r(v) for kk, v in (taiex or {}).items()}, 'breadth': _r(br), 'nbr': nbr},
        'ust': {'d20': _r(ust)},
        'txf': {k: q.get(k) for k in ('txf_day', 'txf_night') if q.get(k)},
        'temp': temp,
        'rule': {k: v for k, v in TEMP.items()},
        'src': {k: {'n': n, 'u': u} for k, (n, u) in SOURCES.items()},
    }


def _r(x, n=4):
    if isinstance(x, float):
        return round(x, n)
    return x


# ---------------------------------------------------------------- 實測用（probe）

def probe_global(http):
    """GitHub Actions 上跑一次：全部歷史與報價（回測用，原樣回傳），不存回 state"""
    hist, e1 = fetch_history(http)
    quotes, e2 = fetch_quotes(http)
    meta = None
    try:
        js = http.json(CBC_FX, timeout=60)
        d = js.get('data') or {}
        meta = {'meta': js.get('meta'), 'keys': list(d.keys()), 'structure': d.get('structure') or d.get('dimension'),
                'tail': (d.get('dataSets') or [])[-3:]}
    except Exception as e:  # noqa: BLE001
        meta = repr(e)[:300]
    return {'hist': hist, 'quotes': quotes, 'errors': {**e1, **e2}, 'cbc': meta,
            'at': dt.datetime.utcnow().isoformat() + 'Z'}
