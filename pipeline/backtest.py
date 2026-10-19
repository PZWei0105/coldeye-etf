"""回測與實際戰績。

回測：在過去每第 5 個交易日，只用「當天以前」的資料跑同一套規則，記下觀點，
再看之後 20 個交易日的含息報酬（用還原權息價計算）。
命中定義：偏多 → 之後上漲；偏空 → 之後下跌。中性不計命中，只看之後平均報酬。
基準：同一段期間「每次都看多」的命中率，規則要比這個高才有意義。
"""
from . import engine

STEP = 5
BUCKETS = [(20, 50), (50, 65), (65, 80), (80, 96)]


def run_series(s, ctx, start=None):
    rows = []
    if s.n < 150:
        return rows
    start = start or 130
    cache = {}
    for i in range(start, s.n - engine.HORIZON, STEP):
        r = engine.analyze(s, i, ctx, live=None, hist_cache=cache, full=False)
        if r is None:
            continue
        f = s.fwd(i, engine.HORIZON)
        if f is None:
            continue
        rows.append((s.dates[i], r['stance'], r['score'], r['conf'], f))
    return rows


def _share(xs, pred):
    xs = list(xs)
    return round(sum(1 for x in xs if pred(x)) / len(xs), 4) if xs else None


def _avg(xs):
    xs = list(xs)
    return round(sum(xs) / len(xs), 5) if xs else None


def stats(rows):
    if not rows:
        return None
    allf = [r[4] for r in rows]
    bull = [r[4] for r in rows if r[1] == 1]
    bear = [r[4] for r in rows if r[1] == -1]
    neu = [r[4] for r in rows if r[1] == 0]
    out = {
        'n': len(rows),
        'start': rows[0][0], 'end': rows[-1][0],
        'base_up': _share(allf, lambda x: x > 0),
        'base_avg': _avg(allf),
        'bull': {'n': len(bull), 'hit': _share(bull, lambda x: x > 0), 'avg': _avg(bull)},
        'bear': {'n': len(bear), 'hit': _share(bear, lambda x: x < 0), 'avg': _avg(bear)},
        'neutral': {'n': len(neu), 'avg': _avg(neu)},
    }
    return out


def calibration(rows):
    """各信心區間的方向正確率，以及同樣多空比例下「亂猜」會得到的基準。"""
    allf = [r[4] for r in rows]
    up = sum(1 for x in allf if x > 0) / len(allf) if allf else 0.5
    out = []
    for lo, hi in BUCKETS:
        sel = [r for r in rows if r[1] != 0 and r[3] is not None and lo <= r[3] < hi]
        hits = [1 if (r[1] == 1 and r[4] > 0) or (r[1] == -1 and r[4] < 0) else 0 for r in sel]
        nb = sum(1 for r in sel if r[1] == 1)
        base = (nb * up + (len(sel) - nb) * (1 - up)) / len(sel) if sel else None
        out.append({'lo': lo, 'hi': hi, 'n': len(sel), 'n_bull': nb,
                    'hit': round(sum(hits) / len(hits), 4) if hits else None,
                    'base': round(base, 4) if base is not None else None})
    return out


def bucket_of(conf):
    if conf is None:
        return None
    for lo, hi in BUCKETS:
        if lo <= conf < hi:
            return lo
    return None


def similar_index(rows_by_code, cats):
    """{(類別, 立場, 信心區間): [命中數, 樣本數, 報酬加總]}，以及不分類別的版本。"""
    idx = {}
    for code, rows in rows_by_code.items():
        cat = cats.get(code)
        for r in rows:
            if r[1] == 0:
                continue
            b = bucket_of(r[3])
            hit = 1 if (r[1] == 1 and r[4] > 0) or (r[1] == -1 and r[4] < 0) else 0
            for key in ((cat, r[1], b), ('*', r[1], b)):
                a = idx.setdefault(key, [0, 0, 0.0])
                a[0] += hit
                a[1] += 1
                a[2] += r[4]
    return idx


def similar_lookup(idx, cat, stance, conf, min_n=40):
    if stance == 0 or conf is None:
        return None
    b = bucket_of(conf)
    for key, scope in (((cat, stance, b), 'cat'), (('*', stance, b), 'all')):
        a = idx.get(key)
        if a and a[1] >= min_n:
            return {'hit': round(a[0] / a[1], 4), 'n': a[1], 'avg': round(a[2] / a[1], 5), 'scope': scope,
                    'bucket': b}
    return None


def live_record(views, series, max_days=400):
    """把上線後每天記下的觀點，用之後 20 個交易日的實際含息報酬驗證。"""
    rows_by_code = {}
    pending = 0
    for d_str in sorted(views.keys())[-max_days:]:
        d = int(d_str)
        for code, v in views[d_str].items():
            s = series.get(code)
            if s is None:
                continue
            i = s.idx(d)
            if i is None:
                continue
            f = s.fwd(i, engine.HORIZON)
            if f is None:
                pending += 1
                continue
            rows_by_code.setdefault(code, []).append((d, v[0], v[1], v[2], f))
    return rows_by_code, pending
