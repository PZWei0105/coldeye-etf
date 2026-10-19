"""把引擎結果寫成白話摘要。固定句型、不加形容詞，同樣的結果永遠產生同樣的文字。"""

PLUS = {
    'trend': '價格站在主要均線之上',
    'momentum': '近期動能向上',
    'flows': '外資與投信買超',
    'premium': '市價低於淨值',
    'yield': '配息殖利率在近兩年偏高的位置（相對便宜）',
}
MINUS = {
    'trend': '價格落在主要均線之下',
    'momentum': '近期動能轉弱',
    'flows': '外資與投信賣超或融資逆勢增加',
    'premium': '溢價偏高',
    'yield': '配息殖利率在近兩年偏低的位置（相對貴）',
}


def _regime_phrase(comp, plus):
    if comp['src'] == 'ust':
        return '美債殖利率下降' if plus else '美債殖利率上升'
    return '大盤環境偏多' if plus else '大盤環境轉弱'


def summarize(name, r):
    comps = r.get('components') or []
    trend = next((c for c in comps if c['key'] == 'trend'), None)
    t = trend['score'] if trend else 0
    if t >= 1.5:
        lead = '多頭排列、趨勢向上'
    elif t >= 0.5:
        lead = '趨勢偏多'
    elif t > -0.5:
        lead = '沒有明確趨勢，在區間內整理'
    elif t > -1.5:
        lead = '趨勢偏弱'
    else:
        lead = '空頭排列、趨勢向下'
    plus, minus = [], []
    for c in comps:
        if c['key'] == 'trend':
            continue
        if c['score'] >= 1:
            plus.append(_regime_phrase(c, True) if c['key'] == 'regime' else PLUS[c['key']])
        elif c['score'] <= -1:
            minus.append(_regime_phrase(c, False) if c['key'] == 'regime' else MINUS[c['key']])
    parts = [f'{name}目前{lead}。']
    if plus and minus:
        parts.append(f'加分的是{"、".join(plus)}；扣分的是{"、".join(minus)}。')
    elif plus:
        parts.append(f'其他面向也支持：{"、".join(plus)}。')
    elif minus:
        parts.append(f'需要留意：{"、".join(minus)}。')
    label = {1: '偏多', 0: '中性', -1: '偏空'}[r['stance']]
    conf = f'（信心 {r["conf"]}）' if r.get('conf') is not None else ''
    adv = r.get('advice') or {}
    parts.append(f'規則判斷{label}{conf}，建議：{adv.get("action", "—")}。')
    return ''.join(parts)
