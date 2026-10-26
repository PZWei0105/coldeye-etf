"""ETF 成分股（投信投顧公會）與成分股個股資料的測試：python3 tests/holdings_test.py
解析（rowspan、表頭用 </th> 收尾）、種類、名稱比對只做完全相符、期間 postback 流程、只抓新的一期、
新的一期不完整先不收、20 天內每天重抓合併；個股資料（指定日期的官方收盤、每輪檢查到最新交易日、不倒退、失敗保留上一次）、
盤中成分股報價（MIS）、輸出檔（每檔、索引、反查、最新一期沒有的 ETF）。"""
import datetime as dt
import json
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from pipeline import holdings as H  # noqa: E402

n = 0


def t(name):
    def deco(fn):
        global n
        fn()
        n += 1
        print('ok  ', name)
        return fn
    return deco


HEAD_M = ['基金名稱', '名次', '標的種類', '標的代號 或 Bloomberg Isin Code', '標的名稱', '金額', '擔保機構**', '次順位債券**', '受益權單位數***', '占基金淨資產價值 之比例(%)']
HEAD_Q = [h for h in HEAD_M if h != '名次']


def result_html(funds, head=HEAD_M):
    """IN2629 的結果表：沒有 id、表頭的 <td> 用 </th> 收尾、基金名稱 rowspan 跨列，外面包一層排版表格。"""
    th = ''.join(f'<td class=DTHeader nowrap>{h}</th>' for h in head)
    body = ''
    for name, rows in funds:
        for i, r in enumerate(rows):
            cells = ''.join(f'<td>{c}</td>' for c in r)
            body += f'<tr><td rowspan={len(rows)}>{name}</td>{cells}</tr>' if i == 0 else f'<tr>{cells}</tr>'
    return f'<table><tr><td><table border=1><tr>{th}</tr>{body}</table></td></tr></table>'


def row_m(rank, kind, code, name, pct):
    return [str(rank), kind, code, name, '1,000', '', '', '0', pct]


def row_q(kind, code, name, pct):
    return [kind, code, name, '1,000', '', '', '0', pct]


@t('解析：rowspan 的後幾列少一格、表頭用 </th> 收尾、警語留在名稱裡')
def _():
    html = result_html([('元大台灣卓越50基金 (本基金之配息來源可能為收益平準金)', [row_m(1, '國內上市', '2330', '台積電', '56.45'), row_m(2, '國內上市', '2454', '聯發科', '6.74')]),
                        ('群益台灣精選高息ETF基金', [row_m(1, '國內上市', '2881', '富邦金', '15.05')])])
    head, funds = H.parse_holdings(html)
    assert head == HEAD_M, head
    assert len(funds) == 2
    rows = H.holding_rows(head, funds['元大台灣卓越50基金 (本基金之配息來源可能為收益平準金)'])
    assert rows == [['2330', '台積電', 'tse', 56.45], ['2454', '聯發科', 'tse', 6.74]], rows
    assert H.parse_holdings('<html>沒有表</html>') == ([], {})


@t('種類：上市、上櫃、國外（股票、存託憑證、國外 ETF）、債券、基金、其他')
def _():
    cases = {'國內上市': 'tse', '國內上櫃': 'otc', '國外股票(含承銷)': 'f', '國外存託憑證': 'f', '國外掛牌交易之ETF': 'f',
             '公司債 無擔保': 'b', '政府公債 100%比例(有擔)': 'b', '金融債-Tlac 無擔保': 'b', '同公司發行之境內基金': 'fund',
             '投信ETF': 'fund', '依境外基金管理辦法經金管會核准之境外基金': 'fund', '其他': 'o'}
    for k, v in cases.items():
        assert H.kind_of(k) == v, (k, H.kind_of(k))


@t('每季明細沒有名次欄；比例由大到小；比例空白的列略過')
def _():
    head = HEAD_Q
    rows = [row_q('國內上市', '2330', '台積電', '10.0'), row_q('國內上市', '2454', '聯發科', '20.5'), row_q('其他', '-', '現金', '')]
    out = H.holding_rows(head, rows)
    assert [r[0] for r in out] == ['2454', '2330'], out


