"""開盤叫醒（pipeline/wake.py）：清晨的排程睡到 09:00:30 發出第一輪盤中更新。

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

w, why = wake.plan(at(2026, 10, 28, 5, 13), HOL)
check('05:13 起來：睡到 09:00:30（3 小時 47 分 30 秒）', w == 3 * 3600 + 47 * 60 + 30, (w, why))
w, why = wake.plan(at(2026, 10, 28, 7, 53, 10), HOL)
check('排程延遲到 07:53 也照樣等到 09:00:30', w == 67 * 60 + 20, (w, why))
w, why = wake.plan(at(2026, 10, 28, 9, 5), HOL)
check('延遲到開盤後（09:05）：馬上發出', w == 0 and why is None, (w, why))
w, why = wake.plan(at(2026, 10, 28, 9, 30), HOL)
check('09:30 以後不叫（盤中備援排程早就接上）', w is None, (w, why))
w, why = wake.plan(at(2026, 10, 31, 6, 13), HOL)
check('週六不叫', w is None and '週末' in why, (w, why))
w, why = wake.plan(at(2026, 10, 26, 6, 13), HOL)
check('證交所休市表上的平日（10/26 光復節補假）不叫', w is None and '休市' in why, (w, why))
w, why = wake.plan(at(2026, 10, 27, 6, 13), [])
check('休市表抓不到（空的）照常叫', w is not None, (w, why))
w, why = wake.plan(at(2026, 10, 28, 3, 0), HOL)
check('離開盤超過 5 小時不等（GitHub 一個工作最多 6 小時）', w is None, (w, why))

# 叫醒的時間和盤中接力的第一輪（kick）一樣
h, m, s = dispatch.FIRST_TICK
w, _ = wake.plan(at(2026, 10, 28, 8, 0), HOL)
check('發出時間＝dispatch.FIRST_TICK', w == (h - 8) * 3600 + m * 60 + s, w)

# 同一個早上好幾個排程都跑起來：只有最早的那個在等
check('有比自己早的叫醒在等：交給它', wake.older_wake([{'id': 101}, {'id': 205}], '205'))
check('只有自己：自己等', not wake.older_wake([{'id': 205}], '205'))
check('比自己晚的不算', not wake.older_wake([{'id': 300}, {'id': 205}], 205))
check('查不到（空的）：自己等', not wake.older_wake([], 205))

# 叫醒發出的第一輪：盤中模式、接力照常
now = at(2026, 10, 28, 9, 1, 5)
nxt = dispatch.next_tick('intraday', now.timestamp() - 40, 20261027, now)
check('第一輪（09:01）證交所資料還是昨天的日期：照樣接力（09:15 以前不判斷休市）', nxt is not None, nxt)

print('全部通過' if not fails else f'{fails} 項失敗')
sys.exit(1 if fails else 0)
