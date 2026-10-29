"""叫醒（pipeline/wake.py）與接力（pipeline/dispatch.py 的 next_plan）：
早班 07:45 全球市場 → 09:00:30 第一輪盤中更新；下午班 14:15 收盤後計算 → 15:05 晚上的全球市場接力（每 10 分鐘到 05:30）；
夜班 21:23、01:23 看門（接力斷了才發一輪）。

用法：python3 tests/wake_test.py
"""
import datetime as dt
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from pipeline import dispatch, wake  # noqa: E402

TW = dt.timezone(dt.timedelta(hours=8))
fails = 0


def check(name, cond, info=''):
    global fails
    if not cond:
        fails += 1
    print(('ok   ' if cond else 'FAIL ') + name + (f'  {info}' if info and not cond else ''))


def at(y, mo, d, h, mi, s=0):
    return dt.datetime(y, mo, d, h, mi, s, tzinfo=TW)


HOL = [20261009, 20261026, 20261225]
modes = lambda shift, now, hol=HOL: [x[1] for x in wake.steps_left(shift, now, hol)]  # noqa: E731

# 早班
w, sh = wake.plan(at(2026, 10, 28, 5, 13), HOL)
check('05:13 起來：早班，先睡到 07:45（2 小時 32 分）', w == 2 * 3600 + 32 * 60 and sh == 'open', (w, sh))
check('早班照順序：全球市場 → 第一輪盤中更新', modes('open', at(2026, 10, 28, 5, 13)) == ['global', 'intraday'])
w, sh = wake.plan(at(2026, 10, 28, 7, 53, 10), HOL)
check('延遲到 07:53：全球市場馬上發', w == 0 and sh == 'open', (w, sh))
check('09:00 以後起來：只剩第一輪盤中更新', modes('open', at(2026, 10, 28, 9, 5)) == ['intraday'])
w, sh = wake.plan(at(2026, 10, 28, 9, 5), HOL)
check('延遲到開盤後（09:05）：第一輪馬上發出', w == 0 and sh == 'open', (w, sh))
w, sh = wake.plan(at(2026, 11, 2, 3, 0), HOL)
check('週一 03:00（不是看門的時間）：離最後一步超過 5 小時多不等（GitHub 一個工作最多 6 小時）', w is None, (w, sh))
h, m, s = dispatch.FIRST_TICK
check('第一輪的時間＝dispatch.FIRST_TICK', wake.SHIFTS['open'][1][0] == (h, m, s))
check('休市日早上：只發全球市場（美股有開）', modes('open', at(2026, 10, 26, 6, 13)) == ['global'])

# 下午班
w, sh = wake.plan(at(2026, 10, 28, 10, 13), HOL)
check('10:13 起來：下午班，睡到 14:15', w == 4 * 3600 + 2 * 60 and sh == 'close', (w, sh))
check('下午班照順序：收盤後計算 → 晚上的全球市場接力', modes('close', at(2026, 10, 28, 10, 13)) == ['eod', 'night'])
w, sh = wake.plan(at(2026, 10, 28, 9, 40), HOL)
check('09:30～10:00 起來的不叫（到 15:05 會超過 6 小時）', w is None, (w, sh))
check('14:45 起來：只剩晚上的接力', modes('close', at(2026, 10, 28, 14, 45)) == ['night'])
w, sh = wake.plan(at(2026, 10, 28, 16, 0), HOL)
check('16:00 以後不叫', w is None, (w, sh))
check('休市日下午：只發晚上的全球市場接力', modes('close', at(2026, 10, 26, 11, 13)) == ['night'])
check('下午班的模式是 eod、night', [x[1] for x in wake.SHIFTS['close']] == ['eod', 'night'])

# 週末
w, sh = wake.plan(at(2026, 10, 31, 6, 13), HOL)
check('週六不叫', w is None and '週末' in sh, (w, sh))
check('休市表抓不到（空的）照常叫', wake.plan(at(2026, 10, 27, 6, 13), [])[0] is not None)

