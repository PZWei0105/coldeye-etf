"""官方資料來源。每個函式只做一件事：抓一份官方資料、解析成乾淨的 Python 結構。

來源（皆為官方一手發布）：
- 臺灣證券交易所（證交所）：每日收盤行情（ETF）、三大法人買賣超、融資融券、除權息、注意／處置、休市日、最新消息
- 證交所基本市況報導網站（MIS）：ETF 盤中預估淨值與折溢價、即時行情
- 證券櫃檯買賣中心（櫃買）：上櫃 ETF（多為債券 ETF）的行情、法人、融資融券、除權息、注意／處置
- 臺灣集中保管結算所（集保）：集保戶股權分散表（受益人數）
- 中華民國證券投資信託暨顧問商業同業公會（投信投顧公會，金管會監理）：各投信申報的 ETF 成分股（基金投資明細）
- 美國財政部：公債殖利率
- 中央社、金管會、中央銀行：新聞與新聞稿
"""
import csv
import datetime as dt
import html
import io
import re
import xml.etree.ElementTree as ET

from .util import clean_field, find_col, num, roc_date, sign_from_html, tables_of

TWSE = 'https://www.twse.com.tw/rwd/zh'
TPEX = 'https://www.tpex.org.tw/www/zh-tw'
TPEX_API = 'https://www.tpex.org.tw/openapi/v1'
MIS = 'https://mis.twse.com.tw/stock'

