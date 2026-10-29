"""全球市場與市場溫度：美股指數、費城半導體、VIX、新台幣匯率、台指期夜盤（加碼計畫的「市場溫度」用）。

來源（官方一手；2026/10/30 PZ 同意把來源名單擴大到這幾個）：
- Cboe 芝加哥選擇權交易所（VIX 的編製者、S&P 500 指數選擇權的交易所）：VIX 歷史收盤、S&P 500 歷史、兩者的延遲報價
- Nasdaq 那斯達克（那斯達克 100、費城半導體指數的編製者）：歷史收盤與延遲報價
- 中央銀行：新台幣對美元匯率日資料（統計資料庫 BP01D01，一個月更新一次）＋央行網站每天的「新臺幣/美元銀行間收盤匯率」（最近 60 天）
- 臺灣期貨交易所 MIS：台指期一般（日盤）、盤後（夜盤）行情
- 美國財政部：10 年期公債殖利率（既有的 state['yields']）
GitHub Actions 上實測過（2026/10/30 probe）；FRED（聖路易聯準銀行）從 GitHub Actions 連不上，沒有用。

市場溫度：七個「風險升高」的警訊數一數（固定門檻在 TEMP），2 個以上「陰」、4 個以上或 VIX ≥ 35「雨」；
台指期夜盤沒有歷史可以回測，只當作「今天開盤」的提醒，不算進警訊數。
回測（tests/temp_backtest.py、temp_evidence）：雨的日子之後 20 個交易日的最差 10% 明顯比晴差（0050 約 −10% 對 −4%），
溫度分得出風險高低；但拿它去打折加碼金額（tests/add_sim.py），2020/4～2026/10 的結果幾乎一樣、沒有變好，
所以溫度只「告訴你現在的風險」，不改加碼股數（PZ：沒有讓結果變好的就不放）。
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
# 央行的日資料（BP01D01）一個月才更新一次（2026/10/30 實測最新是 9/30）；央行網站「新臺幣/美元銀行間收盤匯率」
# 每天更新（一頁 20 天），抓最近 3 頁補上。臺灣銀行的牌告從 GitHub Actions 會被機器人驗證擋下，沒有用。
CBC_FX_PAGE = 'https://www.cbc.gov.tw/tw/lp-645-1-{page}-20.html'
CBC_FX_PAGES = 3
TAIFEX_MIS = 'https://mis.taifex.com.tw/futures/api/getQuoteList'
TAIFEX_HEADERS = {'Content-Type': 'application/json;charset=UTF-8', 'Origin': 'https://mis.taifex.com.tw',
                  'Referer': 'https://mis.taifex.com.tw/futures/AfterHoursSession/EquityIndices/FuturesDomestic/'}

SOURCES = {
    'cboe': ('Cboe 芝加哥選擇權交易所 VIX、S&P 500', 'https://www.cboe.com/tradable_products/vix/vix_historical_data/'),
    'nasdaq': ('Nasdaq 那斯達克 100、費城半導體指數', 'https://www.nasdaq.com/market-activity/index/sox'),
    'cbc_fx': ('中央銀行 新台幣對美元匯率（日資料）', 'https://cpx.cbc.gov.tw/Data/DataMain?pxfilename=BP01D01.px'),
    'cbc_fx_daily': ('中央銀行 新臺幣/美元銀行間收盤匯率（每天）', 'https://www.cbc.gov.tw/tw/lp-645-1.html'),
    'taifex': ('臺灣期貨交易所 台指期行情（含夜盤）', 'https://mis.taifex.com.tw/futures/'),
}
NAMES = {'spx': 'S&P 500', 'ndx': '那斯達克 100', 'sox': '費城半導體', 'vix': 'VIX 恐慌指數', 'twd': '新台幣（每美元）'}

# 市場溫度的固定門檻（改了要同步 App 設定頁的說明，calc.js 的 tempRulesHTML 照 global.json 裡的 rule 寫）
TEMP = {
    'ma_tw': 60,          # 加權指數的季線
    'ma_us': 200,         # 美股、費半的 200 日均線
    'breadth_low': 0.6,   # 六成以上的 ETF（不含反向型）收在自己的季線之下（回測：五成太常出現、分不出好壞）
    'vix_hi': 25,         # VIX 25 以上：市場緊張
    'vix_panic': 35,      # VIX 35 以上：恐慌，直接算「雨」
    'twd_weak': 2.0,      # 新台幣 20 個交易日貶值超過 2%（外資匯出的壓力）
    'ust_jump': 0.5,      # 美國 10 年期公債殖利率 20 個交易日上升超過 0.5 個百分點
    'night_drop': -1.5,   # 台指期夜盤跌超過 1.5%：只提醒隔天開盤的壓力，不算進警訊數
    # 幾個警訊以上算哪一級：(門檻, 名稱)
    'levels': [(0, '晴'), (2, '陰'), (4, '雨')],
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


def parse_cbc_rate_html(text):
    """央行網站「新臺幣/美元銀行間收盤匯率」列表頁：表格每列 [YYYY/MM/DD, 匯率] → [(yyyymmdd, 匯率)]；不在 20～50 之間的不收"""
    out = []
    for row in re.findall(r'<tr[^>]*>(.*?)</tr>', text or '', re.S):
        cells = [re.sub(r'<[^>]+>', '', c).strip() for c in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', row, re.S)]
        if len(cells) < 2:
            continue
        m = re.match(r'^(\d{4})/(\d{1,2})/(\d{1,2})$', cells[0])
        v = _num(cells[1])
        if m and v is not None and 20 < v < 50:
            out.append((int(m.group(1)) * 10000 + int(m.group(2)) * 100 + int(m.group(3)), v))
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
        'twd_cbc': lambda: sorted({x for k in range(1, CBC_FX_PAGES + 1)
                                   for x in parse_cbc_rate_html(http.get(CBC_FX_PAGE.format(page=k), timeout=40).text)}),
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


def quiet(k, prev, now):
    """這一個報價從上次抓到現在不可能變（休市中，而且休市之後已經抓過）：這一輪不用再抓，對來源客氣一點。
    美股：台灣時間 06:00～21:20 一定休市（冬令 05:00 收盤、VIX 05:15 收、延遲 15 分鐘，06:00 以後抓到的一定是收盤）；
    台指期夜盤 05:00 收（即時、不延遲），日盤 13:45 收。prev＝上次抓到的報價（有 at＝抓的時間）。"""
    at = (prev or {}).get('at')
    if not at:
        return False
    hm = now.hour * 100 + now.minute

    def since(h, m, days=0):
        t = (now - dt.timedelta(days=days)).replace(hour=h, minute=m, second=0, microsecond=0)
        return at >= t.isoformat(timespec='minutes')
    if k in ('spx', 'vix', 'ndx', 'sox'):
        return 600 <= hm <= 2120 and since(6, 0)
    if k == 'txf_night':
        return 510 <= hm < 1500 and since(5, 10)
    if k == 'txf_day':
        if hm >= 1350:
            return since(13, 50)
        if hm < 845:
            return since(13, 50, days=1)
    return False


def fetch_quotes(http, prev=None, now=None):
    """最新報價（每一輪都抓，很小）：S&P 500、VIX（Cboe）、那斯達克 100、費半（Nasdaq）、台指期日盤與夜盤（期交所）。
    prev／now 給了的話，休市中而且已經抓過收盤的那幾個不再抓（quiet）。回傳 (報價, 錯誤, 沒抓的)"""
    prev = prev or {}
    out = {}
    errs = {}
    skipped = []
    jobs = {
        'spx': lambda: parse_cboe_quote(http.json(CBOE_Q.format(sym='SPX'))),
        'vix': lambda: parse_cboe_quote(http.json(CBOE_Q.format(sym='VIX'))),
        'ndx': lambda: parse_nasdaq_info(http.json(NQ_INFO.format(sym='NDX'), headers=NQ_HEADERS)),
        'sox': lambda: parse_nasdaq_info(http.json(NQ_INFO.format(sym='SOX'), headers=NQ_HEADERS)),
    }
    for k, fn in jobs.items():
        if now is not None and quiet(k, prev.get(k), now):
            skipped.append(k)
            continue
        try:
            q = fn()
            if q:
                out[k] = q
            else:
                errs[k] = 'empty'
        except Exception as e:  # noqa: BLE001
            errs[k] = repr(e)[:200]
    for k, mt in (('txf_day', '0'), ('txf_night', '1')):
        if now is not None and quiet(k, prev.get(k), now):
            skipped.append(k)
            continue
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
    return out, errs, skipped


def update(state, http, now=None, history=None):
    """更新 state['global']：報價每一輪都抓（盤中、夜盤、美股盤中都是最新的）；
    歷史 history=None 一天抓一次（會存回 state 的那幾輪：收盤後、早上的 global）、True 一定抓、False 不抓（盤中、夜間那幾輪不存 state）。
    回傳 {quotes, history, errors}"""
    now = now or now_tw()
    g = state['global']
    g.setdefault('s', {})
    g.setdefault('q', {})
    stamp = now.isoformat(timespec='minutes')
    errors = {}
    got_h = []
    if history is True or (history is None and (g.get('hist_day') != now.strftime('%Y%m%d') or not g['s'])):
        hist, e1 = fetch_history(http)
        errors.update({f'h_{k}': v for k, v in e1.items()})
        for k, xs in hist.items():
            # 央行網站每天的收盤匯率（最近 60 天）蓋在央行統計資料庫的日資料上（一個月才更新一次）
            _merge(g['s'].setdefault('twd' if k == 'twd_cbc' else k, {'d': [], 'c': []}), xs)
            got_h.append(k)
        if hist and not e1:
            g['hist_day'] = now.strftime('%Y%m%d')   # 有一個來源失敗：下一輪會存 state 的（收盤後那幾輪）再抓一次
    quotes, e2, skipped = fetch_quotes(http, g['q'], now)
    errors.update({f'q_{k}': v for k, v in e2.items()})
    for k, q in quotes.items():
        q['at'] = stamp
        g['q'][k] = q
        # 美股收盤之後的報價，當作那一天的收盤補進歷史：盤後就算得到最新的均線（盤前的 VIX 不算）
        if k in ('spx', 'vix', 'ndx', 'sox') and q.get('d') and is_close(q):
            _merge(g['s'].setdefault(k, {'d': [], 'c': []}), [(q['d'], q['px'])])
    g['at'] = stamp
    g['errors'] = errors
    return {'quotes': sorted(quotes), 'skipped': skipped, 'history': got_h, 'errors': errors}


def _us_closed(now):
    """台灣時間 05:20～21:20 美股一定休市（含夏令時間的差別）"""
    hm = now.hour * 100 + now.minute
    return 520 <= hm <= 2120


def is_close(q):
    """這筆報價是不是那一天的收盤：Nasdaq 看市場狀態（收盤後的時間戳沒有幾點）；Cboe 看最後成交時間（美東 16:00 以後；
    2026/10/30 實測收盤後 S&P 500 是 16:14、VIX 是 16:15）。VIX 美東清晨 03:15 起有盤前報價，那個不是收盤。"""
    if 'open' in q:
        return not q['open']
    return bool(q.get('t') and q['t'] >= '16:00')


def us_open(q, now):
    """這筆報價是不是美股盤中的：Nasdaq 有標；Cboe 看最後成交時間在美東 09:30～16:00、而且不在台灣時間 05:20～21:20（一定休市）"""
    if 'open' in q:
        return bool(q['open'])
    t = q.get('t')
    return not _us_closed(now) and bool(t) and '09:30' <= t < '16:00'


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
    """警訊數 → 等級名稱；VIX 恐慌直接算最冷的一級"""
    levels = TEMP['levels']
    n = len(flags)
    lv = levels[0]
    for x in levels:
        if n >= x[0]:
            lv = x
    if vix is not None and vix >= TEMP['vix_panic']:
        lv = levels[-1]
    return lv[1]


def market_temp(ind):
    """ind：{ taiex: indicator(季線), breadth: 收在季線之下的比例, spx/sox/ndx: indicator(200 日), vix: 數字,
    twd: indicator（r20＝新台幣每美元的 20 日變化 %，正的是台幣貶值）, ust: 10 年期殖利率 20 日變化（百分點）, night: 夜盤漲跌 % }
    回傳 { level, flags: [{k, t}], n, notes: [{k, t}] }"""
    flags = []
    add = lambda k, t: flags.append({'k': k, 't': t})  # noqa: E731
    tx = ind.get('taiex')
    if tx and tx.get('below'):
        add('taiex', '加權指數收在季線之下')
    b = ind.get('breadth')
    if b is not None and b >= TEMP['breadth_low']:
        add('breadth', f'{b * 100:.0f}% 的 ETF 收在自己的季線之下')
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
        notes.append({'k': 'night', 't': f'台指期夜盤跌 {abs(nt):.1f}%，台股開盤可能有壓力'})
    return {'level': temp_level(flags, vix), 'flags': flags, 'n': len(flags), 'notes': notes}


def ust_change(yields, d, k=20):
    """美國 10 年期殖利率 d（含）以前最後一天，和 k 個交易日前比（百分點）"""
    ks = sorted(x for x in yields if int(x) <= d and (yields[x] or {}).get('y10') is not None)
    if len(ks) <= k:
        return None
    return yields[ks[-1]]['y10'] - yields[ks[-1 - k]]['y10']


def breadth_series(daily, meta_cat, n=60):
    """每一天收在自己季線之下的 ETF 比例（不含反向型；那天有成交、而且有滿 n 天收盤的才算）→ {d: (之下的檔數, 總檔數)}"""
    out = {}
    for code, s in (daily or {}).items():
        if meta_cat.get(code) == 'inv':
            continue
        win = []
        run = 0.0
        for d, c in zip(s.get('d') or [], s.get('c') or []):
            if not c:
                win, run = [], 0.0
                continue
            win.append(c)
            run += c
            if len(win) > n:
                run -= win.pop(0)
            if len(win) == n:
                b, t = out.get(d, (0, 0))
                out[d] = (b + (1 if c < run / n else 0), t + 1)
    return out


def _before(series, d):
    """d 之前（不含 d）的子序列：美股、美債在台灣收盤之後才開盤，央行匯率 16:00 才公布，那天收盤時還不知道"""
    i = bisect.bisect_left(series.get('d') or [], d)
    return {'d': (series.get('d') or [])[:i], 'c': (series.get('c') or [])[:i]}


def _last_breadth(br, d):
    """d（含）以前最後一個有算的交易日（d 不是交易日時，例如收盤後用「下一個交易日」的角度看）"""
    ks = [k for k in br if k <= d]
    return br[max(ks)] if ks else (0, 0)


def temp_on(d, taiex, br, gs, yields, vix_now=None, night=None):
    """台灣交易日 d 收盤時的市場溫度：台灣這一側用 d 的收盤，美股、VIX、匯率、美債用 d 之前的資料（不偷看）。
    br：breadth_series 的結果；gs：{spx, sox, vix, twd: {d, c}}；vix_now／night：即時（只用在最新一天）"""
    b, t = br.get(d) or _last_breadth(br, d)
    vixs = _before(gs.get('vix') or {}, d)
    yk = {k: v for k, v in (yields or {}).items() if int(k) < d}
    ind = {
        'taiex': indicator(taiex, d, TEMP['ma_tw']),
        'breadth': b / t if t >= 30 else None,
        'spx': indicator(_before(gs.get('spx') or {}, d), 99999999, TEMP['ma_us']),
        'sox': indicator(_before(gs.get('sox') or {}, d), 99999999, TEMP['ma_us']),
        'vix': vix_now if vix_now is not None else (vixs['c'][-1] if vixs['c'] else None),
        'twd': indicator(_before(gs.get('twd') or {}, d), 99999999, 20),
        'ust': ust_change(yk, 99999999) if yk else None,
        'night': night,
    }
    return market_temp(ind), ind


def _pct(xs, q):
    xs = sorted(xs)
    if not xs:
        return None
    return xs[max(0, min(len(xs) - 1, int(round(q * (len(xs) - 1)))))]


def temp_evidence(state, codes=('0050',), start=20200401, H=20, br=None):
    """回測：每個交易日照冷眼的方法買進（出場線＝移動防守線，已經跌破就用 2 倍 ATR），之後 H 個交易日的
    含息報酬（平均、上漲比例、最差 10%）、期間最大跌幅（平均、最差 10%）、碰到出場線的比例與實際虧損是計畫的幾倍；
    晴／陰／雨和每一個警訊分開算，和「任何一天」並列。回傳 {from, to, days, level_days, res: {代號: {組別: 統計}}}"""
    from .series import Series
    g = state['global'] or {}
    gs = {k: (g.get('s') or {}).get(k) or {} for k in ('spx', 'sox', 'vix', 'twd')}
    meta = state['meta'] or {}
    meta_cat = {c: (m or {}).get('cat') for c, m in meta.items()}
    br = br if br is not None else breadth_series(state['daily'], meta_cat)
    tx = {'d': state['taiex']['d'], 'c': state['taiex']['c']}
    days = [d for d in tx['d'] if d >= start]
    rows = [(d, temp_on(d, tx, br, gs, state['yields'])[0]) for d in days]
    res = {}
    for code in codes:
        daily = (state['daily'] or {}).get(code)
        if not daily:
            continue
        s = Series(code, meta.get(code, {}), daily, divs=[tuple(x) for x in (state['divs'] or {}).get(code, [])])
        groups = {}
        for d, t in rows:
            i = s._index.get(d)
            if i is None or i < 22 or i + H >= s.n or not s.c[i] or not s.atr14[i]:
                continue
            c, atr = s.c[i], s.atr14[i]
            dl = max(s.c[i - 21:i + 1]) - 3 * atr
            stop = dl if dl < c else c - 2 * atr
            plan = c - stop
            fwd = s.c[i + H] / c - 1
            mdd = min(s.l[i + 1:i + H + 1]) / c - 1
            hit = None
            for j in range(i + 1, i + H + 1):
                if s.l[j] <= stop:
                    hit = (c - min(s.o[j], stop)) / plan
                    break
            for k in ['任何一天', t['level']] + ['警訊:' + f['k'] for f in t['flags']]:
                groups.setdefault(k, []).append((fwd, mdd, hit))
        out = {}
        for k, xs in groups.items():
            fw = [x[0] for x in xs]
            md = [x[1] for x in xs]
            hits = [x[2] for x in xs if x[2] is not None]
            out[k] = {'n': len(xs), 'avg': _r(sum(fw) / len(fw)), 'up': _r(sum(1 for x in fw if x > 0) / len(fw)),
                      'p10': _r(_pct(fw, 0.1)), 'mdd': _r(sum(md) / len(md)), 'mdd_p10': _r(_pct(md, 0.1)),
                      'hit': _r(len(hits) / len(xs)), 'over': _r(sum(hits) / len(hits)) if hits else None,
                      'over_p90': _r(_pct(hits, 0.9))}
        res[code] = out
    lv = {}
    for _, t in rows:
        lv[t['level']] = lv.get(t['level'], 0) + 1
    return {'from': days[0] if days else None, 'to': days[-1] if days else None, 'days': len(rows), 'h': H,
            'level_days': lv, 'res': res}


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
        if q and q.get('d') and q['d'] >= x['d']:
            # 交易所的延遲報價（15 分鐘）：盤中、盤前（VIX）、收盤都照實標（d／t 是美東的日期與時間，at 是抓的時間）
            live = {'px': q['px'], 'pct': q.get('pct'), 't': q.get('t'), 'd': q['d'], 'open': us_open(q, now),
                    'close': is_close(q), 'at': q.get('at')}
        idx[k] = {'name': NAMES[k], **{kk: _r(v) for kk, v in x.items()}, 'live': live,
                  'spark': [_r(v) for v in (S_.get(k) or {}).get('c', [])[-60:]]}
    # 台灣這一側：加權指數、ETF 收在季線之下的比例（和回測同一個算法）；美股、匯率、美債用最新一天之前的資料
    tx = {'d': (state['taiex'] or {}).get('d') or [], 'c': (state['taiex'] or {}).get('c') or []}
    meta_cat = {c: (m or {}).get('cat') for c, m in (state['meta'] or {}).items()}
    br = breadth_series(state['daily'], meta_cat)
    last_td = tx['d'][-1] if tx['d'] else None
    q = g.get('q') or {}
    night = q.get('txf_night')
    hm = now.hour * 100 + now.minute
    # 夜盤只在台股開盤前（和夜盤進行中）提醒；09:00 開盤以後台股自己的價格已經反映了
    night_pct = (night['pct'] if night and night.get('d') and last_td and night['d'] >= last_td
                 and (hm >= 1500 or hm < 900) else None)
    gs = {k: S_.get(k) or {} for k in ('spx', 'sox', 'vix', 'twd')}
    # 收盤之後到隔天開盤前，美股已經收的那一晚也算進來（比 last_td 新的美股收盤）：用「下一個交易日」的角度看
    asof = int(now.strftime('%Y%m%d'))
    if last_td and asof <= last_td:
        asof = last_td + 1
    temp, ind = temp_on(asof, tx, br, gs, state['yields'], night=night_pct)
    temp['asof'] = {'tw': last_td, 'us': (ind.get('spx') or {}).get('d'), 'twd': (ind.get('twd') or {}).get('d')}
    ev = None
    try:
        ev = temp_evidence(state, codes=('0050',), br=br)
    except Exception as e:  # noqa: BLE001 — 回測失敗不影響溫度本身
        print(f'[global] temp_evidence failed {e!r}', flush=True)
    taiex = ind.get('taiex')
    b, t = br.get(last_td, (0, 0)) if last_td else (0, 0)
    return {
        'at': g.get('at') or now.isoformat(timespec='minutes'),
        'idx': idx,
        'tw': {'taiex': {kk: _r(v) for kk, v in (taiex or {}).items()}, 'breadth': _r(b / t) if t else None, 'nbr': t},
        'ust': {'d20': _r(ind.get('ust'))},
        'txf': {k: q.get(k) for k in ('txf_day', 'txf_night') if q.get(k)},
        'temp': temp,
        'bt': ev,
        'sim': g.get('sim'),   # 加碼計畫的回測（pipeline/addsim.py，收盤後有新資料才重算）
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
    quotes, e2, _ = fetch_quotes(http)
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
