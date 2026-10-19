"""用真實 state 分支資料在本機重算一次（盤中資料用 probe 抓到的 10/19 官方回應），檢查規則與輸出。"""
import datetime as dt
import json
import pathlib
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from pipeline import build, sources as src  # noqa: E402
from pipeline.state import State  # noqa: E402
from tests.fake_http import FakeHttp  # noqa: E402

state_dir = pathlib.Path(sys.argv[1])
out_root = pathlib.Path(sys.argv[2])
if out_root.exists():
    shutil.rmtree(out_root)
work = out_root / 'state'
shutil.copytree(state_dir, work)
state = State(work)
h = FakeHttp()
extra = {'mis': src.mis_etf(h), 'pre': src.twse_dividend_preview(h), 'risk': src.twse_risk(h), 'news': []}
TW = dt.timezone(dt.timedelta(hours=8))
now = dt.datetime(2026, 10, 20, 0, 52, tzinfo=TW)
build.compute(state, extra, work / 'out', now)
pub = out_root / 'public'
shutil.copytree(ROOT / 'site', pub)
shutil.copytree(work / 'out', pub / 'data', dirs_exist_ok=True)
(pub / 'data' / 'live.json').write_text(json.dumps(build.make_live(state, extra, now, 'eod'), ensure_ascii=False), encoding='utf-8')
print('done')
