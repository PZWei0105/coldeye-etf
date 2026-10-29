"""叫醒：讓開盤第一輪盤中更新、收盤後第一次完整計算、早晚的全球市場準時開始。

GitHub 的排程常常延遲半小時到一小時：
- 早上：08:37–08:53 的暖身排程每天都延遲到 09:15 以後才跑（10/21、10/22、10/23、10/27 第一筆盤中資料都在
  09:15～09:20），開盤後最重要的前 20 分鐘沒有新資料。
- 下午：收盤後第一次完整計算原本是靠 13:44／13:54 的盤中備援排程「剛好」被延遲到 14:00 以後（10/21～10/27 都在
  14:10～14:17）；10/28 那兩個排程沒怎麼延遲，14:25 的排程又遲遲不來，完整分析拖到 14:47 手動補跑、14:49 才算好。
這支程式由 .github/workflows/wake.yml 的排程執行（早上 05:13、06:13、07:13，下午 10:13、11:13、12:13，
延遲一兩個小時也還來得及），每一班照順序發出：
- 早班：07:45 全球市場（美股收盤、台指期夜盤收盤、全球歷史一天一次）→ 09:00:30 第一輪盤中更新（之後每一輪自己接力）
- 下午班：14:15 收盤後計算（eod）→ 15:05 晚上的全球市場接力（台指期夜盤、美股盤中，每 10 分鐘一輪到隔天 05:30）
- 夜班（21:23、01:23 起來）：看門。晚上的接力白天沒有備援排程，萬一斷掉（發不出下一輪、GitHub 出狀況），
  美股開盤的那幾個小時就沒有新資料；所以每 10 分鐘看一次，冷眼 20 分鐘以上沒有任何執行（也沒有在跑、在排隊的）
  才發一輪 night 接上。平常接力好好的時候什麼都不做，不會把排隊中的收盤後計算擠掉。
同一班有好幾個排程都跑起來時，只有最早的那個在等，其他的馬上結束。證交所休市日不發盤中更新與收盤後計算，
但全球市場照常（美股有開）。它不和冷眼主流程共用排隊（concurrency），睡覺時不會擋住推送或其他工作；只用標準函式庫。

用法（GitHub Actions）：python3 -m pipeline.wake（環境變數 GH_TOKEN、REPO、GITHUB_RUN_ID）
"""
import datetime as dt
import json
import os
import time
import urllib.parse
import urllib.request

from .dispatch import FIRST_TICK, TW

OPEN_LATEST = 930          # 09:30 以前起來的是早班
CLOSE_FROM = 1000          # 10:00 以後起來的是下午班（到 15:05 還在 GitHub 一個工作 6 小時的限制內）
CLOSE_LATEST = 1600        # 16:00 以後起來的不叫（晚上的接力已經由收盤後的排程接上）
GLOBAL_AT = (7, 45, 0)     # 美股收盤（冬令 05:00）、台指期夜盤 05:00 收盤之後
CLOSE_AT = (14, 15, 0)     # 收盤後第一次完整計算：證交所、櫃買的收盤資料 14:00 前後公布（10/22～10/27 14:16 都抓得到）
NIGHT_AT = (15, 5, 0)      # 台指期夜盤 15:00 開盤
MAX_WAIT_S = 5 * 3600 + 600
WATCH_FROM = 2100          # 夜班看門：21:00 以後起來的看到 01:15（01:23 那一班接手），00:00～05:05 起來的看到 05:05
WATCH_TO = 505             # 05:05 以後交給早班（05:13 起來），兩班不重疊（只有最早的那個叫醒會等）
WATCH_GAP_S = 600          # 每 10 分鐘看一次
WATCH_STALE_S = 1200       # 冷眼 20 分鐘以上沒有新的執行、也沒有在跑或排隊的：接力斷了
CAL_URL = 'https://pzwei0105.github.io/coldeye-etf/data/cal.json'
API = 'https://api.github.com'
# 每一班照順序：(幾點, 冷眼的模式, 怎麼說, 超過這個時間就不發這一步, 休市日要不要發)
SHIFTS = {
    'open': [(GLOBAL_AT, 'global', '早上的全球市場', 900, True),
             (FIRST_TICK, 'intraday', '第一輪盤中更新', 930, False)],
    'close': [(CLOSE_AT, 'eod', '收盤後第一次完整計算', 1440, False),
              (NIGHT_AT, 'night', '晚上的全球市場接力', 1600, True)],
}


