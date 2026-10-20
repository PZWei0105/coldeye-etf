"""規則引擎：同樣的資料，每次得出同樣的觀點。所有門檻寫死在這裡，App 的「規則說明」頁照抄這份。

時間尺度：約 1 個月（20 個交易日）。
"""
import math

from .series import CATEGORY_NAMES, i2d

VERSION = '1.1'

WEIGHTS = {
    'trend': 0.30,     # 趨勢
    'momentum': 0.20,  # 動能
    'flows': 0.15,     # 籌碼
    'regime': 0.10,    # 大環境
    'premium': 0.10,   # 折溢價（進場價格品質）
    'yield': 0.15,     # 殖利率位階（只有有配息紀錄的 ETF）
}
BULL_TH = 0.5
BEAR_TH = -0.5
WEAK_EDGE = 0.02   # 類別回測命中率比基準高不到 2 個百分點，視為沒有優勢
HORIZON = 20

COMPONENT_NAMES = {
    'trend': '趨勢', 'momentum': '動能', 'flows': '籌碼', 'regime': '大環境',
    'premium': '折溢價', 'yield': '殖利率位階',
}

# 部位訊號（給已持有或準備加碼的人看；不含個人部位資訊，個人化部分在 App 內用固定公式計算）
CHANDELIER_N = 22      # 移動防守線：近 22 個交易日最高收盤
CHANDELIER_K = 3.0     # 減 3 倍 ATR
EXTENDED_ATR = 2.0     # 收盤高於月線超過 2 倍 ATR 視為漲多
POS_NAMES = {'add': '可加碼', 'wait': '漲多分批', 'hold': '續抱', 'caution': '先不加碼', 'trim': '減碼'}


def _sgn(x, band=0.0):
    if x is None:
        return None
    if x > band:
        return 1
    if x < -band:
        return -1
    return 0


def _mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def _clamp(x, lo, hi):
    return max(lo, min(hi, x))


def fmt_px(x):
    if x is None:
        return '—'
    return f'{x:,.2f}'


def pct(x, digits=1, sign=True):
    if x is None:
        return '—'
    s = f'{x * 100:+.{digits}f}%' if sign else f'{x * 100:.{digits}f}%'
    return s


def lots(shares):
    """股數 → 張（1 張 = 1000 股），帶正負號與萬張單位。"""
    if shares is None:
        return '—'
    z = shares / 1000
    if abs(z) >= 10000:
        return f'{z / 10000:+.2f} 萬張'
    return f'{z:+,.0f} 張'


# ---------------------------------------------------------------- 各面向

def comp_trend(s, i):
    c, m20, m60, m120 = s.c[i], s.ma20[i], s.ma60[i], s.ma120[i]
    if m60 is None:
        return None
    parts = []
    s1 = _sgn(c / m60 - 1, 0.005)
    s2 = _sgn(m20 / m60 - 1, 0.002) if m20 else None
    slope = None
    if i >= 20 and s.ma60[i - 20]:
        slope = m60 / s.ma60[i - 20] - 1
    s3 = _sgn(slope, 0.01)
    s4 = _sgn(c / m120 - 1, 0.005) if m120 else None
    score = 2 * _mean([s1, s2, s3, s4])
    pos = []
    pos.append(('站上' if s1 == 1 else '跌破' if s1 == -1 else '貼著') + f'季線（60 日均 {fmt_px(m60)}）')
    if m120:
        pos.append(('站上' if s4 == 1 else '跌破' if s4 == -1 else '貼著') + f'半年線（{fmt_px(m120)}）')
    parts.append('、'.join(pos))
    if slope is not None:
        parts.append(f'季線近 20 日{"上升" if slope > 0 else "下降"} {abs(slope) * 100:.1f}%')
    if s2 is not None:
        parts.append('月線在季線之上' if s2 == 1 else '月線在季線之下' if s2 == -1 else '月線與季線糾結')
    return {'key': 'trend', 'score': score, 'text': '；'.join(parts) + '。',
            'facts': {'ma20': m20, 'ma60': m60, 'ma120': m120, 'slope60': slope}, 'src': 'price'}


