"""GitHub Actions 進入點：依觸發方式與台灣時間決定這一輪要做什麼。"""
import datetime as dt
import json
import os
import pathlib
import time
import traceback

ROOT = pathlib.Path(__file__).resolve().parent.parent
TW = dt.timezone(dt.timedelta(hours=8))

# 盤中接力：GitHub 的排程忙的時候常常延遲半小時以上，所以盤中每一輪結束前自己排好下一輪。
CYCLE_S = 300        # 兩輪開始抓資料的間隔（秒）
LEAD_S = 35          # 新一輪從排隊、開機到開始抓資料大約要多久，提早這麼多秒發出
LAST_TICK = 1336     # 下一輪預計開始時間超過 13:36 就不再接力（13:30 收盤撮合後的價格要抓得到）
KICK_FROM = 835      # 開盤前這段時間的排程只負責暖身：不抓資料，等到 09:00 發出第一輪
FIRST_TICK = (9, 0, 30)
# 晚上：台指期夜盤（15:00～05:00）、美股盤中（21:30／22:30～04:00／05:00），全球市場每 10 分鐘更新一次
NIGHT_FROM = 1505
NIGHT_TO = 530       # 冬令時間美股 05:00 收盤，交易所延遲 15 分鐘的報價 05:15 才看得到收盤
NIGHT_CYCLE_S = 600


def decide_mode() -> str:
    event = os.environ.get('EVENT', '')
    wanted = (os.environ.get('INPUT_MODE') or '').strip()
    if event == 'workflow_dispatch' and wanted and wanted != 'auto':
        return wanted
    if event == 'push':
        job = json.loads((ROOT / 'control' / 'job.json').read_text(encoding='utf-8'))
        return job.get('job', 'eod')
    now = dt.datetime.now(TW)
    if now.weekday() >= 5:
        return 'weekly'
    hm = now.hour * 100 + now.minute
    if event == 'schedule' and KICK_FROM <= hm < 900:
        return 'kick'
    return 'intraday' if 900 <= hm < 1400 else 'eod'


def next_tick(mode: str, t0: float, live_date, now: dt.datetime | None = None):
    """這一輪結束後要不要排下一輪；要的話回傳「發出下一輪」的 Unix 時間，不要就回傳 None。"""
    now = now or dt.datetime.now(TW)
    if now.weekday() >= 5:
        return None
    if mode == 'kick':
        h, m, s = FIRST_TICK
        return int(now.replace(hour=h, minute=m, second=s, microsecond=0).timestamp())
    # 探測（probe）推上來時正好在盤中，也要接力，不然盤中更新會斷到備援排程接上為止
    if mode not in ('intraday', 'deploy', 'probe'):
        return None
    hm = now.hour * 100 + now.minute
    if hm < 900:
        return None
    start = dt.datetime.fromtimestamp(t0 + CYCLE_S, TW)
    if start.date() != now.date() or start.hour * 100 + start.minute > LAST_TICK:
        return None
    today = int(now.strftime('%Y%m%d'))
    if live_date and int(live_date) != today and hm >= 915:
        return None   # 證交所的即時資料還停在之前的日期：今天休市（颱風假也一樣）
    return int(t0 + CYCLE_S - LEAD_S)


def in_night(now: dt.datetime) -> bool:
    """週一到週五晚上 15:05 以後、週二到週六清晨 05:30 以前（前一晚的延續）"""
    hm = now.hour * 100 + now.minute
    wd = now.weekday()
    if hm >= NIGHT_FROM:
        return wd <= 4
    if hm <= NIGHT_TO:
        return 1 <= wd <= 5
    return False


def next_plan(mode: str, t0: float, live_date, now: dt.datetime | None = None):
    """這一輪結束後排哪一輪：(發出的 Unix 時間, 模式) 或 (None, None)。
    白天盤中照 next_tick 每 5 分鐘一輪（intraday）；晚上（夜盤、美股盤中）每 10 分鐘一輪全球市場（night）。"""
    now = now or dt.datetime.now(TW)
    ts = next_tick(mode, t0, live_date, now)
    if ts:
        return ts, 'intraday'
    if mode in ('night', 'global', 'eod', 'weekly', 'deploy', 'probe'):
        start = dt.datetime.fromtimestamp(t0 + NIGHT_CYCLE_S, TW)
        if in_night(start):
            return int(t0 + NIGHT_CYCLE_S - LEAD_S), 'night'
    return None, None


def live_date():
    try:
        return json.loads((ROOT / 'public' / 'data' / 'live.json').read_text(encoding='utf-8')).get('date')
    except Exception:  # noqa: BLE001 — 抓不到就當作不知道，照常接力
        return None


def set_output(key: str, value: str):
    path = os.environ.get('GITHUB_OUTPUT')
    if path:
        with open(path, 'a', encoding='utf-8') as f:
            f.write(f'{key}={value}\n')
    print(f'[output] {key}={value}', flush=True)


def main():
    t0 = time.time()
    mode = decide_mode()
    print(f'[coldeye] mode={mode} at {dt.datetime.now(TW).isoformat()}', flush=True)
    deploy = False
    try:
        if mode == 'probe':
            from . import probe
            probe.run()
        elif mode == 'kick':
            print('[coldeye] 開盤前暖身：09:00 準時發出第一輪', flush=True)
        else:
            try:
                from . import build
            except ImportError:
                print('[coldeye] build 模組尚未就緒，這輪略過', flush=True)
            else:
                deploy = bool(build.run(mode))
    except Exception:  # noqa: BLE001 — 任何錯誤都要留下紀錄，不讓排程整個中斷
        traceback.print_exc()
    set_output('deploy', 'true' if deploy else 'false')
    nxt, nmode = None, None
    try:
        nxt, nmode = next_plan(mode, t0, live_date())
    except Exception:  # noqa: BLE001
        traceback.print_exc()
    set_output('next_at', str(nxt) if nxt else '')
    set_output('next_mode', nmode or 'intraday')


if __name__ == '__main__':
    main()
