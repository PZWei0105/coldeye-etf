"""GitHub Actions 進入點：依觸發方式與台灣時間決定這一輪要做什麼。"""
import datetime as dt
import json
import os
import pathlib
import traceback

ROOT = pathlib.Path(__file__).resolve().parent.parent
TW = dt.timezone(dt.timedelta(hours=8))


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
    return 'intraday' if 900 <= hm < 1400 else 'eod'


def set_output(key: str, value: str):
    path = os.environ.get('GITHUB_OUTPUT')
    if path:
        with open(path, 'a', encoding='utf-8') as f:
            f.write(f'{key}={value}\n')
    print(f'[output] {key}={value}', flush=True)


def main():
    mode = decide_mode()
    print(f'[coldeye] mode={mode} at {dt.datetime.now(TW).isoformat()}', flush=True)
    deploy = False
    try:
        if mode == 'probe':
            from . import probe
            probe.run()
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


if __name__ == '__main__':
    main()
