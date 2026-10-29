"""加碼計畫的回測：每個月固定存一筆錢，「每月定期定額」和「照冷眼的加碼建議分批買」誰比較好？

A 定期定額（dca）：每個月第一個交易日，整筆買進。
B 冷眼加碼＋市場溫度（rules_temp）：錢先放著；規則訊號「可加碼／漲多分批」的日子（中性的「續抱」日子減半），照 pf.js planAdd 的主要規則買
  （單筆最多虧總資產 1%×溫度倍數 TEMP_MULT ÷ 每股跌到出場線的虧損；單檔上限照穩健型的類別 CAPS；可動用現金分 3 份；信心不到 70 減半），
  「減碼」訊號賣三分之一、超過上限賣回上限。
C 冷眼加碼（rules_flat）：同 B，溫度倍數一律 1。
和 App 不完全一樣的地方（App 畫面照實寫）：只有一檔、沒有緊急預備金與定期定額保留款；出場線一律用移動防守線（App 偏多時用作廢線）；
沒有單一公司上限（沒有歷史的成分股明細）、沒有溢價減半（沒有歷史的盤中溢價）；不算手續費。
每一天只用那天收盤時已經知道的資料（規則訊號、市場溫度都不偷看），用收盤價成交，含息（還原價）。
看：期末資產、投入本金、時間加權報酬與它的最大跌幅、最差 10% 的 20 個交易日報酬、平均現金比例。

2026/10/30 第一次算（2020/4～2026/10）：B 和 C 幾乎一樣，溫度打折沒有讓結果變好，所以 App 的加碼股數不乘溫度
（PZ：沒有讓結果變好的就拿掉）；C 的最大跌幅只有定期定額的一半不到，但平均留了五成現金，這段多頭期間期末資產少很多——
App 照實並列（global.json 的 sim，收盤後那幾輪有新資料才重算）。
"""
from . import engine, globalmkt as G
from .series import Series

LOSS = 0.01       # 穩健型：單筆最多虧總資產 1%
CAPS = {'broad': 0.6, 'div': 0.5}   # 穩健型各類的單檔上限（和 site/pf.js 的 PROFILES.mid.caps 一樣）
CAP = CAPS['broad']               # 沒有列到的類別
SLICES = 3
CONF_FULL = 70
TEMP_MULT = {'晴': 1.0, '陰': 0.5, '雨': 0.25}   # B 的溫度倍數（實驗用；App 沒有用）
START = 20200401
MONTHLY = 10000
CODES = ('0050', '0056', '00878')   # 市值型、高股息兩種最多人存的