def comp_momentum(s, i):
    vol = s.vol20[i]
    r20, r60 = s.ret(i, 20), s.ret(i, 60)
    h = s.macd_hist[i]
    if r20 is None or vol is None or h is None:
        return None
    z20 = r20 / (vol * math.sqrt(20)) if vol > 0 else 0
    z60 = r60 / (vol * math.sqrt(60)) if (vol > 0 and r60 is not None) else None
    m1 = 1 if h > 0 else -1
    m2 = _sgn(z20, 0.5)
    m3 = _sgn(z60, 0.5) if z60 is not None else None
    score = 2 * _mean([m1, m2, m3])
    txt = f'近 20 日 {pct(r20)}'
    if r60 is not None:
        txt += f'、近 60 日 {pct(r60)}'
    txt += f'；MACD 柱狀體{"翻正" if h > 0 else "為負"}'
    r = s.rsi14[i]
    if r is not None:
        txt += f'；RSI {r:.0f}'
        if r >= 75:
            txt += '（短線過熱）'
        elif r <= 25:
            txt += '（短線超賣）'
    return {'key': 'momentum', 'score': score, 'text': txt + '。',
            'facts': {'r20': r20, 'r60': r60, 'rsi': r, 'macd_hist': h}, 'src': 'price'}


def comp_flows(s, i):
    lo = i - 19
    if lo < 0:
        return None
    ff = s.flow_f[lo:i + 1]
    ft = s.flow_t[lo:i + 1]
    have = sum(1 for x in ff if x is not None)
    if have < 14:
        return None
    net = sum(x or 0 for x in ff) + sum(x or 0 for x in ft)
    volsum = sum(s.v[lo:i + 1]) or 1
    ratio = net / volsum
    f1 = 0
    if ratio > 0.10:
        f1 = 2
    elif ratio > 0.03:
        f1 = 1
    elif ratio < -0.10:
        f1 = -2
    elif ratio < -0.03:
        f1 = -1
    txt = f'外資＋投信近 20 日{"買超" if net >= 0 else "賣超"} {lots(abs(net)).lstrip("+")}（約占成交量 {abs(ratio) * 100:.1f}%）'
    f2 = 0
    mb_now, mb_then = s.margin[i], s.margin[lo] if lo >= 0 else None
    margin_note = None
    if mb_now is not None and mb_then:
        avg_lots = (s.vavg20[i] or 0) / 1000
        material = avg_lots > 0 and mb_now / avg_lots > 0.5
        mchg = mb_now / mb_then - 1
        r20 = s.ret(i, 20) or 0
        if material:
            if mchg > 0.15 and r20 < 0:
                f2 = -1
                margin_note = f'融資餘額 20 日增加 {mchg * 100:.0f}% 但價格下跌，散戶槓桿逆勢加碼'
            elif mchg < -0.10 and r20 > 0:
                f2 = 1
                margin_note = f'融資餘額 20 日減少 {abs(mchg) * 100:.0f}% 而價格上漲，籌碼較乾淨'
            else:
                margin_note = f'融資餘額 20 日 {pct(mchg, 0)}'
    if margin_note:
        txt += '；' + margin_note
    score = _clamp(f1 + f2, -2, 2)
    tag = 'margin_up' if f2 < 0 and f1 >= 0 else 'margin_down' if f2 > 0 and f1 <= 0 else ('buy' if net >= 0 else 'sell')
    return {'key': 'flows', 'score': score, 'text': txt + '。',
            'facts': {'net20': net, 'ratio': ratio, 'margin': mb_now, 'tag': tag}, 'src': 'flows'}


