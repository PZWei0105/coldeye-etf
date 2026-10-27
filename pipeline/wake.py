"""開盤叫醒：讓盤中接力的第一輪準時在 09:00 發出。

GitHub 的排程在台灣早上很忙：08:37–08:53 的暖身排程每天都延遲到 09:15 以後才跑（10/21、10/22、10/23、10/27
第一筆盤中資料都在 09:15～09:20），開盤後最重要的前 20 分鐘沒有新資料。
這支程式由清晨的排程執行（.github/workflows/wake.yml，台灣 05:13、06:13、07:13 三次，延遲一兩個小時也還來得及）：
睡到 09:00:30 發出第一輪盤中更新，之後照舊由每一輪自己接力（dispatch.next_tick）。
它不和冷眼主流程共用排隊（concurrency），睡覺時不會擋住推送或其他工作；只用標準函式庫，不用安裝套件。

用法（GitHub Actions）：python3 -m pipeline.wake（環境變數 GH_TOKEN、REPO、GITHUB_RUN_ID）
"""
import datetime as dt
import json
import os
import time
import urllib.request

from .dispatch import FIRST_TICK, TW

LATEST = 930              # 09:30 以後就不叫了：盤中的備援排程早就接上
MAX_WAIT_S = 5 * 3600     # GitHub 一個工作最多跑 6 小時；離 09:00 太久的不等（下一個排程會再來）
CAL_URL = 'https://pzwei0105.github.io/coldeye-etf/data/cal.json'
API = 'https://api.github.com'


def plan(now: dt.datetime, holidays=()):
    """今天要不要叫：回傳 (要睡幾秒, None)，不叫就回傳 (None, 原因)。holidays＝證交所休市表上的日期（yyyymmdd）。"""
    if now.weekday() >= 5:
        return None, '週末'
    if int(now.strftime('%Y%m%d')) in set(holidays or ()):
        return None, '今天是證交所休市日'
    if now.hour * 100 + now.minute >= LATEST:
        return None, '已經過了 09:30（盤中備援排程會接上）'
    h, m, s = FIRST_TICK
    wait = (now.replace(hour=h, minute=m, second=s, microsecond=0) - now).total_seconds()
    if wait > MAX_WAIT_S:
        return None, '離開盤還太久（之後的排程會再叫）'
    return max(0, int(wait)), None


def older_wake(runs, my_id) -> bool:
    """另一個比較早開始的叫醒還在等（同一個早上有好幾個排程）：交給它，自己不用等。"""
    return any(int(r.get('id') or 0) < int(my_id or 0) for r in runs or [])


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


def _runs(repo, workflow, status):
    js = _api(f'/repos/{repo}/actions/workflows/{workflow}/runs?status={status}&per_page=30')
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
        mine = [r for st in ('in_progress', 'queued') for r in _runs(repo, 'wake.yml', st)]
        if older_wake(mine, my_id):
            log('另一個叫醒已經在等了，交給它')
            return
    except Exception as e:  # noqa: BLE001 — 查不到就自己等（頂多多發一輪，不會少）
        log(f'查不到其他叫醒：{e}')
    wait, why = plan(dt.datetime.now(TW), _holidays())
    if wait is None:
        log(f'今天不用叫：{why}')
        return
    log(f'睡 {wait} 秒，09:00:30 發出第一輪盤中更新')
    time.sleep(wait)
    try:
        if any(_runs(repo, 'coldeye.yml', st) for st in ('pending', 'queued')):
            log('冷眼已經有排隊中的執行，交給它接力')
            return
    except Exception as e:  # noqa: BLE001
        log(f'查不到冷眼的排隊：{e}（照樣發出）')
    for i in range(3):
        try:
            _api(f'/repos/{repo}/actions/workflows/coldeye.yml/dispatches', 'POST',
                 {'ref': 'main', 'inputs': {'mode': 'intraday'}})
            log('已發出第一輪盤中更新')
            return
        except Exception as e:  # noqa: BLE001
            log(f'發出失敗（第 {i + 1} 次）：{e}')
            time.sleep(10)
    raise SystemExit('發不出第一輪盤中更新（備援排程約 09:15 會接上）')


if __name__ == '__main__':
    main()
