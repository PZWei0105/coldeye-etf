"""全球市場與市場溫度（pipeline/globalmkt.py）：解析官方格式、盤中／收盤判斷、溫度規則、輸出不偷看。

用法：python3 tests/global_test.py [state 資料夾 global 歷史 json]（給了就用真實資料把 global.json 算一次）
"""
import datetime as dt
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from pipeline import globalmkt as G  # noqa: E402

TW = dt.timezone(dt.timedelta(hours=8))
fails = 0


def check(name, cond, info=''):
    global fails
    if not cond:
        fails += 1
    print(('ok   ' if cond else 'FAIL ') + name + (f'  {info}' if info and not cond else ''))


def at(y, mo, d, h, mi):
    return dt.datetime(y, mo, d, h, mi, tzinfo=TW)


# ---- 解析（2026/10/30 實測的格式）
v = G.parse_vix_csv('DATE,OPEN,HIGH,LOW,CLOSE\n12/31/2018,25,26,24,25.42\n01/02/2019,19.6,24.0,19.3,23.22\n10/28/2026,17,17.3,16.2,16.91\n')
check('VIX 歷史：日期轉成 yyyymmdd、2019 年以前不收', v == [(20190102, 23.22), (20261028, 16.91)], v)
q = G.parse_cboe_quote({'data': {'current_price': 7707.1099, 'prev_day_close': 7743.98, 'price_change_percent': -0.4761,
                                 'last_trade_time': '2026-10-29T13:37:31'}})
check('Cboe 報價：價格、前一天收盤、美東日期與時間', q == {'px': 7707.1099, 'prev': 7743.98, 'pct': -0.4761, 'd': 20261029, 't': '13:37'}, q)
n = G.parse_nasdaq_info({'data': {'primaryData': {'lastSalePrice': '11,487.01', 'percentageChange': '-1.69%',
                                                  'lastTradeTimestamp': 'Oct 29, 2026 1:51 PM ET'},
                                  'keyStats': {'previousclose': {'value': '11,684.00'}}, 'marketStatus': 'Open'}})
check('Nasdaq 即時：千分位、下午 1:51 → 13:51、盤中', n == {'px': 11487.01, 'prev': 11684.0, 'pct': -1.69, 'd': 20261029, 't': '13:51', 'open': True}, n)
h = G.parse_nasdaq_hist({'data': {'tradesTable': {'rows': [{'date': '10/28/2026', 'close': '11,684.00'}, {'date': '01/02/2019', 'close': '1,165.30'}]}}})
check('Nasdaq 歷史：照日期排序', h == [(20190102, 1165.3), (20261028, 11684.0)], h)
f = G.parse_cbc_fx({'data': {'dataSets': [['20260929', '31.876', '157.38'], ['20260930', '31.852', '156.89'], ['20260930', 'x', '1']]}})
check('央行匯率：第 1 欄是新台幣、格式不對的不收', f == [(20260929, 31.876), (20260930, 31.852)], f)
check('央行匯率：不在 20～50 之間就當作格式變了', G.parse_cbc_fx({'data': {'dataSets': [['20260930', '157.38']]}}) == [])
b = G.parse_bot_csv('資料日期,幣別,匯率,現金,即期\n20261029,USD,本行買入,31.555,31.905,31.86,本行賣出,32.225,32.005,31.98\n')
check('臺灣銀行牌告：即期買賣中價', b == [(20261029, 31.955)], b)
tx = G.parse_taifex({'RtData': {'QuoteList': [
    {'SymbolID': 'TXF-P', 'CLastPrice': '', 'CRefPrice': '46368.33'},
    {'SymbolID': 'TXFL6-M', 'CLastPrice': '46430.00', 'CRefPrice': '46702.00', 'CDiffRate': '-0.58', 'CTotalVolume': '213', 'CDate': '20261029', 'CTime': '014804'},
    {'SymbolID': 'TXFK6-M', 'DispCName': '臺指期116', 'CLastPrice': '46305.00', 'CRefPrice': '46569.00', 'CDiffRate': '-0.57', 'CTotalVolume': '29059', 'CDate': '20261029', 'CTime': '015343'}]}})
check('台指期：成交量最大的近月、不拿現貨那一列', tx and tx['sym'] == 'TXFK6-M' and tx['pct'] == -0.57 and tx['t'] == '01:53', tx)

