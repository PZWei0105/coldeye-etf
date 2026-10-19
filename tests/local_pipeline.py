"""本機測試：以 probe 抓到的官方回應模擬每一個端點，跑一次 backfill → eod → publish 的完整流程（不連網、不推送）。"""
import datetime as dt
import json
import pathlib
import shutil
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from pipeline import build  # noqa: E402
from pipeline.state import State  # noqa: E402
from tests.fake_http import FakeHttp  # noqa: E402

build.Http = FakeHttp
tmp = pathlib.Path(tempfile.mkdtemp())
state = State(tmp / 'state')
log = {'steps': [], 'errors': []}
build.backfill(state, log, budget_s=60)
build.eod(state, log, weekly=True)
build.PUBLIC = tmp / 'public'
ok = build.publish(state, log, 'eod')
state.save()
print('publish ok:', ok)
print('backfill:', log.get('backfill'))
for s in log['steps']:
    if not s['ok']:
        print('FAILED step:', s)
print('etf count:', len(state['daily']), 'flows:', len(state['flows']), 'margin:', len(state['margin']), 'divs:', len(state['divs']), 'holders:', len(state['holders']))
print('files:', sorted(p.name for p in (tmp / 'public' / 'data').iterdir())[:10])
live = json.loads((tmp / 'public' / 'data' / 'live.json').read_text())
print('live:', {k: live[k] for k in ('at', 'mode', 'open', 'date')}, len(live['etfs']))
print('status keys:', sorted(state['status'].keys()))
shutil.rmtree(tmp)
