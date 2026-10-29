"""加碼金額的回測（pipeline/addsim.py）：每月定期定額 vs 照冷眼的加碼建議分批買（有／沒有市場溫度）。

用法：python3 tests/add_sim.py <state 資料夾> [global 歷史 json（probe 的 raw/global.json，或 state 的 global.json），- 表示用 state 的] [代號，預設 0050] [每月金額，預設 10000]
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from pipeline import addsim  # noqa: E402
from pipeline.state import State  # noqa: E402


def main():
    st = State(pathlib.Path(sys.argv[1]))
    if len(sys.argv) > 2 and sys.argv[2] != '-':
        obj = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
        if 'hist' in obj:
            st['global'] = {'s': {k: {'d': [int(a) for a, _ in v], 'c': [float(b) for _, b in v]} for k, v in obj['hist'].items()}}
        else:
            st['global'] = obj
    code = sys.argv[3] if len(sys.argv) > 3 else '0050'
    monthly = int(sys.argv[4]) if len(sys.argv) > 4 else 10000
    rep = addsim.simulate(st, code, monthly)
    print(json.dumps(rep, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
