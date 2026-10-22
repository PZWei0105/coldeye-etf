"""沙盤用資料（pipeline/tape.py）的本機測試：用 probe 抓到的 MIS 原始回應，不連網、不推送。

用法：python3 tests/tape_test.py <probe 資料夾（裡面有 raw/mis_*.txt）>
"""
import datetime as dt
import json
import pathlib
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from pipeline import tape  # noqa: E402

probe = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None
fails = 0


def check(name, cond, info=''):
    global fails
    if not cond:
        fails += 1
    print(('ok   ' if cond else 'FAIL ') + name + (f'  {info}' if info and not cond else ''))


# ---- 五檔解析
lv = tape._levels('108.4500_108.5000_-_0_108.6500_', '1123_3419_5_6_565_', 1000)
check('五檔：去掉 - 和 0、量換成股', lv == [[108.45, 1123000], [108.5, 3419000], [108.65, 565000]], lv)

m = {'c': '0050', 'z': '-', 'trade': {'t': '09:01:49', 'v': 1, 'z': '109.1000'}, 't': '09:02:04', 'd': '20261022',
     'o': '108.95', 'h': '109.15', 'l': '108.75', 'y': '108.15', 'u': '118.95', 'w': '97.35', 'v': '10229',
     'a': '109.1_109.15_', 'f': '524_597_', 'b': '109.0_108.95_', 'g': '415_407_', 'pz': '-'}
q = tape.parse_quote(m)
check('z 是 - 時用 trade 裡的最後成交', q['z'] == 109.1 and q['zt'] == 90149, q)
check('整股量換成股', q['v'] == 10229000 and q['a'][0] == [109.1, 524000], q)
check('有漲跌停', q['u'] == 118.95 and q['w'] == 97.35)
q2 = tape.parse_quote({'c': '00679B', 'z': '25.83', 't': '09:01:58', 'u': '9999.9500', 'd': '20261022', 'v': '2102'})
check('國外成分：u=9999.95 視為沒有漲跌停', q2['u'] is None and q2['w'] is None and q2['zt'] == 90158, q2)
q3 = tape.parse_quote({'c': '0050', 'z': '-', 't': '09:02:14', 'v': '0', 'd': '20261022', 'a': '108.45_', 'f': '1123_'}, odd=True)
check('零股量是股、還沒成交時 z 為 None', q3['z'] is None and q3['a'] == [[108.45, 1123]], q3)
TL = int(dt.datetime(2026, 10, 22, 9, 42, 34, tzinfo=tape.TW).timestamp())
q4 = tape.parse_quote({'c': '0050', 'z': '108.3', 't': '09:42:34', 'tlong': str(TL * 1000), 'd': '20261022'})
check('資料時間 q 用 MIS 的 tlong', q4['q'] == TL, q4)
q5 = tape.parse_quote({'c': '0050', 'z': '108.3', 't': '09:42:34', 'd': '20261022'})
check('沒有 tlong 時用 t 推算資料時間', q5['q'] == TL, q5)

# ---- tape 累積與換日
t = {'cur': None, 'prev': None, 'last': None}
books = {'at': 100, 'reg': {'0050': dict(q)}, 'odd': {'0050': dict(q3)}, 'at_of': {'reg': {'0050': 100}, 'odd': {'0050': 101}}}
check('交易時段內加進 tape', tape.append(t, books, 20261022, 902) and len(t['cur']['codes']['0050']['reg']['t']) == 1)
check('重複的快照不重複加', tape.append(t, books, 20261022, 903) and len(t['cur']['codes']['0050']['reg']['t']) == 1)
b2 = json.loads(json.dumps(books))
b2['at_of']['reg']['0050'] = 400
b2['reg']['0050']['z'] = 109.5
b2['reg']['0050']['q'] += 300       # 證交所的資料時間也往前走了
tape.append(t, b2, 20261022, 907)
check('新的快照加在後面', t['cur']['codes']['0050']['reg']['z'] == [109.1, 109.5])
check('零股另外一條', t['cur']['codes']['0050']['odd']['t'] == [101])
check('收盤後不加，只更新 last', not tape.append(t, b2, 20261022, 1400) and t['last']['at'] == 100)
b3 = json.loads(json.dumps(books))
for k in ('reg', 'odd'):
    b3[k]['0050']['d'] = 20261023
