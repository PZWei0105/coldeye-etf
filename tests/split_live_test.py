"""今天剛生效、官方收盤資料還沒算進去的分割（build.live_splits）與分割前後的單位數、規模。

情境：00662 在 2026/11/10 收 120 元（官方淨值 120.2），11/11～11/16 停止交易，11/17 一拆五恢復交易。
11/17 盤中證交所的參考價已經是 24 元，但官方收盤資料要收盤後才進來：App 在那之前要知道「這是分割、不是大跌」。

用法：python3 tests/split_live_test.py
"""
import datetime as dt
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from pipeline import build, series  # noqa: E402

TW = dt.timezone(dt.timedelta(hours=8))
fails = 0


def check(name, cond, info=''):
    global fails
    if not cond:
        fails += 1
    print(('ok   ' if cond else 'FAIL ') + name + (f'  {info}' if info and not cond else ''))


def daily(rows):
    return {'d': [r[0] for r in rows], 'o': [r[1] for r in rows], 'h': [r[1] for r in rows], 'l': [r[1] for r in rows],
            'c': [r[1] for r in rows], 'v': [1000] * len(rows)}


state = {
    'daily': {
        '00662': daily([(20261106, 119.0), (20261107, 119.5), (20261110, 120.0)]),
        '0050': daily([(20261114, 60.0), (20261116, 61.0)]),
        '00632R': daily([(20261110, 5.0)]),            # 冷門：之後幾天都沒成交
    },
    'nav': {'00662': {'20261110': 120.2, '20261116': 24.05}},
}

# --- 盤中：沙盤那一輪的整股行情有參考價
extra = {'tape': {'last': {'reg': {
    '00662': {'d': 20261117, 'y': 24.0, 'z': 24.3},
    '0050': {'d': 20261117, 'y': 61.0, 'z': 61.5},
    '00632R': {'d': 20261117, 'y': 5.0, 'z': None},
}}}, 'mis': {}}
sp = build.live_splits(state, extra, 20261117)
check('恢復交易那天：參考價差 5 倍 → 認出 1 拆 5', sp.get('00662') == [[20261117, 5]], sp)
check('平常的 ETF 不會被認成分割', '0050' not in sp and '00632R' not in sp, sp)

# --- 參考價只差一點點（漲跌 10%）不是分割
extra2 = {'tape': {'last': {'reg': {'00662': {'d': 20261117, 'y': 108.0}}}}, 'mis': {}}
check('跌 10% 不是分割', build.live_splits(state, extra2, 20261117) == {})

# --- 停止交易中：參考價還是 120
extra3 = {'tape': {'last': {'reg': {'00662': {'d': 20261116, 'y': 120.0}}}}, 'mis': {}}
check('停止交易那幾天不會被認成分割', build.live_splits(state, extra3, 20261116) == {})

# --- 沒有沙盤的行情（晚上、MIS 那一支掛了）：投信的即時價和預估淨值都要差同一個倍數
mis_ok = {'00662': {'px': 24.3, 'est_nav': 24.1, 'date': '20261117'}}
check('沒有參考價時：即時價與預估淨值都差 5 倍 → 1 拆 5', build.live_splits(state, {'mis': mis_ok}, 20261117).get('00662') == [[20261117, 5]])
mis_bad = {'00662': {'px': 24.3, 'est_nav': 121.0, 'date': '20261117'}}
check('只有價格差 5 倍、淨值沒變：不算（可能是資料錯）', build.live_splits(state, {'mis': mis_bad}, 20261117) == {})

# --- 官方收盤進來之後（最近一次收盤就是今天）：交給收盤後的計算，不再標
state2 = {'daily': {'00662': daily([(20261110, 120.0), (20261117, 24.2)])}, 'nav': {}}
check('官方收盤進來之後不再標', build.live_splits(state2, extra, 20261117) == {})

# --- make_live 把它放進 live.json
now = dt.datetime(2026, 11, 17, 9, 5, tzinfo=TW)
extra4 = dict(extra, taiex_live={'z': 28000.0, 'y': 27900.0, 't': '09:05:00', 'd': '20261117'},
              mis={'00662': {'px': 24.3, 'est_nav': 24.1, 'premium': 0.8, 'time': '09:05:00', 'units_chg': 0, 'date': '20261117'}})
live = build.make_live(state, extra4, now, 'intraday')
check('live.json 帶 splits', live.get('splits') == {'00662': [[20261117, 5]]}, live.get('splits'))
check('沒有分割時 live.json 不帶 splits', 'splits' not in build.make_live(state2, extra4, now, 'intraday'))

# --- 收盤後：開盤跳空同一套倍數（series.split_ratio），和盤中認出來的同一天、同一個倍數
f, vf, splits = series.adjust_factors([20261110, 20261117], [120.0, 24.0], [120.0, 24.2], [])
check('收盤後的開盤跳空：同一天、同一個倍數', splits == [(20261117, 5)], splits)
check('還原因子：分割前的價格除以 5', abs(f[0] - 0.2) < 1e-9, f)
check('split_ratio：反分割（5 合 1）', series.split_ratio(4.0, 20.0) == 0.2)

# --- 單位數：分割那天跳 5 倍，「近 20 日單位數」不能變成 +400% 的淨申購
units = [[20261106, 8.0e8], [20261107, 8.1e8], [20261110, 8.1e8], [20261117, 40.6e8], [20261118, 40.8e8]]
u = series.units_norm(units, [(20261117, 5)])
check('分割前的單位數換成目前的基準（×5）', u[0][1] == 40e8 and u[2][1] == 40.5e8, u)
check('分割後的不動', u[3][1] == 40.6e8 and u[4][1] == 40.8e8, u)
check('附近沒有分割：不動（一般的申購贖回）', series.units_norm(units, [(20250618, 4)]) == units)
check('原本的資料沒被改到', units[0][1] == 8.0e8)

print('\n全部通過' if not fails else f'\n{fails} 項失敗')
sys.exit(1 if fails else 0)
