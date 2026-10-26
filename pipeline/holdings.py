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

from .util import num

SITCA = 'https://www.sitca.org.tw/ROC'
ZONE_Q = f'{SITCA}/SITCA_ETF/etf_statement.aspx'
ZONE_R = f'{SITCA}/SITCA_ETF/etf_statement2.aspx'
PAGES = {'m': f'{SITCA}/Industry/IN2629.aspx', 'q': f'{SITCA}/Industry/IN2630.aspx'}
SRC_PAGE = {'m': 'https://www.sitca.org.tw/ROC/Industry/IN2629.aspx', 'q': 'https://www.sitca.org.tw/ROC/Industry/IN2630.aspx'}
GRID_ID = 'ctl00_ContentPlaceHolder1_GridView1'
FP = 'ctl00$ContentPlaceHolder1$'
KEEP = {'m': 3, 'q': 2}          # 每月前十大留 3 期、每季明細留 2 期（算「最近換了哪些」）

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
        ('受益憑證', 'fund'), ('基金', 'fund'), ('期貨', 'fut'), ('存託憑證', 'dr'))


def kind_of(text: str) -> str:
    t = text or ''
    for k, v in KIND:
        if k in t:
            return v
    return 'o'


def holding_rows(header, rows):
    """明細列 → [[代號, 名稱, 種類, 占淨值%, 金額(元)]]，依比例大到小。"""
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
        out.append([code, r[iname].strip(), kind, round(pct, 3), num(r[iamt]) if iamt is not None else None])
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
    """某一期、好幾個類型代號的明細：{基金名稱: [[代號, 名稱, 種類, %, 金額]]}。
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


def update(state, http, today: dt.date, force=False):
    """一天最多檢查一次；有新的一期才抓。結果存進 state['hold']：{m: {期間: {代號: 列}}, q: {...}, zone: {...}}。"""
    hold = state['hold']
    day = today.strftime('%Y%m%d')
    if hold.get('checked') == day and not force:
        return 'skip'
    zm = zone_months(http)
    if not zm:
        raise ValueError('ETF 專區找不到月份選單')
    zones = {}

    def zmap_for(ym):
        z = ym if ym in zm else zm[0]
        if z not in zones:
            zones[z] = zone(http, z)
        return zones[z]
    got = []
    for kind in ('m', 'q'):
        months, page = periods(http, kind)
        if not months:
            raise ValueError(f'{kind} 找不到期間選單')
        store = hold.setdefault(kind, {})
        want = months[:KEEP[kind]]
        for ym in want:
            if ym in store and not force:
                continue
            rows, n_funds = fetch_period(http, kind, ym, zmap_for(ym), page)
            if rows:
                store[ym] = rows
                got.append(f'{kind}{ym}:{len(rows)}/{n_funds}')
        for ym in list(store):
            if ym not in want:
                del store[ym]
    latest = zmap_for(zm[0])
    hold['zone'] = {c: [z['n'], z['cls']] for c, z in latest.items()}
    hold['zone_ym'] = zm[0]
    hold['checked'] = day
    return got or 'no-new'


# ------------------------------------------------------------------ 成分股的官方個股資料

TWSE_OPEN = 'https://openapi.twse.com.tw/v1'
TPEX_OPEN = 'https://www.tpex.org.tw/openapi/v1'


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