SOURCE_INFO = {
    'twse_daily': ('證交所 每日收盤行情', 'https://www.twse.com.tw/zh/trading/historical/mi-index.html'),
    'tpex_daily': ('櫃買中心 上櫃每日收盤行情', 'https://www.tpex.org.tw/zh-tw/mainboard/trading/info/pricing.html'),
    'twse_flows': ('證交所 三大法人買賣超日報', 'https://www.twse.com.tw/zh/trading/foreign/t86.html'),
    'tpex_flows': ('櫃買中心 三大法人買賣明細', 'https://www.tpex.org.tw/zh-tw/mainboard/trading/major-institutional/detail/day.html'),
    'twse_margin': ('證交所 融資融券彙總', 'https://www.twse.com.tw/zh/trading/margin/mi-margn.html'),
    'tpex_margin': ('櫃買中心 融資融券餘額', 'https://www.tpex.org.tw/zh-tw/mainboard/trading/margin-trading/transactions.html'),
    'mis_etf': ('證交所 ETF 盤中預估淨值', 'https://mis.twse.com.tw/stock/etf_nav.jsp?ex=tse'),
    'twse_div': ('證交所 除權除息計算結果表', 'https://www.twse.com.tw/zh/announced/exright/twt49u.html'),
    'twse_div_pre': ('證交所 除權除息預告表', 'https://www.twse.com.tw/zh/announced/exright/twt48u.html'),
    'tpex_div': ('櫃買中心 除權除息計算結果表', 'https://www.tpex.org.tw/zh-tw/mainboard/trading/info/exright-daily.html'),
    'twse_market': ('證交所 市場成交資訊', 'https://www.twse.com.tw/zh/trading/historical/fmtqik.html'),
    'twse_mflows': ('證交所 三大法人買賣金額統計', 'https://www.twse.com.tw/zh/trading/foreign/bfi82u.html'),
    'twse_risk': ('證交所 注意／處置股票', 'https://www.twse.com.tw/zh/announcement/punish.html'),
    'tpex_risk': ('櫃買中心 注意／處置股票', 'https://www.tpex.org.tw/zh-tw/announce/market/disposal.html'),
    'tdcc': ('集保結算所 集保戶股權分散表', 'https://www.tdcc.com.tw/portal/zh/smWeb/qryStock'),
    'sitca': ('投信投顧公會 基金投資明細（ETF 成分股）', 'https://www.sitca.org.tw/ROC/Industry/IN2629.aspx'),
    'stocks': ('證交所、櫃買中心 個股收盤、本益比、殖利率、月營收', 'https://openapi.twse.com.tw/'),
    'ust': ('美國財政部 公債殖利率', 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve'),
    'twse_news': ('證交所 最新消息', 'https://www.twse.com.tw/zh/about/news/news/list.html'),
    'cna': ('中央社 財經新聞', 'https://www.cna.com.tw/list/aie.aspx'),
    'fsc': ('金管會 新聞稿', 'https://www.fsc.gov.tw/ch/home.jsp?id=96&parentpath=0,2'),
    'cbc': ('中央銀行 新聞稿', 'https://www.cbc.gov.tw/tw/lp-302-1.html'),
}


def is_etf_code(code: str) -> bool:
    c = (code or '').strip().upper()
    return bool(re.match(r'^00\d{2,4}[A-Z]?$', c))


def _ymd(d: dt.date) -> str:
    return d.strftime('%Y%m%d')


def _slash(d: dt.date) -> str:
    return f'{d.year}%2F{d.month:02d}%2F{d.day:02d}'


def _ok(js) -> bool:
    return isinstance(js, dict) and str(js.get('stat', '')).lower() == 'ok'


# ---------------------------------------------------------------- 行情

def twse_etf_daily(http, d: dt.date):
    js = http.json(f'{TWSE}/afterTrading/MI_INDEX?date={_ymd(d)}&type=0099P&response=json')
    if not _ok(js):
        return None
    out = {}
    for t in tables_of(js):
        f = t['fields']
        ic, iname = find_col(f, '證券代號'), find_col(f, '證券名稱')
        icl = find_col(f, '收盤價')
        if ic is None or icl is None:
            continue
        io_, ih, il = find_col(f, '開盤價'), find_col(f, '最高價'), find_col(f, '最低價')
        iv, ival, itr = find_col(f, '成交股數'), find_col(f, '成交金額'), find_col(f, '成交筆數')
        isg, ich = find_col(f, '漲跌(+/-)'), find_col(f, '漲跌價差')
        for row in t['data']:
            code = str(row[ic]).strip()
            if not is_etf_code(code):
                continue
            chg = num(row[ich]) if ich is not None else None
            if chg is not None and isg is not None:
                chg = abs(chg) * (sign_from_html(row[isg]) or 1) if sign_from_html(row[isg]) else 0.0
            out[code] = {
                'name': str(row[iname]).strip(), 'o': num(row[io_]), 'h': num(row[ih]),
                'l': num(row[il]), 'c': num(row[icl]), 'v': num(row[iv]) or 0.0,
                'val': num(row[ival]) or 0.0, 'n': num(row[itr]) if itr is not None else None,
                'chg': chg,
            }
    return out or None


def tpex_etf_daily(http, d: dt.date):
    js = http.json(f'{TPEX}/afterTrading/otc?date={_slash(d)}&type=EW&id=&response=json')
    if not _ok(js):
        return None
    out = {}
    for t in tables_of(js):
        f = t['fields']
        ic, iname, icl = find_col(f, '代號'), find_col(f, '名稱'), find_col(f, '收盤')
        if ic is None or icl is None:
            continue
        io_, ih, il = find_col(f, '開盤'), find_col(f, '最高'), find_col(f, '最低')
        iv, ival, itr, ich = find_col(f, '成交股數'), find_col(f, '成交金額'), find_col(f, '成交筆數'), find_col(f, '漲跌')
        if not t['data'] or (t.get('title') and '定價' in t['title'] and '不含' not in t['title']):
            continue
        for row in t['data']:
            code = str(row[ic]).strip()
            if not is_etf_code(code):
                continue
            out[code] = {
                'name': str(row[iname]).strip(), 'o': num(row[io_]), 'h': num(row[ih]),
                'l': num(row[il]), 'c': num(row[icl]), 'v': num(row[iv]) or 0.0,
                'val': num(row[ival]) or 0.0, 'n': num(row[itr]) if itr is not None else None,
                'chg': num(row[ich]) if ich is not None else None,
            }
    return out or None


def twse_market_month(http, year, month):
    """FMTQIK：當月每個交易日的加權指數收盤、成交金額。也用來當交易日曆。"""
    js = http.json(f'{TWSE}/afterTrading/FMTQIK?date={year}{month:02d}01&response=json')
    if not _ok(js):
        return []
    rows = []
    for t in tables_of(js):
        f = t['fields']
        idt, ix, ival = find_col(f, '日期'), find_col(f, '加權股價指數'), find_col(f, '成交金額')
        ichg = find_col(f, '漲跌點數')
        if idt is None or ix is None:
            continue
        for row in t['data']:
            d = roc_date(row[idt])
            if d:
                rows.append({'d': d, 'close': num(row[ix]), 'val': num(row[ival]) if ival is not None else None,
                             'chg': num(row[ichg]) if ichg is not None else None})
    return rows


# ---------------------------------------------------------------- 籌碼

def twse_market_flows(http, d: dt.date):
    """BFI82U：集中市場三大法人買賣金額（元）。"""
    js = http.json(f'{TWSE}/fund/BFI82U?type=day&dayDate={_ymd(d)}&response=json')
    if not _ok(js):
        return None
    out = {'f': 0.0, 't': 0.0, 'd': 0.0}
    for t in tables_of(js):
        f = t['fields']
        iname, inet = find_col(f, '單位名稱'), find_col(f, '買賣差額')
        if iname is None or inet is None:
            continue
        for row in t['data']:
            name = str(row[iname])
            v = num(row[inet]) or 0.0
            if name.startswith('外資'):
                out['f'] += v
            elif name.startswith('投信'):
                out['t'] += v
            elif name.startswith('自營商'):
                out['d'] += v
    return out


def twse_flows(http, d: dt.date):
    js = http.json(f'{TWSE}/fund/T86?date={_ymd(d)}&selectType=0099P&response=json')
    if not _ok(js):
        return None
    out = {}
    for t in tables_of(js):
        f = [clean_field(x) for x in t['fields']]
        ic = find_col(f, '證券代號')
        ifor = find_col(f, '外陸資買賣超股數')
        ifd = next((k for k, x in enumerate(f) if x == '外資自營商買賣超股數'), None)
        itr = find_col(f, '投信買賣超股數')
        idl = next((k for k, x in enumerate(f) if x == '自營商買賣超股數'), None)
        if ic is None or ifor is None:
            continue
        for row in t['data']:
            code = str(row[ic]).strip()
            if not is_etf_code(code):
                continue
            foreign = (num(row[ifor]) or 0) + ((num(row[ifd]) or 0) if ifd is not None else 0)
            out[code] = [foreign, num(row[itr]) or 0 if itr is not None else 0,
                         num(row[idl]) or 0 if idl is not None else 0]
    return out or None


def tpex_flows(http, d: dt.date):
    js = http.json(f'{TPEX}/insti/dailyTrade?type=Daily&sect=EW&date={_slash(d)}&id=&response=json')
    if not _ok(js):
        return None
    out = {}
    for t in tables_of(js):
        f = t['fields']
        if len(f) < 24 or find_col(f, '代號') is None:
            continue
        # 欄位順序（三欄一組）：外資及陸資(不含外資自營商)、外資自營商、外資及陸資合計、投信、
        # 自營商(自行買賣)、自營商(避險)、自營商合計，最後一欄為三大法人合計
        for row in t['data']:
            code = str(row[0]).strip()
            if not is_etf_code(code):
                continue
            out[code] = [num(row[10]) or 0, num(row[13]) or 0, num(row[22]) or 0]
    return out or None


def twse_margin(http, d: dt.date):
    js = http.json(f'{TWSE}/marginTrading/MI_MARGN?date={_ymd(d)}&selectType=0099P&response=json')
    if not _ok(js):
        return None
    out = {}
    for t in tables_of(js):
        f = t['fields']
        ic = find_col(f, '代號')
        i_bal = find_col(f, '今日餘額')
        if ic is None or i_bal is None:
            continue
        i_sbal = find_col(f, '今日餘額', start=i_bal + 1)
        for row in t['data']:
            code = str(row[ic]).strip()
            if not is_etf_code(code):
                continue
            out[code] = [num(row[i_bal]) or 0, num(row[i_sbal]) or 0 if i_sbal is not None else 0]
    return out or None


def tpex_margin(http, d: dt.date):
    js = http.json(f'{TPEX}/margin/balance?date={_slash(d)}&id=&response=json')
    if not _ok(js):
        return None
    out = {}
    for t in tables_of(js):
        f = t['fields']
        ic, ib, isb = find_col(f, '代號'), find_col(f, '資餘額'), find_col(f, '券餘額')
        if ic is None or ib is None:
            continue
        for row in t['data']:
            code = str(row[ic]).strip()
            if not is_etf_code(code):
                continue
            out[code] = [num(row[ib]) or 0, num(row[isb]) or 0 if isb is not None else 0]
    return out or None


# ---------------------------------------------------------------- 淨值（盤中預估）

def mis_etf(http):
    js = http.json(f'{MIS}/data/all_etf.txt')
    out = {}
    for g in js.get('a1', []):
        for m in g.get('msgArray', []) or []:
            code = str(m.get('a', '')).strip()
            if not is_etf_code(code):
                continue
            out[code] = {
                'name': str(m.get('b', '')).split('(')[0].strip(),
                'units': num(m.get('c')), 'units_chg': num(m.get('d')),
                'px': num(m.get('e')), 'est_nav': num(m.get('f')), 'premium': num(m.get('g')),
                'prev_nav': num(m.get('h')), 'date': str(m.get('i', '')), 'time': str(m.get('j', '')),
                'issuer_url': g.get('refURL'),
            }
    return out


def mis_quotes(http, channels):
    """channels 例如 ['tse_t00.tw']。回傳 {代號: {...}}。"""
    url = f'{MIS}/api/getStockInfo.jsp?ex_ch={"|".join(channels)}&json=1&delay=0'
    try:
        http.get(f'{MIS}/index.jsp', timeout=20)
    except Exception:  # noqa: BLE001 — 只是取得 cookie
        pass
    js = http.json(url)
    out = {}
    for m in js.get('msgArray', []) or []:
        out[m.get('c')] = {
            'name': m.get('n'), 'z': num(m.get('z')), 'y': num(m.get('y')), 'o': num(m.get('o')),
            'h': num(m.get('h')), 'l': num(m.get('l')), 'v': num(m.get('v')), 't': m.get('t'), 'd': m.get('d'),
        }
    return out


# ---------------------------------------------------------------- 配息

def twse_dividends(http, start: dt.date, end: dt.date):
    js = http.json(f'{TWSE}/exRight/TWT49U?startDate={_ymd(start)}&endDate={_ymd(end)}&response=json')
    if not _ok(js):
        return []
    out = []
    for t in tables_of(js):
        f = t['fields']
        idt, ic, ival, ikind = find_col(f, '資料日期'), find_col(f, '股票代號'), find_col(f, '權值+息值'), find_col(f, '權/息')
        ipre = find_col(f, '除權息前收盤價')
        if idt is None or ic is None or ival is None:
            continue
        for row in t['data']:
            code = str(row[ic]).strip()
            if not is_etf_code(code):
                continue
            kind = str(row[ikind]) if ikind is not None else '息'
            if '息' not in kind:
                continue
            d = roc_date(row[idt])
            cash = num(row[ival])
            if d and cash:
                out.append({'code': code, 'd': d, 'cash': cash,
                            'pre': num(row[ipre]) if ipre is not None else None})
    return out


def twse_dividend_preview(http):
    js = http.json(f'{TWSE}/exRight/TWT48U?response=json')
    if not _ok(js):
        return []
    out = []
    for t in tables_of(js):
        f = t['fields']
        idt, ic, iname, icash = find_col(f, '除權除息日期'), find_col(f, '股票代號'), find_col(f, '名稱'), find_col(f, '現金股利')
        if idt is None or ic is None:
            continue
        for row in t['data']:
            code = str(row[ic]).strip()
            if not is_etf_code(code):
                continue
            raw = str(row[icash]) if icash is not None else ''
            cash = None if '待公告' in raw else num(raw)
            out.append({'code': code, 'name': str(row[iname]).strip(), 'd': roc_date(row[idt]),
                        'cash': cash, 'tba': '待公告' in raw})
    return out


def tpex_dividends(http, start: dt.date, end: dt.date):
    """櫃買中心 除權除息計算結果表（可查一段期間）。"""
    js = http.json(f'{TPEX}/bulletin/exDailyQ?startDate={_slash(start)}&endDate={_slash(end)}&id=&response=json')
    if not _ok(js):
        return []
    out = []
    for t in tables_of(js):
        f = t['fields']
        idt, ic, ival, ikind = find_col(f, '除權息日期'), find_col(f, '代號'), find_col(f, '息值'), find_col(f, '權/息')
        ipre = find_col(f, '除權息前收盤價')
        if idt is None or ic is None or ival is None:
            continue
        for row in t['data']:
            code = str(row[ic]).strip()
            if not is_etf_code(code):
                continue
            if ikind is not None and '息' not in str(row[ikind]):
                continue
            d = roc_date(row[idt])
            cash = num(row[ival])
            if d and cash:
                out.append({'code': code, 'd': d, 'cash': cash,
                            'pre': num(row[ipre]) if ipre is not None else None})
    return out


def tpex_dividend_preview(http):
    """櫃買 OpenAPI 除權除息預告表。"""
    rows = http.json(f'{TPEX_API}/tpex_exright_prepost')
    out = []
    for r in rows if isinstance(rows, list) else []:
        code = str(r.get('SecuritiesCompanyCode') or '').strip()
        if not is_etf_code(code) or '息' not in str(r.get('ExRrightsExDividend', '息')):
            continue
        cash = num(r.get('CashDividend'))
        out.append({'code': code, 'name': str(r.get('CompanyName') or '').strip(),
                    'd': roc_date(r.get('ExRrightsExDividendDate')), 'cash': cash or None, 'tba': not cash})
    return out


# ---------------------------------------------------------------- 風險名單

def twse_risk(http):
    out = []
    try:
        js = http.json(f'{TWSE}/announcement/punish?response=json')
        for t in tables_of(js):
            f = t['fields']
            ic, iname, iper, imeas = find_col(f, '證券代號'), find_col(f, '證券名稱'), find_col(f, '處置起迄'), find_col(f, '處置措施')
            for row in t['data']:
                code = str(row[ic]).strip()
                out.append({'code': code, 'name': str(row[iname]).strip(), 'kind': 'disposal',
                            'period': str(row[iper]).strip() if iper is not None else '',
                            'text': str(row[imeas]).strip() if imeas is not None else '', 'mkt': 'tse'})
    except Exception:  # noqa: BLE001
        pass
    try:
        js = http.json(f'{TWSE}/announcement/notice?response=json')
        for t in tables_of(js):
            f = t['fields']
            ic, iname, iinfo = find_col(f, '證券代號'), find_col(f, '證券名稱'), find_col(f, '注意交易資訊')
            for row in t['data']:
                out.append({'code': str(row[ic]).strip(), 'name': str(row[iname]).strip(), 'kind': 'notice',
                            'text': re.sub(r'\s+', ' ', str(row[iinfo])).strip() if iinfo is not None else '',
                            'mkt': 'tse'})
    except Exception:  # noqa: BLE001
        pass
    return out


def tpex_risk(http):
    out = []
    for path, kind in (('tpex_disposal_information', 'disposal'), ('tpex_trading_warning_information', 'notice')):
        try:
            rows = http.json(f'{TPEX_API}/{path}')
        except Exception:  # noqa: BLE001
            continue
        for r in rows if isinstance(rows, list) else []:
            code = str(r.get('SecuritiesCompanyCode') or r.get('Code') or '').strip()
            name = str(r.get('CompanyName') or r.get('Name') or '').strip()
            text = ' '.join(str(v) for k, v in r.items() if k not in ('SecuritiesCompanyCode', 'CompanyName', 'Date'))
            out.append({'code': code, 'name': name, 'kind': kind, 'text': text[:200], 'mkt': 'otc'})
    return out


# ---------------------------------------------------------------- 受益人數

def tdcc_holders(http):
    r = http.get('https://opendata.tdcc.com.tw/getOD.ashx?id=1-5', timeout=90)
    txt = r.content.decode('utf-8-sig', errors='replace')
    out = {}
    date = None
    for row in csv.reader(io.StringIO(txt)):
        if len(row) < 5 or not row[0].isdigit():
            continue
        code = row[1].strip()
        if not is_etf_code(code):
            continue
        if row[2].strip() == '17':
            date = int(row[0])
            out[code] = (num(row[3]), num(row[4]))
    return date, out


# ---------------------------------------------------------------- 美國公債殖利率

def us_yields(http, year):
    url = (f'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/'
           f'daily-treasury-rates.csv/{year}/all?type=daily_treasury_yield_curve'
           f'&field_tdr_date_value={year}&page&_format=csv')
    r = http.get(url, timeout=60)
    txt = r.content.decode('utf-8-sig', errors='replace')
    out = {}
    rd = csv.DictReader(io.StringIO(txt))
    for row in rd:
        ds = row.get('Date') or ''
        m = re.match(r'(\d{2})/(\d{2})/(\d{4})', ds)
        if not m:
            continue
        d = int(m.group(3)) * 10000 + int(m.group(1)) * 100 + int(m.group(2))
        out[d] = {'y10': num(row.get('10 Yr')), 'y20': num(row.get('20 Yr'))}
    return out


# ---------------------------------------------------------------- 新聞與公告

def twse_news(http):
    js = http.json(f'{TWSE}/news/newsList?response=json')
    out = []
    for row in js.get('data', []) or []:
        if len(row) < 4:
            continue
        out.append({'t': str(row[1]).strip(), 'd': roc_date(row[2]), 'src': 'twse_news', 'kind': 'official',
                    'url': f'https://www.twse.com.tw/zh/about/news/news/content.html?{row[3]}'})
    return out


def _rss_items(raw: bytes):
    """標準 XML 解析失敗時（官方 RSS 偶有格式瑕疵），改用逐項擷取。"""
    try:
        root = ET.fromstring(raw)
        for it in root.iter('item'):
            yield (it.findtext('title') or '', it.findtext('link') or '', it.findtext('pubDate') or '',
                   it.findtext('description') or '')
        return
    except ET.ParseError:
        pass
    txt = raw.decode('utf-8', errors='replace')

    def grab(tag, block):
        m = re.search(rf'<{tag}>(.*?)</{tag}>', block, re.S)
        if not m:
            return ''
        v = m.group(1).strip()
        cd = re.match(r'^<!\[CDATA\[(.*)\]\]>$', v, re.S)
        return cd.group(1) if cd else v

    for block in re.findall(r'<item>(.*?)</item>', txt, re.S):
        yield grab('title', block), grab('link', block), grab('pubDate', block), grab('description', block)


def _rss(http, url, src, kind):
    r = http.get(url, timeout=40)
    out = []
    for title, link, pub, desc in _rss_items(r.content):
        title = html.unescape(title.strip())
        link = html.unescape(link.strip())
        pub = pub.strip()
        desc = re.sub(r'<[^>]+>', '', html.unescape(desc)).strip()
        try:
            d = dt.datetime.strptime(pub[:25].strip(), '%a, %d %b %Y %H:%M:%S')
        except ValueError:
            d = None
        out.append({'t': title, 'url': link, 'ts': d.isoformat() if d else None,
                    'd': d.date() if d else None, 'src': src, 'kind': kind, 'desc': desc[:160]})
    return out


def cna_finance(http):
    return _rss(http, 'https://feeds.feedburner.com/rsscna/finance', 'cna', 'fact')


def fsc_news(http):
    items = _rss(http, 'https://www.fsc.gov.tw/RSS/Messages?serno=201202290009&language=chinese', 'fsc', 'official')
    # 「證券期貨局每日新聞」是媒體剪報彙整，不是金管會自己的公告
    return [x for x in items if '每日新聞' not in x['t']][:60]


def cbc_news(http):
    return _rss(http, 'https://www.cbc.gov.tw/tw/rss-302-1.xml', 'cbc', 'official')[:40]