# 夜班看門
w, sh = wake.plan(at(2026, 10, 28, 21, 23), HOL)
check('21:23 起來：夜班看門（馬上開始）', w == 0 and sh == 'watch', (w, sh))
check('21:23 起來的看到隔天 01:15', wake.watch_end(at(2026, 10, 28, 21, 23)) == at(2026, 10, 29, 1, 15))
w, sh = wake.plan(at(2026, 10, 29, 1, 23), HOL)
check('01:23 起來：夜班看門，看到 05:05', sh == 'watch' and wake.watch_end(at(2026, 10, 29, 1, 23)) == at(2026, 10, 29, 5, 5), (w, sh))
check('週六清晨 01:23（週五晚上的美股）：照樣看門', wake.plan(at(2026, 10, 31, 1, 23), HOL)[1] == 'watch')
check('週六晚上 21:23：不看門', wake.plan(at(2026, 10, 31, 21, 23), HOL)[0] is None)
check('週一清晨 01:23（週日晚上沒有美股）：不看門', wake.plan(at(2026, 11, 2, 1, 23), HOL)[0] is None)
check('05:13 起來是早班、不是夜班', wake.plan(at(2026, 10, 29, 5, 13), HOL)[1] == 'open')
check('休市日晚上照樣看門（美股有開）', wake.plan(at(2026, 10, 26, 21, 23), HOL)[1] == 'watch')
nw = at(2026, 10, 28, 23, 0)
check('看門：有在跑或排隊的執行 → 接力好好的', not wake.relay_dead(True, None, nw))
check('看門：最後一次執行 12 分鐘前 → 還好', not wake.relay_dead(False, nw - dt.timedelta(minutes=12), nw))
check('看門：最後一次執行 25 分鐘前、也沒有在跑的 → 斷了', wake.relay_dead(False, nw - dt.timedelta(minutes=25), nw))
check('看門：查不到任何執行 → 斷了', wake.relay_dead(False, None, nw))
check('看門的兩班不重疊（21:23 那班 01:15 結束、01:23 那班才開始）', wake.watch_end(at(2026, 10, 28, 22, 30)) < at(2026, 10, 29, 1, 23))

# 同一班好幾個排程都跑起來：只有最早的那個在等
check('有比自己早的叫醒在等：交給它', wake.older_wake([{'id': 101}, {'id': 205}], '205'))
check('只有自己：自己等', not wake.older_wake([{'id': 205}], '205'))
check('比自己晚的不算', not wake.older_wake([{'id': 300}, {'id': 205}], 205))
check('14:00 以後有排程或手動的執行：收盤後計算不再發', wake.close_started([{'event': 'schedule'}]) and wake.close_started([{'event': 'workflow_dispatch'}]))
check('只有推送：照樣發', not wake.close_started([{'event': 'push'}]) and not wake.close_started([]))

# 接力：白天盤中每 5 分鐘、晚上每 10 分鐘
now = at(2026, 10, 28, 9, 1, 5)
ts, md = dispatch.next_plan('intraday', now.timestamp() - 40, 20261027, now)
check('第一輪（09:01）證交所資料還是昨天的日期：照樣接力（09:15 以前不判斷休市）', ts is not None and md == 'intraday', (ts, md))
now = at(2026, 10, 28, 14, 16)
check('下午的收盤後計算：還沒到夜盤時間，不接力', dispatch.next_plan('eod', now.timestamp() - 60, 20261028, now) == (None, None))
now = at(2026, 10, 28, 15, 6)
ts, md = dispatch.next_plan('night', now.timestamp() - 30, 20261028, now)
check('晚上的全球市場：10 分鐘後下一輪（night）', md == 'night' and abs(ts - (now.timestamp() - 30 + 600 - dispatch.LEAD_S)) < 1, (ts, md))
now = at(2026, 10, 28, 22, 40)
ts, md = dispatch.next_plan('eod', now.timestamp() - 90, 20261028, now)
check('21:55 那一輪收盤後計算（延遲到 22:40）：接著晚上的接力', md == 'night', (ts, md))
now = at(2026, 10, 29, 5, 15)
ts, md = dispatch.next_plan('night', now.timestamp() - 30, 20261028, now)
check('05:15 那一輪之後還有一輪（冬令美股 05:00 收盤，延遲 15 分鐘的報價 05:15 才看得到）', md == 'night', (ts, md))
now = at(2026, 10, 29, 5, 25)
ts, md = dispatch.next_plan('night', now.timestamp() - 30, 20261028, now)
check('05:25 那一輪之後不再接力（美股、夜盤都收了）', md is None, (ts, md))
now = at(2026, 10, 31, 1, 0)
check('週六清晨：週五晚上的接力繼續到 05:30', dispatch.next_plan('night', now.timestamp() - 30, 20261030, now)[1] == 'night')
now = at(2026, 10, 31, 15, 30)
check('週六下午：不接力', dispatch.next_plan('night', now.timestamp() - 30, 20261030, now) == (None, None))
now = at(2026, 11, 1, 23, 0)
check('週日晚上：不接力（沒有夜盤、美股沒開）', dispatch.next_plan('night', now.timestamp() - 30, 20261030, now) == (None, None))
now = at(2026, 10, 28, 7, 46)
check('早上 07:45 的全球市場：不接力（等 09:00 盤中）', dispatch.next_plan('global', now.timestamp() - 60, 20261027, now) == (None, None))

print('全部通過' if not fails else f'{fails} 項失敗')
sys.exit(1 if fails else 0)