def comp_regime(s, i, ctx):
    d = s.dates[i]
    if s.cat == 'fut':
        return None
    if s.cat == 'bond':
        y = ctx.get('us20y_before')(d) if ctx.get('us20y_before') else None
        if not y:
            return None
        now, ago20, ago60 = y
        if now is None or ago20 is None:
            return None
        d20 = now - ago20
        d60 = (now - ago60) if ago60 is not None else None
        r1 = -_sgn(d20, 0.15)
        r2 = -_sgn(d60, 0.25) if d60 is not None else None
        score = 2 * _mean([r1, r2])
        txt = f'美國 20 年期公債殖利率 {now:.2f}%，近一個月{"上升" if d20 > 0 else "下降"} {abs(d20):.2f} 個百分點'
        txt += '（殖利率下降對長天期債券 ETF 有利）。'
        return {'key': 'regime', 'score': score, 'text': txt, 'facts': {'us20y': now, 'd20': d20},
                'src': 'ust'}
    if s.foreign:
        return None
    t = ctx.get('taiex_at')(d) if ctx.get('taiex_at') else None
    if not t:
        return None
    close, m60, m60_ago = t
    if m60 is None:
        return None
    r1 = _sgn(close / m60 - 1, 0.005)
    r2 = _sgn(m60 / m60_ago - 1, 0.01) if m60_ago else None
    score = 2 * _mean([r1, r2])
    inv = s.cat == 'inv'
    if inv:
        score = -score
    txt = f'加權指數 {close:,.0f}，{"在" if r1 >= 0 else "跌破"}季線（{m60:,.0f}）{"之上" if r1 >= 0 else ""}'
    if r2 is not None:
        txt += f'、季線{"上彎" if r2 > 0 else "下彎" if r2 < 0 else "走平"}'
    if inv:
        txt += '；反向型 ETF 與大盤方向相反'
    return {'key': 'regime', 'score': score, 'text': txt + '。', 'facts': {'taiex': close, 'ma60': m60},
            'src': 'taiex'}


def premium_band(s):
    if s.cat in ('overseas', 'bond', 'fut') or s.foreign:
        return 1.0, 2.0
    return 0.5, 1.0


def comp_premium(s, i, live=None):
    """live: {'premium': %, 'nav': 數字, 'time': 'HH:MM', 'kind': 'est'|'official'}。回測時沒有。"""
    p = None
    info = None
    if live and live.get('premium') is not None:
        p = live['premium']
        info = live
    elif s.nav[i]:
        p = (s.raw_c[i] / s.nav[i] - 1) * 100
        info = {'nav': s.nav[i], 'kind': 'official'}
    if p is None:
        return None
    warn, bad = premium_band(s)
    if p > bad:
        sc = -2
    elif p > warn:
        sc = -1
    elif p < -warn:
        sc = 1
    else:
        sc = 0
    kind = '投信預估淨值' if info.get('kind') == 'est' else '官方淨值'
    word = '溢價' if p >= 0 else '折價'
    txt = f'市價 {fmt_px(s.raw_c[i])} 相對{kind} {fmt_px(info.get("nav"))}，{word} {abs(p):.2f}%'
    if sc <= -1:
        txt += f'（超過 {warn:.1f}%，現在買等於多付錢）'
    elif sc == 1:
        txt += '（低於淨值，買進價格品質較好，但也要留意折價原因）'
    else:
        txt += '（在正常範圍）'
    return {'key': 'premium', 'score': sc, 'text': txt + '。', 'facts': {'premium': p, **(info or {})},
            'src': 'mis' if info.get('kind') == 'est' else 'nav'}


def comp_yield(s, i, hist_cache):
    d = s.dates[i]
    n_div = sum(1 for x in s.divs if d - 20000 < x[0] <= d)
    if n_div < 2 or not s.ttm[i]:
        return None
    ttm, y = s.ttm[i], s.yld[i]
    # 近兩年（約 500 個交易日）每 5 天取一個樣本，看今天的殖利率排在哪裡
    vals = [s.yld[k] for k in range(max(0, i - 500), i + 1, 5) if s.yld[k]]
    if len(vals) < 40:
        return None
    pctl = sum(1 for v in vals if v < y) / len(vals)
    if pctl >= 0.9:
        sc = 2
    elif pctl >= 0.7:
        sc = 1
    elif pctl <= 0.1:
        sc = -2
    elif pctl <= 0.3:
        sc = -1
    else:
        sc = 0
    txt = (f'近 12 個月配息合計 {ttm:.2f} 元，以收盤價計配息殖利率 {y:.2f}%，'
           f'位於近兩年的 {pctl * 100:.0f}% 分位（{"偏高＝相對便宜" if sc > 0 else "偏低＝相對貴" if sc < 0 else "中間"}）。')
    return {'key': 'yield', 'score': sc, 'text': txt, 'facts': {'ttm': ttm, 'yield': y, 'pctl': pctl},
            'src': 'div'}


