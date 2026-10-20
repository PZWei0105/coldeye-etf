/* 冷眼 — 共用核心：狀態、設定、資料載入、格式、圖示、小元件。 */
import * as PF from './pf.js';
import { breadth } from './calc.js';

export { PF };

// ------------------------------------------------------------------ 基本工具
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const isNum = (x) => typeof x === 'number' && isFinite(x);
export const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const store = {
  get(k, d) { try { const v = localStorage.getItem('coldeye.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('coldeye.' + k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem('coldeye.' + k); } catch { /* 無法使用儲存空間 */ } },
};

// ------------------------------------------------------------------ 設定
export const DEFAULT_WATCH = ['0050', '00878', '00662', '0056', '00919', '00679B'];
export const DEFAULT_RULES = [
  '不買溢價超過警戒的 ETF',
  '單檔不超過我設定的比重上限',
  '觀點偏空時不攤平',
  '每次加碼前先想好出場線',
  '分批買進，不一次梭哈',
];
const savedSettings = store.get('settings', {});
export const settings = Object.assign({
  watch: DEFAULT_WATCH.slice(), risk: 'mid', fee: { ...PF.DEFAULT_FEE }, name: 'PZ', theme: 'system',
  privacy: false, opinion: false, dca: true, installHidden: false, rules: DEFAULT_RULES.slice(),
  mode: 'real', explain: false, boot: true, heatMode: 'chg', radarView: 'list', duel: null, tm: null,
}, savedSettings);
if (!['real', 'paper'].includes(settings.mode)) settings.mode = 'real';
if (!PF.PROFILES[settings.risk]) settings.risk = 'mid';
settings.fee = Object.assign({ ...PF.DEFAULT_FEE }, settings.fee || {});
delete settings.capital;   // 舊版的「投資本金」改由「部位」裡的現金與持股計算
export const saveSettings = () => store.set('settings', settings);

// ------------------------------------------------------------------ 我的部位、提醒（只存在這支手機）
// 真實部位存在 coldeye.pf，模擬倉存在 coldeye.paper；book 永遠指向目前這一個（同一個物件，切換時換內容）
export const isPaper = () => settings.mode === 'paper';
const bookKey = () => (isPaper() ? 'paper' : 'pf');
const EMPTY_BOOK = () => ({ cash: 0, lots: [], colors: {} });
export const book = Object.assign(EMPTY_BOOK(), store.get(bookKey(), {}));
export const saveBook = () => { book.updated = new Date().toISOString(); return store.set(bookKey(), book); };
export function switchMode(mode) {
  if (mode === settings.mode) return;
  saveBook();
  settings.mode = mode;
  saveSettings();
  for (const k of Object.keys(book)) delete book[k];
  Object.assign(book, EMPTY_BOOK(), store.get(bookKey(), {}));
}
/** 換掉目前這一本（還原備份、重設模擬倉用） */
export function replaceBook(next) {
  for (const k of Object.keys(book)) delete book[k];
  Object.assign(book, EMPTY_BOOK(), next || {});
  saveBook();
}
/** 另一本（真實／模擬）目前存的內容，備份時一起帶走 */
export const otherBook = () => store.get(isPaper() ? 'pf' : 'paper', null);
/** 還原備份、清除資料用：real／paper 給了才寫；目前顯示的那一本直接換掉，另一本寫進它自己的位置 */
export function setBooks({ real, paper } = {}) {
  const put = (key, b) => {
    const next = { ...EMPTY_BOOK(), ...(b || {}) };
    if (bookKey() === key) { replaceBook(next); return; }
    next.updated = new Date().toISOString();
    store.set(key, next);
  };
  if (real !== undefined) put('pf', real);
  if (paper !== undefined) put('paper', paper);
}
export const alerts = store.get('alerts', []);
export const saveAlerts = () => store.set('alerts', alerts);
export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ------------------------------------------------------------------ 全域狀態與事件
export const S = {
  summary: null, live: null, offline: false, news: null, track: null, divs: null, detail: {}, hist: {}, breadth: null, pxSeen: new Map(),
  tab: store.get('tab', 'home'), all: { q: '', cat: '*', sig: '*', sort: 'score' }, newsTab: 'official',
  range: 120, rows: new Map(), deferredInstall: null, P: null, adv: new Map(), openCode: null,
  firstPaint: true, changes: [],
};
if (!['home', 'pf', 'radar', 'news', 'track'].includes(S.tab)) S.tab = 'home';

const listeners = [];
export const bus = {
  on(fn) { listeners.push(fn); },
  emit(what) { for (const fn of listeners) { try { fn(what); } catch (e) { console.error(e); } } },
};

// ------------------------------------------------------------------ 格式
export const fmt = {
  px(x) { return isNum(x) ? x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'; },
  n(x, d = 0) { return isNum(x) ? x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—'; },
  pct(x, d = 2, sign = true) { return isNum(x) ? (sign && x > 0 ? '+' : '') + x.toFixed(d) + '%' : '—'; },
  r(x, d = 1, sign = true) { return isNum(x) ? (sign && x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x * 100).toFixed(d) + '%' : '—'; },
  big(x) {
    if (!isNum(x)) return '—';
    const a = Math.abs(x);
    if (a >= 1e12) return (x / 1e12).toFixed(2) + ' 兆';
    if (a >= 1e8) return (x / 1e8).toFixed(a >= 1e10 ? 0 : 1) + ' 億';
    if (a >= 1e4) return (x / 1e4).toFixed(0) + ' 萬';
    return x.toFixed(0);
  },
  d(n) { if (!n) return '—'; const s = String(n); return `${+s.slice(4, 6)}/${+s.slice(6, 8)}`; },
  dy(n) { if (!n) return '—'; const s = String(n); return `${s.slice(0, 4)}/${s.slice(4, 6)}/${s.slice(6, 8)}`; },
  ago(iso) {
    if (!iso) return '—';
    const t = new Date(iso).getTime();
    if (!isFinite(t)) return '—';
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return '剛剛';
    if (m < 60) return m + ' 分鐘前';
    const h = Math.round(m / 60);
    if (h < 24) return h + ' 小時前';
    return Math.round(h / 24) + ' 天前';
  },
};
export const cash3 = (x) => (isNum(x) ? String(+x.toFixed(3)) : '—');
const MASK = '••••';
/** 金額（隱藏模式時遮住）。sign：顯示正負號 */
export function money(x, sign = false) {
  if (!isNum(x)) return '—';
  if (settings.privacy) return MASK;
  const v = Math.round(x);
  const s = Math.abs(v).toLocaleString('en-US');
  if (!sign) return (v < 0 ? '−' : '') + s;
  return (v > 0 ? '+' : v < 0 ? '−' : '') + s;
}
export function sharesOf(sh) {
  if (!isNum(sh)) return '—';
  return settings.privacy ? MASK : PF.sharesText(sh);
}
export const dirCls = (x) => (isNum(x) ? (x > 0 ? 'up' : x < 0 ? 'down' : 'flat') : 'flat');
export const arrow = (x) => (isNum(x) && Math.abs(x) > 1e-12 ? (x > 0 ? '▲' : '▼') : '');
export const today = () => PF.twToday();
export function twParts() {
  const d = new Date(Date.now() + 8 * 3600e3);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, day: d.getUTCDate(), wd: d.getUTCDay(), h: d.getUTCHours(), min: d.getUTCMinutes() };
}

export const CAT = PF.CAT_NAMES;
export const catName = (k) => CAT[k] || (S.summary && S.summary.cats && S.summary.cats[k]) || k || '';
export const POS = {
  add: { t: '可加碼', cls: 'go' }, wait: { t: '漲多分批', cls: 'go2' }, hold: { t: '續抱', cls: 'mute' },
  caution: { t: '先不加碼', cls: 'warn' }, trim: { t: '減碼', cls: 'warn2' },
};
export const ACT = {
  none: 'mute', pause: 'warn', trim: 'warn2', rebalance: 'warn2', hold_off: 'warn', full: 'mute', add: 'go', hold: 'mute',
};
export const ST = { 1: { t: '偏多', cls: 's1' }, 0: { t: '中性', cls: 's0' }, '-1': { t: '偏空', cls: 's-1' } };

// ------------------------------------------------------------------ 圖示（線條一致：1.7 px、圓角端點）
const sv = (vb, body) => `<svg viewBox="${vb}" aria-hidden="true">${body}</svg>`;
export const ICON = {
  up: sv('0 0 16 16', '<path d="M8 3.2 13 9.4H9.6V13H6.4V9.4H3z" fill="currentColor"/>'),
  down: sv('0 0 16 16', '<path d="M8 12.8 3 6.6h3.4V3h3.2v3.6H13z" fill="currentColor"/>'),
  flat: sv('0 0 16 16', '<rect x="3" y="6.6" width="10" height="2.8" rx="1.2" fill="currentColor"/>'),
  warn: sv('0 0 16 16', '<path d="M8 1.8 15 14H1z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 6v3.6M8 11.4v.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'),
  cal: sv('0 0 16 16', '<rect x="2" y="3" width="12" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M2 6.5h12M5.5 1.6v2.8M10.5 1.6v2.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'),
  back: sv('0 0 20 20', '<path d="M12.5 4 6.5 10l6 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>'),
  star: sv('0 0 20 20', '<path d="m10 2.6 2.3 4.7 5.1.7-3.7 3.6.9 5.1L10 14.3l-4.6 2.4.9-5.1-3.7-3.6 5.1-.7z" fill="currentColor"/>'),
  bell: sv('0 0 20 20', '<path d="M5 13.5V9a5 5 0 0 1 10 0v4.5l1.5 1.8h-13z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8.2 17.2a2 2 0 0 0 3.6 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'),
  search: sv('0 0 20 20', '<circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m13.5 13.5 4 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'),
  x: sv('0 0 16 16', '<path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'),
  plus: sv('0 0 20 20', '<path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  eye: sv('0 0 24 24', '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.7"/>'),
  eyeOff: sv('0 0 24 24', '<path d="M4 4l16 16M9.9 6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.6 7.4A16.6 16.6 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.3-1.1" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M9.9 9.9a3.2 3.2 0 0 0 4.3 4.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'),
  upA: sv('0 0 16 16', '<path d="M8 3.5 12.5 9h-9z" fill="currentColor"/>'),
  downA: sv('0 0 16 16', '<path d="M8 12.5 3.5 7h9z" fill="currentColor"/>'),
  chev: sv('0 0 16 16', '<path d="m6 3.5 4.5 4.5L6 12.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>'),
  ok: sv('0 0 16 16', '<path d="m3.4 8.4 3 3 6.2-6.8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>'),
  no: sv('0 0 16 16', '<path d="m4.5 4.5 7 7M11.5 4.5l-7 7" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>'),
  dot: sv('0 0 16 16', '<circle cx="8" cy="8" r="2.6" fill="currentColor"/>'),
  bang: sv('0 0 16 16', '<path d="M8 3.2v6.2M8 12.2v.6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  chart: sv('0 0 16 16', '<path d="M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'),
  refresh: sv('0 0 20 20', '<path d="M16.2 7.6A6.6 6.6 0 0 0 4 6.3M3.8 12.4A6.6 6.6 0 0 0 16 13.7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M16.6 3.4v4.4h-4.4M3.4 16.6v-4.4h4.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>'),
  swap: sv('0 0 20 20', '<path d="M5 7h11l-3-3M15 13H4l3 3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>'),
};

// ------------------------------------------------------------------ 資料
export async function getJSON(path) {
  const t = Math.floor(Date.now() / 60000);
  const r = await fetch(`data/${path}?t=${t}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  // service worker 在連不上網路時會改給上次存下的資料，並加上這個標記
  if (path === 'summary.json' || path === 'live.json') S.offline = r.headers.get('X-ColdEye-Offline') === '1';
  return r.json();
}
export async function loadCore() {
  const [summary, live] = await Promise.all([getJSON('summary.json'), getJSON('live.json').catch(() => null)]);
  S.summary = summary;
  if (live) S.live = live;   // 盤中資料這次沒抓到，就保留上一份，不要退回昨天的收盤價
  S.rows = new Map(summary.etfs.map((r) => [r.c, r]));
  S.breadth = breadth(summary.etfs);
  store.set('cache.summary', summary);
  if (live) store.set('cache.live', live);
}
export function useCache() {
  const cached = store.get('cache.summary', null);
  if (!cached) return false;
  S.summary = cached;
  S.rows = new Map(cached.etfs.map((r) => [r.c, r]));
  S.breadth = breadth(cached.etfs);
  S.live = store.get('cache.live', null);
  S.divs = store.get('cache.divs', null);
  return true;
}
export async function ensureTrack() {
  if (S.track) return S.track;
  try { S.track = await getJSON('track.json'); } catch { S.track = null; }
  return S.track;
}
export async function ensureDivs(force = false) {
  if (S.divs && !force) return S.divs;
  try { S.divs = await getJSON('divs.json'); store.set('cache.divs', S.divs); } catch { /* 用快取 */ }
  return S.divs;
}
export async function ensureHist(code) {
  if (S.hist[code]) return S.hist[code];
  try { S.hist[code] = await getJSON(`hist/${code}.json`); } catch { return null; }
  return S.hist[code];
}
export async function ensureDetail(code) {
  if (S.detail[code]) return S.detail[code];
  try { S.detail[code] = await getJSON(`etf/${code}.json`); } catch { return null; }
  return S.detail[code];
}

export function liveOf(code) {
  const L = S.live;
  if (!L || !L.etfs || !L.etfs[code]) return null;
  const x = L.etfs[code];
  return { px: x[0], nav: x[1], prem: x[2], time: x[3], uchg: x[4], date: x[5] || L.date };
}
/** 合併收盤資料與盤中資料：盤中日期比收盤資料新時，用盤中價格 */
export function quote(row) {
  const lv = liveOf(row.c);
  if (lv && lv.date && row.d && lv.date > row.d && isNum(lv.px) && lv.px > 0) {
    let ref = row.p;
    // 收盤資料之後才生效的分割（例如 1 拆 4）：昨收要換算成分割後的價格，不然漲跌會差好幾倍
    const sp = ((S.divs && S.divs[row.c] && S.divs[row.c].s) || []).filter(([d]) => d > row.d && d <= lv.date);
    for (const [, k] of sp) ref /= k;
    if (row.dv && row.dv.d === lv.date && isNum(row.dv.cash)) ref -= row.dv.cash;
    return { px: lv.px, ch: lv.px - ref, pc: (lv.px / ref - 1) * 100, prem: lv.prem, live: true, time: lv.time, date: lv.date };
  }
  return { px: row.p, ch: row.ch, pc: row.pc, prem: lv && lv.date === row.d ? (lv.prem ?? row.pr) : row.pr, live: false, time: lv ? lv.time : null, date: row.d };
}

// ------------------------------------------------------------------ 我的部位：計算與建議
export function hasBook() { return book.lots.length > 0 || book.cash > 0; }

export function paperCash(P0) {
  if (!book.start) return 0;
  const sp = (c) => (S.divs && S.divs[c] && S.divs[c].s) || [];
  return (book.start.cash0 || 0) + PF.lotsCashFlow(book.lots, sp) + (P0 ? P0.totals.divRecv : 0);
}
export function computePF() {
  if (!S.summary) { S.P = null; return null; }
  const td = today();
  if (isPaper()) {
    // 模擬倉的現金不用手填：先算一次拿到已領股息，再把現金補進去重算
    const P0 = PF.buildPortfolio({ ...book, cash: 0 }, S.rows, quote, S.divs || {}, settings.fee, td);
    book.cash = Math.max(0, Math.round(paperCash(P0) * 100) / 100);
  }
  const P = PF.buildPortfolio(book, S.rows, quote, S.divs || {}, settings.fee, td);
  const codes = P.holdings.map((x) => x.code);
  const colors = PF.assignColors(book, codes);
  if (JSON.stringify(colors) !== JSON.stringify(book.colors || {})) { book.colors = colors; saveBook(); }
  for (const x of P.holdings) x.slot = colors[x.code] ?? null;
  // 兩輪：先看有幾檔「可加碼」，再把現金平均分給它們（至少分 3 份）
  S.adv = new Map();
  const first = new Map(P.holdings.map((x) => [x.code, PF.advise(holdingInput(x), ctxFor(x.code, P))]));
  const nAdd = [...first.values()].filter((a) => a.plan && a.plan.n > 0).length;   // 所有會拿到加碼計畫的（含減半的續抱）
  const share = P.totals.cash / Math.max(PF.CASH_SLICES, nAdd);
  for (const x of P.holdings) S.adv.set(x.code, PF.advise(holdingInput(x), ctxFor(x.code, P, share)));
  P.nAdd = nAdd;
  P.cashShare = share;
  S.P = P;
  return P;
}
export function holdingInput(x) {
  return { row: x.row, sh: x.h.sh, avg: x.h.avg, cost: x.h.cost, px: x.px, prem: x.q ? x.q.prem : null };
}
export function ctxFor(code, P = S.P, cashShare) {
  const row = S.rows.get(code);
  const T = P ? P.totals.T : 0;
  const cash = P ? P.totals.cash : 0;
  return {
    T, cash, cashShare: cashShare ?? (P && isNum(P.cashShare) ? P.cashShare : cash / PF.CASH_SLICES),
    profile: settings.risk, fee: settings.fee, today: today(),
    stats: S.track && S.track.pos && row ? (S.track.pos[row.k] || null) : null,
  };
}
export function heldOf(code) { return S.P ? S.P.holdings.find((x) => x.code === code) || null : null; }
export function adviceFor(code) {
  const x = heldOf(code);
  if (x) return S.adv.get(code) || null;
  const row = S.rows.get(code);
  if (!row) return null;
  const q = quote(row);
  return PF.advise({ row, sh: 0, avg: null, cost: 0, px: q.px, prem: q.prem }, ctxFor(code));
}
export const slotVar = (slot) => (slot == null ? 'var(--s-other)' : `var(--s${slot + 1})`);

// ------------------------------------------------------------------ 小元件
export function stanceChip(st, extra = '') {
  if (st == null) return '<span class="chip stance na">資料不足</span>';
  const s = ST[String(st)];
  const ic = st > 0 ? ICON.up : st < 0 ? ICON.down : ICON.flat;
  return `<span class="chip stance ${s.cls}" data-term="st">${ic}${s.t}${extra}</span>`;
}
export function posChip(ps) {
  if (!ps || !POS[ps]) return '';
  return `<span class="chip act ${POS[ps].cls}" data-term="ps">${POS[ps].t}</span>`;
}
export function actChip(a) {
  if (!a) return '';
  return `<span class="chip act ${ACT[a.key] || 'mute'}">${esc(a.label)}</span>`;
}
export const premBand = (row) => PF.premBand(row);

export function gaugeSVG(score, stance, big = false) {
  const W = 300, H = big ? 54 : 22, x = (v) => 8 + ((clamp(v, -2, 2) + 2) / 4) * 284;
  const base = big ? 30 : 13;
  let ticks = '';
  for (let k = -20; k <= 20; k++) {
    const v = k / 10, major = k % 5 === 0;
    const h = major ? (big ? 11 : 7) : (big ? 5 : 3.5);
    ticks += `<line class="tick${major ? ' major' : ''}" x1="${x(v).toFixed(1)}" x2="${x(v).toFixed(1)}" y1="${base - h}" y2="${base}"/>`;
  }
  const zh = big ? 14 : 8;
  const zone = `<rect class="zone-bear" x="${x(-2)}" y="${base - zh}" width="${(x(-0.5) - x(-2)).toFixed(1)}" height="${zh}" rx="2"/>` +
    `<rect class="zone-bull" x="${x(0.5).toFixed(1)}" y="${base - zh}" width="${(x(2) - x(0.5)).toFixed(1)}" height="${zh}" rx="2"/>`;
  const labs = big
    ? `<text class="lab" x="${x(-2)}" y="${base + 16}" text-anchor="start">偏空</text><text class="lab" x="${x(0)}" y="${base + 16}" text-anchor="middle">中性</text><text class="lab" x="${x(2)}" y="${base + 16}" text-anchor="end">偏多</text>` +
      `<text class="lab" x="${x(-0.5)}" y="${base + 16}" text-anchor="middle">−0.5</text><text class="lab" x="${x(0.5)}" y="${base + 16}" text-anchor="middle">+0.5</text>`
    : '';
  const col = stance > 0 ? 'var(--up)' : stance < 0 ? 'var(--down)' : 'var(--flat)';
  const nx = isNum(score) ? x(score) - x(0) : 0;
  const needle = isNum(score)
    ? `<g class="needle" data-dx="${nx.toFixed(1)}" style="transform:translateX(0px)"><line x1="${x(0)}" x2="${x(0)}" y1="${big ? 6 : 1}" y2="${base + 2}" stroke="${col}"/><circle cx="${x(0)}" cy="${big ? 6 : 2.5}" r="${big ? 4.5 : 3}" fill="${col}"/></g>`
    : '';
  return `<svg class="gauge${big ? ' big' : ''}" viewBox="0 0 ${W} ${H}" role="img" aria-label="規則分數 ${isNum(score) ? score.toFixed(2) : '無'}（-2 偏空到 +2 偏多）">${zone}<line x1="${x(-2)}" x2="${x(2)}" y1="${base}" y2="${base}" class="base"/>${ticks}${labs}${needle}</svg>`;
}
export function animateNeedles(root) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    $$('.needle', root).forEach((g) => { g.style.transform = `translateX(${g.dataset.dx}px)`; });
  }));
}
export function sparkSVG(vals, w = 64, h = 28, dir = 0) {
  const v = (vals || []).filter(isNum);
  if (v.length < 2) return '';
  const mn = Math.min(...v), mx = Math.max(...v), rg = mx - mn || 1;
  const pts = v.map((y, i) => [(i / (v.length - 1)) * (w - 4) + 2, h - 3 - ((y - mn) / rg) * (h - 6)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
  const end = pts[pts.length - 1];
  const col = dir > 0 ? 'var(--up)' : dir < 0 ? 'var(--down)' : 'var(--flat)';
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="var(--frost-3)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${end[0].toFixed(1)}" cy="${end[1].toFixed(1)}" r="2.6" fill="${col}"/></svg>`;
}

let toastTimer = null;
export function toast(msg) {
  let t = $('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, Math.min(6000, 1800 + String(msg).length * 70));   // 字多就停久一點
}
export function buzz(ms = 12) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* 不支援 */ } }

/** 數字跳動（只用在第一次開啟時的總資產） */
export function countUp(el, to, render, ms = 900) {
  if (!el || !isNum(to) || reduceMotion() || settings.privacy) { if (el) el.textContent = render(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = clamp((t - t0) / ms, 0, 1);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = render(to * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
