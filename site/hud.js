/* 冷眼 — 介面效果（2026/11/17，PZ：「誰說專業高端的成品，就不能酷炫」）
   原則：會動、會亮的都代表一件真的事；只改畫面，不改任何資料、計算與建議。
   1 資料新鮮度光環 halo：卡片標題右邊的小圓環＝這張卡用的資料有多新。盤中即時價剛更新是滿的、越舊越空，
     該更新卻沒更新變琥珀；收盤後、休市是靜止的完整環。判斷直接用頂端狀態列的 freshness()（app.js），兩邊一定一致。點一下說明。
   3 數字翻牌 roll：總資產、損益、報價更新時，只有變了的那幾位數像機械計數器翻過去（價格本來就會紅綠閃一下）。
   4 鏡頭轉場 zoom：點熱力圖的格子或清單的一列，那一格放大成單檔頁；返回時縮回原位。
   5 三段顯示模式 modes：巡航（只看最重要的）／作戰（原本的完整版）／深潛（細節全部攤開、排得更密）。
   開關存在這支手機（settings.ui、settings.dmode），不進備份。四個都關掉＝改之前的樣子：不輸出任何新元素、不改排版
   （作戰模式本身就是原本的畫面）。畫面特效關掉、或手機設定「減少動態效果」時，翻牌與轉場不動。 */
import { $, $$, S, settings, saveSettings, reduceMotion, toast, esc, fmt, today, twParts, marketClosedOn } from './core.js';
import { haloLive, haloEod, rollPlan } from './calc.js';
import * as FX from './fx.js';

// ------------------------------------------------------------------ 開關（回到原本的樣子）
export const UI_FX = [
  { k: 'halo', t: '資料新鮮度光環', d: '卡片標題右邊的小圓環：盤中價格剛更新是滿的、越舊越空，該更新卻沒更新變琥珀色；收盤後、休市是靜止的完整環。點一下說明這張卡用的是哪一份資料、幾點的' },
  { k: 'roll', t: '數字翻牌', d: '總資產、損益、報價更新時，只有變了的那幾位數像計數器一樣翻過去' },
  { k: 'zoom', t: '鏡頭轉場', d: '點熱力圖的格子或清單的一列，那一格直接放大成單檔頁；返回時縮回原位' },
  { k: 'modes', t: '三段顯示模式', d: '名字旁邊的「巡航／作戰／深潛」：巡航只看最重要的，作戰是完整版，深潛把細節全部攤開。關掉就固定用作戰' },
];
export const uiOn = (k) => !(settings.ui && settings.ui[k] === false);
export function setUi(k, on) { settings.ui = { ...(settings.ui || {}), [k]: !!on }; saveSettings(); }
export function setAllUi(on) { settings.ui = Object.fromEntries(UI_FX.map((x) => [x.k, !!on])); saveSettings(); }
const anim = () => settings.fx !== false && !reduceMotion();

// ------------------------------------------------------------------ 5 三段顯示模式
export const DMODES = [
  { k: 'cruise', t: '巡航', d: '只看最重要的：總資產、今日損益、一句晨報、今天要做的事；部位只留總覽和持股' },
  { k: 'combat', t: '作戰', d: '完整版，就是原本的畫面' },
  { k: 'deep', t: '深潛', d: '細節全部攤開：每一檔多一排數字、清單全部展開、排得更密' },
];
/** 現在的顯示模式（三段模式關掉時一律是作戰＝原本的畫面） */
export const dmode = () => (uiOn('modes') && (settings.dmode === 'cruise' || settings.dmode === 'deep') ? settings.dmode : 'combat');
export function setDmode(m) { settings.dmode = DMODES.some((x) => x.k === m) ? m : 'combat'; saveSettings(); paintDmode(); }
export const dmodeInfo = (m = dmode()) => DMODES.find((x) => x.k === m) || DMODES[1];
export function dmodeChipHTML() {
  if (!uiOn('modes')) return '';
  const m = dmodeInfo();
  const lv = { cruise: 1, combat: 2, deep: 3 }[m.k];
  return `<button type="button" class="dm-chip lv${lv}" id="dmode" aria-label="顯示模式：${m.t}（點一下換）"><i aria-hidden="true"><b></b><b></b><b></b></i><span>${m.t}</span></button>`;
}
/** 頂端名字旁邊的模式按鈕、body 的 class（巡航／深潛才有，作戰沒有任何 class） */
export function paintDmode() {
  const m = dmode();
  document.body.classList.toggle('dm-cruise', m === 'cruise');
  document.body.classList.toggle('dm-deep', m === 'deep');
  const hi = $('#top .hi');
  if (!hi) return;
  const chip = $('#dmode', hi);
  const html = dmodeChipHTML();
  if (!html) { if (chip) chip.remove(); return; }
  if (chip) chip.outerHTML = html; else hi.insertAdjacentHTML('beforeend', html);
}