# ---------------------------------------------------------------- 關鍵價位

def key_levels(s, i):
    c = s.c[i]
    atr = s.atr14[i] or (c * 0.01)
    lows, highs = [], []
    from .indicators import swing_points
    sh, sl = swing_points(s.h, s.l, i, lookback=120, k=3)
    for k, v in sl:
        if v < c:
            lows.append((v, '前波低點', 2))
    for k, v in sh:
        if v > c:
            highs.append((v, '前波高點', 2))
    for arr, lab, w in ((s.ma20, '月線', 1), (s.ma60, '季線', 3), (s.ma120, '半年線', 2)):
        v = arr[i]
        if v:
            (lows if v < c else highs).append((v, lab, w))
    for arr, lab in ((s.lo20, '20 日低點'), (s.lo60, '60 日低點')):
        if arr[i] and arr[i] < c:
            lows.append((arr[i], lab, 1))
    for arr, lab in ((s.hi20, '20 日高點'), (s.hi60, '60 日高點')):
        if arr[i] and arr[i] > c:
            highs.append((arr[i], lab, 1))
    if s.hi252[i] and s.hi252[i] > c and s.hi252[i] < c * 1.2:
        highs.append((s.hi252[i], '一年高點', 2))

    def cluster(levels, reverse):
        levels = sorted(levels, key=lambda x: x[0], reverse=reverse)
        out = []
        for v, lab, w in levels:
            if out and abs(out[-1][0] - v) < 0.6 * atr:
                if w > out[-1][2]:
                    out[-1] = (v, lab, w)
                continue
            out.append((v, lab, w))
        return out

    sup = cluster(lows, reverse=True)       # 由近到遠
    res = cluster(highs, reverse=False)
    return sup, res, atr


def tick_round(p):
    """ETF 升降單位：未滿 50 元為 0.01 元，50 元以上為 0.05 元。"""
    if p is None:
        return None
    t = 0.01 if p < 50 else 0.05
    return round(round(p / t) * t, 2)


def _lvl(v, lab, s, i):
    # 還原價 → 實際價格（最近一次配息／分割之後的價格與還原價相同）
    return {'price': tick_round(v * s.raw_price_factor(i)), 'label': lab}


# ---------------------------------------------------------------- 部位訊號

def defense_line(s, i):
    """移動防守線（吊燈式出場）：近 22 個交易日最高收盤 − 3 倍 ATR，回傳還原價。
    創新高時跟著往上移；下跌時多半停在原地，但波動（ATR）變大、或高點已超過 22 個交易日時也會往下移。
    收盤跌破代表這段上漲已經中斷。"""
    atr = s.atr14[i]
    if atr is None or i < CHANDELIER_N - 1:
        return None
    window = [x for x in s.c[i - CHANDELIER_N + 1:i + 1] if x is not None]
    if not window:
        return None
    return max(window) - CHANDELIER_K * atr


