"""叫醒：讓開盤第一輪盤中更新、收盤後第一次完整計算準時開始。

GitHub 的排程常常延遲半小時到一小時：
- 早上：08:37–08:53 的暖身排程每天都延遲到 09:15 以後才跑（10/21、10/22、10/23、10/27 第一筆盤中資料都在
  09:15～09:20），開盤後最重要的前 20 分鐘沒有新資料。
- 下午：收盤後第一次完整計算原本是靠 13:44／13:54 的盤中備援排程「剛好」被延遲到 14:00 以後（10/21～10/27 都在
  14:10～14:17）；10/28 那兩個排程沒怎麼延遲，14:25 的排程又遲遲不來，完整分析拖到 14:47 手動補跑、14:49 才算好。
這支程式由 .github/workflows/wake.yml 的排程執行（早上 05:13、06:13、07:13，下午 10:13、11:13、12:13，
延遲一兩個小時也還來得及）：早上睡到 09:00:30 發出第一輪盤中更新（之後照舊由每一輪自己接力，dispatch.next_tick），
下午睡到 14:15 發出收盤後計算（eod）。同一班有好幾個排程都跑起來時，只有最早的那個在等，其他的馬上結束。
它不和冷眼主流程共用排隊（concurrency），睡覺時不會擋住推送或其他工作；只用標準函式庫，不用安裝套件。

用法（GitHub Actions）：python3 -m pipeline.wake（環境變數 GH_TOKEN、REPO、GITHUB_RUN_ID）
"""
import datetime as dt
import json
import os
import time
import urllib.parse
import urllib.request

from .dispatch import FIRST_TICK, TW

OPEN_LATEST = 930          # 09:30 以後就不叫第一輪了：盤中的備援排程早就接上
CLOSE_AT = (14, 15, 0)     # 收盤後第一次完整計算：證交所、櫃買的收盤資料 14:00 前後公布（10/22～10/27 14:16 都抓得到）
CLOSE_LATEST = 1440        # 14:40 以後不叫（之後的排程照常會跑）
MAX_WAIT_S = 5 * 3600      # GitHub 一個工作最多跑 6 小時；離叫醒時間太久的不等（之後的排程會再來）
CAL_URL = 'https://pzwei0105.github.io/coldeye-etf/data/cal.json'
API = 'https://api.github.com'
# 班別：叫冷眼做什麼、怎麼說
SHIFTS = {'open': ('intraday', '第一輪盤中更新'), 'close': ('eod', '收盤後第一次完整計算')}


def plan(now: dt.datetime, holidays=()):
    """今天這一班要不要叫：回傳 (要睡幾秒, 班別 'open'／'close')，不叫就回傳 (None, 原因)。
    09:30 以前起來的是早班（09:00:30 發出第一輪盤中更新），之後到 14:40 是下午班（14:15 發出收盤後計算）。
    holidays＝證交所休市表上的日期（yyyymmdd）。"""
    if now.weekday() >= 5:
        return None, '週末'
    if int(now.strftime('%Y%m%d')) in set(holidays or ()):
        return None, '今天是證交所休市日'
    hm = now.hour * 100 + now.minute
    if hm < OPEN_LATEST:
        shift, (h, m, s) = 'open', FIRST_TICK
    elif hm < CLOSE_LATEST:
        shift, (h, m, s) = 'close', CLOSE_AT
    else:
        return None, '已經過了 14:40（之後的排程照常會跑）'
    wait = (now.replace(hour=h, minute=m, second=s, microsecond=0) - now).total_seconds()
    if wait > MAX_WAIT_S:
        return None, '離叫醒的時間還太久（之後的排程會再叫）'
    return max(0, int(wait)), shift


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
    wait, shift = plan(dt.datetime.now(TW), _holidays())
    if wait is None:
        log(f'這一班不用叫：{shift}')
        return
    mode, what = SHIFTS[shift]
    log(f'睡 {wait} 秒，之後發出{what}')
    time.sleep(wait)
    try:
        if any(_runs(repo, 'coldeye.yml', f'status={st}') for st in ('pending', 'queued')):
            log('冷眼已經有排隊中的執行，交給它')
            return
        if shift == 'close':
            since = dt.datetime.now(TW).replace(hour=14, minute=0, second=0, microsecond=0).astimezone(dt.timezone.utc)
            q = 'created=' + urllib.parse.quote('>=' + since.strftime('%Y-%m-%dT%H:%M:%SZ'))
            if close_started(_runs(repo, 'coldeye.yml', q)):
                log('14:00 以後已經有收盤後計算，不用再發')
                return
    except Exception as e:  # noqa: BLE001
        log(f'查不到冷眼的執行：{e}（照樣發出）')
    for i in range(3):
        try:
            _api(f'/repos/{repo}/actions/workflows/coldeye.yml/dispatches', 'POST',
                 {'ref': 'main', 'inputs': {'mode': mode}})
            log(f'已發出{what}')
            return
        except Exception as e:  # noqa: BLE001
            log(f'發出失敗（第 {i + 1} 次）：{e}')
            time.sleep(10)
    raise SystemExit(f'發不出{what}（之後的排程會接上）')


if __name__ == '__main__':
    main()
