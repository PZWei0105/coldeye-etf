"""ETF 成分股（透視）與成分股的官方個股資料。

來源（全部官方、一手）：
- 投信投顧公會（SITCA，金管會監理的投信同業公會；各投信依法申報的基金資料）
  - ETF 專區：每一檔 ETF 的證券代號、基金名稱、類型代號（用來對上明細裡的基金名稱）
    https://www.sitca.org.tw/ROC/SITCA_ETF/etf_statement.aspx
  - 基金投資明細：IN2629 每月前十大（約次月第 10 個營業日公布）、IN2630 每季占淨資產 1% 以上
    https://www.sitca.org.tw/ROC/Industry/IN2629.aspx 、 IN2630.aspx
- 證交所、櫃買中心：成分股（上市、上櫃股票）的收盤、本益比、殖利率、股價淨值比、產業別、月營收

明細只列基金名稱、沒有證券代號，所以先在 ETF 專區用「基金名稱＋類型代號」找到代號，
再在同一類型的明細裡找「拿掉警語與級別後一模一樣」的名稱。只做完全相符，不做模糊比對
（正 2 和反 1 的名稱只差兩個字）。槓桿、反向型 ETF 多半只持有期貨與現金，明細裡沒有。
"""
import datetime as dt
import html as htmllib
import re

from .util import find_col, num, sign_from_html, tables_of, write_json

SITCA = 'https://www.sitca.org.tw/ROC'
ZONE_Q = f'{SITCA}/SITCA_ETF/etf_statement.aspx'
ZONE_R = f'{SITCA}/SITCA_ETF/etf_statement2.aspx'
PAGES = {'m': f'{SITCA}/Industry/IN2629.aspx', 'q': f'{SITCA}/Industry/IN2630.aspx'}
SRC_PAGE = {'m': 'https://www.sitca.org.tw/ROC/Industry/IN2629.aspx', 'q': 'https://www.sitca.org.tw/ROC/Industry/IN2630.aspx'}
GRID_ID = 'ctl00_ContentPlaceHolder1_GridView1'
FP = 'ctl00$ContentPlaceHolder1$'
KEEP = {'m': 2, 'q': 2}          # 每月前十大、每季明細各留 2 期（算「最近換了哪些」）

_TAG = re.compile(r'<[^>]+>')
_ROW = re.compile(r'<tr[^>]*>(.*?)</tr>', re.S | re.I)
_CELL = re.compile(r'<t[dh]([^>]*)>(.*?)</t[dh]>', re.S | re.I)
_HIDDEN = re.compile(r'<input[^>]*type="hidden"[^>]*>', re.I)
_ATTR = re.compile(r'(\w+)="([^"]*)"')
_DISCLAIMER = re.compile(r'\s+[（(].*$', re.S)
_SHARE_CLASS = re.compile(r'-(?:新台幣|新臺幣|台幣|美元|人民幣|日圓|日幣|澳幣)(?:[（(][^)）]*[)）])?$')


def _text(cell: str) -> str:
    return ' '.join(htmllib.unescape(_TAG.sub(' ', cell.replace('<br>', ' ').replace('<br/>', ' '))).replace('\xa0', ' ').split())


def _decode(r) -> str:
    raw = r.content
    for enc in ('utf-8-sig', 'cp950', 'big5hkscs'):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode('utf-8', errors='replace')


def _select_months(page: str, name: str):
    m = re.search(r'name="' + re.escape(FP + name) + r'"[^>]*>(.*?)</select>', page, re.S)
    if not m:
        return []
    return sorted(set(re.findall(r'<option[^>]*value="(\d{6})"', m.group(1))), reverse=True)


def _select_values(page: str, name: str):
    m = re.search(r'name="' + re.escape(FP + name) + r'"[^>]*>(.*?)</select>', page, re.S)
    if not m:
        return []
    return [(v, _text(t)) for v, t in re.findall(r'<option[^>]*value="([^"]*)"[^>]*>(.*?)</option>', m.group(1), re.S)]


def _hidden(page: str) -> dict:
    out = {}
    for tag in _HIDDEN.findall(page):
        a = dict(_ATTR.findall(tag))
        if a.get('name'):
            out[a['name']] = htmllib.unescape(a.get('value', ''))
    return out


def fund_key(name: str) -> str:
    """可以比較的基金名稱：拿掉警語、級別（-新台幣…），去掉空白。"""
    name = _DISCLAIMER.sub('', (name or '').strip())
    return re.sub(r'\s', '', _SHARE_CLASS.sub('', name))


def grid_rows(page: str, grid_id: str = GRID_ID):
    """ASP.NET GridView（有 id 的那張表）→ [表頭, 資料列…]（合計列去掉）。"""
    i = page.find(f'id="{grid_id}"')
    if i < 0:
        return []
    start = page.rfind('<table', 0, i)
    end = page.find('</table>', i)
    rows = []
    for row in _ROW.findall(page[start:end]):
        cells = [_text(c) for _a, c in _CELL.findall(row)]
        if cells:
            rows.append(cells)
    if not rows or rows[0][0] != '序號':
        return []
    return [rows[0]] + [r for r in rows[1:] if r and r[0].isdigit()]


def parse_holdings(page: str):
    """基金投資明細的結果表 → (表頭, {基金名稱: [列…]})。
    這張表沒有 id、表頭的 <td> 用 </th> 收尾、基金名稱用 rowspan 跨好幾列（後面的列少一格）。"""
    start = page.find('DTHeader')
    if start < 0:
        return [], {}
    table = page[page.rfind('<table', 0, start):]
    table = table[:table.find('</table>')]
    header, funds, cur = [], {}, None
    for row in _ROW.findall(table):
        cells = [_text(c) for _a, c in _CELL.findall(row)]
        if not cells:
            continue
        if not header:
            header = cells
        elif len(cells) == len(header):
            cur = cells[0]
            funds.setdefault(cur, []).append(cells[1:])
        elif len(cells) == len(header) - 1 and cur is not None:
            funds[cur].append(cells)
    return header, funds