def in_watch(now: dt.datetime) -> bool:
    """夜班看門的時間：週一到週五 21:00 以後、週二到週六 05:05 以前（美股、台指期夜盤的那一晚）"""
    hm = now.hour * 100 + now.minute
    wd = now.weekday()
    if hm >= WATCH_FROM:
        return wd <= 4
    if hm < WATCH_TO:
        return 1 <= wd <= 5
    return False


def watch_end(now: dt.datetime) -> dt.datetime:
    """這一班看門看到幾點：21:00 以後起來的看到隔天 01:15，半夜起來的看到 05:05"""
    if now.hour * 100 + now.minute >= WATCH_FROM:
        return (now + dt.timedelta(days=1)).replace(hour=1, minute=15, second=0, microsecond=0)
    return now.replace(hour=WATCH_TO // 100, minute=WATCH_TO % 100, second=0, microsecond=0)


def relay_dead(active, latest_created, now, stale_s=WATCH_STALE_S) -> bool:
    """接力斷了沒：沒有在跑、在排隊的執行，而且最後一次執行是 stale_s 秒以前（或查不到任何執行）"""
    if active:
        return False
    return latest_created is None or (now - latest_created).total_seconds() > stale_s


def plan(now: dt.datetime, holidays=()):
    """這一班要不要叫：回傳 (到第一步要睡幾秒, 班別 'open'／'close'／'watch')，不叫就回傳 (None, 原因)。
    holidays＝證交所休市表上的日期（yyyymmdd）：休市日只發全球市場那幾步。"""
    if in_watch(now):
        return 0, 'watch'
    if now.weekday() >= 5:
        return None, '週末'
    hm = now.hour * 100 + now.minute
    if hm < OPEN_LATEST:
        shift = 'open'
    elif CLOSE_FROM <= hm < CLOSE_LATEST:
        shift = 'close'
    else:
        return None, '不在早班、下午班的時間'
    steps = steps_left(shift, now, holidays)
    if not steps:
        return None, '這一班要發的都過了（或今天是證交所休市日）'
    (h, m, s), *_ = steps[0]
    wait = (now.replace(hour=h, minute=m, second=s, microsecond=0) - now).total_seconds()
    last = steps[-1][0]
    total = (now.replace(hour=last[0], minute=last[1], second=last[2], microsecond=0) - now).total_seconds()
    if total > MAX_WAIT_S:
        return None, '離叫醒的時間還太久（之後的排程會再叫）'
    return max(0, int(wait)), shift


def steps_left(shift, now, holidays=()):
    """這一班還要發的那幾步（時間還沒過、休市日只留全球市場）"""
    hm = now.hour * 100 + now.minute
    closed = int(now.strftime('%Y%m%d')) in set(holidays or ())
    return [x for x in SHIFTS[shift] if hm < x[3] and (x[4] or not closed)]


def older_wake(runs, my_id) -> bool:
    """另一個比較早開始的叫醒還在等（同一班有好幾個排程）：交給它，自己不用等。"""
    return any(int(r.get('id') or 0) < int(my_id or 0) for r in runs or [])


def close_started(runs) -> bool:
    """今天 14:00 以後冷眼已經有排程或手動的執行（那時候跑的就是收盤後計算）：不用再叫。"""
    return any(r.get('event') in ('schedule', 'workflow_dispatch') for r in runs or [])


def _api(path, method='GET', body=None):
    token = os.environ.get('GH_TOKEN', '')
    req = urllib.request.Request(
        API + path, method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json',
                 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        txt = r.read().decode() or 'null'
    return json.loads(txt)


def _runs(repo, workflow, query):
    js = _api(f'/repos/{repo}/actions/workflows/{workflow}/runs?{query}&per_page=30')
    return (js or {}).get('workflow_runs') or []


def _holidays():
    try:
        with urllib.request.urlopen(CAL_URL, timeout=20) as r:
            return json.loads(r.read().decode()).get('holidays') or []
    except Exception as e:  # noqa: BLE001 — 抓不到休市表就照常叫（休市的話第一輪會發現、接力自己停）
        print(f'[wake] 休市表抓不到：{e}', flush=True)
        return []


def log(msg):
    print(f'[wake] {dt.datetime.now(TW).strftime("%H:%M:%S")} {msg}', flush=True)


def _created(run):
    try:
        return dt.datetime.fromisoformat(str(run.get('created_at')).replace('Z', '+00:00'))
    except (TypeError, ValueError):
        return None


def watch(repo):
    """夜班看門：每 10 分鐘看一次，接力斷了才發一輪 night"""
    end = watch_end(dt.datetime.now(TW))
    log(f'看門到 {end:%H:%M}')
    while True:
        now = dt.datetime.now(TW)
        if now >= end:
            return
        try:
            active = any(_runs(repo, 'coldeye.yml', f'status={st}') for st in ('in_progress', 'queued', 'pending'))
            latest = None if active else _created((_runs(repo, 'coldeye.yml', 'branch=main') or [{}])[0])
            if relay_dead(active, latest, now):
                log(f'接力斷了（最後一次執行 {latest.astimezone(TW):%H:%M}）' if latest else '接力斷了（查不到執行）')
                _dispatch(repo, 'night', '晚上的全球市場接力')
        except Exception as e:  # noqa: BLE001 — 查不到就下一次再看
            log(f'查不到冷眼的執行：{e}')
        time.sleep(max(1, min(WATCH_GAP_S, (end - dt.datetime.now(TW)).total_seconds())))


def _dispatch(repo, mode, what):
    for i in range(3):
        try:
            _api(f'/repos/{repo}/actions/workflows/coldeye.yml/dispatches', 'POST',
                 {'ref': 'main', 'inputs': {'mode': mode}})
            log(f'已發出{what}')
            return True
        except Exception as e:  # noqa: BLE001
            log(f'發出失敗（第 {i + 1} 次）：{e}')
            time.sleep(10)
    return False


def main():
    repo = os.environ.get('REPO', '')
    my_id = os.environ.get('GITHUB_RUN_ID', '0')
    try:
        mine = [r for st in ('in_progress', 'queued') for r in _runs(repo, 'wake.yml', f'status={st}')]
        if older_wake(mine, my_id):
            log('另一個叫醒已經在等了，交給它')
            return
    except Exception as e:  # noqa: BLE001 — 查不到就自己等（頂多多發一輪，不會少）
        log(f'查不到其他叫醒：{e}')
    holidays = _holidays()
    wait, shift = plan(dt.datetime.now(TW), holidays)
    if wait is None:
        log(f'這一班不用叫：{shift}')
        return
    if shift == 'watch':
        watch(repo)
        return
    failed = []
    for (h, m, s), mode, what, latest, _ in steps_left(shift, dt.datetime.now(TW), holidays):
        now = dt.datetime.now(TW)
        if now.hour * 100 + now.minute >= latest:
            continue
        wait = (now.replace(hour=h, minute=m, second=s, microsecond=0) - now).total_seconds()
        if wait > 0:
            log(f'睡 {int(wait)} 秒，之後發出{what}')
            time.sleep(wait)
        try:
            if any(_runs(repo, 'coldeye.yml', f'status={st}') for st in ('pending', 'queued')):
                log(f'冷眼已經有排隊中的執行，{what}交給它')
                continue
            if mode == 'eod':
                since = dt.datetime.now(TW).replace(hour=14, minute=0, second=0, microsecond=0).astimezone(dt.timezone.utc)
                q = 'created=' + urllib.parse.quote('>=' + since.strftime('%Y-%m-%dT%H:%M:%SZ'))
                if close_started(_runs(repo, 'coldeye.yml', q)):
                    log('14:00 以後已經有收盤後計算，不用再發')
                    continue
        except Exception as e:  # noqa: BLE001
            log(f'查不到冷眼的執行：{e}（照樣發出）')
        if not _dispatch(repo, mode, what):
            failed.append(what)
    if failed:
        raise SystemExit(f'發不出：{"、".join(failed)}（之後的排程會接上）')


if __name__ == '__main__':
    main()