@t('名稱比對：拿掉警語與級別後完全相同才算；正 2 和反 1 不會配錯')
def _():
    zone = {'0050': {'fund': '元大台灣卓越50基金', 'cls': 'AH11'}, '00631L': {'fund': '元大台灣50單日正向2倍基金', 'cls': 'AH13'},
            '00632R': {'fund': '元大台灣50單日反向1倍基金', 'cls': 'AH13'}, '00625K': {'fund': '富邦上証基金-人民幣', 'cls': 'AH21'}}
    funds = {'元大台灣卓越50基金 (本基金之配息來源可能為收益平準金)': [['2330', '台積電', 'tse', 56.0]],
             '元大台灣50單日正向2倍基金 (本基金為策略交易型產品…)': [['2330', '台積電', 'tse', 42.0]],
             '富邦上証基金-新台幣': [['CNE1', 'X', 'f', 9.0]]}
    m = H.match(zone, funds)
    assert set(m) == {'0050', '00631L', '00625K'}, m
    assert '00632R' not in m
    assert H.fund_key('富邦上証基金-美元(配息)') == '富邦上証基金'


class FakeSitca:
    """假的投信投顧公會：ETF 專區（月份選單＋結果表）、明細頁（期間選單、postback、依類型查詢）。"""

    def __init__(self, months_m, months_q, zone_rows, data):
        self.months = {'m': months_m, 'q': months_q}
        self.zone_rows = zone_rows          # {月份: [[代號, 簡稱, 統編, 基金名稱, 類型]]}
        self.data = data                    # {(kind, 期間, 類型): [(基金名稱, [列])]}
        self.calls = []
        self.state = {}                     # 每一頁目前選的期間（postback 之後才會換）

    def _select(self, name, months, cur):
        opts = ''.join(f'<option value="{m}"{" selected" if m == cur else ""}>{m}</option>' for m in months)
        return f'<select name="ctl00$ContentPlaceHolder1${name}">{opts}</select>'

    def _page(self, kind, cur, vs):
        return (f'<form><input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="{vs}" />'
                f'<input type="hidden" name="__EVENTVALIDATION" id="__EVENTVALIDATION" value="ev" />'
                + self._select('ddlQ_YM', self.months[kind], cur) + '</form>')

    def get(self, url, timeout=None, **kw):
        self.calls.append(('GET', url))
        if 'etf_statement2' in url:
            ym = url.split('txtYM=')[1][:6]
            head = ['序號', '類型代號', '證券代號', '證券簡稱', '基金統編', '基金名稱', '類型']
            rows = ''.join(f'<tr><td>{i + 1}</td><td>{r[4]}</td><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td><td>x</td></tr>' for i, r in enumerate(self.zone_rows[ym]))
            html = f'<table id="ctl00_ContentPlaceHolder1_GridView1"><tr>{"".join(f"<th>{h}</th>" for h in head)}</tr>{rows}<tr><td>合計</td></tr></table>'
            return Resp(html)
        if 'etf_statement.aspx' in url:
            return Resp(self._select('ddlYM', sorted(self.zone_rows, reverse=True), None))
        kind = 'm' if 'IN2629' in url else 'q'
        return Resp(self._page(kind, self.months[kind][0], 'vs0'))

    def post(self, url, data=None, timeout=None, **kw):
        kind = 'm' if 'IN2629' in url else 'q'
        self.calls.append(('POST', url, data.get('ctl00$ContentPlaceHolder1$ddlQ_YM'), data.get('ctl00$ContentPlaceHolder1$ddlQ_Class'), data.get('__VIEWSTATE')))
        ym = data['ctl00$ContentPlaceHolder1$ddlQ_YM']
        if data.get('__EVENTTARGET', '').endswith('ddlQ_YM'):
            self.state[kind] = ym
            return Resp(self._page(kind, ym, f'vs-{ym}'))
        # 查詢：一定要先送過期間的 postback（VIEWSTATE 要是那一頁的），不然回第一家（測試裡回空的）
        if data.get('__VIEWSTATE') != f'vs-{ym}' or self.state.get(kind) != ym:
            return Resp(result_html([]))
        cls = data['ctl00$ContentPlaceHolder1$ddlQ_Class']
        return Resp(result_html(self.data.get((kind, ym, cls), []), HEAD_M if kind == 'm' else HEAD_Q))