KIND = (('上市', 'tse'), ('上櫃', 'otc'), ('興櫃', 'emg'), ('國外', 'f'), ('海外', 'f'), ('債', 'b'),
        ('受益憑證', 'fund'), ('基金', 'fund'), ('ETF', 'fund'), ('期貨', 'fut'), ('存託憑證', 'f'))


def kind_of(text: str) -> str:
    t = text or ''
    for k, v in KIND:
        if k in t:
            return v
    return 'o'


def holding_rows(header, rows):
    """明細列 → [[代號, 名稱, 種類, 占淨值%]]，依比例大到小。種類：tse 上市、otc 上櫃、f 國外、b 債券、fund 基金、o 其他。"""
    cols = header[1:]

    def col(*names):
        for n in names:
            for i, c in enumerate(cols):
                if c.replace(' ', '') == n.replace(' ', ''):
                    return i
        for n in names:
            for i, c in enumerate(cols):
                if n.replace(' ', '') in c.replace(' ', ''):
                    return i
        return None
    ik, ic, iname = col('標的種類'), col('標的代號或BloombergIsinCode', '標的代號'), col('標的名稱')
    iamt, ipct = col('金額'), col('占基金淨資產價值之比例(%)', '比例')
    if iname is None or ipct is None:
        raise ValueError(f'基金投資明細欄位變了：{header}')
    out = []
    for r in rows:
        if len(r) < len(cols):
            continue
        pct = num(r[ipct])
        if pct is None:
            continue
        code = (r[ic] if ic is not None else '').strip()
        if code in ('-', '--'):
            code = ''
        kind = kind_of(r[ik] if ik is not None else '')
        out.append([code, r[iname].strip(), kind, round(pct, 3)])
    out.sort(key=lambda x: -x[3])
    return out


# ------------------------------------------------------------------ 抓資料

def zone_months(http):
    return _select_months(_decode(http.get(ZONE_Q, timeout=60)), 'ddlYM')


def zone(http, ym: str):
    """ETF 專區某個月份：{證券代號: {n, fund, cls, fid}}（沒有證券代號的列略過）。"""
    q = f'{ZONE_R}?txtYM={ym}&txtcomid=&txtfund=&txtemcode=&txtkeyword=&txtR1=1&txtR2=1'
    rows = grid_rows(_decode(http.get(q, timeout=120)))
    if len(rows) < 2:
        return {}
    h = rows[0]

    def ix(name):
        return h.index(name) if name in h else None
    ic, isn, ifid, ifn, icls = ix('證券代號'), ix('證券簡稱'), ix('基金統編'), ix('基金名稱'), ix('類型代號')
    if None in (ic, ifn, icls):
        raise ValueError(f'ETF 專區欄位變了：{h}')
    out = {}
    for r in rows[1:]:
        code = r[ic].strip().upper()
        if not code or code == '-':
            continue
        out[code] = {'n': r[isn] if isn is not None else '', 'fund': r[ifn], 'cls': r[icls],
                     'fid': r[ifid] if ifid is not None else ''}
    return out


def periods(http, kind: str):
    """明細頁可以查的期間（YYYYMM，新的在前）＋ 頁面本身（給 postback 用）。"""
    page = _decode(http.get(PAGES[kind], timeout=60))
    return _select_months(page, 'ddlQ_YM'), page


def _post(http, url, form):
    r = http.post(url, data=form, timeout=120)
    return _decode(r)


def by_classes(http, kind: str, ym: str, classes, first_page=None, raw=None):
    """某一期、好幾個類型代號的明細：{基金名稱: [[代號, 名稱, 種類, %]]}。
    要先送「換期間」的 postback（不然伺服器會默默回第一家投信的資料），再用它回來的 VIEWSTATE 查每一類。"""
    url = PAGES[kind]
    page = first_page or _decode(http.get(url, timeout=60))
    by_class = {FP + 'ddlQ_YM': ym, FP + 'rdo1': 'rbClass'}
    period_page = _post(http, url, {**_hidden(page), '__EVENTTARGET': FP + 'ddlQ_YM', '__EVENTARGUMENT': '', **by_class})
    if ym not in _select_months(period_page, 'ddlQ_YM'):
        raise ValueError(f'{kind} 期間 {ym} 不在選單裡')
    funds = {}
    for cls in classes:
        res = _post(http, url, {**_hidden(period_page), **by_class, FP + 'ddlQ_Class': cls, FP + 'BtnQuery': '查詢'})
        header, rows = parse_holdings(res)
        if raw is not None:
            raw.setdefault('header', header)
            raw.setdefault('classes', {})[cls] = len(rows)
            for name, rs in list(rows.items())[:2]:
                raw.setdefault('rows', []).append([name] + rs[:3])
            ik = next((i - 1 for i, h in enumerate(header) if '種類' in h), None)
            for rs in rows.values():
                for r in rs:
                    if ik is not None and 0 <= ik < len(r):
                        kinds = raw.setdefault('kinds', {})
                        kinds[r[ik]] = kinds.get(r[ik], 0) + 1
            if not rows:
                raw.setdefault('empty', []).append([cls, res[:1500]])
        for name, rs in rows.items():
            funds[name] = holding_rows(header, rs)
    return funds


def match(zone_map: dict, funds: dict):
    """明細（基金名稱）對回 ETF 代號：同名（拿掉警語與級別後完全相同）才算。"""
    by_key = {}
    for name, rows in funds.items():
        by_key.setdefault(fund_key(name), rows)
    out = {}
    for code, z in zone_map.items():
        rows = by_key.get(fund_key(z['fund']))
        if rows:
            out[code] = rows
    return out


def fetch_period(http, kind, ym, zmap, first_page=None, raw=None):
    classes = sorted({z['cls'] for z in zmap.values() if z.get('cls')})
    funds = by_classes(http, kind, ym, classes, first_page, raw)
    return match(zmap, funds), len(funds)


def _ym_prev(ym: str, months: int) -> str:
    y, m = int(ym[:4]), int(ym[4:])
    m -= months
    while m <= 0:
        m += 12
        y -= 1
    return f'{y}{m:02d}'