b3['at_of']['reg']['0050'] = 90000
tape.append(t, b3, 20261023, 901)
check('換日：前一天變成 prev', t['prev']['d'] == 20261022 and t['cur']['d'] == 20261023 and len(t['cur']['codes']['0050']['reg']['t']) == 1)
check('換日：前一天標成完成', t['prev'].get('done') is True)
check('休市（資料日期不是今天）不加', not tape.append(t, b3, 20261026, 905))

# ---- 資料時間 q：證交所這一檔的資料沒更新就不重複記；13:45 以後標成完成；換日要擠掉沒封存的那一天
t2 = {'cur': None, 'prev': None, 'last': None}
def bk(at, qq, z, d=20261022):
    r = {'0050': {'d': d, 'z': z, 'zt': None, 'h': None, 'l': None, 'v': 0, 'a': [], 'b': [], 'pz': None, 'q': qq}}
    return {'at': at, 'reg': r, 'odd': {}, 'at_of': {'reg': {'0050': at}, 'odd': {}}}
tape.append(t2, bk(1000, 900, 108.0), 20261022, 930)
tape.append(t2, bk(1300, 900, 108.0), 20261022, 935)
check('資料時間沒變：不重複記', len(t2['cur']['codes']['0050']['reg']['t']) == 1)
tape.append(t2, bk(1600, 1500, 108.1), 20261022, 940)
s50 = t2['cur']['codes']['0050']['reg']
check('資料時間有變：記下，q 跟著存', s50['t'] == [1000, 1600] and s50['q'] == [900, 1500], s50)
old_series = {'t': [10, 20], 'z': [1, 2], 'zt': [None, None], 'h': [None, None], 'l': [None, None], 'v': [0, 0],
              'a': [[], []], 'b': [[], []], 'pz': [None, None]}
t3 = {'cur': {'d': 20261022, 'codes': {'0050': {'reg': old_series}}}, 'prev': None, 'last': None}
tape.append(t3, bk(1700, 1650, 108.2), 20261022, 945)
check('舊資料沒有 q：補 None 再接上', t3['cur']['codes']['0050']['reg']['q'] == [None, None, 1650], t3['cur']['codes']['0050']['reg'])
tape.append(t2, bk(1900, 1500, 108.1), 20261022, 1350)
check('13:45 以後：今天標成完成、不再加快照', t2['cur'].get('done') is True and len(s50['t']) == 2)
t4 = {'cur': {'d': 20261023, 'codes': {'0050': {}}}, 'prev': {'d': 20261022, 'codes': {'0050': {}}}, 'last': None, 'archived': []}
tape.append(t4, bk(5000, 4900, 108.0, d=20261026), 20261026, 905)
check('換日：要被擠掉、還沒封存的那一天交給封存', [x['d'] for x in t4.get('_drop', [])] == [20261022] and t4['prev']['d'] == 20261023)
t5 = {'cur': {'d': 20261023, 'codes': {'0050': {}}}, 'prev': {'d': 20261022, 'codes': {'0050': {}}}, 'last': None, 'archived': [20261022]}
tape.append(t5, bk(5000, 4900, 108.0, d=20261026), 20261026, 905)
check('已經封存過的就不再封存', '_drop' not in t5)

# ---- 封存：{日期}/{代號}.json、只留最近 ARCHIVE_KEEP 天、index.json
arc = pathlib.Path(tempfile.mkdtemp())
for k in range(tape.ARCHIVE_KEEP + 2):
    (arc / str(20260101 + k)).mkdir()
kept = tape.write_archive(arc, [{'d': 20261022, 'done': True, 'codes': {'0050': {'reg': s50, 'y': 108.15}}}])
f = json.loads((arc / '20261022' / '0050.json').read_text())
check('封存檔格式和 tape 的 cur／prev 一樣', f['d'] == 20261022 and f['done'] is True and f['reg']['q'] == [900, 1500] and f['y'] == 108.15, f)
check('封存只留最近 ARCHIVE_KEEP 天', len(kept) == tape.ARCHIVE_KEEP and kept[-1] == 20261022 and not (arc / '20260101').exists(), kept[:3])
check('封存有 index.json', json.loads((arc / 'index.json').read_text())['days'] == kept)

