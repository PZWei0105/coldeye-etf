/* 冷眼 — ETF 透視：ETF 裡面裝了哪些公司、你的 ETF 合起來其實押了誰、兩檔重疊多少、成分股的官方資料。
   資料：投信投顧公會「基金投資明細」（各投信依法申報：每月前十大、每季占淨資產 1% 以上），
        成分股的收盤、本益比、殖利率、股價淨值比、月營收來自證交所、櫃買中心（收盤後每一輪檢查，直到是最新交易日的），
        盤中價格來自證交所基本市況報導（stockq.json，後台盤中約 5 分鐘一輪）。每一個數字都標日期或時間。
   冷眼只整理官方資料、不評價個股、不做買賣建議。門檻在 XR；改了要同步設定頁的說明（xrayRulesHTML）。 */
import { $, $$, esc, isNum, S, settings, fmt, ICON, getJSON, quote, money, toast, bus, today, dayTag } from './core.js';
import { openModal, closeModal } from './forms.js';
import * as FX from './fx.js';

export const XR = {
  oneCo: 0.2,       // 穿透之後，單一公司超過總資產 20%：集中
  overlapHi: 0.5,   // 兩檔（或這檔和你現有的股票部位）重疊 50% 以上：高度重疊
  staleQ: 2,        // 每季明細比每月前十大舊 2 個月以內，透視用每季（比較完整）
  top: 10,          // 透視列出前 10 家
};
const KIND = { tse: '上市', otc: '上櫃', f: '國外', b: '債券', fund: '基金', o: '其他', emg: '興櫃', fut: '期貨' };
const SRC = {
  m: { n: '投信投顧公會：基金投資明細（每月前十大）', u: 'https://www.sitca.org.tw/ROC/Industry/IN2629.aspx' },
  q: { n: '投信投顧公會：基金投資明細（每季 1% 以上）', u: 'https://www.sitca.org.tw/ROC/Industry/IN2630.aspx' },
  twseClose: { n: '證交所：每日收盤行情', u: 'https://www.twse.com.tw/zh/trading/historical/mi-index.html' },
  tpexClose: { n: '櫃買中心：上櫃股票每日收盤行情', u: 'https://www.tpex.org.tw/zh-tw/mainboard/trading/info/pricing.html' },
  twse: { n: '證交所：個股日本益比、殖利率及股價淨值比', u: 'https://www.twse.com.tw/zh/trading/historical/bwibbu-day.html' },
  tpex: { n: '櫃買中心：上櫃股票個股本益比、殖利率、股價淨值比', u: 'https://www.tpex.org.tw/zh-tw/mainboard/trading/info/pe-ratio.html' },
  rev: { n: '公開資訊觀測站：每月營業收入', u: 'https://mops.twse.com.tw/mops/web/t21sc04_ifrs' },
  mis: { n: '證交所：基本市況報導（盤中即時行情）', u: 'https://mis.twse.com.tw/stock/index.jsp' },
};
const pu = (x, d = 1) => (isNum(x) ? `${(x * 100).toFixed(d)}%` : '—');
const pcS = (x, d = 2) => (isNum(x) ? `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(d)}%` : '—');
const ymT = (p) => { const t = String(p || ''); return /^\d{6}$/.test(t) ? `${t.slice(0, 4)}/${t.slice(4)}` : '—'; };
const keyOf = (r) => r[0] || r[1];        // 有代號用代號（股票代號或 ISIN），沒有用名稱
const isStock = (k) => k === 'tse' || k === 'otc' || k === 'f';

// ------------------------------------------------------------------ 資料
// 後台有新的一批（收盤資料、成分股明細或個股資料換了）時全部作廢、下次要用時重抓（app.js 的資料同步發 'batch'／'holddata'）。
// gen：作廢之前就發出去、之後才回來的舊請求，不會把舊資料寫回快取。
S.hold = S.hold || {};
let idxP = null, stocksP = null, sqP = null, gen = 0;
export function resetXray() {
  gen += 1;
  S.hold = {};
  S.holdIdx = null;
  S.stocks = null;
  idxP = null;
  stocksP = null;
  ltKey = '';
  ltVal = null;
}
bus.on((what) => { if (what === 'batch' || what === 'holddata') { resetXray(); refreshCard(); } });
export function ensureHoldIdx() {
  if (S.holdIdx) return Promise.resolve(S.holdIdx);
  const g = gen;
  if (!idxP) idxP = getJSON('hold.json').then((d) => { if (g === gen) S.holdIdx = d; return d; }).catch(() => { if (g === gen) idxP = null; return null; });
  return idxP;
}
/**
 * 一檔 ETF 的成分股明細。回傳：明細物件；null＝確定沒有（索引裡沒有這一檔：槓桿、期貨型、新 ETF）；
 * undefined＝這次抓不到（網路、伺服器），不快取，下次再試——不能說成「沒有明細」。
 */