FRESH_DAYS = 20    # 新的一期第一次抓到後 20 天內，每天重抓一次（晚報、更正的投信也會補進來）
MIN_RATIO = 0.5    # 新的一期配對到的 ETF 不到上一期的一半：當作沒抓完整（例如網站只回了一部分），先不收


def update(state, http, today: dt.date, force=False):
    """一天最多檢查一次。結果存進 state['hold']：{m: {期間: {代號: 列}}, q: {...}, zone: {...}, seen: {種類+期間: 第一次抓到的日期}}。
    - 新的一期：配對到的 ETF 太少（不到上一期的 MIN_RATIO）不收，下一次再抓。
    - 最近 FRESH_DAYS 天內才出現的一期：每天重抓、和已經有的合併（新的覆蓋、這次沒抓到的保留），
      投信晚一點申報或更正，幾天內就會補上；某一類暫時抓失敗也不會讓明細少一塊。"""
    hold = state['hold']
    day = today.strftime('%Y%m%d')
    if hold.get('checked') == day and not force:
        return 'skip'
    zm = zone_months(http)
    if not zm:
        raise ValueError('ETF 專區找不到月份選單')
    zones = {}
    seen = hold.setdefault('seen', {})

    def zmap_for(ym):
        z = ym if ym in zm else zm[0]
        if z not in zones:
            zones[z] = zone(http, z)
        return zones[z]

    def young(key):
        first = seen.get(key)
        if not first:
            return False
        try:
            return (today - dt.date(int(first[:4]), int(first[4:6]), int(first[6:8]))).days <= FRESH_DAYS
        except ValueError:
            return False
    for kind in ('m', 'q'):
        # 改版前就存好的最新一期：從上次檢查的那天起算，一樣再確認幾天
        per = hold.get(kind) or {}
        if per:
            seen.setdefault(kind + max(per), hold.get('checked') or day)
    got = []
    for kind in ('m', 'q'):
        months, page = periods(http, kind)
        if not months:
            raise ValueError(f'{kind} 找不到期間選單')
        store = hold.setdefault(kind, {})
        want = months[:KEEP[kind]]
        for ym in want:
            key = kind + ym
            if ym in store and not force and not young(key):
                continue
            rows, n_funds = fetch_period(http, kind, ym, zmap_for(ym), page)
            if not rows:
                continue
            prev = [p for p in sorted(store, reverse=True) if p < ym]
            if ym not in store and prev and len(rows) < MIN_RATIO * len(store[prev[0]]):
                got.append(f'{kind}{ym}:不完整 {len(rows)}/{len(store[prev[0]])}，下次再抓')
                continue
            old = store.get(ym) or {}
            merged = {**old, **rows}
            if merged != old:
                got.append(f'{kind}{ym}:{len(rows)}/{n_funds}' + (f'（合併後 {len(merged)}）' if old else ''))
            store[ym] = merged
            seen.setdefault(key, day)
        for ym in list(store):
            if ym not in want:
                del store[ym]
    for key in list(seen):
        if key[1:] not in (hold.get(key[0]) or {}):
            del seen[key]
    latest = zmap_for(zm[0])
    hold['zone'] = {c: [z['n'], z['cls']] for c, z in latest.items()}
    hold['zone_ym'] = zm[0]
    hold['checked'] = day
    if any(':不完整' not in g for g in got):
        hold['at'] = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(timespec='minutes')
    return got or 'no-new'


# ------------------------------------------------------------------ 成分股的官方個股資料

TWSE_OPEN = 'https://openapi.twse.com.tw/v1'
TWSE_RWD = 'https://www.twse.com.tw/rwd/zh'
TPEX_OPEN = 'https://www.tpex.org.tw/openapi/v1'
TPEX_RWD = 'https://www.tpex.org.tw/www/zh-tw'

# stocks 每一檔的欄位（App 的 xray.js 用同樣的順序）
#  0 名稱 1 市場(tse/otc) 2 產業別 3 收盤 4 漲跌% 5 收盤日期 6 本益比 7 殖利率 8 股價淨值比 9 本益比的日期
# 10 月營收年增% 11 今年累計營收年增% 12 營收月份(YYYYMM)
NF = 13


def _roc(d):
    """'1151022' → 20261022；'11509' → '202609'。"""
    t = str(d or '').strip()
    if len(t) == 7 and t.isdigit():
        return (int(t[:3]) + 1911) * 10000 + int(t[3:])
    if len(t) == 5 and t.isdigit():
        return f'{int(t[:3]) + 1911}{t[3:]}'
    return None


def _f(v):
    x = num(v)
    return None if x is None else round(x, 4)


def _ok(js):
    return isinstance(js, dict) and str(js.get('stat', '')).lower() == 'ok'


def _resp_day(js):
    """回應本身標的日期（20261022、115/10/22 或 2026/10/22）。和要的日期不同就不能用
    （有些查詢在那天還沒有資料時，會回最近一天的）。"""
    for k in ('date', 'reportDate', 'Date'):
        v = str(js.get(k) or '').strip()
        if v.isdigit() and len(v) == 8:
            return int(v)
        m = re.match(r'^(\d{2,4})/(\d{1,2})/(\d{1,2})$', v)
        if m:
            y = int(m[1])
            return ((y + 1911) if y < 1911 else y) * 10000 + int(m[2]) * 100 + int(m[3])
    return None


def _chg(sign_cell, val):
    """證交所的漲跌：符號欄（HTML 紅綠）＋價差。'X' 是不比價（除權息、新上市等），漲跌當作不知道。"""
    t = re.sub(r'<[^>]+>', '', str(sign_cell or '')).strip().upper()
    if 'X' in t:
        return None
    v = num(val)
    if v is None:
        return None
    s = sign_from_html(sign_cell)
    return round(abs(v) * s, 4) if s else 0.0


