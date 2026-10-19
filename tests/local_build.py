"""本機測試用：以官方抓到的「今天」真實資料為終點，往回產生模擬歷史，跑完整計算與輸出，檢查程式與畫面。
產生的資料只存在本機暫存資料夾，絕不會部署。"""
import datetime as dt
import json
import math
import pathlib
import random
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from pipeline import build, sources as src  # noqa: E402
from pipeline.series import d2i, infer_category  # noqa: E402
from pipeline.state import State  # noqa: E402
from tests.fake_http import FakeHttp  # noqa: E402

OUT = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path('/tmp/coldeye-local')
TW = dt.timezone(dt.timedelta(hours=8))


def weekdays_back(end, n):
    out = []
    d = end
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d -= dt.timedelta(days=1)
    return sorted(out)


def main():
    rnd = random.Random(7)
    h = FakeHttp()
    today = dt.date(2026, 10, 19)
    tw = src.twse_etf_daily(h, today)
    tp = src.tpex_etf_daily(h, today)
    mis = src.mis_etf(h)
    days = weekdays_back(today, 520)
    if OUT.exists():
        shutil.rmtree(OUT)
    st_dir = OUT / 'state'
    st_dir.mkdir(parents=True)
    state = State(st_dir)
    pick = ['0050', '006208', '0056', '00878', '00919', '00929', '00713', '00662', '00646', '00757', '00830',
            '00631L', '00632R', '00881', '00891', '00692', '00850', '00915', '00918', '00939', '00940', '00679B',
            '00687B', '00937B', '00720B', '00635U', '00642U', '00400A', '00401A']
    data = {**{k: (v, 'tse') for k, v in tw.items()}, **{k: (v, 'otc') for k, v in tp.items()}}
    for code in pick:
        if code not in data:
            continue
        row, mkt = data[code]
        cat = infer_category(code, row['name'])
        vol = {'bond': 0.006, 'lev': 0.022, 'inv': 0.011, 'fut': 0.016, 'overseas': 0.012}.get(cat, 0.010)
        drift = rnd.uniform(-0.0004, 0.0009)
        n = len(days) if not code.endswith('A') else 60
        closes = [row['c']]
        for _ in range(n - 1):
            closes.append(closes[-1] / math.exp(drift + rnd.gauss(0, vol)))
        closes.reverse()
        ds = days[-n:]
        divs = []
        if cat in ('div', 'bond') or code in ('0050', '006208'):
            every = 63 if cat == 'div' else (21 if cat == 'bond' else 126)
            for k in range(every, n, every):
                cash = round(closes[k - 1] * (0.012 if cat == 'div' else 0.004 if cat == 'bond' else 0.01), 3)
                divs.append([d2i(ds[k]), cash])
                for j in range(k):
                    closes[j] += cash  # 除息前的原始價格含息，除息日向下跳空
        for k, d in enumerate(ds):
            c = round(closes[k], 2)
            o = round(c * (1 + rnd.gauss(0, vol / 3)), 2)
            hi = round(max(o, c) * (1 + abs(rnd.gauss(0, vol / 2))), 2)
            lo = round(min(o, c) * (1 - abs(rnd.gauss(0, vol / 2))), 2)
            v = abs(rnd.gauss(1, 0.35)) * max(row['v'], 2e5)
            if k == n - 1:
                o, hi, lo, c, v = row['o'] or c, row['h'] or c, row['l'] or c, row['c'], row['v']
            state.put_daily(code, d2i(d), {'o': o, 'h': hi, 'l': lo, 'c': c, 'v': v, 'val': v * c}, name=row['name'], market=mkt)
            if k >= n - 260:
                f = rnd.gauss(0, 0.06) * v
                t = rnd.gauss(0, 0.02) * v
                state.put_map('flows', code, d2i(d), [f, t, rnd.gauss(0, 0.05) * v])
                state.put_map('margin', code, d2i(d), [max(0, 20000 + 3000 * math.sin(k / 17) + rnd.gauss(0, 500)), 300])
            if k >= n - 60:
                state.put_map('nav', code, d2i(d), round(c / (1 + rnd.gauss(0.0005, 0.002)), 4))
        state['divs'][code] = divs
        state['holders'][code] = [[d2i(today - dt.timedelta(days=10)), 100000, 1e9], [20261016, 103000, 1.02e9]]
        m = mis.get(code)
        if m:
            state.put_map('units', code, 20261019, m['units'])
            state.put_map('units', code, 20260919, m['units'] * 0.97)
    tx = [46822.08]
    for _ in range(519):
        tx.append(tx[-1] / math.exp(0.0006 + rnd.gauss(0, 0.011)))
    tx.reverse()
    state['taiex'] = {'d': [d2i(d) for d in days], 'c': [round(x, 2) for x in tx], 'val': [8.6e11] * len(days)}
    y = 4.6
    for d in days:
        y += rnd.gauss(0, 0.04)
        state['yields'][str(d2i(d))] = {'y10': round(y - 0.3, 2), 'y20': round(y, 2)}
    news = []
    for fn in (src.twse_news, src.cna_finance, src.fsc_news, src.cbc_news):
        news.extend(fn(h))
    build.store_news(state, news)
    extra = {'mis': mis, 'pre': src.twse_dividend_preview(h), 'risk': src.twse_risk(h), 'news': news}
    now = dt.datetime(2026, 10, 19, 21, 58, tzinfo=TW)
    out_dir = st_dir / 'out'
    build.compute(state, extra, out_dir, now)
    pub = OUT / 'public'
    shutil.copytree(ROOT / 'site', pub)
    shutil.copytree(out_dir, pub / 'data', dirs_exist_ok=True)
    live = build.make_live(state, extra, now, 'eod')
    (pub / 'data' / 'live.json').write_text(json.dumps(live, ensure_ascii=False), encoding='utf-8')
    s = json.loads((out_dir / 'summary.json').read_text(encoding='utf-8'))
    print('etfs in summary:', len(s['etfs']), 'with views:', sum(1 for r in s['etfs'] if r.get('st') is not None))
    for r in s['etfs']:
        if r['c'] in ('0050', '00878', '00662', '00679B', '00631L', '00400A'):
            print(r['c'], r['n'], r.get('st'), r.get('sc'), r.get('cf'), r.get('a'), r.get('iv'), r.get('pr'), r.get('y'), r.get('sim'))
    t = json.loads((out_dir / 'track.json').read_text(encoding='utf-8'))
    print('track overall:', json.dumps(t['overall'], ensure_ascii=False)[:400])
    d = json.loads((out_dir / 'etf' / '0050.json').read_text(encoding='utf-8'))
    print('0050 summary:', d['view']['summary'])
    print('0050 advice:', d['view']['advice'])
    for c in d['view']['components']:
        print('  ', c['name'], c['score'], c['text'])
    print('levels:', json.dumps(d['view']['levels'], ensure_ascii=False))
    print('sizes:', {p.name: p.stat().st_size for p in out_dir.iterdir() if p.is_file()})


if __name__ == '__main__':
    main()