export async function ensureHold(code) {
  if (code in S.hold) return S.hold[code];
  const g = gen;
  const idx = await ensureHoldIdx();
  if (!idx) return undefined;
  if (!idx.etf || !idx.etf[code]) { if (g === gen) S.hold[code] = null; return null; }
  let obj;
  try { obj = await getJSON(`hold/${code}.json`); } catch { return undefined; }
  if (g === gen) S.hold[code] = obj;
  return obj;
}
export function ensureStocks() {
  if (S.stocks) return Promise.resolve(S.stocks);
  const g = gen;
  if (!stocksP) stocksP = getJSON('stocks.json').then((d) => { d = normStocks(d); if (g === gen) S.stocks = d; return d; }).catch(() => { if (g === gen) stocksP = null; return null; });
  return stocksP;
}
/** 舊格式（每檔 10 欄、日期記在整份上）轉成新格式（每檔 13 欄、自己的日期），和後台 holdings.py 的 _upgrade 一樣 */
export function normStocks(d) {
  if (!d || !d.s) return d;
  for (const [c, r] of Object.entries(d.s)) {
    if (!Array.isArray(r) || r.length !== 10) continue;
    const day = r[1] === 'otc' ? d.d_otc : d.d;
    d.s[c] = [r[0], r[1], r[2], r[3], r[4], isNum(r[3]) ? day || null : null, r[5], r[6], r[7],
      [r[5], r[6], r[7]].some((x) => x != null) ? day || null : null, r[8], r[9], r[8] != null || r[9] != null ? d.rev || null : null];
  }
  return d;
}
/** 成分股的盤中行情（證交所基本市況報導）：超過 maxAge 就重抓 */
export function ensureStockq(maxAge = 60000, v = null) {
  if (S.stockq && Date.now() - S.stockqAt < maxAge) return Promise.resolve(S.stockq);
  if (!sqP) {
    // 抓不到（例如後台那一輪沒抓到行情）就留著手上那一份，不要退回沒有即時價
    sqP = getJSON('stockq.json', { v }).then((d) => { S.stockq = d; S.stockqAt = Date.now(); return d; })
      .catch(() => S.stockq).finally(() => { sqP = null; });
  }
  return sqP;
}
/** 資料同步發現盤中行情換了：成分股小卡開著就馬上重抓、換價格；沒開著就只標成過期，下次打開再抓 */
export async function refreshStockq(v = null) {
  S.stockqAt = 0;
  await refreshCard(v);
}
/** 開著的成分股小卡：成分股資料、盤中行情都備齊了再換價格（換批時成分股資料先被清掉，要等新的抓回來） */
async function refreshCard(v = null) {
  if (!cardKey || !$('.stock-card .sk-px')) return;
  await Promise.all([ensureStocks(), ensureStockq(60000, v)]);
  paintStockPx();
}

// stocks.json 每一檔的欄位（和後台 holdings.py 的 NF 一樣的順序）
const F_ = { name: 0, mkt: 1, ind: 2, close: 3, pct: 4, cd: 5, pe: 6, dy: 7, pb: 8, pd: 9, yoy: 10, cum: 11, rm: 12 };
const hm = (sec) => new Date(sec * 1000).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' });
const hmNum = (sec) => { const [h, m] = hm(sec).split(':'); return +h * 100 + +m; };
/**
 * 成分股現在的價格。盤中（或官方收盤資料還沒出來）用證交所即時行情；官方收盤資料是同一天或更新的，就用官方的。
 * 回傳 { px, pct, d, t, kind: 'live' 盤中／'close' 收盤（即時行情的收盤那一筆或官方）／'ref' 今天還沒有成交 } 或 null。
 */
export function stockPx(key, st = S.stocks, sq = S.stockq) {
  const s = st && st.s ? st.s[key] : null;
  if (!s) return null;
  const off = isNum(s[F_.close]) ? { px: s[F_.close], pct: isNum(s[F_.pct]) ? s[F_.pct] : null, d: s[F_.cd] || null, t: null, kind: 'close', src: 'official' } : null;
  const q = sq && sq.q ? sq.q[key] : null;
  if (q && q[7] && (!off || !off.d || q[7] > off.d)) {
    const [z, y, , , , v, qt, qd] = q;
    const t = isNum(qt) ? qt : null;
    const after = t != null && hmNum(t) >= 1330;
    if (isNum(z) && z > 0) return { px: z, pct: isNum(y) && y > 0 ? (z / y - 1) * 100 : null, d: qd, t, v, kind: after ? 'close' : 'live', src: 'mis' };
    // 這一筆快照沒有成交價：今天已經有成交量＝這一輪剛好沒有新的成交價（不是還沒成交），照實寫今天的最高、最低
    if (isNum(v) && v > 0 && !after) return { px: null, hi: q[3], lo: q[4], pct: null, d: qd, t, v, kind: 'gap', src: 'mis' };
    if (isNum(y) && y > 0 && !after && !(isNum(v) && v > 0)) return { px: null, ref: y, pct: null, d: qd, t, kind: 'ref', src: 'mis' };
  }
  return off;
}
function pxBlockHTML(key) {
  const p = stockPx(key);
  const s = S.stocks && S.stocks.s ? S.stocks.s[key] : null;
  const src = s && s[F_.mkt] === 'otc' ? '櫃買中心' : '證交所';
  if (!p) return `<div class="sk-px"><b class="num">—</b><small class="muted">還沒有${src}的行情資料</small></div>`;
  const day = p.d ? dayTag(p.d) : '';
  const closeT = day === '今日' ? '今日收盤' : `${day} 收盤`;
  let when;
  if (p.kind === 'live') when = `盤中 ${hm(p.t)}・即時行情`;
  else if (p.kind === 'ref') when = `${day} ${hm(p.t)} 還沒有成交（參考價 ${p.ref.toLocaleString('en-US', { maximumFractionDigits: 2 })}）`;
  else if (p.kind === 'gap') when = `盤中 ${hm(p.t)} 這一筆沒有最新成交價${isNum(p.hi) && isNum(p.lo) ? `（今天最高 ${p.hi.toLocaleString('en-US', { maximumFractionDigits: 2 })}、最低 ${p.lo.toLocaleString('en-US', { maximumFractionDigits: 2 })}）` : ''}，下一輪再更新`;
  else if (p.src === 'mis') when = `${closeT}・即時行情（${src}的官方收盤資料稍後更新）`;
  else when = `${closeT}・${src}`;
  const px = isNum(p.px) ? p.px.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—';
  const pc = isNum(p.pct) ? `<span class="num ${p.pct > 0 ? 'up' : p.pct < 0 ? 'down' : ''}">${pcS(p.pct)}</span>` : '';
  return `<div class="sk-px" data-px="${isNum(p.px) ? p.px : ''}"><b class="num">${px}</b>${pc}<small class="muted">${esc(when)}</small></div>`;
}
let cardKey = null;
/** 開著的成分股小卡：換成最新的價格（價格變了閃一下，紅漲綠跌） */
function paintStockPx() {
  const el = cardKey ? $('.stock-card .sk-px') : null;
  if (!el || !S.stocks || !S.stocks.s) return;
  const was = +el.dataset.px;
  const box = document.createElement('div');
  box.innerHTML = pxBlockHTML(cardKey);
  const nel = box.firstElementChild;
  el.replaceWith(nel);
  const now = +nel.dataset.px;
  if (was && now && was !== now) { const b = nel.querySelector('b'); if (b) b.classList.add(now > was ? 'fl-up' : 'fl-down'); }
}