def _chg_txt(v):
    """櫃買、OpenAPI 的漲跌是一個字串（+1.50、-0.2、X0.00、除息）。不比價當作不知道。"""
    t = str(v or '').strip().upper()
    if not t or t.startswith('X') or not re.search(r'\d', t):
        return None
    return _f(t)


def domestic_codes(state):
    """成分股裡出現過的國內股票：{代號: 'tse' 或 'otc'}（每月與每季明細各自最新的一期）。"""
    hold = state['hold']
    out = {}
    for kind in ('m', 'q'):
        per = hold.get(kind) or {}
        for ym in sorted(per, reverse=True)[:1]:
            for rows in per[ym].values():
                for r in rows:
                    if r[2] in ('tse', 'otc') and r[0]:
                        out[r[0]] = r[2]
    return out


# ---- 收盤：先用「指定日期」的每日收盤行情（和 ETF 用的同一份，日期寫在回應裡），還沒公布再看 OpenAPI 的最新一天

def twse_close_day(http, d: int, want):
    """證交所每日收盤行情（全部，不含權證）某一天：{代號: (收盤, 漲跌)}。那天還沒公布、沒開市回傳 {}。"""
    js = http.json(f'{TWSE_RWD}/afterTrading/MI_INDEX?date={d}&type=ALLBUT0999&response=json', timeout=120)
    if not _ok(js):
        return {}
    rd = _resp_day(js)
    if rd and rd != d:
        return {}
    out = {}
    for t in tables_of(js):
        f = t['fields']
        ic, icl = find_col(f, '證券代號'), find_col(f, '收盤價')
        if ic is None or icl is None:
            continue
        isg, ich = find_col(f, '漲跌(+/-)'), find_col(f, '漲跌價差')
        for row in t['data']:
            code = str(row[ic]).strip()
            c = _f(row[icl]) if code in want else None
            if c:
                out[code] = (c, _chg(row[isg], row[ich]) if isg is not None and ich is not None else None)
    return out


def tpex_close_day(http, d: int, want):
    """櫃買中心上櫃股票每日收盤行情某一天（和上櫃 ETF 同一份）：{代號: (收盤, 漲跌)}。"""
    y, m, dd = d // 10000, d // 100 % 100, d % 100
    js = http.json(f'{TPEX_RWD}/afterTrading/otc?date={y}%2F{m:02d}%2F{dd:02d}&type=EW&id=&response=json', timeout=120)
    if not _ok(js):
        return {}
    rd = _resp_day(js)
    if rd and rd != d:
        return {}
    out = {}
    for t in tables_of(js):
        f = t['fields']
        if not t['data'] or (t.get('title') and '定價' in t['title'] and '不含' not in t['title']):
            continue
        ic, icl, ich = find_col(f, '代號'), find_col(f, '收盤'), find_col(f, '漲跌')
        if ic is None or icl is None:
            continue
        for row in t['data']:
            code = str(row[ic]).strip()
            c = _f(row[icl]) if code in want else None
            if c:
                out[code] = (c, _chg_txt(row[ich]) if ich is not None else None)
    return out


def twse_close_open(http, want):
    """證交所 OpenAPI 每日收盤行情（最新一天）：({代號: (收盤, 漲跌)}, 日期)。"""
    out, day = {}, None
    for r in http.json(f'{TWSE_OPEN}/exchangeReport/STOCK_DAY_ALL', timeout=90) or []:
        code = str(r.get('Code') or '').strip()
        day = day or _roc(r.get('Date'))
        c = _f(r.get('ClosingPrice')) if code in want else None
        if c:
            out[code] = (c, _chg_txt(r.get('Change')))
    return out, day


def tpex_close_open(http, want):
    """櫃買 OpenAPI 上櫃股票收盤行情（最新一天）：({代號: (收盤, 漲跌)}, 日期)。"""
    out, day = {}, None
    for r in http.json(f'{TPEX_OPEN}/tpex_mainboard_daily_close_quotes', timeout=90) or []:
        code = str(r.get('SecuritiesCompanyCode') or '').strip()
        day = day or _roc(r.get('Date'))
        c = _f(r.get('Close')) if code in want else None
        if c:
            out[code] = (c, _chg_txt(r.get('Change')))
    return out, day


# ---- 本益比、殖利率、股價淨值比

def twse_pe_day(http, d: int, want):
    """證交所個股日本益比、殖利率及股價淨值比某一天：{代號: (本益比, 殖利率, 股價淨值比)}。"""
    js = http.json(f'{TWSE_RWD}/afterTrading/BWIBBU_d?date={d}&selectType=ALL&response=json', timeout=90)
    if not _ok(js):
        return {}
    rd = _resp_day(js)
    if rd and rd != d:
        return {}
    out = {}
    for t in tables_of(js):
        f = t['fields']
        ic, ipe = find_col(f, '證券代號'), find_col(f, '本益比')
        if ic is None or ipe is None:
            continue
        idy, ipb = find_col(f, '殖利率'), find_col(f, '股價淨值比')
        for row in t['data']:
            code = str(row[ic]).strip()
            if code in want:
                out[code] = (_f(row[ipe]), _f(row[idy]) if idy is not None else None, _f(row[ipb]) if ipb is not None else None)
    return out


def tpex_pe_day(http, d: int, want):
    """櫃買中心上櫃個股本益比、殖利率、股價淨值比（依日期查詢）某一天：{代號: (本益比, 殖利率, 股價淨值比)}。"""
    y, m, dd = d // 10000, d // 100 % 100, d % 100
    js = http.json(f'{TPEX_RWD}/afterTrading/peQryDate?date={y}%2F{m:02d}%2F{dd:02d}&response=json', timeout=90)
    if not _ok(js):
        return {}
    rd = _resp_day(js)
    if rd and rd != d:
        return {}
    out = {}
    for t in tables_of(js):
        f = t['fields']
        ic, ipe = find_col(f, '代號'), find_col(f, '本益比')
        if ic is None or ipe is None:
            continue
        idy, ipb = find_col(f, '殖利率'), find_col(f, '股價淨值比')
        for row in t['data']:
            code = str(row[ic]).strip()
            if code in want:
                out[code] = (_f(row[ipe]), _f(row[idy]) if idy is not None else None, _f(row[ipb]) if ipb is not None else None)
    return out