class Resp:
    def __init__(self, text):
        self.content = text.encode('utf-8')


class St(dict):
    def __getitem__(self, k):
        return self.setdefault(k, {})


ZONE = {'202609': [['0050', '元大台灣50', '1', '元大台灣卓越50基金', 'AH11'], ['00878', '國泰永續高股息', '2', '國泰台灣ESG永續高股息ETF基金', 'AH11'],
                   ['00662', '富邦NASDAQ', '3', '富邦NASDAQ-100基金', 'AH21']],
        '202608': [['0050', '元大台灣50', '1', '元大台灣卓越50基金', 'AH11']],
        '202606': [['0050', '元大台灣50', '1', '元大台灣卓越50基金', 'AH11']]}
DATA = {
    ('m', '202609', 'AH11'): [('元大台灣卓越50基金', [row_m(1, '國內上市', '2330', '台積電', '56.45'), row_m(2, '國內上市', '2454', '聯發科', '6.74')]),
                              ('國泰台灣ESG永續高股息ETF基金', [row_m(1, '國內上市', '2891', '中信金', '9.65'), row_m(2, '國內上櫃', '5274', '信驊', '2.0')])],
    ('m', '202609', 'AH21'): [('富邦NASDAQ-100基金', [row_m(1, '國外股票(含承銷)', 'US67066G1040', 'NVIDIA CORP', '8.25')])],
    ('m', '202608', 'AH11'): [('元大台灣卓越50基金', [row_m(1, '國內上市', '2330', '台積電', '55.0'), row_m(2, '國內上市', '2317', '鴻海', '3.0')])],
    ('q', '202609', 'AH11'): [('元大台灣卓越50基金', [row_q('國內上市', '2330', '台積電', '56.45'), row_q('國內上市', '2454', '聯發科', '6.74'), row_q('國內上市', '2308', '台達電', '3.4')])],
    ('q', '202609', 'AH21'): [('富邦NASDAQ-100基金', [row_q('國外股票(含承銷)', 'US67066G1040', 'NVIDIA CORP', '8.25')])],
    ('q', '202606', 'AH11'): [('元大台灣卓越50基金', [row_q('國內上市', '2330', '台積電', '50.0')])],
}


@t('期間 postback 流程：先換期間、再用回來的 VIEWSTATE 查每一類；只抓新的一期、舊的刪掉、一天只檢查一次')
def _():
    http = FakeSitca(['202609', '202608', '202607'], ['202609', '202606', '202603'], ZONE, DATA)
    st = St()
    got = H.update(st, http, dt.date(2026, 10, 26))
    assert got == ['m202609:3/3', 'm202608:1/1', 'q202609:2/2', 'q202606:1/1'], got
    assert st['hold']['m']['202609']['0050'][0] == ['2330', '台積電', 'tse', 56.45]
    assert st['hold']['m']['202609']['00878'][1][2] == 'otc'
    assert set(st['hold']['m']) == {'202609', '202608'} and set(st['hold']['q']) == {'202609', '202606'}
    assert st['hold']['zone']['00662'] == ['富邦NASDAQ', 'AH21']
    # 查詢一定帶期間 postback 回來的 VIEWSTATE
    q = [c for c in http.calls if c[0] == 'POST' and c[3]]
    assert all(c[4] == f'vs-{c[2]}' for c in q), q
    assert H.update(st, http, dt.date(2026, 10, 26)) == 'skip'
    # 隔天：剛出來的一期（20 天內）會再確認一次（內容一樣就不算新的）
    n0 = len([c for c in http.calls if c[0] == 'POST'])
    assert H.update(st, http, dt.date(2026, 10, 27)) == 'no-new'
    assert len([c for c in http.calls if c[0] == 'POST']) > n0
    # 超過 20 天、沒有新的一期：不抓明細
    n1 = len([c for c in http.calls if c[0] == 'POST'])
    assert H.update(st, http, dt.date(2026, 11, 20)) == 'no-new'
    assert len([c for c in http.calls if c[0] == 'POST']) == n1
    # 新的一月：只抓 202610，202608 被擠掉
    http.months['m'] = ['202610', '202609', '202608']
    ZONE['202610'] = ZONE['202609']
    DATA[('m', '202610', 'AH11')] = DATA[('m', '202609', 'AH11')]
    DATA[('m', '202610', 'AH21')] = DATA[('m', '202609', 'AH21')]
    got = H.update(st, http, dt.date(2026, 11, 21))
    assert got == ['m202610:3/3'], got
    assert set(st['hold']['m']) == {'202610', '202609'}
    assert st['hold']['seen'].get('m202610') == '20261121' and 'm202608' not in st['hold']['seen']