# ---- 盤中還是收盤（決定要不要把報價當收盤補進歷史）
check('Nasdaq 有標盤中：照標的', G.us_open({'open': True}, at(2026, 10, 30, 12, 0)) is True)
check('Cboe 美東 13:37 的報價、台灣 01:52：盤中', G.us_open({'t': '13:37'}, at(2026, 10, 30, 1, 52)) is True)
check('Cboe 美東 16:14（收盤後）：不是盤中', G.us_open({'t': '16:14'}, at(2026, 10, 30, 4, 58)) is False)
check('台灣 09:00～21:20 美股一定休市', G.us_open({'t': '13:37'}, at(2026, 10, 30, 9, 0)) is False)
check('Cboe 美東 09:10 的 VIX（盤前）、台灣 21:25：不算盤中', G.us_open({'t': '09:10'}, at(2026, 10, 30, 21, 25)) is False)
check('收盤：Cboe 美東 16:14', G.is_close({'t': '16:14'}))
check('收盤：VIX 盤前（美東 05:30）不是收盤', not G.is_close({'t': '05:30'}))
check('收盤：Nasdaq 狀態不是盤中', G.is_close({'open': False, 't': None}) and not G.is_close({'open': True, 't': '13:51'}))

# ---- 休市中、而且休市後已經抓過的報價不再抓（對來源客氣）
qa = lambda h, m, d=30: {'at': at(2026, 10, d, h, m).isoformat(timespec='minutes')}  # noqa: E731
check('美股：09:05、早上 07:45 抓過收盤 → 不抓', G.quiet('spx', qa(7, 45), at(2026, 10, 30, 9, 5)))
check('美股：05:25（冬令收盤後還在等延遲報價）→ 照抓', not G.quiet('vix', qa(5, 15), at(2026, 10, 30, 5, 25)))
check('美股：09:05、上次是清晨 05:25 抓的 → 再抓一次確定收盤', not G.quiet('spx', qa(5, 25), at(2026, 10, 30, 9, 5)))
check('美股：21:30 以後（開盤）→ 照抓', not G.quiet('ndx', qa(21, 5), at(2026, 10, 30, 21, 35)))
check('美股：沒有抓過 → 照抓', not G.quiet('sox', None, at(2026, 10, 30, 12, 0)))
check('夜盤：09:05、05:10 以後抓過 → 不抓', G.quiet('txf_night', qa(7, 45), at(2026, 10, 30, 9, 5)))
check('夜盤：15:05（夜盤開盤）→ 照抓', not G.quiet('txf_night', qa(14, 25), at(2026, 10, 30, 15, 5)))
check('日盤：10:00 盤中 → 照抓', not G.quiet('txf_day', qa(9, 55), at(2026, 10, 30, 10, 0)))
check('日盤：14:30、13:50 以後抓過 → 不抓', G.quiet('txf_day', qa(14, 25), at(2026, 10, 30, 14, 30)))
check('日盤：清晨 07:45、昨天 13:50 以後抓過 → 不抓', G.quiet('txf_day', qa(21, 55, 29), at(2026, 10, 30, 7, 45)))

# ---- 指標與溫度
s = {'d': list(range(1, 251)), 'c': [100.0] * 249 + [90.0]}
x = G.indicator(s, 250, 200)
check('均線之下：最新 90、200 日均線約 99.95', x['below'] is True and abs(x['ma'] - 99.95) < 1e-9, x)
check('d 之前沒有資料：None', G.indicator(s, 0, 200) is None)
calm = G.market_temp({'taiex': {'below': False}, 'breadth': 0.3, 'spx': {'below': False}, 'sox': {'below': False}, 'vix': 15,
                      'twd': {'r20': 0.5}, 'ust': 0.1, 'night': -0.4})
check('沒有警訊：晴', calm['level'] == '晴' and calm['n'] == 0, calm)
cloudy = G.market_temp({'taiex': {'below': True}, 'breadth': 0.65, 'spx': {'below': False}, 'vix': 18})
check('加權在季線之下＋六成以上的 ETF 在季線之下：陰', cloudy['level'] == '陰' and cloudy['n'] == 2, cloudy)
rain = G.market_temp({'taiex': {'below': True}, 'breadth': 0.7, 'spx': {'below': True}, 'sox': {'below': True}, 'vix': 22})
check('四個警訊：雨', rain['level'] == '雨' and rain['n'] == 4, rain)
panic = G.market_temp({'vix': 36})
check('VIX 35 以上：直接算雨', panic['level'] == '雨' and panic['n'] == 1, panic)
night = G.market_temp({'night': -2.1})
check('台指期夜盤大跌只提醒、不算警訊（沒有歷史可以回測）', night['n'] == 0 and night['notes'] and '夜盤' in night['notes'][0]['t'], night)
check('門檻：五成以下的 ETF 在季線之下不算警訊', G.market_temp({'breadth': 0.55})['n'] == 0)
check('新台幣 20 日貶 2% 以上、美債殖利率 20 日升 0.5 個百分點以上：各算一個', G.market_temp({'twd': {'r20': 2.4}, 'ust': 0.6})['n'] == 2)