def twse_pe_open(http, want):
    """證交所 OpenAPI 個股本益比（最新一天）：({代號: (...)}, 日期或 None)。"""
    out, day = {}, None
    for r in http.json(f'{TWSE_OPEN}/exchangeReport/BWIBBU_ALL', timeout=90) or []:
        code = str(r.get('Code') or '').strip()
        day = day or _roc(r.get('Date'))
        if code in want:
            out[code] = (_f(r.get('PEratio')), _f(r.get('DividendYield')), _f(r.get('PBratio')))
    return out, day


def tpex_pe_open(http, want):
    """櫃買 OpenAPI 上櫃個股本益比（最新一天）：({代號: (...)}, 日期)。"""
    out, day = {}, None
    for r in http.json(f'{TPEX_OPEN}/tpex_mainboard_peratio_analysis', timeout=90) or []:
        code = str(r.get('SecuritiesCompanyCode') or '').strip()
        day = day or _roc(r.get('Date'))
        if code in want:
            out[code] = (_f(r.get('PriceEarningRatio')), _f(r.get('YieldRatio')), _f(r.get('PriceBookRatio')))
    return out, day


def _revenue(http_tw, http_tp, want):
    """月營收（公開資訊觀測站，經證交所、櫃買開放資料）：{代號: (產業別, 年增%, 累計年增%, 月份)}。"""
    rev = {}

    def take(rows):
        for r in rows or []:
            code = str(r.get('公司代號') or '').strip()
            if code in want:
                rev[code] = (str(r.get('產業別') or '').strip(), _f(r.get('營業收入-去年同月增減(%)')),
                             _f(r.get('累計營業收入-前期比較增減(%)')), _roc(r.get('資料年月')))
    take(http_tw.json(f'{TWSE_OPEN}/opendata/t187ap05_L', timeout=90))
    try:
        take(http_tp.json(f'{TPEX_OPEN}/mopsfin_t187ap05_O', timeout=90))
    except Exception:  # noqa: BLE001 — 少了上櫃的月營收也沒關係（保留上一次的）
        pass
    return rev


def _upgrade(rec, st):
    """舊格式（10 欄、日期記在整份資料上）→ 新格式（每一檔自己的日期）。"""
    rec = list(rec or [])
    if len(rec) == 10:
        mkt = rec[1]
        d = st.get('d_otc' if mkt == 'otc' else 'd')   # 舊版收盤和本益比是同一次、同一天的 OpenAPI 資料
        rec = [rec[0], mkt, rec[2], rec[3], rec[4], d if rec[3] else None, rec[5], rec[6], rec[7],
               d if any(x is not None for x in rec[5:8]) else None, rec[8], rec[9], st.get('rev') if rec[8] is not None or rec[9] is not None else None]
    return (rec + [None] * NF)[:NF]


def _pct(c, ch):
    return round(ch / (c - ch) * 100, 2) if c and ch is not None and c - ch else None


def update_stocks(state, http_tw, http_tp, today: dt.date, target=None, force=False):
    """成分股（國內上市、上櫃）的官方資料：收盤、漲跌、本益比、殖利率、股價淨值比、產業別、月營收年增率。

    每一輪收盤後的更新都會檢查（不是一天一次）：上市、上櫃的收盤與本益比都已經是最新交易日（target）的資料、
    今天也看過月營收，才略過；不然就再抓一次。先用「指定日期」的官方每日資料（回應裡有日期，對不上就不用），
    還沒公布才看 OpenAPI 的最新一天。每一檔記自己的收盤日期、本益比日期、營收月份：抓不到的保留上一次的，
    不會被空的蓋掉，也不會倒退到更舊的日期。"""
    st = state['stocks']
    want = domestic_codes(state)
    if not want:
        return 'no-holdings'
    day = today.strftime('%Y%m%d')
    old = {c: _upgrade(v, st) for c, v in (st.get('s') or {}).items()}
    dd = dict(st.get('dd') or {})
    if 'tse' not in dd and st.get('d'):
        dd.update({'tse': st.get('d'), 'otc': st.get('d_otc'), 'pe_tse': st.get('d'), 'pe_otc': st.get('d_otc')})
    new_codes = [c for c in want if c not in old]

    def need(k):
        return force or bool(new_codes) or not target or (dd.get(k) or 0) < target
    need_rev = force or bool(new_codes) or st.get('rev_checked') != day
    parts = {k: need(k) for k in ('tse', 'otc', 'pe_tse', 'pe_otc')}
    if not any(parts.values()) and not need_rev:
        return 'skip'
    tse = {c for c, m in want.items() if m == 'tse'}
    otc = {c for c, m in want.items() if m == 'otc'}
    errs = []

    def fetch(day_fn, open_fn, http, codes):
        """回傳 (資料, 日期)。指定日期的抓不到才用 OpenAPI；兩個都失敗回傳 ({}, None)。"""
        if target:
            try:
                got = day_fn(http, target, codes)
                if got:
                    return got, target
            except Exception as e:  # noqa: BLE001
                errs.append(f'{day_fn.__name__}: {e!r}'[:160])
        if open_fn is None:
            return {}, None
        try:
            return open_fn(http, codes)
        except Exception as e:  # noqa: BLE001
            errs.append(f'{open_fn.__name__}: {e!r}'[:160])
            return {}, None

    px, pe = {}, {}          # 代號 → (值, 日期)
    for key, codes, day_fn, open_fn, http in (('tse', tse, twse_close_day, twse_close_open, http_tw),
                                               ('otc', otc, tpex_close_day, tpex_close_open, http_tp)):
        if not parts[key]:
            continue
        got, d = fetch(day_fn, open_fn, http, codes)
        if got and d and d >= (dd.get(key) or 0):
            dd[key] = d
            for c, v in got.items():
                px[c] = (v, d)
    for key, codes, day_fn, open_fn, http in (('pe_tse', tse, twse_pe_day, twse_pe_open, http_tw),
                                               ('pe_otc', otc, tpex_pe_day, tpex_pe_open, http_tp)):
        if not parts[key]:
            continue
        got, d = fetch(day_fn, open_fn, http, codes)
        if got and (d is None or d >= (dd.get(key) or 0)):
            if d:
                dd[key] = d
            for c, v in got.items():
                pe[c] = (v, d)
    rev, rev_ok = {}, False
    if need_rev:
        try:
            rev = _revenue(http_tw, http_tp, want)
            rev_ok = True
        except Exception as e:  # noqa: BLE001
            errs.append(f'revenue: {e!r}'[:160])
    names = {}
    for kind in ('m', 'q'):
        per = state['hold'].get(kind) or {}
        for ym_ in sorted(per, reverse=True)[:1]:
            for rows in per[ym_].values():
                for r in rows:
                    if r[0] in want:
                        names.setdefault(r[0], r[1])
    s = {}
    for code, mkt in want.items():
        rec = old.get(code) or [None] * NF
        rec[0], rec[1] = names.get(code) or rec[0] or '', mkt
        if code in px:
            (c, ch), d = px[code]
            if d >= (rec[5] or 0):
                rec[3], rec[4], rec[5] = c, _pct(c, ch), d
        if code in pe:
            (p, y_, b), d = pe[code]
            if d is None or d >= (rec[9] or 0):
                rec[6], rec[7], rec[8], rec[9] = p, y_, b, d
        if code in rev:
            ind, yoy, cum, ym = rev[code]
            if not rec[12] or not ym or ym >= rec[12]:
                rec[2] = ind or rec[2]
                rec[10] = round(yoy, 2) if yoy is not None else None
                rec[11] = round(cum, 2) if cum is not None else None
                rec[12] = ym or rec[12]
        rec[2] = rec[2] or ''
        s[code] = rec
    if not px and not pe and not rev and errs:
        raise RuntimeError('; '.join(errs)[:400])
    rev_checked = day if rev_ok else st.get('rev_checked')
    st.clear()
    st.update({'s': s, 'dd': dd, 'checked': day, 'rev_checked': rev_checked,
               'at': dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(timespec='minutes')})
    return (f'{len(s)} 檔：收盤 上市 {dd.get("tse")}、上櫃 {dd.get("otc")}；本益比 {dd.get("pe_tse")}／{dd.get("pe_otc")}'
            f'{"；" + "；".join(errs) if errs else ""}')[:300]


