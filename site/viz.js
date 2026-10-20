/* 冷眼 — 圖：大盤之瞳／資產環、熱力圖、對決六角圖、折線圖。只負責畫，數字在 calc.js 算好。 */
import { $, esc, clamp, isNum, fmt } from './core.js';
import { squarify } from './calc.js';

const f1 = (x) => x.toFixed(1);
const polar = (C, r, a) => [C + r * Math.cos(a), C + r * Math.sin(a)];

// ------------------------------------------------------------------ 大盤之瞳／資產環
/**
 * main：主環的分段 [{v, col, name}]；outer：外圈細環（有持股時放市場溫度）；anim：第一次打開的描繪動畫
 * 主環用「一格一格」的分段筆畫，像儀表的 LED 刻度；空的格子也看得到，讀起來像容量表。
 */
export function irisSVG({ main = [], outer = null, anim = false, label = '' }) {
  const C = 160;
  const R = 114, W = 18;
  let ticks = '';
  for (let k = 0; k < 120; k++) {
    const a = (k / 120) * Math.PI * 2 - Math.PI / 2;
    const major = k % 10 === 0;
    const [x1, y1] = polar(C, major ? 143 : 148, a);
    const [x2, y2] = polar(C, 155, a);
    ticks += `<line class="${major ? 'tk mj' : 'tk'}" x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}"/>`;
  }
  const arcs = (segs, r, cls) => {
    const tot = segs.reduce((a, s) => a + s.v, 0);
    if (!(tot > 0)) return '';
    if (segs.length === 1) return `<circle class="${cls}" cx="${C}" cy="${C}" r="${r}" stroke="${segs[0].col}"><title>${esc(segs[0].name)} 100%</title></circle>`;
    let a0 = -Math.PI / 2;
    const gap = 4 / r;
    return segs.map((s) => {
      const ang = (s.v / tot) * Math.PI * 2;
      const st = a0 + gap / 2, en = a0 + ang - gap / 2;
      a0 += ang;
      if (en <= st) return '';
      const [x1, y1] = polar(C, r, st), [x2, y2] = polar(C, r, en);
      return `<path class="${cls}" d="M${f1(x1)} ${f1(y1)}A${r} ${r} 0 ${en - st > Math.PI ? 1 : 0} 1 ${f1(x2)} ${f1(y2)}" stroke="${s.col}"><title>${esc(s.name)} ${(s.v / tot * 100).toFixed(1)}%</title></path>`;
    }).join('');
  };
  const cross = [0, 90, 180, 270].map((deg) => {
    const a = (deg * Math.PI) / 180;
    const [x1, y1] = polar(C, 100, a), [x2, y2] = polar(C, 88, a);
    return `<line class="cr" x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}"/>`;
  }).join('');
  const brk = [45, 135, 225, 315].map((deg) => {
    const a = (deg * Math.PI) / 180;
    const d = 6 * Math.PI / 180;
    const [x1, y1] = polar(C, 96, a - d), [x2, y2] = polar(C, 96, a + d);
    return `<path class="brk" d="M${f1(x1)} ${f1(y1)}A96 96 0 0 1 ${f1(x2)} ${f1(y2)}"/>`;
  }).join('');
  return `<svg class="iris-svg${anim ? ' anim' : ''}" viewBox="0 0 320 320" role="img" aria-label="${esc(label)}">
    <defs>
      <radialGradient id="ig" cx="50%" cy="46%" r="54%"><stop offset="0" stop-color="var(--glow-1)"/><stop offset=".6" stop-color="var(--glow-2)"/><stop offset="1" stop-color="transparent"/></radialGradient>
      <mask id="irv"><circle class="rv" cx="${C}" cy="${C}" r="${R}" pathLength="1" transform="rotate(-90 ${C} ${C})"/>${outer ? `<circle class="rv" cx="${C}" cy="${C}" r="134" pathLength="1" transform="rotate(-90 ${C} ${C})"/>` : ''}</mask>
    </defs>
    <circle cx="${C}" cy="${C}" r="158" fill="url(#ig)"/>
    <g class="bezel">${ticks}</g>
    <path class="north" d="M${C} 2l5.5 8.5h-11z"/>
    <circle class="ring-track" cx="${C}" cy="${C}" r="${R}" stroke-width="${W}"/>
    ${outer ? `<circle class="ring-track thin" cx="${C}" cy="${C}" r="134"/>` : ''}
    <g mask="url(#irv)">${arcs(main, R, 'seg')}${outer ? arcs(outer, 134, 'seg thin') : ''}</g>
    <circle class="reticle" cx="${C}" cy="${C}" r="92"/>${cross}${brk}
  </svg>`;
}