def position_signal(s, i, stance, premium, fkeys):
    """部位訊號，依序判斷（先符合先決定）：
    1. 觀點偏空且收盤跌破移動防守線 → trim 減碼
    2. 觀點偏空、收盤跌破防守線、處置／注意中、或溢價超過警戒 → caution 先不加碼
    3. 觀點偏多但漲多（RSI ≥ 75、爆量、或高於月線 2 倍 ATR）→ wait 漲多分批
    4. 觀點偏多 → add 可加碼
    5. 其他（中性）→ hold 續抱
    """
    fkeys = set(fkeys or ())
    c = s.c[i]
    dl = defense_line(s, i)
    warn, _ = premium_band(s)
    m20, atr = s.ma20[i], s.atr14[i]
    ext = bool(m20 and atr and c > m20 + EXTENDED_ATR * atr)
    hot = ext or 'overbought' in fkeys or 'volume_spike' in fkeys
    below = dl is not None and c < dl
    if stance < 0 and below:
        key = 'trim'
    elif stance < 0 or below or fkeys & {'disposal', 'notice'} or (premium is not None and premium > warn):
        key = 'caution'
    elif stance > 0 and hot:
        key = 'wait'
    elif stance > 0:
        key = 'add'
    else:
        key = 'hold'
    return {'key': key, 'dl': dl, 'hot': hot, 'ext': ext, 'below': below}


# ---------------------------------------------------------------- 主函式