@t('新的一期抓得不完整：配對到的不到上一期一半先不收，隔天再抓；晚報的投信補進來、某一類暫時失敗不會少一塊')
def _():
    zone = {'202609': ZONE['202609'], '202610': ZONE['202609']}
    data = {k: v for k, v in DATA.items() if k[1] == '202609'}
    http = FakeSitca(['202609'], ['202609'], zone, data)
    st = St()
    H.update(st, http, dt.date(2026, 10, 26))
    assert len(st['hold']['m']['202609']) == 3
    # 新的一月只回了一檔（1/3 < 一半）：不收
    http.months['m'] = ['202610', '202609']
    data[('m', '202610', 'AH21')] = data[('m', '202609', 'AH21')]
    got = H.update(st, http, dt.date(2026, 11, 12))
    assert '202610' not in st['hold']['m'] and any('不完整' in g for g in got), got
    # 隔天：AH11 也出來了一檔 → 收（2 檔，不少於一半）
    data[('m', '202610', 'AH11')] = [data[('m', '202609', 'AH11')][0]]
    got = H.update(st, http, dt.date(2026, 11, 13))
    assert set(st['hold']['m']['202610']) == {'0050', '00662'}, got
    # 再隔天：國泰晚報補進來 → 合併成 3 檔
    data[('m', '202610', 'AH11')] = data[('m', '202609', 'AH11')]
    got = H.update(st, http, dt.date(2026, 11, 14))
    assert set(st['hold']['m']['202610']) == {'0050', '00878', '00662'}, got
    # 某一類暫時抓不到（回空的）：已經有的保留
    data[('m', '202610', 'AH21')] = []
    H.update(st, http, dt.date(2026, 11, 15))
    assert set(st['hold']['m']['202610']) == {'0050', '00878', '00662'}


RED, GREEN = '<p style= color:red>+</p>', '<p style= color:green>-</p>'
TW_ROWS = {   # 證交所每日收盤行情（全部）：代號 → (收盤, 符號, 價差)
    '2330': ('2,385.00', GREEN, '35.00'), '2454': ('4,010.00', 'X', '0.00'), '2891': ('74.90', RED, '0.10'), '2308': ('--', ' ', '0.00')}


def _roc_s(d):
    return f'{d // 10000 - 1911}{d % 10000:04d}'


