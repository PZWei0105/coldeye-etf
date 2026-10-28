"""叫醒（pipeline/wake.py）：早上睡到 09:00:30 發出第一輪盤中更新，下午睡到 14:15 發出收盤後計算。

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

# 早班
w, sh = wake.plan(at(2026, 10, 28, 5, 13), HOL)
check('05:13 起來：睡到 09:00:30（3 小時 47 分 30 秒），早班', w == 3 * 3600 + 47 * 60 + 30 and sh == 'open', (w, sh))
w, sh = wake.plan(at(2026, 10, 28, 7, 53, 10), HOL)
check('排程延遲到 07:53 也照樣等到 09:00:30', w == 67 * 60 + 20 and sh == 'open', (w, sh))
w, sh = wake.plan(at(2026, 10, 28, 9, 5), HOL)
check('延遲到開盤後（09:05）：馬上發出第一輪', w == 0 and sh == 'open', (w, sh))
w, sh = wake.plan(at(2026, 10, 28, 3, 0), HOL)
check('離開盤超過 5 小時不等（GitHub 一個工作最多 6 小時）', w is None, (w, sh))
h, m, s = dispatch.FIRST_TICK
w, _ = wake.plan(at(2026, 10, 28, 8, 0), HOL)
check('早班發出時間＝dispatch.FIRST_TICK', w == (h - 8) * 3600 + m * 60 + s, w)

# 下午班
w, sh = wake.plan(at(2026, 10, 28, 9, 30), HOL)
check('09:30 以後起來的是下午班：睡到 14:15', w == 4 * 3600 + 45 * 60 and sh == 'close', (w, sh))
w, sh = wake.plan(at(2026, 10, 28, 10, 13), HOL)
check('10:13 起來：睡到 14:15（4 小時 2 分），下午班', w == 4 * 3600 + 2 * 60 and sh == 'close', (w, sh))
w, sh = wake.plan(at(2026, 10, 28, 14, 20), HOL)
check('延遲到 14:20：馬上發出收盤後計算', w == 0 and sh == 'close', (w, sh))
w, sh = wake.plan(at(2026, 10, 28, 14, 40), HOL)
check('14:40 以後不叫（之後的排程照常會跑）', w is None, (w, sh))
check('下午班叫的是 eod、早班叫的是 intraday', wake.SHIFTS['close'][0] == 'eod' and wake.SHIFTS['open'][0] == 'intraday')

# 週末、休市
w, sh = wake.plan(at(2026, 10, 31, 6, 13), HOL)
check('週六不叫', w is None and '週末' in sh, (w, sh))
w, sh = wake.plan(at(2026, 10, 26, 6, 13), HOL)
check('證交所休市表上的平日（10/26 光復節補假）早上不叫', w is None and '休市' in sh, (w, sh))
w, sh = wake.plan(at(2026, 10, 26, 11, 13), HOL)
check('休市日下午也不叫', w is None and '休市' in sh, (w, sh))
w, sh = wake.plan(at(2026, 10, 27, 6, 13), [])
check('休市表抓不到（空的）照常叫', w is not None, (w, sh))

# 同一班好幾個排程都跑起來：只有最早的那個在等
check('有比自己早的叫醒在等：交給它', wake.older_wake([{'id': 101}, {'id': 205}], '205'))
check('只有自己：自己等', not wake.older_wake([{'id': 205}], '205'))
check('比自己晚的不算', not wake.older_wake([{'id': 300}, {'id': 205}], 205))
check('查不到（空的）：自己等', not wake.older_wake([], 205))

# 下午：14:00 以後冷眼已經有排程或手動的執行（那時候跑的就是收盤後計算）就不再發
check('14:00 以後有排程執行：不用再發', wake.close_started([{'event': 'schedule'}]))
check('14:00 以後有手動執行：不用再發', wake.close_started([{'event': 'workflow_dispatch'}]))
check('只有推送（部署介面，不算收盤後計算）：照樣發', not wake.close_started([{'event': 'push'}]))
check('什麼都沒有：照樣發', not wake.close_started([]))

# 叫醒發出的第一輪：盤中模式、接力照常；下午那一輪不接力
now = at(2026, 10, 28, 9, 1, 5)
nxt = dispatch.next_tick('intraday', now.timestamp() - 40, 20261027, now)
check('第一輪（09:01）證交所資料還是昨天的日期：照樣接力（09:15 以前不判斷休市）', nxt is not None, nxt)
now = at(2026, 10, 28, 14, 16)
check('下午的收盤後計算不接力', dispatch.next_tick('eod', now.timestamp() - 60, 20261028, now) is None)

print('全部通過' if not fails else f'{fails} 項失敗')
sys.exit(1 if fails else 0)