// ------------------------------------------------------------------ 純計算（tests/xray_test.mjs 有測）
const months = (a, b) => (+a.slice(0, 4) - +b.slice(0, 4)) * 12 + (+a.slice(4) - +b.slice(4));
/** 透視用的清單：每季明細（比較完整）不比每月前十大舊 2 個月以上就用它 */
export function bestList(obj) {
  if (!obj) return null;
  const m = obj.m, q = obj.q;
  if (q && (!m || months(m.p, q.p) <= XR.staleQ)) return { ...q, k: 'q' };
  return m ? { ...m, k: 'm' } : null;
}
/** 這一期和上一期比：新進、退出、比重變多／變少（百分點） */
export function changes(cur, prev) {
  if (!cur || !prev) return null;
  const P = new Map(prev.h.map((r) => [keyOf(r), r]));
  const C = new Map(cur.h.map((r) => [keyOf(r), r]));
  const added = cur.h.filter((r) => !P.has(keyOf(r)));
  const removed = prev.h.filter((r) => !C.has(keyOf(r)));
  const moved = cur.h.filter((r) => P.has(keyOf(r))).map((r) => ({ r, d: r[3] - P.get(keyOf(r))[3] })).filter((x) => Math.abs(x.d) >= 0.5).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  return { added, removed, moved, from: prev.p, to: cur.p };
}
/**
 * 穿透持股：每檔 ETF 的比重（占總資產）× 它的成分股比例，加總成「你其實押了誰」。
 * pos：[{ code, w, slot }]（w＝占總資產比例）；holds：{ 代號: hold 檔 }
 * 回傳 { items:[{ key, name, kind, w, via:[{code, w, slot}] }], cov（算得到的部分占總資產）, etfW（ETF 部位占總資產）, byKind,
 *        missing:[確定沒有明細的代號], failed:[這次抓不到的代號（holds 裡是 undefined）] }
 */