class FakeOpen:
    """假的證交所／櫃買：指定日期的查詢只有 day 那天有資料；OpenAPI 回 open_day 那天。"""

    def __init__(self, day=20261022, open_day=20261022, fail=(), px=None, rev_ym='11509', resp_day=None):
        self.day, self.open_day, self.fail, self.urls = day, open_day, set(fail), []
        self.px = dict(TW_ROWS, **(px or {}))
        self.rev_ym, self.resp_day = rev_ym, resp_day

    def json(self, url, timeout=None, **kw):
        self.urls.append(url)
        for f in self.fail:
            if f in url:
                raise RuntimeError('ChunkedEncodingError')
        if 'MI_INDEX' in url:
            d = int(url.split('date=')[1][:8])
            if d != self.day:
                return {'stat': '很抱歉，沒有符合條件的資料!'}
            fields = ['證券代號', '證券名稱', '成交股數', '成交筆數', '成交金額', '開盤價', '最高價', '最低價', '收盤價', '漲跌(+/-)', '漲跌價差', '本益比']
            data = [[c, 'x', '1', '1', '1', '1', '1', '1', v[0], v[1], v[2], '0'] for c, v in self.px.items()]
            return {'stat': 'OK', 'date': str(self.resp_day or d), 'tables': [
                {'title': '價格指數', 'fields': ['指數', '收盤指數'], 'data': [['發行量加權股價指數', '27,000']]},
                {'title': '每日收盤行情(全部(不含權證、牛熊證))', 'fields': fields, 'data': data}]}
        if 'BWIBBU_d' in url:
            d = int(url.split('date=')[1][:8])
            if d != self.day:
                return {'stat': '很抱歉，沒有符合條件的資料!'}
            return {'stat': 'OK', 'date': str(d), 'fields': ['證券代號', '證券名稱', '收盤價', '殖利率(%)', '股利年度', '本益比', '股價淨值比', '財報年/季'],
                    'data': [['2330', '台積電', '2385', '0.92', '114', '27.65', '9.61', '115/2'], ['2891', '中信金', '74.9', '3.34', '114', '-', '2.14', '115/2']]}
        if 'peQryDate' in url:
            y, m, dd = url.split('date=')[1].split('&')[0].split('%2F')
            d = int(y) * 10000 + int(m) * 100 + int(dd)
            rows = [['5274', '信驊', '106.80', '15.0', 114, '0.51', '77.68', '115Q2']] if d == self.day else []
            return {'stat': 'ok', 'date': str(d), 'tables': [{'title': '', 'fields': ['股票代號', '公司名稱', '本益比', '每股股利', '股利年度', '殖利率(%)', '股價淨值比', '財報年/季'], 'data': rows}]}
        if 'afterTrading/otc' in url:
            y, m, dd = url.split('date=')[1].split('&')[0].split('%2F')
            d = int(y) * 10000 + int(m) * 100 + int(dd)
            if d != self.day:
                return {'stat': 'ok', 'date': str(self.day - 1), 'tables': [{'fields': ['代號', '名稱', '收盤', '漲跌'], 'data': [['5274', '信驊', '15,000.00', '-1.00']]}]}
            return {'stat': 'ok', 'date': str(d), 'tables': [{'title': '上櫃股票行情', 'fields': ['代號', '名稱', '收盤', '漲跌'], 'data': [['5274', '信驊', '16,010.00', '-505.00']]}]}
        od = _roc_s(self.open_day)
        if url.endswith('STOCK_DAY_ALL'):
            return [{'Date': od, 'Code': '2330', 'Name': '台積電', 'ClosingPrice': '2300.00', 'Change': '-10.0000'},
                    {'Date': od, 'Code': '2891', 'Name': '中信金', 'ClosingPrice': '70.00', 'Change': 'X0.0000'}]
        if url.endswith('BWIBBU_ALL'):
            return [{'Date': od, 'Code': '2330', 'PEratio': '26.00', 'DividendYield': '1.00', 'PBratio': '9.00'}]
        if url.endswith('t187ap05_L'):
            return [{'資料年月': self.rev_ym, '公司代號': '2330', '公司名稱': '台積電', '產業別': '半導體業', '營業收入-去年同月增減(%)': '54.65', '累計營業收入-前期比較增減(%)': '41.11'}]
        if url.endswith('tpex_mainboard_daily_close_quotes'):
            return [{'Date': od, 'SecuritiesCompanyCode': '5274', 'Close': '16000.00', 'Change': '-5.00'}]
        if url.endswith('tpex_mainboard_peratio_analysis'):
            return [{'Date': od, 'SecuritiesCompanyCode': '5274', 'PriceEarningRatio': '106.80', 'YieldRatio': '0.51', 'PriceBookRatio': '77.68'}]
        if url.endswith('mopsfin_t187ap05_O'):
            return [{'資料年月': self.rev_ym, '公司代號': '5274', '公司名稱': '信驊', '產業別': '半導體業', '營業收入-去年同月增減(%)': '100.93', '累計營業收入-前期比較增減(%)': '77.73'}]
        raise AssertionError(url)


def _stock_state():
    http = FakeSitca(['202609', '202608'], ['202609', '202606'], ZONE, DATA)
    st = St()
    H.update(st, http, dt.date(2026, 10, 26), force=True)
    return st