def simulate(st, code='0050', monthly=MONTHLY, start=START, ctx=None, br=None):
    meta = st['meta'] or {}
    daily = (st['daily'] or {}).get(code)
    if not daily:
        return None
    s = Series(code, meta.get(code, {}), daily, flows=(st['flows'] or {}).get(code), margin=(st['margin'] or {}).get(code),
               nav=(st['nav'] or {}).get(code), divs=[tuple(x) for x in (st['divs'] or {}).get(code, [])],
               holders=(st['holders'] or {}).get(code))
    if ctx is None:
        from .build import build_ctx
        ctx = build_ctx(st)
    g = st['global'] or {}
    gs = {k: (g.get('s') or {}).get(k) or {} for k in ('spx', 'sox', 'vix', 'twd')}
    if br is None:
        br = G.breadth_series(st['daily'], {c: (m or {}).get('cat') for c, m in meta.items()}, divs=st['divs'] or {})
    tx = {'d': st['taiex']['d'], 'c': st['taiex']['c']}
    cap = CAPS.get(s.cat, CAP)
    idx = [i for i in range(s.n) if s.dates[i] >= start]
    if len(idx) < 60:
        return None
    cache = {}
    sig = {i: engine.analyze(s, i, ctx, live=None, hist_cache=cache, full=False) for i in idx}
    temps = {i: G.temp_on(s.dates[i], tx, br, gs, st['yields'])[0] for i in idx}

    def sim(kind):
        cash = sh = 0.0
        invested = 0.0
        vals, cash_ratio = [], []
        month = None
        twr = [1.0]
        prev_v = None
        for i in idx:
            d = s.dates[i]
            px = s.c[i]
            flow = 0.0
            if d // 100 != month:
                month = d // 100
                cash += monthly
                invested += monthly
                flow = monthly
            v_before = cash + sh * px
            if prev_v is not None and prev_v > 0:
                twr.append(twr[-1] * (v_before - flow) / prev_v)
            if kind == 'dca':
                if flow:
                    n = int(cash // px)
                    sh += n
                    cash -= n * px
            else:
                r = sig.get(i)
                T = cash + sh * px
                if r and r['ps'] == 'trim' and sh > 0:
                    n = int(sh // 3) or int(sh)
                    sh -= n
                    cash += n * px
                elif r and sh * px > cap * T + 0.02 * T:
                    n = int((sh * px - cap * T) / px)
                    sh -= n
                    cash += n * px
                elif r and ((r['stance'] > 0 and r['ps'] in ('add', 'wait')) or (r['stance'] == 0 and r['ps'] == 'hold')):
                    atr = s.atr14[i] or px * 0.015
                    dl = engine.defense_line(s, i)
                    stop = dl if dl is not None and dl < px else px - 2 * atr
                    mult = TEMP_MULT[temps[i]['level']] if kind == 'rules_temp' else 1.0
                    per = max(px - stop, 0.01)
                    n = min(int(T * LOSS * mult / per), int(max(0.0, cap * T - sh * px) / px), int((cash / SLICES) / px))
                    if r['stance'] == 0 or not (r['conf'] is not None and r['conf'] >= CONF_FULL):
                        n //= 2      # 觀點中性（續抱裡的「想加碼的話，小額就好」）、信心不到 70：減半
                    if n > 0:
                        sh += n
                        cash -= n * px
            v = cash + sh * px
            vals.append(v)
            cash_ratio.append(cash / v if v > 0 else 1.0)
            prev_v = v
        peak, mdd = 0.0, 0.0
        for x in twr:
            peak = max(peak, x)
            mdd = min(mdd, x / peak - 1)
        r20 = sorted(twr[k + 20] / twr[k] - 1 for k in range(0, len(twr) - 20))
        p10 = r20[int(0.1 * (len(r20) - 1))] if r20 else None
        return {'final': round(vals[-1]), 'invested': round(invested), 'gain': round(vals[-1] - invested),
                'twr': round(twr[-1] - 1, 4), 'mdd': round(mdd, 4), 'p10': round(p10, 4) if p10 is not None else None,
                'cash': round(sum(cash_ratio) / len(cash_ratio), 3)}

    return {'code': code, 'name': (meta.get(code) or {}).get('name'), 'from': s.dates[idx[0]], 'to': s.dates[idx[-1]],
            'monthly': monthly, 'cat': s.cat, 'cap': cap, 'dca': sim('dca'), 'rules': sim('rules_flat'), 'rules_temp': sim('rules_temp')}


def update(state, codes=CODES):
    """收盤後（會存 state 的那幾輪）：有新的收盤資料才重算，結果存在 state['global']['sim']。回傳這次有沒有重算。"""
    g = state['global']
    last = max((((state['daily'] or {}).get(c) or {}).get('d') or [0])[-1] for c in codes)
    old = g.get('sim') or {}
    if old.get('to') == last and old.get('v') == 2:
        return False
    from .build import build_ctx
    ctx = build_ctx(state)
    meta = state['meta'] or {}
    br = G.breadth_series(state['daily'], {c: (m or {}).get('cat') for c, m in meta.items()}, divs=state['divs'] or {})
    res = {}
    for c in codes:
        r = simulate(state, c, ctx=ctx, br=br)
        if r:
            res[c] = r
    if res:
        # v2（2026/10/30）：單檔上限照類別（高股息 50%）、季線比例用還原價
        g['sim'] = {'v': 2, 'to': last, 'monthly': MONTHLY, 'from': START, 'loss': LOSS, 'cap': CAP, 'caps': CAPS, 'slices': SLICES,
                    'temp_mult': TEMP_MULT, 'res': res}
    return bool(res)