def analyze(s, i, ctx, live=None, hist_cache=None, full=True):
    hist_cache = hist_cache if hist_cache is not None else {}
    comps = []
    for fn in (lambda: comp_trend(s, i), lambda: comp_momentum(s, i), lambda: comp_flows(s, i),
               lambda: comp_regime(s, i, ctx), lambda: comp_premium(s, i, live),
               lambda: comp_yield(s, i, hist_cache)):
        r = fn()
        if r is not None:
            r['name'] = COMPONENT_NAMES[r['key']]
            r['weight'] = WEIGHTS[r['key']]
            comps.append(r)
    if not any(c['key'] == 'trend' for c in comps):
        return None
    wsum = sum(c['weight'] for c in comps)
    score = sum(c['weight'] * c['score'] for c in comps) / wsum
    stance = 1 if score >= BULL_TH else -1 if score <= BEAR_TH else 0
    coverage = wsum / sum(WEIGHTS.values())

    flags = []
    r = s.rsi14[i]
    if r is not None and r >= 75:
        flags.append({'key': 'overbought', 'text': f'RSI {r:.0f}，短線過熱'})
    if r is not None and r <= 25:
        flags.append({'key': 'oversold', 'text': f'RSI {r:.0f}，短線超賣'})
    vavg = s.vavg20[i - 1] if i > 0 else None
    if vavg and s.v_adj[i] > 3 * vavg and (s.ret(i, 1) or 0) > 0.02:
        flags.append({'key': 'volume_spike', 'text': f'成交量是 20 日均量的 {s.v_adj[i] / vavg:.1f} 倍，追價熱度高'})
    if s.cat in ('lev', 'inv'):
        flags.append({'key': 'leverage', 'text': '槓桿／反向型每日重新平衡，長期持有會偏離指數，只適合短線'})
    if s.valavg20[i] is not None and s.valavg20[i] < 10_000_000:
        flags.append({'key': 'illiquid', 'text': f'近 20 日平均成交值僅約 {s.valavg20[i] / 1e6:.1f} 百萬元，買賣價差可能偏大'})
    for f in (ctx.get('extra_flags') or {}).get(s.code, []):
        flags.append(f)

    edge = ((ctx.get('cat_edge') or {}).get(s.cat) or {}).get(stance) if stance != 0 else None
    if edge and edge['delta'] < WEAK_EDGE:
        cname = CATEGORY_NAMES.get(s.cat, s.cat)
        word = '偏多' if stance > 0 else '偏空'
        always = '一直看多' if stance > 0 else '一直看空'
        flags.append({'key': 'weak_edge',
                      'text': f'過去回測中，{cname} ETF 的{word}訊號沒有比{always}更準'
                              f'（{edge["hit"] * 100:.0f}% 對 {edge["base"] * 100:.0f}%），這個觀點請當參考就好'})

    if stance != 0:
        agree = sum(1 for c in comps if c['score'] * stance > 0) / len(comps)
        strength = _clamp((abs(score) - 0.5) / 1.0, 0, 1)
        conf = 35 + 35 * strength + 30 * agree
        if stance > 0 and any(f['key'] in ('overbought', 'volume_spike', 'crowding', 'social_heat') for f in flags):
            conf -= 8
        if stance < 0 and any(f['key'] == 'oversold' for f in flags):
            conf -= 8
        if coverage < 0.6:
            conf -= 10
        if any(f['key'] in ('disposal', 'notice') for f in flags):
            conf -= 10
        if any(f['key'] == 'weak_edge' for f in flags):
            conf -= 15
        conf = int(round(_clamp(conf, 20, 95)))
    else:
        conf = None

    prem_now = next((c['facts'].get('premium') for c in comps if c['key'] == 'premium'), None)
    pos = position_signal(s, i, stance, prem_now, [f['key'] for f in flags])

    result = {'stance': stance, 'score': round(score, 3), 'conf': conf, 'coverage': round(coverage, 2),
              'ps': pos['key']}
    if not full:
        return result

    sup, res, atr = key_levels(s, i)
    c = s.c[i]
    result['components'] = [{k: v for k, v in comp.items() if k != 'facts'} | {'facts': _round_facts(comp['facts'])}
                            for comp in comps]
    result['flags'] = flags
    result['levels'] = {
        'support': [_lvl(v, lab, s, i) for v, lab, _ in sup[:2]],
        'resistance': [_lvl(v, lab, s, i) for v, lab, _ in res[:2]],
    }
    # 作廢線：離現價至少 1 個 ATR 的第一個支撐／壓力
    inval = None
    if stance > 0:
        cand = [x for x in sup if c - x[0] >= atr]
        inval = cand[0] if cand else (c - 2 * atr, '2 倍 ATR', 0)
    elif stance < 0:
        cand = [x for x in res if x[0] - c >= atr]
        inval = cand[0] if cand else (c + 2 * atr, '2 倍 ATR', 0)
    result['levels']['invalid'] = _lvl(inval[0], inval[1], s, i) if inval else None
    result['levels']['turn_bull'] = _lvl(res[0][0], res[0][1], s, i) if res else None
    result['levels']['turn_bear'] = _lvl(sup[0][0], sup[0][1], s, i) if sup else None
    result['risk'] = {
        'vol_ann': round(s.vol20[i] * math.sqrt(252) * 100, 1) if s.vol20[i] else None,
        'atr': round(atr * s.raw_price_factor(i), 4),
        'dd_52w': round((c / s.hi252[i] - 1) * 100, 1) if s.hi252[i] else None,
        'pos_52w': round((c - s.lo252[i]) / (s.hi252[i] - s.lo252[i]) * 100, 0)
        if s.hi252[i] and s.lo252[i] and s.hi252[i] > s.lo252[i] else None,
        'value20': round(s.valavg20[i]) if s.valavg20[i] else None,
    }
    if stance > 0 and result['levels']['invalid']:
        tgt = next((x for x in res if x[0] - c >= atr), None)
        down = c - inval[0]
        if tgt and down > 0:
            result['risk']['rr'] = round((tgt[0] - c) / down, 2)
    pull = None
    if stance > 0 and inval:
        m20 = s.ma20[i]
        floor = inval[0] + 0.5 * atr
        if m20 and floor < m20 < c:
            pull = {'price': tick_round(m20 * s.raw_price_factor(i)), 'label': '月線附近'}
        else:
            pull = {'price': tick_round((c + inval[0]) / 2 * s.raw_price_factor(i)), 'label': '現價與作廢線中間'}
    result['levels']['pullback'] = pull
    f_raw = s.raw_price_factor(i)
    result['position'] = {
        'key': pos['key'], 'name': POS_NAMES[pos['key']],
        'dl': tick_round(pos['dl'] * f_raw) if pos['dl'] is not None else None,
        'hot': pos['hot'], 'ext': pos['ext'], 'below': pos['below'],
        'rsi': round(s.rsi14[i], 1) if s.rsi14[i] is not None else None,
        'ma20': tick_round(s.ma20[i] * f_raw) if s.ma20[i] else None,
    }
    result['advice'] = advice(s, i, result, live)
    return result


def _round_facts(f):
    out = {}
    for k, v in (f or {}).items():
        if isinstance(v, float):
            out[k] = round(v, 4)
        else:
            out[k] = v
    return out