// ------------------------------------------------------------------ 1 資料新鮮度光環
let freshFn = null;
let ageFn = null;
const isoD = (iso) => (iso ? +String(iso).slice(0, 10).replace(/-/g, '') : 0);
const isoHm = (iso) => (iso ? +String(iso).slice(11, 13) * 100 + +String(iso).slice(14, 16) : 0);
/** app.js 開機時給：freshness()（頂端狀態列的判斷）、minsAgo()。之後每 20 秒重畫一次光環；點光環說明 */
export function haloSetup({ fresh, minsAgo }) {
  freshFn = fresh;
  ageFn = minsAgo;
  setInterval(() => { if (document.visibilityState === 'visible') paintHalos(); }, 20000);
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest && e.target.closest('.halo[data-halo]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    const h = haloInfo(b.dataset.halo);
    if (h.txt) toast(h.txt);
  }, true);
}
/** 卡片標題上的光環。src：live＝盤中即時價、eod＝收盤後的完整分析 */
export const haloHTML = (src) => (uiOn('halo') ? `<button type="button" class="halo" data-halo="${src}" aria-label="資料新鮮度"><i aria-hidden="true"></i></button>` : '');
export function haloInfo(src) {
  if (!S.summary || !freshFn) return { st: 'rest', f: 1, txt: '' };
  const f = freshFn();
  if (f.offline || (S.syncFail || 0) >= 2) return { st: 'off', f: 0, txt: f.txt };
  if (src === 'eod') {
    const td = today();
    const { wd, h, min } = twParts();
    const L = S.live;
    const liveToday = !!(L && L.date === td);
    const ranToday = !!(L && isoD(L.at) === td && isoHm(L.at) >= 905);
    const closed = (ranToday && L.date != null && L.date < td) || (!liveToday && marketClosedOn(td));
    const asof = S.summary.asof;
    const r = haloEod({ asof, td, hm: h * 100 + min, trading: wd >= 1 && wd <= 5 && !closed });
    const txt = r.k === 'late' ? `收盤後的完整分析：今天（${fmt.d(td)}）的還沒到，平常約 14:20 更新；現在的訊號、分數是 ${fmt.d(asof)} 收盤算的`
      : r.k === 'soon' ? `收盤後的完整分析：今天收盤了，約 14:20 換成今天的；現在的訊號、分數是 ${fmt.d(asof)} 收盤算的`
        : `收盤後的完整分析：${fmt.d(asof)} 收盤算的（規則訊號、分數、加碼計畫、戰績；每個交易日收盤後更新）`;
    return { ...r, txt };
  }
  const age = S.live && ageFn ? ageFn(S.live.at) : null;
  const r = haloLive(f.key, age);
  const plain = String(f.txt || '').replace(/\s+/g, ' ');
  return { ...r, txt: r.st === 'ok' ? `盤中即時價（證交所）：${plain}。盤中約每 5 分鐘一輪，環越空代表越久沒更新` : `即時價（證交所）：${plain}` };
}
/** 重畫畫面上的光環（同一份資料只算一次） */
export function paintHalos(root = document) {
  if (!uiOn('halo')) return;
  const memo = {};
  for (const el of $$('.halo[data-halo]', root)) {
    const src = el.dataset.halo;
    const h = memo[src] || (memo[src] = haloInfo(src));
    el.className = `halo st-${h.st}`;
    el.style.setProperty('--f', h.f.toFixed(3));
    el.setAttribute('aria-label', h.txt ? `資料新鮮度：${h.txt}` : '資料新鮮度');
  }
}
/** 頂端狀態列的小圖示：光環打開時是一個會消耗的圓環，關掉時是原本的菱形 */
export function statusIcon(f) {
  if (!uiOn('halo')) return '<i></i>';
  const off = f.offline || (S.syncFail || 0) >= 2;
  const h = off ? { st: 'off', f: 0 } : haloLive(f.key, S.live && ageFn ? ageFn(S.live.at) : null);
  return `<i class="hring st-${h.st}" style="--f:${h.f.toFixed(3)}"></i>`;
}