@t('個股資料：用指定日期的官方收盤（回應日期對得上才用）、漲跌換成百分比、不比價（X）不算漲跌、每一檔記自己的日期')
def _():
    st = _stock_state()
    tw, tp = FakeOpen(), FakeOpen()
    msg = H.update_stocks(st, tw, tp, dt.date(2026, 10, 22), target=20261022)
    s = st['stocks']['s']
    assert set(s) == {'2330', '2454', '2891', '5274', '2308'}, (s, msg)
    assert s['2330'][:6] == ['台積電', 'tse', '半導體業', 2385.0, round(-35 / 2420 * 100, 2), 20261022], s['2330']
    assert s['2330'][6:] == [27.65, 0.92, 9.61, 20261022, 54.65, 41.11, '202609'], s['2330']
    assert s['2454'][3] == 4010.0 and s['2454'][4] is None            # 不比價
    assert s['2891'][6] is None and s['2891'][7] == 3.34              # 本益比是「-」
    assert s['2308'][3] is None and s['2308'][5] is None               # 那天沒成交：留空
    assert s['5274'][1] == 'otc' and s['5274'][3] == 16010.0 and s['5274'][5] == 20261022
    assert s['5274'][6] == 106.8 and s['5274'][9] == 20261022         # 上櫃本益比（依日期查詢）
    assert st['stocks']['dd'] == {'tse': 20261022, 'otc': 20261022, 'pe_tse': 20261022, 'pe_otc': 20261022}
    assert not any('STOCK_DAY_ALL' in u for u in tw.urls)              # 指定日期有資料就不用 OpenAPI
    # 同一天再跑：全部都是最新的 → 略過（不再抓任何東西）
    n = len(tw.urls) + len(tp.urls)
    assert H.update_stocks(st, tw, tp, dt.date(2026, 10, 22), target=20261022) == 'skip'
    assert len(tw.urls) + len(tp.urls) == n


@t('個股資料：新的交易日還沒公布 → 先保留、每一輪再檢查，公布了馬上換；OpenAPI 比手上的舊就不用（不會倒退）')
def _():
    st = _stock_state()
    H.update_stocks(st, FakeOpen(), FakeOpen(), dt.date(2026, 10, 22), target=20261022)
    # 10/26 下午：證交所還沒出 10/26 的資料，OpenAPI 也還停在 10/21（比手上的舊）
    tw, tp = FakeOpen(day=20261022, open_day=20261021), FakeOpen(day=20261022, open_day=20261021)
    H.update_stocks(st, tw, tp, dt.date(2026, 10, 26), target=20261026)
    s = st['stocks']['s']
    assert s['2330'][3] == 2385.0 and s['2330'][5] == 20261022        # 沒有被 OpenAPI 的舊資料蓋掉
    assert st['stocks']['dd']['tse'] == 20261022
    # 下一輪還會再檢查（不是一天一次）
    tw2, tp2 = FakeOpen(day=20261026, open_day=20261022, px={'2330': ('2,400.00', RED, '15.00')}), FakeOpen(day=20261026, open_day=20261022, fail=('peQryDate',))
    H.update_stocks(st, tw2, tp2, dt.date(2026, 10, 26), target=20261026)
    s = st['stocks']['s']
    assert s['2330'][3] == 2400.0 and s['2330'][5] == 20261026, s['2330']
    assert s['5274'][3] == 16010.0 and s['5274'][5] == 20261026
    assert st['stocks']['dd']['tse'] == 20261026 and st['stocks']['dd']['otc'] == 20261026
    # 上櫃的本益比（依日期查詢失敗、OpenAPI 還停在 10/22）：下一輪只再問那一份
    assert st['stocks']['s']['5274'][9] == 20261022 and st['stocks']['dd']['pe_otc'] == 20261022
    n = len(tw2.urls) + len(tp2.urls)
    H.update_stocks(st, tw2, tp2, dt.date(2026, 10, 26), target=20261026)
    asked = [u.split('/')[-1].split('?')[0] for u in (tw2.urls + tp2.urls)[n:]]
    assert asked == ['peQryDate', 'tpex_mainboard_peratio_analysis'], asked
    tp2.fail = set()
    H.update_stocks(st, tw2, tp2, dt.date(2026, 10, 26), target=20261026)
    assert st['stocks']['s']['5274'][9] == 20261026
    # 月營收今天已經看過、收盤與本益比也都是最新 → 略過
    assert H.update_stocks(st, tw2, tp2, dt.date(2026, 10, 26), target=20261026) == 'skip'