// ------------------------------------------------------------------ 熱力圖
/** 發散色：正（漲、偏多）用紅、負用綠，0 附近是中性灰；max 是顏色飽和的上限 */
export function heatColor(v, max) {
  if (!isNum(v)) return 'var(--heat-na)';
  const t = clamp(Math.abs(v) / max, 0, 1);
  if (t < 0.04) return 'var(--heat-0)';
  const pct = Math.round(16 + 54 * t);
  return `color-mix(in oklab, ${v > 0 ? 'var(--up)' : 'var(--down)'} ${pct}%, var(--heat-base))`;
}
const shortName = (n) => String(n || '').replace(/^(元大|國泰|富邦|中信|群益|復華|永豐|凱基|兆豐|統一|野村|第一金|台新|新光|大華銀|街口|華南永昌|日盛|國票|摩根|貝萊德|聯博|安聯|保德信|富蘭克林華美|富蘭克林|柏瑞|路博邁|PGIM保德信|宏利|德銀遠東|中國信託|鋒裕匯理|瀚亞)/, '') || n;
/**
 * rows：[{c, n, k, val, v}]（v 是上色用的數字），groups：類別名稱
 * 先依類別切大塊（面積＝成交值合計），每塊裡面再依成交值切每一檔。格子之間留 2px 底色間隔。
 */
export function heatHTML(rows, { w, h, mode = 'chg', groups = {}, mini = false }) {
  const max = mode === 'chg' ? 3 : 1.5;
  const byCat = new Map();
  for (const r of rows) {
    if (!(r.val > 0)) continue;
    if (!byCat.has(r.k)) byCat.set(r.k, []);
    byCat.get(r.k).push(r);
  }
  const cats = [...byCat.entries()].map(([k, xs]) => ({ k, v: xs.reduce((a, r) => a + r.val, 0), xs }));
  const blocks = squarify(cats, 0, 0, w, h);
  let html = '';
  for (const b of blocks) {
    const lab = !mini && b.w > 64 && b.h > 56;
    const top = lab ? 16 : 0;
    const tiles = squarify(b.xs.map((r) => ({ ...r, v: r.val })), b.x, b.y + top, b.w, b.h - top);
    if (lab) html += `<span class="hm-cat" style="left:${f1(b.x + 2)}px;top:${f1(b.y + 1)}px;max-width:${f1(b.w - 6)}px">${esc(groups[b.k] || b.k)}</span>`;
    for (const t of tiles) {
      const tw = t.w - 2, th = t.h - 2;
      if (tw < 1 || th < 1) continue;
      const big = !mini ? tw >= 58 && th >= 34 : tw >= 64 && th >= 36;
      const mid = !big && tw >= 34 && th >= 18;
      const val = t.vv;
      const txt = mode === 'chg' ? (isNum(val) ? `${val > 0 ? '+' : ''}${val.toFixed(2)}%` : '—') : (isNum(val) ? `${val > 0 ? '+' : ''}${val.toFixed(2)}` : '—');
      html += `<button class="hm-t${big ? ' big' : mid ? ' mid' : ''}" data-code="${t.c}" style="left:${f1(t.x + 1)}px;top:${f1(t.y + 1)}px;width:${f1(tw)}px;height:${f1(th)}px;background:${heatColor(val, max)}" title="${esc(t.n)} ${t.c}　${mode === 'chg' ? '今日' : '規則分數'} ${txt}　成交值 ${fmt.big(t.val)}元" aria-label="${esc(t.n)} ${txt}">${big ? `<b>${esc(shortName(t.n))}</b><span class="num">${txt}</span>` : mid ? `<span class="num">${t.c}</span>` : ''}</button>`;
    }
  }
  return `<div class="hm" style="height:${h}px">${html}</div>`;
}
export function heatLegend(mode) {
  const max = mode === 'chg' ? 3 : 1.5;
  const stops = [-1, -0.66, -0.33, 0, 0.33, 0.66, 1].map((k) => heatColor(k * max, max));
  const lab = mode === 'chg' ? ['−3% 以下', '0', '+3% 以上'] : ['−1.5 偏空', '0', '+1.5 偏多'];
  return `<div class="hm-leg" aria-hidden="true"><span>${lab[0]}</span><span class="hm-ramp">${stops.map((c) => `<i style="background:${c}"></i>`).join('')}</span><span>${lab[2]}</span></div>`;
}

