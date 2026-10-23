"""live.json 的「今天有沒有開市」：用證交所即時成交資料的日期，不用投信預估淨值檔的日期。

2026/10/23 颱風假：all_etf.txt 有 45 檔標了 10/23，價格卻是 10/22 的；以前 live.json 的 date 因此變成「今天」，
App 以為今天有開市（模擬倉可以用 10/22 的價格成交、定期定額不提醒順延），盤中接力也整天沒停。

用法：python3 tests/live_test.py
"""
import datetime as dt
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from pipeline import build, dispatch  # noqa: E402

TW = dt.timezone(dt.timedelta(hours=8))
fails = 0


def check(name, cond, info=''):
    global fails
    if not cond:
        fails += 1
    print(('ok   ' if cond else 'FAIL ') + name + (f'  {info}' if info and not cond else ''))


def mis(date):
    return {'px': 106.9, 'est_nav': 107.0, 'premium': -0.1, 'time': '13:30:00', 'units_chg': 0, 'date': date}


now = dt.datetime(2026, 10, 23, 13, 20, tzinfo=TW)
typhoon = {
    'mis': {'0050': mis('20261022'), '00981A': mis('20261023')},
    'taiex_live': {'z': 28000.0, 'y': 27900.0, 't': '13:30:00', 'd': '20261022'},
    'tape': {'last': {'reg': {'0050': {'d': 20261022}, '0056': {'d': 20261022}}}},
}
live = build.make_live(None, typhoon, now, 'intraday')
check('颱風假：live 的日期是證交所資料的日期（前一個交易日）', live['date'] == 20261022, live['date'])
check('颱風假：投信檔標今天的那一檔，價格日期也改成前一個交易日', live['etfs']['00981A'][5] == 20261022, live['etfs']['00981A'])
check('颱風假：盤中接力停下來', dispatch.next_tick('intraday', now.timestamp() - 60, live['date'], now) is None)

# 只有加權指數、或只有 tape 時也判斷得出來
check('只有加權指數', build.market_day({'taiex_live': {'d': '20261022'}}) == 20261022)
check('只有 tape', build.market_day({'tape': {'last': {'reg': {'0050': {'d': 20261022}}}}}) == 20261022)
check('兩個不一樣時取比較早的', build.market_day({'taiex_live': {'d': '20261023'}, 'tape': {'last': {'reg': {'0050': {'d': 20261022}}}}}) == 20261022)

# 平常的交易日：照常
normal = {
    'mis': {'0050': mis('20261023'), '00981A': mis('20261023')},
    'taiex_live': {'z': 28000.0, 'y': 27900.0, 't': '13:20:00', 'd': '20261023'},
    'tape': {'last': {'reg': {'0050': {'d': 20261023}}}},
}
live2 = build.make_live(None, normal, now, 'intraday')
check('交易日：日期是今天', live2['date'] == 20261023 and live2['etfs']['0050'][5] == 20261023, live2['date'])
check('交易日：接力照常', dispatch.next_tick('intraday', now.timestamp() - 60, live2['date'], now) is not None)

# 抓不到證交所即時資料：退回投信檔的日期（和以前一樣）
live3 = build.make_live(None, {'mis': {'0050': mis('20261023')}}, now, 'eod')
check('沒有即時資料：退回投信檔的日期', live3['date'] == 20261023 and live3['etfs']['0050'][5] == 20261023, live3)
live4 = build.make_live(None, {}, now, 'eod')
check('什麼都沒有：日期是 None', live4['date'] is None and live4['taiex'] is None)

print('全部通過' if not fails else f'{fails} 項失敗')
sys.exit(1 if fails else 0)
