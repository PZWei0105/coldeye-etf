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
        rows.append((s.dates[i], r['stance'], r['score'], r['conf'], f, r.get('ps')))
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


def calibration_by_cat(rows_by_code, cats):
    """同上，但「亂猜」的基準用每一筆訊號所屬類別的上漲比例計算，避免類別組成造成的假優勢。"""
    cnt = {}
    for code, rows in rows_by_code.items():
        u = cnt.setdefault(cats.get(code), [0, 0])
        for r in rows:
            u[0] += 1 if r[4] > 0 else 0
            u[1] += 1
    upr = {c: u[0] / u[1] for c, u in cnt.items() if u[1]}
    out = []
    for lo, hi in BUCKETS:
        n = nb = hits = 0
        base = 0.0
        for code, rows in rows_by_code.items():
            u = upr.get(cats.get(code), 0.5)
            for r in rows:
                if r[1] == 0 or r[3] is None or not (lo <= r[3] < hi):
                    continue
                n += 1
                nb += 1 if r[1] == 1 else 0
                hits += 1 if (r[1] == 1 and r[4] > 0) or (r[1] == -1 and r[4] < 0) else 0
                base += u if r[1] == 1 else 1 - u
        out.append({'lo': lo, 'hi': hi, 'n': n, 'n_bull': nb,
                    'hit': round(hits / n, 4) if n else None, 'base': round(base / n, 4) if n else None})
    return out


def adjusted_base(by_cat):
    """「同類別基準」：依各類 ETF 的訊號次數，加權各類自己「一直看多／一直看空」的命中率。
    直接拿全部 ETF 混在一起的基準比較，會因為類別組成（例如債券 ETF 偏多訊號少、上漲比例低）而高估規則的優勢。"""
    out = {}
    for key in ('bull', 'bear'):
        num = den = 0.0
        for st in by_cat.values():
            if not st or not st[key]['n']:
                continue
            n = st[key]['n']
            num += n * (st['base_up'] if key == 'bull' else 1 - st['base_up'])
            den += n
        out[key] = round(num / den, 4) if den else None
    return out


def bucket_of(conf):
    if conf is None:
        return None
    for lo, hi in BUCKETS:
        if lo <= conf < hi:
            return lo
    return None


def similar_index(rows_by_code, cats):
    """{(類別, 立場, 信心區間): [命中數, 樣本數, 報酬加總]}，以及每個類別「一直看多」的上漲比例。"""
    idx = {}
    up = {}
    for code, rows in rows_by_code.items():
        cat = cats.get(code)
        for r in rows:
            for key in (cat, '*'):
                u = up.setdefault(key, [0, 0])
                u[0] += 1 if r[4] > 0 else 0
                u[1] += 1
            if r[1] == 0:
                continue
            b = bucket_of(r[3])
            hit = 1 if (r[1] == 1 and r[4] > 0) or (r[1] == -1 and r[4] < 0) else 0
            for key in ((cat, r[1], b), ('*', r[1], b)):
                a = idx.setdefault(key, [0, 0, 0.0])
                a[0] += hit
                a[1] += 1
                a[2] += r[4]
    idx['_up'] = {k: v[0] / v[1] for k, v in up.items() if v[1]}
    return idx


def similar_lookup(idx, cat, stance, conf, min_n=40):
    if stance == 0 or conf is None:
        return None
    b = bucket_of(conf)
    for key, scope in (((cat, stance, b), 'cat'), (('*', stance, b), 'all')):
        a = idx.get(key)
        if a and a[1] >= min_n:
            up = idx['_up'].get(cat if scope == 'cat' else '*', 0.5)
            base = up if stance > 0 else 1 - up
            hit = a[0] / a[1]
            return {'hit': round(hit, 4), 'n': a[1], 'avg': round(a[2] / a[1], 5), 'scope': scope,
                    'bucket': b, 'base': round(base, 4), 'delta': round(hit - base, 4)}
    return None


def category_edge(rows_by_code, cats, min_n=100):
    """每類 ETF、每個方向，規則命中率減去「一直看多／一直看空」的基準。"""
    by = {}
    for code, rows in rows_by_code.items():
        by.setdefault(cats.get(code), []).extend(rows)
    out = {}
    for cat, rows in by.items():
        st = stats(rows)
        if not st:
            continue
        e = {}
        for stance, key, base in ((1, 'bull', st['base_up']), (-1, 'bear', 1 - st['base_up'])):
            part = st[key]
            if part['n'] >= min_n and part['hit'] is not None:
                e[stance] = {'hit': part['hit'], 'base': round(base, 4), 'delta': round(part['hit'] - base, 4),
                             'n': part['n']}
        out[cat] = e
    return out


POS_KEYS = ('add', 'wait', 'hold', 'caution', 'trim')


def _dist(xs):
    """一組 20 日後報酬的分布：次數、平均、上漲比例、最差 10% 與中位數。"""
    xs = sorted(xs)
    n = len(xs)
    if not n:
        return {'n': 0}
    return {'n': n, 'avg': round(sum(xs) / n, 5), 'up': round(sum(1 for x in xs if x > 0) / n, 4),
            'p10': round(xs[int(0.1 * (n - 1))], 5), 'p50': round(xs[int(0.5 * (n - 1))], 5)}


def pos_stats(rows):
    """部位訊號出現之後 20 個交易日的報酬，和「任何一天」（all）的基準並列。"""
    if not rows:
        return None
    out = {'all': _dist(r[4] for r in rows)}
    for k in POS_KEYS:
        out[k] = _dist(r[4] for r in rows if len(r) > 5 and r[5] == k)
    return out


def pos_stats_by_cat(rows_by_code, cats):
    by = {}
    for code, rows in rows_by_code.items():
        by.setdefault(cats.get(code), []).extend(rows)
    out = {k: pos_stats(v) for k, v in by.items() if v}
    out['*'] = pos_stats([r for rows in rows_by_code.values() for r in rows])
    return out


def pos_adjusted(pos_cat):
    """每種部位訊號的「同類別基準」：該訊號在各類別出現的次數，加權各類別任何一天的表現。"""
    out = {}
    for k in POS_KEYS:
        n_tot = 0
        up = avg = p10 = 0.0
        for cat, st in pos_cat.items():
            if cat == '*' or not st or not st[k].get('n'):
                continue
            n, a = st[k]['n'], st['all']
            n_tot += n
            up += n * a['up']
            avg += n * a['avg']
            p10 += n * a['p10']
        out[k] = ({'up': round(up / n_tot, 4), 'avg': round(avg / n_tot, 5), 'p10': round(p10 / n_tot, 5)}
                  if n_tot else None)
    return out


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
            rows_by_code.setdefault(code, []).append((d, v[0], v[1], v[2], f, v[3] if len(v) > 3 else None))
    return rows_by_code, pending