// ------------------------------------------------------------------ 對決六角圖
/** stats：calc.duelStats() 的結果；colors：每一檔的顏色（固定順序） */
export function hexSVG(stats, colors) {
  const W = 320, H = 290, cx = 160, cy = 148, R = 100;
  const n = 6;
  const ang = (k) => -Math.PI / 2 + (k * Math.PI * 2) / n;
  const pt = (k, p) => [cx + R * p * Math.cos(ang(k)), cy + R * p * Math.sin(ang(k))];
  let grid = '';
  for (const p of [0.25, 0.5, 0.75, 1]) grid += `<polygon class="hx-g${p === 1 ? ' out' : ''}" points="${[0, 1, 2, 3, 4, 5].map((k) => pt(k, p).map(f1).join(',')).join(' ')}"/>`;
  for (let k = 0; k < n; k++) { const [x, y] = pt(k, 1); grid += `<line class="hx-a" x1="${cx}" y1="${cy}" x2="${f1(x)}" y2="${f1(y)}"/>`; }
  const axes = stats.length ? stats[0].axes : [];
  const labs = axes.map((a, k) => {
    const [x, y] = pt(k, 1.17);
    const anchor = Math.abs(x - cx) < 4 ? 'middle' : x > cx ? 'start' : 'end';
    return `<text class="hx-l" x="${f1(x)}" y="${f1(y + 4)}" text-anchor="${anchor}">${esc(a.t)}</text>`;
  }).join('');
  const polys = stats.map((s, i) => {
    const pts = s.axes.map((a, k) => pt(k, isNum(a.p) ? Math.max(0.03, a.p) : 0.03));
    return `<g class="hx-s"><polygon points="${pts.map((p) => p.map(f1).join(',')).join(' ')}" fill="${colors[i]}" fill-opacity=".13" stroke="${colors[i]}" stroke-width="2" stroke-linejoin="round"/>${pts.map(([x, y], k) => `<circle cx="${f1(x)}" cy="${f1(y)}" r="${isNum(s.axes[k].p) ? 4 : 3}" fill="${isNum(s.axes[k].p) ? colors[i] : 'var(--hull)'}" stroke="${isNum(s.axes[k].p) ? 'var(--hull)' : colors[i]}" stroke-width="2"><title>${esc(s.axes[k].t)} ${isNum(s.axes[k].p) ? `贏過 ${(s.axes[k].p * 100).toFixed(0)}% 的 ETF` : '無資料'}</title></circle>`).join('')}</g>`;
  }).join('');
  return `<svg class="hex" viewBox="0 0 ${W} ${H}" role="img" aria-label="六項屬性的百分位比較">${grid}${labs}${polys}</svg>`;
}

// ------------------------------------------------------------------ 折線圖（多條線、十字線與提示框）
function niceStep(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v || 1)));
  const f = v / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}
/**
 * dates：[yyyymmdd]，series：[{name, col, vals, dash, width}]，fmtY：y 軸數字格式，ref：參考線（例如 100）
 * 只畫圖，互動在 bindLines()。
 */