export function lookThrough(pos, holds) {
  const M = new Map();
  let cov = 0, etfW = 0;
  const byKind = {};
  const missing = [];
  const failed = [];
  for (const p of pos) {
    if (!(p.w > 0)) continue;
    etfW += p.w;
    if (holds[p.code] === undefined) { failed.push(p.code); continue; }
    const L = bestList(holds[p.code]);
    if (!L) { missing.push(p.code); continue; }
    for (const r of L.h) {
      const w = p.w * r[3] / 100;
      cov += w;
      byKind[r[2]] = (byKind[r[2]] || 0) + w;
      const k = keyOf(r);
      let it = M.get(k);
      if (!it) { it = { key: k, code: r[0], name: r[1], kind: r[2], w: 0, via: [] }; M.set(k, it); }
      it.w += w;
      it.via.push({ code: p.code, w, slot: p.slot, pct: r[3] });
    }
  }
  const items = [...M.values()].sort((a, b) => b.w - a.w);
  for (const it of items) it.via.sort((a, b) => b.w - a.w);
  return { items, cov, etfW, byKind, missing, failed };
}
/** 依產業加總（國內股票才有產業；國外股票、債券各自一組） */
export function byIndustry(items, stocks) {
  const g = new Map();
  for (const it of items) {
    let k;
    if (it.kind === 'tse' || it.kind === 'otc') k = (stocks && stocks.s && stocks.s[it.code] && stocks.s[it.code][2]) || '其他國內股票';
    else if (it.kind === 'f') k = '國外股票';
    else if (it.kind === 'b') k = '債券';
    else k = '其他';
    g.set(k, (g.get(k) || 0) + it.w);
  }
  return [...g.entries()].map(([k, w]) => ({ k, w })).sort((a, b) => b.w - a.w);
}
/** 兩份清單的重疊度：Σ min(兩邊的比例)。回傳 { o（0～1）, shared:[{key,name,a,b}] } */
export function overlap(la, lb) {
  if (!la || !lb) return null;
  const B = new Map(lb.h.map((r) => [keyOf(r), r]));
  let o = 0;
  const shared = [];
  for (const r of la.h) {
    const s = B.get(keyOf(r));
    if (!s) continue;
    o += Math.min(r[3], s[3]) / 100;
    shared.push({ key: keyOf(r), code: r[0], name: r[1], kind: r[2], a: r[3], b: s[3] });
  }
  shared.sort((x, y) => Math.min(y.a, y.b) - Math.min(x.a, x.b));
  return { o, shared, covA: la.h.reduce((s, r) => s + r[3], 0) / 100, covB: lb.h.reduce((s, r) => s + r[3], 0) / 100 };
}
/** 一檔 ETF 和你現有部位（穿透後的股票部分）的重疊度：把你的穿透結果換成「占你股票部位的比例」再比 */
export function overlapWithMine(L, lt) {
  if (!L || !lt || !lt.items.length) return null;
  const tot = lt.items.reduce((s, it) => s + it.w, 0);
  if (!(tot > 0)) return null;
  const mine = { h: lt.items.map((it) => [it.code, it.name, it.kind, it.w / tot * 100]) };
  return overlap(L, mine);
}
/** Squarified treemap：values 由大到小，回傳 [{x,y,w,h,i}] */
export function treemap(values, W, H) {
  const out = [];
  const tot = values.reduce((s, v) => s + v, 0);
  if (!(tot > 0)) return out;
  const scale = (W * H) / tot;
  const items = values.map((v, i) => ({ a: v * scale, i }));
  let x = 0, y = 0, w = W, h = H;
  let row = [];
  const worst = (r, side) => {
    const s = r.reduce((t, it) => t + it.a, 0);
    const mx = Math.max(...r.map((it) => it.a)), mn = Math.min(...r.map((it) => it.a));
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  const layRow = (r) => {
    const s = r.reduce((t, it) => t + it.a, 0);
    if (w >= h) {
      const cw = s / h;
      let cy = y;
      for (const it of r) { const ch = it.a / cw; out.push({ x, y: cy, w: cw, h: ch, i: it.i }); cy += ch; }
      x += cw; w -= cw;
    } else {
      const ch = s / w;
      let cx = x;
      for (const it of r) { const cw = it.a / ch; out.push({ x: cx, y, w: cw, h: ch, i: it.i }); cx += cw; }
      y += ch; h -= ch;
    }
  };
  for (const it of items) {
    const side = Math.min(w, h);
    if (!row.length || worst(row.concat(it), side) <= worst(row, side)) row.push(it);
    else { layRow(row); row = [it]; }
  }
  if (row.length) layRow(row);
  return out;
}
/** 新聞標題裡提到你透過 ETF 間接持有的公司 */
export function namesIn(title, lt, T) {
  if (!lt || !title) return [];
  const out = [];
  for (const it of lt.items.slice(0, 40)) {
    if (!(it.kind === 'tse' || it.kind === 'otc') || !it.name || it.name.length < 2) continue;
    if (String(title).includes(it.name)) out.push(it);
  }
  return out.slice(0, 3);
}

// ------------------------------------------------------------------ 你的穿透結果（依目前持股算，快取到持股改變）
let ltKey = '', ltVal = null;
export async function myLookThrough() {
  const P = S.P;
  if (!P || !P.holdings.length) return null;
  const pos = P.holdings.filter((x) => x.mv > 0 && isNum(x.w)).map((x) => ({ code: x.code, w: x.w, slot: x.slot }));
  const key = pos.map((p) => `${p.code}:${p.w.toFixed(4)}`).join('|');
  if (key === ltKey && ltVal) return ltVal;
  const g = gen;
  const holds = {};
  await Promise.all(pos.map(async (p) => { holds[p.code] = await ensureHold(p.code); }));
  const lt = lookThrough(pos, holds);
  if (g === gen && !lt.failed.length) { ltKey = key; ltVal = lt; }
  return lt;
}

// ================================================================== 畫面：單檔頁「透視」
const TILE = ['xr-t1', 'xr-t2', 'xr-t3', 'xr-t4'];
/** 成分股比例圖：格子大小＝比例；字放得下才放（依實際寬度算，不會擠成直的） */
function treemapHTML(rows, opts = {}) {
  const W = 1000;
  const wpx = opts.wpx || 340;
  const H = wpx < 520 ? 700 : rows.length > 14 ? 520 : 420;
  const k = wpx / W;   // 一個單位＝幾個 CSS px
  const vals = rows.map((r) => r[3]);
  const rest = Math.max(0, 100 - vals.reduce((s, v) => s + v, 0));
  const all = rest > 0.5 ? vals.concat(rest) : vals;
  const rects = treemap(all, W, H);
  // 字寬：中文約 13px、英數約 7.5px；放不下就截短，連兩個字都放不下就不放
  const cw = (ch) => (ch.codePointAt(0) > 0x2e80 ? 13 : 7.5);
  const fit = (txt, pw) => {
    const t = String(txt);
    let w = 10, i = 0;
    for (; i < t.length; i++) { if (w + cw(t[i]) > pw) break; w += cw(t[i]); }
    if (i >= t.length) return t;
    return i >= 3 ? t.slice(0, i - 1) + '…' : '';
  };
  return `<div class="xr-map${opts.scan ? ' scan' : ''}" style="aspect-ratio:${W}/${H}" role="img" aria-label="成分股比例圖">${rects.map((t) => {
    const other = t.i >= rows.length;
    const r = rows[t.i];
    const pw = t.w * k, ph = t.h * k;
    const name = other ? '其他' : tileName(r);
    const pct = other ? rest : r[3];
    const alt = !other && r[2] === 'b' ? String(name).split(' ').pop() : null;   // 債券放不下「利率 年份」就只寫到期年
    const full = ph >= 22 ? fit(name, pw) : '';
    const nm = full && full.endsWith('…') && alt && fit(alt, pw) === alt ? alt : full;
    const showPct = nm && ph >= 42 && pw >= 50;
    const cls = other ? 'xr-rest' : TILE[Math.min(3, Math.floor(t.i / 3))];
    const lab = nm ? `<b>${esc(nm)}</b>${showPct ? `<span class="num">${pct.toFixed(other ? 1 : 2)}%</span>` : ''}` : '';
    return `<${other ? 'span' : 'button type="button"'} class="xr-tile ${cls}" style="left:${(t.x / W * 100).toFixed(3)}%;top:${(t.y / H * 100).toFixed(3)}%;width:${(t.w / W * 100).toFixed(3)}%;height:${(t.h / H * 100).toFixed(3)}%;--d:${Math.min(t.i, 14)}"${other ? '' : ` data-stock="${esc(keyOf(r))}" data-kind="${esc(r[2])}" title="${esc(r[1])} ${r[3].toFixed(2)}%" aria-label="${esc(r[1])} ${r[3].toFixed(2)}%"`}>${lab}</${other ? 'span' : 'button'}>`;
  }).join('')}</div>`;
}
/** 格子上的短名字：債券寫「利率 到期年」、國外股票寫第一個字（清單裡照樣是全名） */
function tileName(r) {
  if (r[2] === 'b') { const m = String(r[1]).match(/(\d+(?:\.\d+)?%)\s+\d{1,2}\/\d{1,2}\/(\d{4})/); return m ? `${m[1]} ${m[2]}` : r[1]; }
  if (r[2] === 'f') { const w = String(r[1]).split(/\s+/); return w[0].length <= 3 && w[1] ? `${w[0]} ${w[1]}` : w[0]; }
  return r[1];
}
const shortN = (n) => { const s = String(n || ''); return s.length > 6 ? s.slice(0, 6) + '…' : s; };
function chgHTML(ch) {
  if (!ch) return '';
  const nm = (r) => `<button type="button" class="xr-chip" data-stock="${esc(keyOf(r))}" data-kind="${esc(r[2])}">${esc(r[1])}</button>`;
  const parts = [];
  if (ch.added.length) parts.push(`<div class="xr-chg"><span class="xr-k in">新進</span>${ch.added.slice(0, 6).map(nm).join('')}</div>`);
  if (ch.removed.length) parts.push(`<div class="xr-chg"><span class="xr-k out">退出</span>${ch.removed.slice(0, 6).map(nm).join('')}</div>`);
  if (ch.moved.length) parts.push(`<div class="xr-chg"><span class="xr-k mv">比重變動</span>${ch.moved.slice(0, 4).map((x) => `<button type="button" class="xr-chip" data-stock="${esc(keyOf(x.r))}" data-kind="${esc(x.r[2])}">${esc(x.r[1])} <b class="num">${x.d > 0 ? '+' : '−'}${Math.abs(x.d).toFixed(1)}</b></button>`).join('')}</div>`);
  if (!parts.length) return `<p class="small muted xr-same">和 ${ymT(ch.from)} 比，成分沒有變動（比重變動都在 0.5 個百分點以內）。</p>`;
  return `<div class="xr-chgs"><div class="xr-chg-h">和 ${ymT(ch.from)} 比</div>${parts.join('')}</div>`;
}
function listHTML(rows, prev) {
  const P = prev ? new Map(prev.h.map((r) => [keyOf(r), r[3]])) : null;
  const mx = Math.max(...rows.map((r) => r[3]), 1);
  return `${P ? `<div class="xr-cap"><span>占淨值</span><span>和 ${ymT(prev.p)} 比（百分點）</span></div>` : ''}<ol class="xr-list${P ? ' cmp' : ''}">${rows.map((r, i) => {
    const was = P ? P.get(keyOf(r)) : undefined;
    const d = was == null ? null : r[3] - was;
    const tag = P ? (was == null ? '<em class="xr-new">新進</em>' : Math.abs(d) >= 0.05 ? `<em class="xr-d num">${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}</em>` : '') : '';
    return `<li><button type="button" class="xr-row" data-stock="${esc(keyOf(r))}" data-kind="${esc(r[2])}"${isStock(r[2]) ? '' : ' data-nostock="1"'}>
      <span class="xr-i num">${i + 1}</span><span class="xr-n"><b>${esc(r[1])}</b><small>${esc(r[0] && r[0].length <= 6 ? r[0] : '')} ${KIND[r[2]] || ''}</small></span>
      <span class="xr-bar"><i style="width:${(r[3] / mx * 100).toFixed(1)}%"></i></span><span class="xr-p num">${r[3].toFixed(2)}%</span>${P ? `<span class="xr-tag">${tag}</span>` : ''}</button></li>`;
  }).join('')}</ol>`;
}
export function xrayDetailHTML(code) {
  return `<section class="panel xray" id="xr-d" data-code="${esc(code)}" aria-label="ETF 透視"><div class="xr-h"><h2><span class="xr-eye" aria-hidden="true"></span>透視：裡面裝了什麼</h2></div><div class="xr-body"><div class="skeleton" style="height:180px"></div></div></section>`;
}
export async function bindXrayDetail(root, code) {
  const box = $('#xr-d', root);
  if (!box) return;
  const obj = await ensureHold(code);
  const body = $('.xr-body', box);
  if (!body || !box.isConnected) return;
  if (obj === undefined) {
    body.innerHTML = '<p class="small muted">成分股資料這次沒有載入成功（網路或伺服器忙），不是沒有資料。<button type="button" class="link small" data-xr-retry>再試一次</button></p>';
    const rb = $('[data-xr-retry]', body);
    if (rb) rb.addEventListener('click', () => { body.innerHTML = '<div class="skeleton" style="height:180px"></div>'; bindXrayDetail(root, code); });
    return;
  }
  if (!obj) {
    const row = S.rows.get(code);
    const lev = row && (row.k === 'lev' || row.k === 'inv' || row.k === 'fut');
    body.innerHTML = `<p class="small muted">${lev ? '槓桿、反向、期貨型 ETF 主要持有期貨與現金，投信投顧公會的基金投資明細裡沒有成分股。' : '投信投顧公會還沒有這檔的基金投資明細（新 ETF 要等第一次月報）。'}</p>`;
    return;
  }
  let mode = obj.q && obj.m && obj.q.h.length > obj.m.h.length ? (S.xrMode || 'm') : obj.m ? 'm' : 'q';
  const draw = (anim) => {
    const cur = mode === 'q' ? obj.q : obj.m;
    const prev = mode === 'q' ? obj.pq : obj.pm;
    const cov = cur.h.reduce((s, r) => s + r[3], 0);
    const top = cur.h[0];
    const kinds = {};
    for (const r of cur.h) kinds[r[2]] = (kinds[r[2]] || 0) + r[3];
    const kindTxt = Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${KIND[k] || k} ${v.toFixed(1)}%`).join('、');
    body.innerHTML = `
      ${obj.q && obj.m ? `<div class="seg mini xr-seg" role="tablist" aria-label="資料範圍"><button data-xm="m" aria-pressed="${mode === 'm'}">每月前十大・${ymT(obj.m.p)}</button><button data-xm="q" aria-pressed="${mode === 'q'}">每季 1% 以上・${ymT(obj.q.p)}</button></div>` : ''}
      <p class="xr-lead">${top ? `最大的是 <b>${esc(top[1])}</b>，占 <b class="num">${top[3].toFixed(2)}%</b>；` : ''}${mode === 'm' ? '前十大' : `${cur.h.length} 檔`}合計 <b class="num">${cov.toFixed(1)}%</b>${kindTxt ? `（${esc(kindTxt)}）` : ''}。</p>
      ${treemapHTML(cur.h, { scan: anim, wpx: body.clientWidth || 340 })}
      ${listHTML(cur.h, prev)}
      ${chgHTML(changes(cur, prev))}
      <p class="xr-src small muted">資料：<a href="${SRC[mode].u}" target="_blank" rel="noopener">${esc(SRC[mode].n)}</a>（${ymT(cur.p)} 底的持股，投信每月／每季申報，約次月第 10 個營業日公布）。點公司名稱看官方資料、哪些 ETF 也持有它。</p>`;
    $$('[data-xm]', body).forEach((b) => b.addEventListener('click', () => { if (mode === b.dataset.xm) return; mode = b.dataset.xm; S.xrMode = mode; FX.sfx('tap'); draw(false); }));
    $$('[data-stock]', body).forEach((b) => b.addEventListener('click', () => { if (b.dataset.nostock) return; openStock(b.dataset.stock, b.dataset.kind); }));
    if (anim && FX.fxOn()) { FX.sfx('scan'); }
  };
  draw(true);
}

// ================================================================== 畫面：部位分頁「透視：你其實押了誰」
export function xrayPfHTML() {
  if (!S.P || !S.P.holdings.some((x) => x.mv > 0)) return '';
  return `<div class="sec-h"><h2>透視</h2><span class="aside">你的 ETF 合起來，其實押了誰</span></div>
    <section class="panel xray xpf" id="xr-pf" aria-label="穿透持股"><div class="xr-body"><div class="skeleton" style="height:220px"></div></div></section>`;
}
export async function bindXrayPf(root) {
  const box = $('#xr-pf', root);
  if (!box) return;
  const [lt, stocks] = await Promise.all([myLookThrough(), ensureStocks()]);
  const body = $('.xr-body', box);
  if (!body || !box.isConnected) return;
  if (!lt || !lt.items.length) {
    body.innerHTML = `<p class="small muted">${lt && lt.missing.length && !lt.failed.length ? '你持有的 ETF 目前沒有成分股資料（槓桿、反向、期貨型，或新上市還沒有月報）。' : '成分股資料這次沒有載入成功（網路或伺服器忙），等一下會自動再試。'}</p>`;
    return;
  }
  const T = S.P.totals.T;
  const top = lt.items.slice(0, XR.top);
  const one = top[0];
  const conc = one && one.w >= XR.oneCo;
  const inds = byIndustry(lt.items, stocks);
  const mx = Math.max(...top.map((x) => x.w), 1e-9);
  const pf = Object.fromEntries(S.P.holdings.map((x) => [x.code, x]));
  body.innerHTML = `
    <div class="xp-hero${conc ? ' hazard' : ''}">
      <div class="xp-scan" aria-hidden="true"></div>
      <div class="xp-k">最重的一家</div>
      <div class="xp-v"><b>${esc(one.name)}</b><span class="num">${pu(one.w)}</span></div>
      <div class="xp-s">占你的總資產${settings.privacy ? '' : `，約 <b class="num">${money(one.w * T)}</b> 元`}；透過 ${one.via.map((v) => `${esc(pf[v.code] ? pf[v.code].name : v.code)} ${pu(v.w)}`).join('、')}。</div>
      ${conc ? `<div class="xp-warn">${ICON.warn}<span>單一公司超過總資產 ${pu(XR.oneCo, 0)}：你以為買了好幾檔 ETF 分散風險，其實很大一部分押在同一家公司。</span></div>` : ''}
    </div>
    <ol class="xp-list">${top.map((it, i) => `<li><button type="button" class="xp-row" data-stock="${esc(it.key)}" data-kind="${esc(it.kind)}"${isStock(it.kind) ? '' : ' data-nostock="1"'} style="--d:${i}">
      <span class="xp-n"><b>${esc(it.name)}</b><small>${KIND[it.kind] || ''}${it.via.length > 1 ? `・${it.via.length} 檔都有` : ''}</small></span>
      <span class="xp-bar" title="${esc(it.via.map((v) => `${pf[v.code] ? pf[v.code].name : v.code} ${pu(v.w, 2)}`).join('、'))}">${it.via.map((v) => `<i style="width:${(v.w / mx * 100).toFixed(2)}%;background:${v.slot == null ? 'var(--s-other)' : `var(--s${v.slot + 1})`}"></i>`).join('')}</span>
      <span class="xp-p num">${pu(it.w)}</span></button></li>`).join('')}</ol>
    ${inds.length ? `<div class="xp-ind"><div class="xp-ind-h">依產業</div>${inds.slice(0, 6).map((g) => `<div class="xp-ig"><span>${esc(g.k)}</span><span class="xp-ib"><i style="width:${(g.w / inds[0].w * 100).toFixed(1)}%"></i></span><b class="num">${pu(g.w)}</b></div>`).join('')}</div>` : ''}
    <p class="xr-src small muted">算法：每檔 ETF 占你總資產的比例 × 它的成分股比例，加總起來。只算得到投信有公布的部分（每季 1% 以上或每月前十大），約占你總資產的 <b class="num">${pu(lt.cov)}</b>（ETF 部位 ${pu(lt.etfW)}）${lt.missing.length ? `；${lt.missing.map((c) => esc(pf[c] ? pf[c].name : c)).join('、')} 沒有成分股資料` : ''}${lt.failed.length ? `；<b>${lt.failed.map((c) => esc(pf[c] ? pf[c].name : c)).join('、')} 的成分股資料這次沒有載入成功，先沒有算進來</b>（等一下會自動再試）` : ''}。資料：投信投顧公會基金投資明細。</p>`;
  $$('[data-stock]', body).forEach((b) => b.addEventListener('click', () => { if (b.dataset.nostock) return; openStock(b.dataset.stock, b.dataset.kind); }));
  if (FX.fxOn() && !S.xrPfSeen) {
    S.xrPfSeen = true;
    box.classList.add('scanning');
    FX.sfx('scan');
    setTimeout(() => box.classList.remove('scanning'), 1600);
  }
}

// ================================================================== 成分股小卡（官方資料＋哪些 ETF 持有）
/** 明細裡的名稱與種類（每月、每季、上一期都找）：成分股資料裡沒有的公司（例如上一期退出的）也叫得出名字 */
function findInHold(key) {
  for (const obj of Object.values(S.hold)) {
    for (const L of obj ? [obj.m, obj.q, obj.pm, obj.pq] : []) {
      const r = L && L.h ? L.h.find((x) => keyOf(x) === key) : null;
      if (r) return { name: r[1], kind: r[2] };
    }
  }
  return null;
}
/** 成分股小卡。kind：點的那一列的種類（tse／otc／f），成分股資料抓不到時也分得出國內、國外 */
export async function openStock(key, kind = null) {
  const [st] = await Promise.all([ensureStocks(), ensureStockq()]);
  const s = st && st.s ? st.s[key] : null;
  const fname = st && st.f ? st.f[key] : null;
  const by = (st && st.by && st.by[key]) || [];
  const nby = (st && st.nby && st.nby[key]) || by.length;
  const lt = await myLookThrough().catch(() => null);
  const mine = lt ? lt.items.find((it) => it.key === key) : null;
  const inHold = findInHold(key);
  let name = s ? s[F_.name] : fname;
  if (!name && mine) name = mine.name;
  if (!name && inHold) name = inHold.name;
  const k = (s && s[F_.mkt]) || kind || (mine && mine.kind) || (inHold && inHold.kind) || (fname ? 'f' : null);
  if (!name) { toast(st ? '找不到這家公司的資料' : '成分股資料這次沒有載入成功，稍後再試'); return; }
  const dom = k === 'tse' || k === 'otc';
  const mkt = dom ? k : null, ind = s ? s[F_.ind] : '';
  const [pe, dy, pb, pd, yoy, cum, rm] = s ? [s[F_.pe], s[F_.dy], s[F_.pb], s[F_.pd], s[F_.yoy], s[F_.cum], s[F_.rm]] : [];
  // 國內股票卻沒有個股資料：成分股資料沒載入成功，或這家公司（例如上一期退出的）還沒整理進來——照實說，不能說成國外股票
  const noRec = dom && !s ? `<p class="term-p">${st ? 'ETF 最新一期的明細裡沒有這家公司（例如上一期就退出了），冷眼沒有整理它的行情資料。' : '成分股資料這次沒有載入成功（網路或伺服器忙），稍後再打開一次。'}</p>` : '';
  const T = S.P ? S.P.totals.T : 0;
  const pf = S.P ? Object.fromEntries(S.P.holdings.map((x) => [x.code, x])) : {};
  const asof = [pd ? `本益比、殖利率、股價淨值比是 ${fmt.d(pd)} 收盤算的` : '', rm ? `月營收是 ${ymT(rm)}` : ''].filter(Boolean).join('；');
  const card = openModal(`<div class="form stock-card">
      <div class="term-k">成分股・${dom ? `${KIND[mkt] || ''}${ind ? `・${esc(ind)}` : ''}` : k === 'f' ? '國外股票' : esc(KIND[k] || '其他')}</div>
      <h2 class="m-title">${esc(name)} <span class="num muted">${esc(dom ? key : key.length > 6 ? key : '')}</span></h2>
      ${noRec}${s ? `${pxBlockHTML(key)}
      <div class="kv sk-kv">
        <div><div class="k" data-term="pe">本益比</div><div class="v num">${isNum(pe) && pe > 0 ? pe.toFixed(2) : '—'}</div></div>
        <div><div class="k" data-term="y">殖利率</div><div class="v num">${isNum(dy) ? dy.toFixed(2) + '%' : '—'}</div></div>
        <div><div class="k" data-term="pbr">股價淨值比</div><div class="v num">${isNum(pb) ? pb.toFixed(2) : '—'}</div></div>
        <div><div class="k" data-term="rev">月營收年增</div><div class="v num ${yoy > 0 ? 'up' : yoy < 0 ? 'down' : ''}">${pcS(yoy, 1)}</div></div>
        <div><div class="k">今年累計營收年增</div><div class="v num ${cum > 0 ? 'up' : cum < 0 ? 'down' : ''}">${pcS(cum, 1)}</div></div>
      </div>${asof ? `<p class="small muted sk-asof">${asof}。</p>` : ''}` : dom ? '' : '<p class="term-p">國外股票沒有台灣官方的行情資料；冷眼只列出哪些 ETF 持有它、你間接持有多少。</p>'}
      ${mine ? `<div class="sk-mine"><span>你透過 ETF 間接持有</span><b class="num">${pu(mine.w, 2)}</b><small>占總資產${settings.privacy || !T ? '' : `，約 ${money(mine.w * T)} 元`}：${mine.via.map((v) => `${esc(pf[v.code] ? pf[v.code].name : v.code)} ${pu(v.w, 2)}`).join('、')}</small></div>` : ''}
      <div class="sk-by"><div class="sk-by-h">哪些 ETF 持有它${st ? `<span class="num muted">${nby} 檔${nby > by.length ? `，列出比例最高的 ${by.length} 檔` : ''}</span>` : ''}</div>
        ${!st ? '<p class="small muted">成分股資料這次沒有載入成功，稍後再試。</p>' : by.length ? `<ol>${by.map(([c, p]) => { const r = S.rows.get(c); return `<li><button type="button" data-etf="${esc(c)}" data-noautofocus><span><b>${esc(r ? r.n : c)}</b><small class="num">${esc(c)}</small></span><span class="sk-b"><i style="width:${Math.min(100, p / by[0][1] * 100).toFixed(1)}%"></i></span><b class="num">${p.toFixed(2)}%</b></button></li>`; }).join('')}</ol>` : '<p class="small muted">沒有找到。</p>'}
      </div>
      <div class="ls-src"><span>出處</span>${s ? [SRC.mis, mkt === 'otc' ? SRC.tpexClose : SRC.twseClose, mkt === 'otc' ? SRC.tpex : SRC.twse, SRC.rev].map((x) => `<a href="${x.u}" target="_blank" rel="noopener">${ICON.ext}${esc(x.n)}</a>`).join('') : ''}<a href="${SRC.q.u}" target="_blank" rel="noopener">${ICON.ext}${esc(SRC.q.n)}</a></div>
      <p class="small muted">冷眼只整理官方資料，不評價個股、不做買賣建議。這裡的比例是投信申報那個月底的持股。</p>
      <div class="m-actions"><button type="button" class="btn" data-close>關閉</button></div>
    </div>`, { label: name, onClose: () => { cardKey = null; } });
  cardKey = s ? key : null;
  $$('[data-etf]', card).forEach((b) => b.addEventListener('click', () => { closeModal(); import('./sheet.js').then((m) => m.openDetail(b.dataset.etf)); }));
}

// ================================================================== 搜尋：找到一家公司 → 哪些 ETF 有它
export async function searchStocks(q) {
  const s = String(q || '').trim().toUpperCase();
  if (s.length < 2) return [];
  const st = await ensureStocks();
  if (!st) return [];
  const out = [];
  for (const [code, v] of Object.entries(st.s || {})) {
    if (code === s || (v[0] && v[0].toUpperCase().includes(s))) out.push({ key: code, name: v[0], n: (st.nby || {})[code] || 0, kind: v[1] });
  }
  for (const [code, n] of Object.entries(st.f || {})) {
    if (n && n.toUpperCase().includes(s)) out.push({ key: code, name: n, n: (st.nby || {})[code] || 0, kind: 'f' });
  }
  return out.sort((a, b) => b.n - a.n).slice(0, 6);
}

// ================================================================== 對決：成分股重疊
export async function duelOverlapHTML(codes) {
  if (!codes || codes.length < 2) return '';
  const objs = await Promise.all(codes.map((c) => ensureHold(c)));
  const L = objs.map(bestList);
  if (L.filter(Boolean).length < 2) {
    return `<section class="panel pad xr-duel"><h3>成分股重疊</h3><p class="small muted">${objs.some((o) => o === undefined) ? '成分股資料這次沒有載入成功（網路或伺服器忙），重新打開對決再試一次。' : '至少要有兩檔有成分股資料才能比（槓桿、反向、期貨型和新 ETF 沒有）。'}</p></section>`;
  }
  const pairs = [];
  for (let i = 0; i < codes.length; i++) for (let j = i + 1; j < codes.length; j++) if (L[i] && L[j]) pairs.push([i, j, overlap(L[i], L[j])]);
  const nm = (c) => { const r = S.rows.get(c); return r ? r.n : c; };
  return `<section class="panel pad xr-duel"><h3><span class="xr-eye" aria-hidden="true"></span>成分股重疊</h3>
    ${pairs.map(([i, j, ov]) => `<div class="xd-pair${ov.o >= XR.overlapHi ? ' hi' : ''}">
      <div class="xd-h"><span>${esc(nm(codes[i]))} × ${esc(nm(codes[j]))}</span><b class="num">${pu(ov.o, 0)}</b></div>
      <div class="xd-bar"><i style="width:${Math.min(100, ov.o * 100).toFixed(1)}%"></i></div>
      <p class="small">${ov.shared.length ? `共同持有 ${ov.shared.length} 家：${ov.shared.slice(0, 5).map((x) => `${esc(x.name)}（${x.a.toFixed(1)}%／${x.b.toFixed(1)}%）`).join('、')}${ov.shared.length > 5 ? '…' : ''}` : '沒有共同持有的公司。'}${ov.o >= XR.overlapHi ? '<br><b>高度重疊</b>：兩檔一起買，分散的效果有限。' : ''}</p></div>`).join('')}
    <p class="small muted">重疊度＝每家共同持有的公司取兩檔裡比較小的比例，加總起來（只算投信有公布的部分：${L.filter(Boolean).map((x) => `${x.k === 'q' ? '每季' : '每月'} ${ymT(x.p)}`).filter((v, k, a) => a.indexOf(v) === k).join('、')}）。</p></section>`;
}

// ================================================================== 判斷教練用：這檔和你現有部位重疊多少、新聞標題提到的公司
export async function coachXray(code) {
  const lt = await myLookThrough().catch(() => null);
  const T = S.P ? S.P.totals.T : 0;
  let overlapTxt = '', warn = false;
  if (code) {
    const L = bestList(await ensureHold(code));
    if (L) {
      const top = L.h.slice(0, 3).map((r) => `${esc(r[1])} ${r[3].toFixed(1)}%`).join('、');
      overlapTxt = `前三大：${top}（${L.k === 'q' ? '每季明細' : '每月前十大'} ${ymT(L.p)}）。`;
      const ov = overlapWithMine(L, lt);
      if (ov) {
        warn = ov.o >= XR.overlapHi;
        overlapTxt += `<br>和你現有的股票部位（穿透之後）重疊約 <b class="num">${pu(ov.o, 0)}</b>${ov.shared.length ? `，共同的有 ${ov.shared.slice(0, 3).map((x) => esc(x.name)).join('、')}` : ''}${warn ? '：多買這一檔，分散的效果有限。' : '。'}`;
      }
    }
  }
  const names = (title) => namesIn(title, lt, T).map((it) => `新聞提到的 <b>${esc(it.name)}</b>：你透過 ETF 間接持有，約占總資產 <b class="num">${pu(it.w)}</b>。`);
  return { overlap: overlapTxt, warn, names };
}

// ================================================================== 設定頁：透視怎麼算（照常數產生）
export function xrayRulesHTML() {
  return `<ul class="rules-list">
    <li>成分股來自投信投顧公會「基金投資明細」：每月前十大（約次月第 10 個營業日公布）、每季占淨資產 1% 以上。單檔頁可以兩種都看。</li>
    <li>穿透持股＝每檔 ETF 占你總資產的比例 × 它的成分股比例，加總起來；每季明細不比每月前十大舊 ${XR.staleQ} 個月以上就用每季（比較完整），不然用每月前十大。</li>
    <li>單一公司穿透後超過總資產 ${pu(XR.oneCo, 0)}，標示「集中」；兩檔 ETF 的重疊度（共同持有的公司取比較小的比例加總）${pu(XR.overlapHi, 0)} 以上，標示「高度重疊」。</li>
    <li>投信投顧公會新的一期：配對到的 ETF 不到上一期一半先不收（當作還沒抓完整）；第一次抓到後 20 天內每天再抓一次，晚申報、更正的會補進來。</li>
    <li>成分股的價格：盤中用證交所基本市況報導的即時行情（後台約 5 分鐘一輪，標「盤中 幾點幾分」）；收盤後證交所、櫃買中心的每日收盤行情一出來就換成官方的（標日期）。本益比、殖利率、股價淨值比、月營收來自證交所、櫃買中心與公開資訊觀測站，各自標是哪一天、哪個月的；收盤後每一輪都會檢查，直到是最新交易日的資料。冷眼不評價個股、不做買賣建議。</li>
  </ul>`;
}