// ------------------------------------------------------------------ 3 數字翻牌
const rollSeen = new Map();
/** 會翻牌的數字：key 是「同一個數字」的名字（例如 px:0050、T），text 是它現在顯示的字（元素裡只能放這段純文字） */
export const rollAttr = (key, text) => (uiOn('roll') ? ` data-roll="${esc(key)}" data-rv="${esc(text)}"` : '');
/** 包一層 span 的版本（數字前後還有別的字時用）。翻牌關掉時原樣輸出，和改之前一模一樣 */
export const rollSpan = (key, text) => (uiOn('roll') ? `<span class="rl" data-roll="${esc(key)}" data-rv="${esc(text)}">${esc(text)}</span>` : esc(text));
/** 畫完一次之後呼叫：和上次看到的不一樣的數字，變了的那幾位翻過去 */
export function rollDigits(root) {
  if (!uiOn('roll') || !root) return;
  const els = $$('[data-roll]', root);
  if (!els.length) return;
  const go = anim();
  const seen = [];
  for (const el of els) {
    const k = el.dataset.roll, now = el.dataset.rv;
    const was = rollSeen.get(k);
    if (go && was != null && was !== now) roll(el, was, now);
    seen.push([k, now]);
  }
  for (const [k, v] of seen) rollSeen.set(k, v);
}
function roll(el, was, now) {
  const plan = rollPlan(was, now);
  if (!plan || el.textContent !== now) return;
  const n = plan.filter((p) => p.r).length;
  el.innerHTML = `<span class="rd-sr">${esc(now)}</span>` + plan.map((p) => (p.r
    ? `<span class="rd ${p.r}" style="--i:${Math.min(p.i, 8)}" aria-hidden="true"><span class="o">${esc(p.o || ' ')}</span><span class="n">${esc(p.c)}</span></span>`
    : `<span aria-hidden="true">${esc(p.c)}</span>`)).join('');
  clearTimeout(el._rdT);
  el._rdT = setTimeout(() => { if (el.isConnected && el.dataset.rv === now) el.textContent = now; }, 900 + n * 30);
}