export function linesSVG({ dates, series, fmtY = (v) => fmt.n(v, 0), ref = null, h = 210, area = false }) {
  const W = 360, H = h, pl = 6, pr = 58, pt = 14, pb = 22;
  const all = series.flatMap((s) => s.vals).filter(isNum);
  if (ref != null) all.push(ref);
  if (!all.length) return '';
  let mn = Math.min(...all), mx = Math.max(...all);
  const pad = (mx - mn) * 0.06 || Math.abs(mx) * 0.02 || 1;
  mn -= pad; mx += pad;
  const n = dates.length;
  const X = (i) => pl + (i / Math.max(1, n - 1)) * (W - pl - pr);
  const Y = (v) => pt + (1 - (v - mn) / (mx - mn)) * (H - pt - pb);
  const step = niceStep((mx - mn) / 4);
  let grid = '';
  for (let g = Math.ceil(mn / step) * step; g <= mx; g += step) grid += `<line x1="${pl}" x2="${W - pr}" y1="${f1(Y(g))}" y2="${f1(Y(g))}"/><text x="${W - 4}" y="${f1(Y(g) + 3)}" text-anchor="end" class="ax">${esc(fmtY(g))}</text>`;
  let xl = '';
  const span = n > 1 ? (dates[n - 1] - dates[0]) / 10000 : 0;
  let last = null;
  dates.forEach((d, i) => {
    const key = span > 1.6 ? Math.floor(d / 10000) : Math.floor(d / 100);
    if (key !== last && i > 3 && i < n - 4) {
      const t = span > 1.6 ? String(key) : `${key % 100}月`;
      xl += `<text x="${f1(X(i))}" y="${H - 6}" text-anchor="middle" class="ax">${t}</text>`;
    }
    last = key;
  });
  const path = (vals) => { let d = '', pen = false; vals.forEach((v, i) => { if (!isNum(v)) { pen = false; return; } d += (pen ? 'L' : 'M') + f1(X(i)) + ' ' + f1(Y(v)); pen = true; }); return d; };
  const lines = series.map((s, i) => `<path d="${path(s.vals)}" fill="none" stroke="${s.col}" stroke-width="${s.width || 2}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} stroke-linejoin="round" stroke-linecap="round" data-i="${i}"/>`).join('');
  const ends = series.map((s) => {
    let k = s.vals.length - 1;
    while (k >= 0 && !isNum(s.vals[k])) k--;
    return k >= 0 ? { s, x: X(k), y: Y(s.vals[k]) } : null;
  }).filter(Boolean);
  const dots = ends.map((e) => `<circle cx="${f1(e.x)}" cy="${f1(e.y)}" r="3.5" fill="${e.s.col}" stroke="var(--hull)" stroke-width="2"/>`).join('');
  const refl = ref != null ? `<line class="ref" x1="${pl}" x2="${W - pr}" y1="${f1(Y(ref))}" y2="${f1(Y(ref))}"/>` : '';
  return `<svg class="lines" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map((s) => s.name).join('、'))}" data-n="${n}" data-pl="${pl}" data-pr="${pr}" data-w="${W}" data-mn="${mn}" data-mx="${mx}">
    <g class="grid">${grid}</g><g>${xl}</g>${refl}${lines}${dots}
    <g class="xh" opacity="0"><line class="xl" y1="${pt}" y2="${H - pb}"/>${series.map((s) => `<circle r="4" fill="${s.col}" stroke="var(--hull)" stroke-width="2"/>`).join('')}</g>
    <rect class="hit" x="${pl}" y="${pt}" width="${W - pl - pr}" height="${H - pt - pb}" fill="transparent"/>
  </svg>`;
}
/** 折線圖的互動：手指或滑鼠移動時顯示當天每條線的數值 */
export function bindLines(box, { dates, series, fmtV } = {}) {
  const svg = $('svg.lines', box);
  if (!svg) return;
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  box.appendChild(tip);
  const W = +svg.dataset.w, pl = +svg.dataset.pl, pr = +svg.dataset.pr, n = +svg.dataset.n;
  const vb = svg.viewBox.baseVal;
  const hit = $('.hit', svg), xh = $('.xh', svg);
  const a = +svg.dataset.mn, b = +svg.dataset.mx;   // 和 linesSVG 用同一個刻度
  const ys = (v) => 14 + (1 - (v - a) / (b - a)) * (vb.height - 14 - 22);
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const cx = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) * (W / r.width);
    const i = clamp(Math.round(((cx - pl) / (W - pl - pr)) * (n - 1)), 0, n - 1);
    const x = pl + (i / Math.max(1, n - 1)) * (W - pl - pr);
    xh.setAttribute('opacity', 1);
    const ln = $('.xl', xh);
    ln.setAttribute('x1', x); ln.setAttribute('x2', x);
    [...xh.querySelectorAll('circle')].forEach((c, k) => {
      const v = series[k].vals[i];
      c.setAttribute('cx', x);
      c.setAttribute('cy', isNum(v) ? ys(v) : -99);
    });
    tip.hidden = false;
    tip.innerHTML = `<div class="d num">${fmt.dy(dates[i])}</div>${series.map((s) => `<div class="row"><span><i style="background:${s.col}"></i>${esc(s.name)}</span><b class="num">${isNum(s.vals[i]) ? esc(fmtV(s.vals[i], s)) : '—'}</b></div>`).join('')}`;
    const left = (x / W) * r.width;
    tip.style.left = clamp(left + 12 + tip.offsetWidth > r.width ? left - tip.offsetWidth - 12 : left + 12, 4, r.width - tip.offsetWidth - 4) + 'px';
    tip.style.top = '6px';
  };
  const leave = () => { xh.setAttribute('opacity', 0); tip.hidden = true; };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', leave);
  hit.addEventListener('touchmove', move, { passive: true });
  hit.addEventListener('touchend', () => setTimeout(leave, 1400));
}
