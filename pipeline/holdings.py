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

from .util import num, write_json

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
    if got:
        hold['at'] = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(timespec='minutes')
    return got or 'no-new'


# ------------------------------------------------------------------ 成分股的官方個股資料

TWSE_OPEN = 'https://openapi.twse.com.tw/v1'
TPEX_OPEN = 'https://www.tpex.org.tw/openapi/v1'
TPEX_RWD = 'https://www.tpex.org.tw/www/zh-tw'


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


def domestic_codes(state):
    """成分股裡出現過的國內股票：{代號: 'tse' 或 'otc'}（最新一期的每月與每季明細）。"""
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


def _tpex_close(http, d_hint):
    """上櫃收盤：先用 OpenAPI，抓不到改用櫃買的每日收盤行情（和 ETF 用的同一份）。回傳 {代號: (收盤, 漲跌)}、日期。"""
    try:
        js = http.json(f'{TPEX_OPEN}/tpex_mainboard_daily_close_quotes', timeout=90)
        out, day = {}, None
        for r in js or []:
            code = str(r.get('SecuritiesCompanyCode') or '').strip()
            c, ch = _f(r.get('Close')), _f(r.get('Change'))
            if code and c:
                out[code] = (c, ch)
                day = day or _roc(r.get('Date'))
        if out:
            return out, day
    except Exception:  # noqa: BLE001 — 換另一個官方來源
        pass
    if not d_hint:
        return {}, None
    from .util import tables_of, find_col
    y, m, dd = d_hint // 10000, d_hint // 100 % 100, d_hint % 100
    js = http.json(f'{TPEX_RWD}/afterTrading/otc?date={y}%2F{m:02d}%2F{dd:02d}&type=EW&id=&response=json')
    out = {}
    for t in tables_of(js):
        f = t['fields']
        ic, icl, ich = find_col(f, '代號'), find_col(f, '收盤'), find_col(f, '漲跌')
        if ic is None or icl is None:
            continue
        for row in t['data']:
            c = _f(row[icl])
            if c:
                out[str(row[ic]).strip()] = (c, _f(row[ich]) if ich is not None else None)
    return out, d_hint if out else None


def update_stocks(state, http_tw, http_tp, today: dt.date, force=False):
    """成分股（國內上市、上櫃）的官方資料：收盤、漲跌、本益比、殖利率、股價淨值比、產業別、最新月營收年增率。
    證交所、櫃買的 OpenAPI 是「最新一天」的資料；一天檢查一次，存進 state['stocks']。"""
    st = state['stocks']
    want = domestic_codes(state)
    if not want:
        return 'no-holdings'
    day = today.strftime('%Y%m%d')
    if st.get('checked') == day and not force:
        return 'skip'
    s = {}
    # 上市
    px, d_tw = {}, None
    for r in http_tw.json(f'{TWSE_OPEN}/exchangeReport/STOCK_DAY_ALL', timeout=90) or []:
        code = str(r.get('Code') or '').strip()
        c, ch = _f(r.get('ClosingPrice')), _f(r.get('Change'))
        if code in want and c:
            px[code] = (c, ch)
        d_tw = d_tw or _roc(r.get('Date'))
    ratio = {}
    for r in http_tw.json(f'{TWSE_OPEN}/exchangeReport/BWIBBU_ALL', timeout=90) or []:
        code = str(r.get('Code') or '').strip()
        if code in want:
            ratio[code] = (_f(r.get('PEratio')), _f(r.get('DividendYield')), _f(r.get('PBratio')))
    rev, ym = {}, None

    def take_rev(rows):
        nonlocal ym
        for r in rows or []:
            code = str(r.get('公司代號') or '').strip()
            if code in want:
                rev[code] = (str(r.get('產業別') or '').strip(), _f(r.get('營業收入-去年同月增減(%)')),
                             _f(r.get('累計營業收入-前期比較增減(%)')), str(r.get('公司名稱') or '').strip())
                ym = ym or _roc(r.get('資料年月'))
    take_rev(http_tw.json(f'{TWSE_OPEN}/opendata/t187ap05_L', timeout=90))
    # 上櫃
    tpx, d_tp = _tpex_close(http_tp, d_tw)
    for code, v in tpx.items():
        if code in want:
            px[code] = v
    for r in http_tp.json(f'{TPEX_OPEN}/tpex_mainboard_peratio_analysis', timeout=90) or []:
        code = str(r.get('SecuritiesCompanyCode') or '').strip()
        if code in want:
            ratio[code] = (_f(r.get('PriceEarningRatio')), _f(r.get('YieldRatio')), _f(r.get('PriceBookRatio')))
    try:
        take_rev(http_tp.json(f'{TPEX_OPEN}/mopsfin_t187ap05_O', timeout=90))
    except Exception:  # noqa: BLE001 — 月營收少了上櫃的也沒關係
        pass
    names = {}
    for kind in ('m', 'q'):
        per = state['hold'].get(kind) or {}
        for ym_ in sorted(per, reverse=True)[:1]:
            for rows in per[ym_].values():
                for r in rows:
                    if r[0] in want:
                        names.setdefault(r[0], r[1])
    for code, mkt in want.items():
        c, ch = px.get(code, (None, None))
        pct = round(ch / (c - ch) * 100, 2) if c and ch is not None and c - ch else None
        pe, dy, pb = ratio.get(code, (None, None, None))
        ind, yoy, cum, _n = rev.get(code, ('', None, None, ''))
        s[code] = [names.get(code, ''), mkt, ind, c, pct, pe, dy, pb, round(yoy, 2) if yoy is not None else None,
                   round(cum, 2) if cum is not None else None]
    st.clear()
    st.update({'d': d_tw, 'd_otc': d_tp, 'rev': ym, 'checked': day, 's': s})
    return f'{len(s)} 檔（上市 {sum(1 for v in s.values() if v[1] == "tse")}、收盤 {sum(1 for v in s.values() if v[3])}）'


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
            if ps and c in per[ps[0]]:
                obj[key] = {'p': ps[0], 'h': per[ps[0]][c]}
            if len(ps) > 1 and c in per[ps[1]]:
                obj['p' + key] = {'p': ps[1], 'h': per[ps[1]][c]}
        if 'm' not in obj and 'q' not in obj:
            continue   # 只剩上一期的資料（例如已下市）：不輸出
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
    write_json(out_dir / 'stocks.json', {'d': stocks.get('d'), 'd_otc': stocks.get('d_otc'), 'rev': stocks.get('rev'),
                                         's': stocks.get('s') or {}, 'f': fnames, 'by': by, 'nby': nby})
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