def advice(s, i, r, live):
    stance, conf = r['stance'], r['conf']
    lv = r['levels']
    flags = {f['key'] for f in r['flags']}
    prem = next((c for c in r['components'] if c['key'] == 'premium'), None)
    p = prem['facts'].get('premium') if prem else None
    warn, _ = premium_band(s)
    inv = lv.get('invalid')
    r1 = lv['resistance'][0] if lv['resistance'] else None
    r2 = lv['resistance'][1] if len(lv['resistance']) > 1 else None
    tail = ''
    if 'leverage' in flags:
        tail = '槓桿／反向型只適合短線操作，不宜長抱。'

    def px(x):
        return fmt_px(x['price']) if x else '—'

    pos = r.get('position') or {}
    pk = pos.get('key')
    dl = fmt_px(pos.get('dl')) if pos.get('dl') is not None else '—'
    restricted = bool(flags & {'disposal', 'notice'})

    if stance > 0:
        if p is not None and p > warn:
            return {'action': '等溢價收斂再買',
                    'detail': f'方向偏多，但現在溢價 {p:.2f}%，等回到 {warn:.1f}% 以內再分批；收盤跌破 {px(inv)} 元觀點作廢。' + tail}
        if restricted:
            return {'action': '暫緩買進',
                    'detail': '方向偏多，但被列為注意／處置標的，交易受限，先觀察；解除後再看。' + tail}
        if pk == 'caution' and pos.get('below'):
            return {'action': '偏多但急跌，先等站穩',
                    'detail': f'價格跌破移動防守線 {dl} 元，等收盤站回再分批；收盤跌破 {px(inv)} 元觀點作廢。' + tail}
        if pk == 'wait':
            pb = lv.get('pullback')
            why = '短線漲多' if pos.get('ext') and 'overbought' not in flags else '短線過熱'
            return {'action': '偏多但漲多，分批進場',
                    'detail': f'{why}，可先買預定金額的三分之一，其餘等拉回 {px(pb)} 元（{pb["label"] if pb else ""}）再補；'
                              f'收盤跌破 {px(inv)} 元觀點作廢。' + tail}
        if conf is not None and conf >= 70:
            tgt = f'參考目標 {px(r1)}' + (f'／{px(r2)}' if r2 else '') + ' 元；' if r1 else ''
            return {'action': '可分批布局',
                    'detail': f'可分 2～3 批進場，{tgt}收盤跌破 {px(inv)} 元觀點作廢、出場。' + tail}
        return {'action': '小部位試單',
                'detail': f'訊號偏多但把握度普通，只用小部位；收盤跌破 {px(inv)} 元出場。' + tail}
    if stance < 0:
        if pk == 'trim':
            return {'action': '偏空，持有者依紀律減碼',
                    'detail': f'觀點偏空，而且收盤已跌破移動防守線 {dl} 元；新資金先不進場，已持有者可依紀律減碼。'
                              f'收盤站上 {px(inv)} 元觀點作廢。' + tail}
        return {'action': '暫不買進',
                'detail': f'新資金先不進場；已持有者若收盤跌破移動防守線 {dl} 元再考慮減碼，收盤站上 {px(inv)} 元觀點作廢。' + tail}
    if pk == 'caution' and pos.get('below'):
        return {'action': '觀望，先別加碼',
                'detail': f'收盤跌破移動防守線 {dl} 元，前一段上漲已經中斷；收盤站上 {px(lv.get("turn_bull"))} 元轉偏多、'
                          f'跌破 {px(lv.get("turn_bear"))} 元轉偏空。' + tail}
    return {'action': '觀望',
            'detail': f'收盤站上 {px(lv.get("turn_bull"))} 元轉偏多、跌破 {px(lv.get("turn_bear"))} 元轉偏空，條件出現前不急著動作。' + tail}


def category_name(cat):
    return CATEGORY_NAMES.get(cat, cat)


def date_str(d):
    x = i2d(d)
    return f'{x.month}/{x.day}'