// ------------------------------------------------------------------ 4 鏡頭轉場
let zoomSrc = null;   // 剛剛點的那一格：{ code, cls, rect, t }
let zt = 0;           // 每一次轉場的號碼：晚到的收尾不會動到新的那一次
let zoomEl = null;    // 打開這一頁時點的是哪一種東西（熱力圖的格子、關注的一列…），關的時候縮回同一種
/** 開機時裝一次：記下在主畫面點的是哪一格（點擊的捕獲階段，比那一格自己的 openDetail 早） */
export function zoomInstall() {
  document.addEventListener('click', (e) => {
    const el = e.target && e.target.closest && e.target.closest('[data-code]');
    if (!el || !el.closest('#view')) { zoomSrc = null; return; }
    zoomSrc = { code: el.dataset.code, cls: el.classList[0] || '', rect: el.getBoundingClientRect(), t: performance.now() };
  }, true);
}
const insetOf = (sh, r) => {
  const b = sh.getBoundingClientRect();
  const top = Math.max(0, r.top - b.top), left = Math.max(0, r.left - b.left);
  const right = Math.max(0, b.right - r.right), bottom = Math.max(0, b.bottom - r.bottom);
  return `inset(${top.toFixed(1)}px ${right.toFixed(1)}px ${bottom.toFixed(1)}px ${left.toFixed(1)}px round 10px)`;
};
function clearZoom(sh) {
  sh.classList.remove('zooming', 'zoom-out');
  sh.style.removeProperty('clip-path');
  sh.style.removeProperty('transition');
  sh.style.removeProperty('pointer-events');
}
/** 打開別的全螢幕頁之前：還在縮回去的上一頁不要再動它 */
export function zoomCancel(sh = $('#sheet')) { if (!sh) return; zt++; clearZoom(sh); }
/** 單檔頁剛打開（內容已經放好）：從剛剛點的那一格放大。沒有剛點的格子（從網址、別的頁打開）就照原本的方式 */
export function zoomOpen(sh, code) {
  const z = zoomSrc;
  zoomSrc = null;
  zoomCancel(sh);
  zoomEl = null;
  if (!uiOn('zoom') || !anim() || !z || z.code !== code || performance.now() - z.t > 1200) return false;
  const r = z.rect;
  if (!(r.width > 4 && r.height > 4) || r.bottom < 0 || r.top > window.innerHeight) return false;
  zoomEl = z.cls;
  const my = ++zt;
  sh.classList.add('zooming');
  sh.style.transition = 'none';
  sh.style.clipPath = insetOf(sh, r);
  finishRise(sh);
  lockOn(r);
  sh.getBoundingClientRect();   // 先把起點畫上去
  requestAnimationFrame(() => {
    if (my !== zt) return;
    sh.style.transition = 'clip-path .44s cubic-bezier(.2, .8, .2, 1)';
    sh.style.clipPath = 'inset(0px 0px 0px 0px round 0px)';
  });
  setTimeout(() => { if (my === zt) clearZoom(sh); }, 520);
  return true;
}
/**
 * 全螢幕頁打開時原本的「升起」動畫（styles.css 的 rise）直接跳到結尾：這次改成從那一格展開。
 * 不能用 animation: none 擋——拿掉的那一刻瀏覽器會把升起再播一次（展開完畫面閃一下、往下掉再升上來）。
 * 不支援的舊瀏覽器就照樣升起，只是和展開同時發生。
 */