@t('個股資料：指定日期抓不到改用 OpenAPI；某個市場整個失敗就保留上一次的（不會被空的蓋掉）；回應日期對不上不用')
def _():
    st = _stock_state()
    # 指定日期的查詢失敗 → OpenAPI（日期是 10/22，和要的一樣）
    tw = FakeOpen(fail=('MI_INDEX', 'BWIBBU_d'))
    H.update_stocks(st, tw, FakeOpen(fail=('afterTrading/otc',)), dt.date(2026, 10, 22), target=20261022)
    s = st['stocks']['s']
    assert s['2330'][3] == 2300.0 and s['2330'][5] == 20261022 and s['2330'][6] == 26.0
    assert s['2891'][4] is None                                         # OpenAPI 的 X0.0000：不比價
    assert s['5274'][3] == 16000.0
    # 隔天：上櫃整個連不上 → 上櫃保留 10/22 的，上市換成 10/23
    H.update_stocks(st, FakeOpen(day=20261023, open_day=20261023), FakeOpen(fail=('tpex', 'afterTrading')),
                    dt.date(2026, 10, 23), target=20261023)
    s = st['stocks']['s']
    assert s['2330'][5] == 20261023 and s['5274'][3] == 16000.0 and s['5274'][5] == 20261022
    assert st['stocks']['dd']['otc'] == 20261022
    # 回應裡的日期和要的不一樣（查 10/26 卻回 10/23 的）：不用
    st2 = _stock_state()
    H.update_stocks(st2, FakeOpen(day=20261026, open_day=20261020, resp_day=20261023), FakeOpen(open_day=20261020),
                    dt.date(2026, 10, 26), target=20261026)
    assert st2['stocks']['s']['2330'][5] == 20261020, st2['stocks']['s']['2330']


@t('個股資料：舊格式（日期記在整份上）會升級；月營收每一檔記自己的月份，還沒公布新月份的保留舊的')
def _():
    st = _stock_state()
    st['stocks'].update({'d': 20261021, 'd_otc': 20261021, 'rev': '202608', 'checked': '20261021',
                         's': {'2330': ['台積電', 'tse', '半導體業', 2300.0, 1.0, 27.0, 0.9, 9.5, 50.0, 40.0]}})
    up = H._upgrade(st['stocks']['s']['2330'], st['stocks'])
    assert up == ['台積電', 'tse', '半導體業', 2300.0, 1.0, 20261021, 27.0, 0.9, 9.5, None, 50.0, 40.0, '202608'], up
    # 10 月營收：台積電公布了，信驊還沒（OpenAPI 裡沒有它）
    tp = FakeOpen(rev_ym='11510')
    tp_json = tp.json

    def no_otc_rev(url, **kw):
        if url.endswith('mopsfin_t187ap05_O'):
            return []
        return tp_json(url, **kw)
    tp.json = no_otc_rev
    H.update_stocks(st, FakeOpen(rev_ym='11510'), tp, dt.date(2026, 10, 22), target=20261022)
    s = st['stocks']['s']
    assert s['2330'][12] == '202610' and s['5274'][12] is None