# ---- 輸出
tmp = pathlib.Path(tempfile.mkdtemp())
tape.publish(tmp, t)
qq = json.loads((tmp / 'quotes.json').read_text())
f50 = json.loads((tmp / 'tape' / '0050.json').read_text())
check('quotes.json 有整股與零股', '0050' in qq['reg'] and '0050' in qq['odd'])
check('tape/0050.json 有今天與前一天', f50['cur']['d'] == 20261023 and f50['prev']['d'] == 20261022, f50.keys())
check('tape/0050.json：前一天一定是完成的、今天還沒', f50['prev']['done'] is True and f50['cur']['done'] is False)
check('有 spark.json', (tmp / 'spark.json').exists())
q0 = tape._epoch(20261022, 90000)
sp = tape.make_spark({'d': 20261022, 'codes': {'0050': {'reg': {'t': [q0 + 400, q0 + 700, q0 + 900], 'q': [q0 + 300, None, q0 + 600], 'z': [108.1, 108.2, None]}}}})
check('spark.json：今天每一檔的走勢線（距 09:00 的分鐘、價；優先用資料時間）', sp == {'d': 20261022, 's': {'0050': [5.0, 108.1, 11.7, 108.2]}}, sp)


# ---- 盤後結果：after/{日期}.json、after.json 的 _days 與最近幾天、只留 ETF
class AfterState:
    def __init__(self):
        self.data = {'after': {str(20261001 + k): {'0050': [100 + k, 1, 0, 0, 0], '2330': [1, 1, 1, 1, 1]} for k in range(5)},
                     'daily': {'0050': {}}, 'meta': {'0050': {}}}

    def __getitem__(self, k):
        return self.data[k]


ad = pathlib.Path(tempfile.mkdtemp())
(ad / 'after').mkdir()
(ad / 'after' / '20200101.json').write_text('{}')
tape.write_after(ad, AfterState())
aj = json.loads((ad / 'after.json').read_text())
check('after.json 有 _days 和最近 3 天', aj['_days'] == [20261001 + k for k in range(5)] and sorted(k for k in aj if k != '_days') == ['20261003', '20261004', '20261005'], list(aj))
d1 = json.loads((ad / 'after' / '20261001.json').read_text())
check('after/{日期}.json 每天一個檔、只留 ETF', d1 == {'0050': [100, 1, 0, 0, 0]}, d1)
check('過期的 after 檔會刪掉', not (ad / 'after' / '20200101.json').exists())


# ---- 交易日曆
class FakeState:
    def __init__(self):
        self.data = {'cal': {'2026': {'at': '2026-10-22T00:00:00+08:00', 'rows': [
            [20261009, '國慶日'], [20261012, '測試假'], [20260211, '農曆春節前最後交易日'],
            [20260212, '市場無交易，僅辦理結算交割作業'], [20260102, '國曆新年開始交易日']]}},
            'taiex': {'d': [20261005, 20261006, 20261007, 20261008, 20261013, 20261014]}}

    def __getitem__(self, k):
        return self.data[k]


cal = tape.make_cal(FakeState())
check('休市表：國慶日是休市', 20261009 in cal['holidays'])
check('開始交易日／最後交易日不算休市', 20260211 not in cal['holidays'] and 20260102 not in cal['holidays'])
check('僅辦理結算交割：休市但照常交割', 20260212 in cal['holidays'] and 20260212 in cal['settle_only'])
check('沒在休市表、也沒成交的平日（颱風假）列為 closed', cal['closed'] == [], cal['closed'])
st2 = FakeState()
st2.data['taiex']['d'] = [20261005, 20261007]
cal2 = tape.make_cal(st2)
check('颱風假推得出來', cal2['closed'] == [20261006], cal2['closed'])

# ---- 用 probe 原始回應整批解析
if probe and (probe / 'raw').exists():
    for f in sorted((probe / 'raw').glob('mis_*.txt')):
        try:
            js = json.loads(f.read_text())
        except Exception:  # noqa: BLE001
            continue
        arr = js.get('msgArray') or []
        odd = 'odd' in f.name
        parsed = [tape.parse_quote(m, odd=odd) for m in arr]
        bad = [p for p in parsed if p['d'] is None]
        check(f'{f.name}：{len(parsed)} 檔都解析得出日期', not bad)
        withz = sum(1 for p in parsed if p['z'] is not None)
        print(f'      有成交價 {withz} 檔，有五檔 {sum(1 for p in parsed if p["a"] or p["b"])} 檔')

print('全部通過' if not fails else f'{fails} 項失敗')
sys.exit(1 if fails else 0)
