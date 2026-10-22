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

# ---- tape 累積與換日
t = {'cur': None, 'prev': None, 'last': None}
books = {'at': 100, 'reg': {'0050': dict(q)}, 'odd': {'0050': dict(q3)}, 'at_of': {'reg': {'0050': 100}, 'odd': {'0050': 101}}}
check('交易時段內加進 tape', tape.append(t, books, 20261022, 902) and len(t['cur']['codes']['0050']['reg']['t']) == 1)
check('重複的快照不重複加', tape.append(t, books, 20261022, 903) and len(t['cur']['codes']['0050']['reg']['t']) == 1)
b2 = json.loads(json.dumps(books))
b2['at_of']['reg']['0050'] = 400
b2['reg']['0050']['z'] = 109.5
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
check('休市（資料日期不是今天）不加', not tape.append(t, b3, 20261026, 905))

# ---- 輸出
tmp = pathlib.Path(tempfile.mkdtemp())
tape.publish(tmp, t)
qq = json.loads((tmp / 'quotes.json').read_text())
f50 = json.loads((tmp / 'tape' / '0050.json').read_text())
check('quotes.json 有整股與零股', '0050' in qq['reg'] and '0050' in qq['odd'])
check('tape/0050.json 有今天與前一天', f50['cur']['d'] == 20261023 and f50['prev']['d'] == 20261022, f50.keys())


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