@t('盤中成分股報價：MIS 一次查 120 檔，量換成張、記資料時間與日期；沒有成交價的留空')
def _():
    from pipeline import tape
    st = _stock_state()
    calls = []

    def fake_fetch(http, api, chans):
        calls.append((api, list(chans)))
        arr = []
        for ch in chans:
            mk, code = ch.split('.')[0].split('_')
            if code == '2308':
                arr.append({'c': code, 'z': '-', 'y': '1000.00', 'v': '0', 't': '09:01:00', 'd': '20261027', 'tlong': '1792976460000'})
            else:
                arr.append({'c': code, 'z': '2400.0000', 'y': '2385.00', 'o': '2390', 'h': '2410', 'l': '2380', 'v': '12345',
                            't': '10:31:05', 'd': '20261027', 'tlong': '1792981865000'})
        return 1792981870, arr
    orig, origget = tape._fetch, H.__dict__.get('Http')
    tape._fetch = fake_fetch

    class NoNet:
        def __init__(self, *a, **k):
            pass

        def get(self, *a, **k):
            raise RuntimeError('no net')
    import pipeline.util as U
    real_http = U.Http
    U.Http = NoNet
    try:
        out = H.stock_quotes(st)
    finally:
        tape._fetch = orig
        U.Http = real_http
    assert calls and calls[0][0] == 'getStockInfo.jsp'
    assert 'tse_2330.tw' in calls[0][1] and 'otc_5274.tw' in calls[0][1]
    q = out['q']
    assert q['2330'] == [2400.0, 2385.0, 2390.0, 2410.0, 2380.0, 12345, 1792981865, 20261027], q['2330']
    assert q['2308'][0] is None and q['2308'][1] == 1000.0
    assert out['d'] == 20261027 and out['n'] == 5


@t('輸出：每一檔的明細（含上一期）、索引（最完整清單、涵蓋率、前三大）、個股資料（每一檔自己的日期）與反查')
def _():
    st = _stock_state()
    H.update_stocks(st, FakeOpen(), FakeOpen(), dt.date(2026, 10, 22), target=20261022)
    out = pathlib.Path(tempfile.mkdtemp())
    n_etf = H.write_out(st, out)
    assert n_etf == 3
    h0050 = json.loads((out / 'hold' / '0050.json').read_text(encoding='utf-8'))
    assert h0050['m']['p'] == '202609' and h0050['pm']['p'] == '202608' and h0050['q']['p'] == '202609' and h0050['pq']['p'] == '202606'
    idx = json.loads((out / 'hold.json').read_text(encoding='utf-8'))
    assert idx['etf']['0050']['k'] == 'q' and idx['etf']['0050']['n'] == 3 and abs(idx['etf']['0050']['cov'] - 66.59) < 1e-6
    assert idx['etf']['00878']['k'] == 'm'   # 沒有每季明細
    assert idx['etf']['0050']['top'][0] == ['2330', 56.45]
    sj = json.loads((out / 'stocks.json').read_text(encoding='utf-8'))
    assert sj['by']['2330'] == [['0050', 56.45]]
    assert sj['f']['US67066G1040'] == 'NVIDIA CORP' and sj['nby']['US67066G1040'] == 1
    assert len(sj['s']['2330']) == 13 and sj['s']['2330'][5] == 20261022 and sj['dd']['tse'] == 20261022 and sj['at']
    # 沒有任何明細：不輸出
    assert H.write_out(St(), pathlib.Path(tempfile.mkdtemp())) == 0


@t('輸出：最新一期裡沒有的 ETF 先用它自己最新的一期（期間照實標）；已經不在 ETF 專區的不輸出')
def _():
    st = _stock_state()
    hold = st['hold']
    hold['m']['202610'] = {'0050': hold['m']['202609']['0050'], '00662': hold['m']['202609']['00662']}
    hold['m'].pop('202608')
    hold['m']['202609']['00999'] = [['2330', '台積電', 'tse', 10.0]]     # 只在舊的一期、也不在專區
    out = pathlib.Path(tempfile.mkdtemp())
    H.write_out(st, out)
    h878 = json.loads((out / 'hold' / '00878.json').read_text(encoding='utf-8'))
    assert h878['m']['p'] == '202609' and 'pm' not in h878, h878
    assert not (out / 'hold' / '00999.json').exists()


@t('最完整清單：每季不比每月舊 2 個月以上用每季')
def _():
    m = {'p': '202612', 'h': [['a', 'a', 'tse', 1]]}
    q = {'p': '202609', 'h': [['a', 'a', 'tse', 1], ['b', 'b', 'tse', 1]]}
    assert H.best_list({'m': m, 'q': q}) is m
    assert H.best_list({'m': {'p': '202611', 'h': []}, 'q': q}) is q
    assert H.best_list({'q': q}) is q


@t('民國日期：1151022 → 20261022、11509 → 202609')
def _():
    assert H._roc('1151022') == 20261022 and H._roc('11509') == '202609' and H._roc('') is None


print(f'\n全部通過（{n} 項）')