# ---- 不偷看：台灣 d 收盤時，美股、匯率、美債只用 d 之前的
gs = {'spx': {'d': [20261027, 20261028, 20261029], 'c': [1.0, 2.0, 3.0]}}
check('_before：d 那一天的美股收盤（台灣收盤之後才開盤）不算', G._before(gs['spx'], 20261029)['d'] == [20261027, 20261028])
yd = {'20261001': {'y10': 4.0}, **{f'202610{k:02d}': {'y10': 4.0 + k / 100} for k in range(2, 30)}}
check('美債殖利率 20 個交易日變化', abs(G.ust_change(yd, 20261029) - 0.2) < 1e-9, G.ust_change(yd, 20261029))

# ---- update：報價每一輪都抓、歷史一天一次、收盤後的報價補進歷史
class FakeResp:
    def __init__(self, obj=None, text=''):
        self._o, self.text, self.content = obj, text, text.encode('utf-8')

    def json(self):
        return self._o


class FakeHttp:
    def __init__(self):
        self.calls = []

    def get(self, url, **kw):
        self.calls.append(url)
        if 'VIX_History' in url:
            return FakeResp(text='DATE,OPEN,HIGH,LOW,CLOSE\n10/28/2026,1,1,1,16.91\n')
        if 'L3M' in url:
            return FakeResp(text='20261029,USD,本行買入,31.5,31.9,本行賣出,32.2,32.0\n')
        raise RuntimeError('unexpected ' + url)

    def json(self, url, **kw):
        self.calls.append(url)
        if 'charts/historical/_SPX' in url:
            return {'data': [{'date': '2026-10-28', 'close': '7743.98'}]}
        if 'quotes/_SPX' in url:
            return {'data': {'current_price': 7720.39, 'prev_day_close': 7743.98, 'price_change_percent': -0.3, 'last_trade_time': '2026-10-29T16:14:00'}}
        if 'quotes/_VIX' in url:
            return {'data': {'current_price': 17.2, 'prev_day_close': 16.91, 'price_change_percent': 1.7, 'last_trade_time': '2026-10-29T16:15:00'}}
        if 'historical' in url:
            return {'data': {'tradesTable': {'rows': [{'date': '10/28/2026', 'close': '100'}]}}}
        if 'info' in url:
            return {'data': {'primaryData': {'lastSalePrice': '101', 'percentageChange': '1%', 'lastTradeTimestamp': 'Oct 29, 2026'},
                             'keyStats': {'previousclose': {'value': '100'}}, 'marketStatus': 'Closed'}}
        if 'cbc.gov.tw' in url:
            return {'data': {'dataSets': [['20260930', '31.852']]}}
        raise RuntimeError('unexpected ' + url)

    def post(self, url, **kw):
        return FakeResp({'RtData': {'QuoteList': [{'SymbolID': 'TXFK6-M', 'CLastPrice': '45930', 'CRefPrice': '46569', 'CDiffRate': '-1.37',
                                                   'CTotalVolume': '34286', 'CDate': '20261029', 'CTime': '045800'}]}})


st = {'global': {}}
http = FakeHttp()
r = G.update(st, http, now=at(2026, 10, 30, 7, 45))
check('早上 07:45：歷史抓了（spx、vix、ndx、sox、央行、臺灣銀行）', set(r['history']) == {'spx', 'vix', 'ndx', 'sox', 'twd', 'twd_bot'}, r)
check('收盤後的報價補進歷史：S&P 500 10/29', st['global']['s']['spx']['d'][-1] == 20261029 and st['global']['s']['spx']['c'][-1] == 7720.39)
check('臺灣銀行的最近三個月蓋在央行上', st['global']['s']['twd']['d'] == [20260930, 20261029], st['global']['s']['twd'])
check('台指期夜盤存在 q', st['global']['q']['txf_night']['pct'] == -1.37)
n0 = len(http.calls)
r = G.update(st, http, now=at(2026, 10, 30, 9, 5), history=False)
check('盤中那幾輪不抓歷史（只抓報價）', not any('historical' in u or 'History' in u or 'cbc' in u for u in http.calls[n0:]), http.calls[n0:])
check('盤中那幾輪：美股、夜盤早上已經抓過收盤，不再抓', set(r['skipped']) == {'spx', 'vix', 'ndx', 'sox', 'txf_night'}, r)
n0 = len(http.calls)
G.update(st, http, now=at(2026, 10, 30, 14, 20))
check('同一天第二次（收盤後）：歷史不重抓', not any('History' in u for u in http.calls[n0:]))

