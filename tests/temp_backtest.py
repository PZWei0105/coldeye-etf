"""市場溫度的回測：陰、雨的日子，加碼之後是不是真的比較容易虧到出場線、虧得比較深？

每個交易日 D（2020/4 起，要先有 60 日、200 日均線）用「D 收盤當下已經知道的資料」數警訊（pipeline/globalmkt.py 的 temp_on）：
台灣這一側用 D 的收盤；美股、VIX、新台幣、美債用 D 之前的資料（美股、美債在台灣收盤之後才開盤，匯率 16:00 才公布），不偷看。
接著假設 D 收盤照冷眼的方法買進（出場線＝移動防守線，已經跌破就用 2 倍 ATR），看之後 20 個交易日：
含息報酬（平均、上漲比例、最差 10%）、期間最大跌幅、碰到出場線的比例、碰到時實際虧的是計畫的幾倍（跳空跌破會虧得比計畫多）。
晴／陰／雨和每一個警訊分開算，一律和「任何一天」並列（globalmkt.temp_evidence；後台每次輸出 global.json 也會算一次 0050）。

用法：python3 tests/temp_backtest.py <state 資料夾> [global 歷史：probe 的 raw/global.json（沒給就用 state 的 global.json）] [輸出 json]
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from pipeline import globalmkt as G  # noqa: E402
from pipeline.state import State  # noqa: E402


def main():
    st = State(pathlib.Path(sys.argv[1]))
    if len(sys.argv) > 2 and sys.argv[2] != '-':
        obj = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
        if 'hist' in obj:   # probe 的格式：{hist: {k: [[d, c]]}}
            st['global'] = {'s': {k: {'d': [int(a) for a, _ in v], 'c': [float(b) for _, b in v]} for k, v in obj['hist'].items()}}
            if 'twd_bot' in obj['hist']:
                G._merge(st['global']['s'].setdefault('twd', {'d': [], 'c': []}), [(int(a), float(b)) for a, b in obj['hist']['twd_bot']])
        else:
            st['global'] = obj
    rep = G.temp_evidence(st, codes=('0050', '006208', '0056', '00878'))
    for code, out in rep['res'].items():
        print(f'\n== {code}（{rep["from"]}～{rep["to"]}，之後 {rep["h"]} 個交易日，出場線＝移動防守線／2 倍 ATR）')
        print('組別'.ljust(14), '天數'.rjust(5), '平均'.rjust(7), '上漲'.rjust(6), '最差10%'.rjust(8), '最大跌幅均'.rjust(9),
              '最大跌幅差10%'.rjust(10), '碰出場線'.rjust(7), '實虧/計畫'.rjust(8), '90分位'.rjust(7))
        order = ['任何一天', '晴', '陰', '雨'] + sorted(k for k in out if k.startswith('警訊'))
        f = lambda v, m=100, n=1: '—' if v is None else f'{v * m:.{n}f}'  # noqa: E731
        for g in order:
            x = out.get(g)
            if not x:
                continue
            print(g.ljust(14), str(x['n']).rjust(5), (f(x['avg']) + '%').rjust(7), (f(x['up'], 100, 0) + '%').rjust(6),
                  (f(x['p10']) + '%').rjust(8), (f(x['mdd']) + '%').rjust(9), (f(x['mdd_p10']) + '%').rjust(10),
                  (f(x['hit'], 100, 0) + '%').rjust(7), f(x['over'], 1, 2).rjust(8), f(x['over_p90'], 1, 2).rjust(7))
    print('\n各級天數', rep['level_days'])
    if len(sys.argv) > 3:
        pathlib.Path(sys.argv[3]).write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding='utf-8')


if __name__ == '__main__':
    main()