function finishRise(sh) {
  try {
    if (!sh.getAnimations) return;
    for (const a of sh.getAnimations()) if (a.animationName === 'rise') a.finish();
  } catch { /* 照樣升起 */ }
}
/** 鎖定框：點下去的那一格四個角閃一下（像瞄準鎖定），接著畫面從那裡展開 */
function lockOn(r) {
  const el = document.createElement('div');
  el.className = 'zoom-lock';
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = `left:${r.left.toFixed(1)}px;top:${r.top.toFixed(1)}px;width:${r.width.toFixed(1)}px;height:${r.height.toFixed(1)}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 560);
}
let zoomNot = false;   // 下一次關單檔頁不要縮回去（換分頁、換模式時，底下的畫面整個換掉了）
export function zoomSkip() { zoomNot = true; }
const zoomable = (code) => uiOn('zoom') && anim() && !!code && /^[0-9A-Za-z]+$/.test(code);
/** 這一頁關的時候要不要縮回去（效果打開、有動畫、是單檔頁）。問一次就把「下一次不要」清掉 */
export const zoomReady = (code) => {
  const skip = zoomNot;
  zoomNot = false;
  return !skip && zoomable(code);
};
/**
 * 單檔頁關掉：縮回主畫面上那一格（同一種東西優先，例如從熱力圖開的就縮回熱力圖的格子）。
 * 找不到、不在畫面上，或效果關掉，回傳 false（呼叫的地方照原本的方式直接關）；縮完才呼叫 done。
 */
export function zoomClose(sh, code, done) {
  const cls = zoomEl;
  zoomEl = null;
  if (!zoomable(code)) return false;
  const v = $('#view');
  if (!v) return false;
  const pick = (sel) => $$(sel, v).find((el) => { const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 && r.bottom > 40 && r.top < window.innerHeight - 40; });
  const sel = `[data-code="${code}"]`;
  const el = (cls && /^[a-z][a-z0-9-]*$/i.test(cls) && pick(`.${cls}${sel}`)) || pick(sel);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const my = ++zt;
  sh.classList.add('zooming', 'zoom-out');
  sh.style.pointerEvents = 'none';
  sh.style.transition = 'clip-path .34s cubic-bezier(.4, 0, .2, 1)';
  sh.style.clipPath = 'inset(0px 0px 0px 0px round 0px)';
  sh.getBoundingClientRect();
  requestAnimationFrame(() => { if (my === zt) sh.style.clipPath = insetOf(sh, r); });
  // 縮回去的途中打開了別的全螢幕頁（對決、設定…，S.openCode 有了）：馬上停，新的那一頁不能被裁切、不能點不到。縮完就不再看
  let fin = false;
  const watch = () => { if (fin || my !== zt) return; if (S.openCode) { zoomCancel(sh); return; } requestAnimationFrame(watch); };
  requestAnimationFrame(watch);
  setTimeout(() => {
    fin = true;
    if (my !== zt) return;
    clearZoom(sh);
    if (!S.openCode) { done(); lockOn(el.isConnected ? el.getBoundingClientRect() : r); }
  }, 360);
  return true;
}

// ------------------------------------------------------------------ 設定頁：介面效果（可以一個一個關、或一次回到原本的樣子）
export function hudSettingsHTML() {
  const any = UI_FX.some((x) => uiOn(x.k));
  return `<div class="sec-h"><h2>介面效果</h2><span class="aside">11/17 新增・只存在這支手機</span></div>
    <section class="panel set hud-set">
      <p class="hs-intro">只改畫面，不影響任何資料、計算與建議。用了幾天不喜歡，可以一個一個關掉，或按最下面「回到原本」，畫面就和 11/16 一模一樣。</p>
      ${UI_FX.map((x) => `<div class="srow"><div><div class="h">${x.t}</div><div class="d">${x.d}</div></div><button class="switch" role="switch" data-ui="${x.k}" aria-checked="${uiOn(x.k)}" aria-label="${x.t}"></button></div>`).join('')}
      ${uiOn('modes') ? `<div class="srow col"><div><div class="h">現在的顯示模式</div><div class="d">${esc(dmodeInfo().d)}</div></div><div class="seg">${DMODES.map((m) => `<button data-dm="${m.k}" aria-pressed="${dmode() === m.k}">${m.t}</button>`).join('')}</div></div>` : ''}
      <div class="srow"><div><div class="h">${any ? '全部回到原本的樣子' : '四個效果全部打開'}</div><div class="d">${any ? '一次關掉上面四個效果（顯示模式固定作戰），畫面回到 11/16 的樣子；之後想用再打開' : '光環、翻牌、轉場、三段模式一次打開'}</div></div><button class="btn small ${any ? 'ghost' : 'primary'}" id="s-uiall">${any ? '回到原本' : '全部打開'}</button></div>
    </section>`;
}
/** after(what)：改完之後重畫（app.js 給） */
export function bindHudSettings(sh, after) {
  $$('[data-ui]', sh).forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.ui;
    setUi(k, !uiOn(k));
    FX.cue('tap');
    after(k);
  }));
  $$('[data-dm]', sh).forEach((b) => b.addEventListener('click', () => { setDmode(b.dataset.dm); FX.cue('tap'); after('dm'); }));
  const all = $('#s-uiall', sh);
  if (all) all.addEventListener('click', () => {
    const any = UI_FX.some((x) => uiOn(x.k));
    setAllUi(!any);
    after('all');
    toast(any ? '已回到原本的樣子：四個效果都關掉了（設定這裡隨時可以再打開）' : '四個效果都打開了');
  });
}