# ---- VIX 盤前的報價不當作收盤補進歷史
st2 = {'global': {'s': {'vix': {'d': [20261029], 'c': [17.2]}}, 'q': {}}}


class PreHttp(FakeHttp):
    def json(self, url, **kw):
        if 'quotes/_VIX' in url:
            return {'data': {'current_price': 18.9, 'prev_day_close': 17.2, 'price_change_percent': 9.9, 'last_trade_time': '2026-10-30T05:30:00'}}
        return super().json(url, **kw)


G.update(st2, PreHttp(), now=at(2026, 10, 30, 17, 50), history=False)
check('VIX 盤前（美東 05:30）：存成報價、不補進歷史', st2['global']['s']['vix']['d'] == [20261029] and st2['global']['q']['vix']['px'] == 18.9,
      st2['global']['s']['vix'])

# ---- 輸出：即時報價照實標（盤中／盤前／收盤），夜盤只在台股開盤前提醒
mini = {'global': {'s': {'vix': {'d': list(range(20260101, 20260131)), 'c': [17.0] * 30}}, 'at': '2026-10-30T07:45+08:00',
                   'q': {'vix': {'px': 18.9, 'pct': 9.9, 'd': 20261030, 't': '05:30', 'at': '2026-10-30T17:50+08:00'},
                         'txf_night': {'px': 45000.0, 'pct': -2.1, 'd': 20261029, 't': '04:59', 'at': '2026-10-30T07:45+08:00'}}},
        'taiex': {'d': [20261028, 20261029], 'c': [27000.0, 26800.0]}, 'meta': {}, 'daily': {}, 'yields': {}, 'divs': {}}
o = G.build_out(mini, now=at(2026, 10, 30, 7, 46))
lv = o['idx']['vix']['live']
check('輸出：VIX 盤前的報價標成「不是盤中、不是收盤」', lv and lv['open'] is False and lv['close'] is False and lv['t'] == '05:30', lv)
check('輸出：07:46 有夜盤大跌的提醒', any(x['k'] == 'night' for x in o['temp']['notes']), o['temp'])
o = G.build_out(mini, now=at(2026, 10, 30, 10, 0))
check('輸出：10:00 台股已經開盤，不再提醒夜盤', not o['temp']['notes'], o['temp'])
check('輸出：溫度標出台灣、美股用的是哪一天', o['temp']['asof']['tw'] == 20261029, o['temp']['asof'])

# ---- 真實資料（可選）
if len(sys.argv) > 2:
    from pipeline.state import State
    real = State(pathlib.Path(sys.argv[1]))
    obj = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
    real['global'] = {'s': {k: {'d': [int(a) for a, _ in v], 'c': [float(b) for _, b in v]} for k, v in obj['hist'].items()}, 'q': obj.get('quotes') or {}}
    out = G.build_out(real, now=at(2026, 10, 30, 7, 46))
    check('真實資料：有溫度、有回測、有五個指數', out['temp']['level'] in ('晴', '陰', '雨') and out['bt'] and len(out['idx']) == 5, list(out['idx']))
    ev = out['bt']['res']['0050']
    check('真實資料：雨的最差 10% 比晴差（溫度分得出風險）', ev['雨']['p10'] < ev['晴']['p10'], (ev['雨']['p10'], ev['晴']['p10']))
    from pipeline import addsim
    check('加碼回測：第一次會算', addsim.update(real))
    sim = real['global']['sim']
    r = sim['res']['0050']
    check('加碼回測：三種做法投入的本金一樣', r['dca']['invested'] == r['rules']['invested'] == r['rules_temp']['invested'], r)
    check('加碼回測：定期定額幾乎不留現金、冷眼的建議會留', r['dca']['cash'] < 0.05 < r['rules']['cash'], (r['dca']['cash'], r['rules']['cash']))
    check('加碼回測：沒有新的收盤資料不重算', not addsim.update(real))
    out = G.build_out(real, now=at(2026, 10, 30, 7, 46))
    check('加碼回測：輸出在 global.json 的 sim', out['sim'] and set(out['sim']['res']) >= {'0050', '0056'}, list((out['sim'] or {}).get('res', {})))

print('全部通過' if not fails else f'{fails} 項失敗')
sys.exit(1 if fails else 0)