# ---- 盤中：證交所基本市況報導（MIS）的即時行情（和 ETF 盤中價格、沙盤的五檔同一個來源）

def stock_quotes(state, gap=2.0):
    """成分股的即時行情。回傳 {'at': 抓的時間, 'd': 多數股票的資料日期, 'q': {代號: [成交價, 參考價, 開, 高, 低, 量(張), 資料時間(epoch 秒), 日期]}}。
    成交價是 None 表示那一筆快照沒有成交價（例如今天還沒成交）。收盤後、休市時 MIS 給的是最近一個交易日收盤時的資料。"""
    import time
    from . import tape
    from .util import Http, now_tw
    want = domestic_codes(state)
    if not want:
        return None
    chans = [f'{m}_{c}.tw' for c, m in sorted(want.items())]
    http = Http(gap)
    try:
        http.get(f'{tape.MIS}/index.jsp', timeout=20)   # 取得 cookie
    except Exception:  # noqa: BLE001
        pass
    q, errs = {}, []
    for i in range(0, len(chans), tape.BATCH):
        part = chans[i:i + tape.BATCH]
        for _attempt in range(2):
            try:
                _at, arr = tape._fetch(http, 'getStockInfo.jsp', part)
                for m in arr:
                    c = m.get('c')
                    if c not in want:
                        continue
                    p = tape.parse_quote(m)
                    q[c] = [p['z'], p['y'], p['o'], p['h'], p['l'], int(p['v'] // 1000) if p['v'] else 0, p['q'], p['d']]
                break
            except Exception as e:  # noqa: BLE001
                errs.append(f'[{i}] {e!r}'[:160])
                time.sleep(3)
    if not q:
        raise RuntimeError('MIS 沒有回傳成分股行情 ' + '; '.join(errs)[:300])
    days = [v[7] for v in q.values() if v[7]]
    return {'at': now_tw().isoformat(timespec='seconds'), 'd': max(set(days), key=days.count) if days else None, 'q': q,
            'n': len(want)}


def _months_between(a: str, b: str) -> int:
    return (int(a[:4]) - int(b[:4])) * 12 + int(a[4:]) - int(b[4:])


def best_list(obj):
    """透視用的清單：每季明細（1% 以上、比較完整）不比每月前十大舊 2 個月以上就用它，不然用每月前十大。"""
    m, q = obj.get('m'), obj.get('q')
    if q and (not m or _months_between(m['p'], q['p']) <= 2):
        return q
    return m


BY_TOP = 15   # 每一檔股票列出持有它最多的 15 檔 ETF


def write_out(state, out_dir):
    """輸出 App 用的檔案：hold/{ETF}.json（每月前十大、每季明細，各含上一期）、hold.json（索引）、stocks.json（成分股資料＋反查）。"""
    hold = state['hold']
    M, Q = hold.get('m') or {}, hold.get('q') or {}
    pm, pq = sorted(M, reverse=True), sorted(Q, reverse=True)
    if not pm and not pq:
        return 0
    zone = hold.get('zone') or {}
    codes = set()
    for per in (M, Q):
        for rows in per.values():
            codes.update(rows.keys())
    idx, by, fnames = {}, {}, {}
    for c in sorted(codes):
        obj = {'c': c}
        for key, per, ps in (('m', M, pm), ('q', Q, pq)):
            have = [p for p in ps if c in per[p]]
            # 最新一期裡沒有這一檔（投信晚報，或那一期還沒抓完整）：先用它自己最新的一期，期間照實標；
            # 但已經不在最新的 ETF 專區（下市、合併）就不輸出
            if have and have[0] != ps[0] and zone and c not in zone:
                have = []
            if have:
                obj[key] = {'p': have[0], 'h': per[have[0]][c]}
            if len(have) > 1:
                obj['p' + key] = {'p': have[1], 'h': per[have[1]][c]}
        if 'm' not in obj and 'q' not in obj:
            continue
        write_json(out_dir / 'hold' / f'{c}.json', obj)
        b = best_list(obj)
        cov = round(sum(r[3] for r in b['h']), 2)
        kinds = {}
        for r in b['h']:
            kinds[r[2]] = round(kinds.get(r[2], 0) + r[3], 2)
        idx[c] = {'p': b['p'], 'k': 'q' if b is obj.get('q') else 'm', 'n': len(b['h']), 'cov': cov, 'mix': kinds,
                  'top': [[r[0] or r[1], r[3]] for r in b['h'][:3]]}
        for r in b['h']:
            if r[2] in ('tse', 'otc', 'f') and r[0]:
                by.setdefault(r[0], []).append([c, r[3]])
                if r[2] == 'f':
                    fnames.setdefault(r[0], r[1])
    stocks = state['stocks'] or {}
    nby = {k: len(v) for k, v in by.items()}
    by = {k: sorted(v, key=lambda x: -x[1])[:BY_TOP] for k, v in by.items()}
    write_json(out_dir / 'hold.json', {'m': pm[0] if pm else None, 'q': pq[0] if pq else None, 'at': hold.get('at'),
                                       'zone': hold.get('zone_ym'), 'etf': idx})
    write_json(out_dir / 'stocks.json', {'at': stocks.get('at'), 'dd': stocks.get('dd') or {},
                                         's': {c: _upgrade(v, stocks) for c, v in (stocks.get('s') or {}).items()},
                                         'f': fnames, 'by': by, 'nby': nby})
    return len(idx)


def probe(http):
    """開發用：跑一次完整流程，回傳可以檢查的摘要（probe 模式呼叫）。"""
    out = {}
    zm = zone_months(http)
    out['zone_months'] = zm[:6]
    z = zone(http, zm[0])
    out['zone_n'] = len(z)
    out['zone_sample'] = {c: z[c] for c in ('0050', '0056', '00878', '00919', '00662', '00679B', '00981A', '00631L') if c in z}
    out['classes'] = sorted({v['cls'] for v in z.values()})
    for kind in ('m', 'q'):
        months, page = periods(http, kind)
        out[f'{kind}_months'] = months[:6]
        out[f'{kind}_class_options'] = _select_values(page, 'ddlQ_Class')[:80]
        raw = {}
        rows, n_funds = fetch_period(http, kind, months[0], z, page, raw)
        out[f'{kind}_raw'] = raw
        out[f'{kind}_matched'] = len(rows)
        out[f'{kind}_funds'] = n_funds
        out[f'{kind}_unmatched'] = sorted(c for c in z if c not in rows)[:80]
        out[f'{kind}_sample'] = {c: rows[c][:60] for c in ('0050', '0056', '00878', '00919', '00662', '00679B', '00981A', '00713') if c in rows}
        kinds = {}
        for rs in rows.values():
            for r in rs:
                kinds[r[2]] = kinds.get(r[2], 0) + 1
        out[f'{kind}_kinds'] = kinds
    return out


def probe_full(http):
    """開發用：用空的 state 跑一次完整流程（明細＋個股資料＋輸出），回傳大小與樣本。"""
    import json
    import pathlib
    import tempfile
    import time
    from .util import Http

    class St(dict):
        def __getitem__(self, k):
            return self.setdefault(k, {})
    st = St()
    t0 = time.time()
    today = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).date()
    got = update(st, http, today, force=True)
    t1 = time.time()
    try:
        stocks = update_stocks(st, Http(1.2), Http(1.5), today, force=True)
    except Exception as e:  # noqa: BLE001
        stocks = 'ERR ' + repr(e)[:300]
    t2 = time.time()
    out = pathlib.Path(tempfile.mkdtemp())
    n = write_out(st, out)
    size = lambda p: (out / p).stat().st_size if (out / p).exists() else None
    sj = json.loads((out / 'stocks.json').read_text(encoding='utf-8')) if (out / 'stocks.json').exists() else {}
    hj = json.loads((out / 'hold.json').read_text(encoding='utf-8')) if (out / 'hold.json').exists() else {}
    files = sorted(x.name for x in (out / 'hold').iterdir()) if (out / 'hold').exists() else []
    return {
        'got': got, 'stocks': stocks, 'n': n, 'secs': [round(t1 - t0), round(t2 - t1)],
        'size': {'hold.json': size('hold.json'), 'stocks.json': size('stocks.json'),
                 'hold_total': sum((out / 'hold' / f).stat().st_size for f in files)},
        'files': len(files), 'hold_meta': {k: v for k, v in hj.items() if k != 'etf'},
        'idx_sample': {c: hj.get('etf', {}).get(c) for c in ('0050', '0056', '00878', '00662', '00679B', '00981A', '00919', '00631L')},
        'h0050': json.loads((out / 'hold' / '0050.json').read_text(encoding='utf-8')) if (out / 'hold' / '0050.json').exists() else None,
        's_meta': {k: v for k, v in sj.items() if k not in ('s', 'f', 'by', 'nby')},
        's_sample': {c: sj.get('s', {}).get(c) for c in ('2330', '2454', '2317', '2891', '6488', '3037', '5274', '1303')},
        's_n': len(sj.get('s', {})), 's_missing_px': [c for c, v in sj.get('s', {}).items() if not v[3]][:40],
        's_missing_ind': [c for c, v in sj.get('s', {}).items() if not v[2]][:40],
        'by_2330': sj.get('by', {}).get('2330'), 'nby_top': sorted(sj.get('nby', {}).items(), key=lambda x: -x[1])[:12],
        'f_sample': list(sj.get('f', {}).items())[:8],
        'state_size': len(json.dumps(dict(st), ensure_ascii=False)),
    }


def probe_sources(http):
    """開發用：實測成分股的官方資料來源（指定日期、OpenAPI、盤中 MIS），回傳摘要。"""
    import time
    from . import tape
    from .util import Http
    want = {'2330': 'tse', '2454': 'tse', '2317': 'tse', '2891': 'tse', '2308': 'tse', '1303': 'tse',
            '6488': 'otc', '5274': 'otc', '3105': 'otc', '8299': 'otc'}
    tse = {c for c, m in want.items() if m == 'tse'}
    otc = {c for c, m in want.items() if m == 'otc'}
    out = {}

    def run(name, fn, *a):
        t0 = time.time()
        try:
            r = fn(*a)
            out[name] = {'ok': True, 's': round(time.time() - t0, 1), 'r': r}
        except Exception as e:  # noqa: BLE001
            out[name] = {'ok': False, 's': round(time.time() - t0, 1), 'err': repr(e)[:300]}

    def shape(url):
        js = http.json(url, timeout=120)
        if isinstance(js, list):
            return {'list': len(js), 'first': js[:2]}
        tabs = tables_of(js)
        return {'keys': [k for k in js.keys()][:12], 'stat': js.get('stat'), 'date': js.get('date'),
                'tables': [{'title': t.get('title'), 'fields': t['fields'], 'n': len(t['data']), 'row0': t['data'][:1]} for t in tabs][:8]}
    for d in (20261022, 20261023):
        run(f'twse_close_day_{d}', twse_close_day, http, d, tse)
        run(f'tpex_close_day_{d}', tpex_close_day, http, d, otc)
        run(f'twse_pe_day_{d}', twse_pe_day, http, d, tse)
    run('twse_close_open', twse_close_open, http, tse)
    run('tpex_close_open', tpex_close_open, http, otc)
    run('twse_pe_open', twse_pe_open, http, tse)
    run('tpex_pe_open', tpex_pe_open, http, otc)
    run('revenue', _revenue, http, http, want)
    run('shape_mi_index', shape, f'{TWSE_RWD}/afterTrading/MI_INDEX?date=20261022&type=ALLBUT0999&response=json')
    run('shape_bwibbu_d', shape, f'{TWSE_RWD}/afterTrading/BWIBBU_d?date=20261022&selectType=ALL&response=json')
    run('shape_otc_ew_holiday', shape, f'{TPEX_RWD}/afterTrading/otc?date=2026%2F10%2F23&type=EW&id=&response=json')
    run('shape_stock_day_all_rwd', shape, f'{TWSE_RWD}/afterTrading/STOCK_DAY_ALL?response=json')
    for nm in ('peQryDate', 'peRatio', 'peQry'):
        run(f'shape_tpex_{nm}', shape, f'{TPEX_RWD}/afterTrading/{nm}?date=2026%2F10%2F22&response=json')
    run('shape_twse_bwibbu_open', shape, f'{TWSE_OPEN}/exchangeReport/BWIBBU_ALL')

    def mis():
        h = Http(2.0)
        try:
            h.get(f'{tape.MIS}/index.jsp', timeout=20)
        except Exception:  # noqa: BLE001
            pass
        chans = [f'{m}_{c}.tw' for c, m in sorted(want.items())]
        at, arr = tape._fetch(h, 'getStockInfo.jsp', chans)
        return {'at': at, 'n': len(arr), 'parsed': {m.get('c'): tape.parse_quote(m) for m in arr},
                'raw0': {k: v for k, v in (arr[0] if arr else {}).items() if k in ('c', 'n', 'z', 'y', 'o', 'h', 'l', 'v', 't', 'd', 'tlong', 'ex', 'pz', 'a', 'b')}}
    run('mis', mis)
    return out


def probe_stocks_full(http):
    """開發用：拿 state 分支的真實資料（不存回去）跑一次個股資料更新、略過檢查、盤中報價與輸出，回傳摘要。"""
    import json
    import pathlib
    import tempfile
    import time
    from . import gitstate
    from .state import State
    from .util import Http
    state = State(gitstate.open_branch('state', '.state'))
    days = state['taiex']['d']
    today = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).date()
    before = {k: v for k, v in (state['stocks'] or {}).items() if k != 's'}
    out = {'target': days[-1] if days else None, 'before': before, 'want': len(domestic_codes(state))}
    t0 = time.time()
    out['first'] = update_stocks(state, Http(1.5), Http(1.5), today, target=out['target'])
    out['first_s'] = round(time.time() - t0, 1)
    out['second'] = update_stocks(state, Http(1.5), Http(1.5), today, target=out['target'])
    s = state['stocks']['s']
    out['after'] = {k: v for k, v in state['stocks'].items() if k != 's'}
    out['n'] = len(s)
    out['no_close'] = [c for c, v in s.items() if not v[3]][:30]
    out['no_pe_date'] = [c for c, v in s.items() if not v[9]][:30]
    out['cd'] = sorted({v[5] for v in s.values() if v[5]})
    out['sample'] = {c: s.get(c) for c in ('2330', '2454', '2317', '6488', '5274', '3105', '2891')}
    t1 = time.time()
    try:
        q = stock_quotes(state)
        out['quotes'] = {'s': round(time.time() - t1, 1), 'n': len(q['q']), 'd': q['d'], 'want': q['n'],
                         'no_z': [c for c, v in q['q'].items() if v[0] is None][:20],
                         'sample': {c: q['q'].get(c) for c in ('2330', '6488', '5274')}}
    except Exception as e:  # noqa: BLE001
        out['quotes'] = {'err': repr(e)[:300], 's': round(time.time() - t1, 1)}
    tmp = pathlib.Path(tempfile.mkdtemp())
    write_out(state, tmp)
    sj = json.loads((tmp / 'stocks.json').read_text(encoding='utf-8'))
    out['stocks_json'] = {'size': (tmp / 'stocks.json').stat().st_size, 'at': sj.get('at'), 'dd': sj.get('dd'),
                          '2330': sj['s'].get('2330')}
    return out
