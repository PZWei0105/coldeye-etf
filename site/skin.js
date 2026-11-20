/* 冷眼 — 換裝與配樂（2026/11/21，PZ：「冷眼是否能夠與『解包』一樣做一個音效、配樂版，而且能夠更換 SKIN」→「建議可以全都上」）
   五套：機甲 HUD（原本的樣子＋配樂）、交易終端、聲納艙、號子電視牆、水墨禪。每一套換畫面、字型、音效、配樂、開場。
   原則：
   - 只換外觀與聲音，不動任何資料、計算、建議（skins/ 底下的檔案只碰 CSS、聲音、canvas）。
   - 顏色的意思每一套都一樣：紅漲綠跌（只用在價格、損益、多空）、琥珀＝小心、紫＝你自己（持有、成本、模擬倉）；各套只調色調。
     所以聲納艙不做整片綠色（台股綠色＝跌），交易終端的琥珀只當邊框、標題列與掃描線，要小心的東西照樣是亮琥珀加斜紋。
   - 換裝、配樂開關與音量只存在這支手機（settings.skin、settings.bgm、settings.bgmVol），不進備份。
   - 音量是 0～3 的拉桿（fx.js 的 volNorm；1、2、3＝以前的小、中、大）；設定頁的音效、配樂音量拉桿都用這裡的 volSliderHTML。
   - 「回到原本」：機甲 HUD、配樂關掉＝11/20 的樣子（styles.css 一行都沒有因為換裝改變；機甲 HUD 不載入任何換裝檔案）。
   檔案：skins/base.css（四套共用：拿掉機甲的切角與角落刻度）、skins/{代號}.css（畫面）、skins/{代號}.js（sfx 音效組、song 配樂、opening 開場）。
   index.html 開頭有一小段程式先把這一套的 CSS 放進去，打開時不會先閃一下機甲 HUD。 */
import { $, $$, S, settings, saveSettings, reduceMotion, toast, esc, isNum, taiexNow, marketTemp, quote, fmt, dirCls } from './core.js';
import * as FX from './fx.js';
import * as MUSIC from './music.js';

const GF = 'https://fonts.googleapis.com/css2?';
// 號子電視牆：點陣字只用在數字、英文與符號（中文點陣字型缺字，混在一起很醜）
const LED_TEXT = encodeURIComponent('0123456789.,:;%+-−–/()[]<>#&@!?=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz▲▼△▽ ');
export const SKINS = [
  { k: 'hud', t: '機甲 HUD', en: 'MECH HUD', d: '原本的樣子：極夜深藍、冰川藍的機體儀表。配樂是低速巡航的電子氛圍', scheme: null, color: null, sw: ['#050b15', '#4ee0ff', '#b59cff'] },
  { k: 'term', t: '交易終端', en: 'TERMINAL', d: '黑底、等寬字、琥珀色的終端機；按鍵是鍵盤聲，配樂是深夜交易室的 lo-fi', scheme: 'dark', color: '#000000', font: `${GF}family=IBM+Plex+Mono:wght@400;500;600;700&display=swap`, sw: ['#000000', '#ffb02e', '#f4ecd8'] },
  { k: 'sonar', t: '聲納艙', en: 'SONAR', d: '深海潛艇的聲納螢幕：掃描光、聲納回音、低沉的水下嗡鳴', scheme: 'dark', color: '#010b12', font: `${GF}family=Share+Tech+Mono&display=swap`, sw: ['#010b12', '#38e1e6', '#b59cff'] },
  { k: 'led', t: '號子電視牆', en: 'TICKER WALL', d: '90 年代號子的 LED 看板：紅綠點陣字、跑馬燈、復古的電子嗶嗶聲', scheme: 'dark', color: '#000000', font: `${GF}family=DotGothic16&display=swap&text=${LED_TEXT}`, sw: ['#050505', '#ff3b3b', '#36ff7a'] },
  { k: 'ink', t: '水墨禪', en: 'INK', d: '宣紙、留白、墨色；按鍵是撥弦與木魚，配樂是慢慢的古琴', scheme: 'light', color: '#f1ece1', font: `${GF}family=LXGW+WenKai+TC:wght@400;700&display=swap`, sw: ['#f1ece1', '#1d1d1f', '#a8332b'] },
];
export const skinId = () => (SKINS.some((s) => s.k === settings.skin) ? settings.skin : 'hud');
export const skinInfo = (k = skinId()) => SKINS.find((s) => s.k === k) || SKINS[0];
/** 這一套固定深色或淺色（機甲 HUD 是 null：照「外觀」的設定） */
export const skinScheme = () => skinInfo().scheme || null;
export const skinColor = () => skinInfo().color || null;
/** 配樂打開了嗎（預設打開；「回到原本」會關掉） */
export const musicOn = () => settings.bgm !== false;
const bgmVol = () => FX.volNorm(settings.bgmVol);

/** app.js 給：theme()＝重套外觀（深淺色、狀態列顏色）、replay()＝重播開機畫面、after()＝換裝後重畫 */
export const skinHooks = { theme: () => {}, replay: () => {}, after: () => {} };

// ------------------------------------------------------------------ 載入
const mods = new Map();
let mod = null;
function loadMod(k) {
  if (!mods.has(k)) mods.set(k, import(`./skins/${k}.js`).catch(() => null));
  return mods.get(k);
}
const cssFor = (k) => (k === 'hud' ? [] : ['skins/base.css', `skins/${k}.css`]);
function linkLoaded(l) {
  if (l.sheet) return Promise.resolve();
  return new Promise((ok) => { l.addEventListener('load', ok, { once: true }); l.addEventListener('error', ok, { once: true }); setTimeout(ok, 2500); });
}
/** 把這一套的 CSS 放進去（已經在的不重放；等它載入完才換，避免閃一下） */
function loadCss(k) {
  const want = cssFor(k);
  const have = $$('link[data-skin-css]');
  const ps = [];
  for (const href of want) {
    let l = have.find((x) => x.getAttribute('href') === href);
    if (!l) { l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.setAttribute('data-skin-css', ''); document.head.appendChild(l); }
    ps.push(linkLoaded(l));
  }
  const info = skinInfo(k);
  if (info.font && !$(`link[data-skin-font="${k}"]`)) {
    const f = document.createElement('link'); f.rel = 'stylesheet'; f.href = info.font; f.setAttribute('data-skin-font', k); document.head.appendChild(f);
  }
  return Promise.all(ps);
}
function dropCss(k) {
  const want = cssFor(k);
  for (const l of $$('link[data-skin-css]')) if (!want.includes(l.getAttribute('href'))) l.remove();
}
function apply(k, m) {
  const root = document.documentElement;
  if (k === 'hud') root.removeAttribute('data-skin'); else root.setAttribute('data-skin', k);
  dropCss(k);
  mod = m || null;
  FX.setBank((m && m.sfx) || null);
  if (m && m.song) MUSIC.setSong(m.song);
  skinHooks.theme();
  paintTicker();
}
/** 開機時呼叫：套上這支手機選的換裝（最多等 1.5 秒載入，載入不到就先用機甲 HUD 的聲音與開場） */
export async function initSkin() {
  const k = skinId();
  const timeout = new Promise((ok) => setTimeout(() => ok(null), 1500));
  const [m] = await Promise.all([Promise.race([loadMod(k), timeout]), Promise.race([loadCss(k), timeout])]);
  apply(k, m);
  MUSIC.setVol(bgmVol());
  MUSIC.setOn(musicOn());
  // 換裝的模組晚到（很少見）：到了再補上聲音與配樂
  if (!m) loadMod(k).then((mm) => { if (mm && skinId() === k) apply(k, mm); });
  syncMood();
}
/** 換一套（設定頁）：先載好 CSS 與聲音，再一次換掉；正在播的配樂交叉淡入淡出 */
export async function setSkin(k) {
  if (!SKINS.some((s) => s.k === k)) k = 'hud';
  settings.skin = k;
  saveSettings();
  const [m] = await Promise.all([loadMod(k), loadCss(k)]);
  if (skinId() !== k) return;   // 等的時候又換了別套
  apply(k, m);
  flash(k);
  FX.sfx('online');
  FX.haptic('ok');
  skinHooks.after();
}
/** 這一套的開場（app.js 的開機畫面用；機甲 HUD 是 null＝原本的睜眼） */
export const skinOpening = () => (mod && typeof mod.opening === 'function' ? mod.opening : null);
/** 換裝那一下的全螢幕閃光（每一套自己的樣子在 CSS 的 .skin-flash；畫面特效關掉、減少動態效果時不放） */
function flash(k) {
  if (settings.fx === false || reduceMotion()) return;
  const el = document.createElement('div');
  el.className = 'skin-flash';
  el.dataset.k = k;
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<i></i>';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1100);
}

// ------------------------------------------------------------------ 跑馬燈（交易終端、號子電視牆）
// 加權指數＋你持有的＋關注的報價，紅漲綠跌；報價比市場最新一天舊的（還沒成交、停止交易）前面標日期。
// 只是把畫面上已經有的報價排成一排，不另外抓資料；每次重畫抬頭時更新（內容沒變就不動，跑馬燈不會從頭跑）。
const TICKER = new Set(['term', 'led']);
let tkLast = '';
export function tickerItems() {
  if (!S.summary) return [];
  const out = [];
  const tx = taiexNow();
  if (tx && isNum(tx.px)) out.push({ k: '加權', n: '', px: fmt.n(tx.px, 0), pc: tx.pc, d: null });
  const held = S.P && S.P.holdings ? S.P.holdings.map((h) => h.code) : [];
  const codes = [...new Set([...held, ...(settings.watch || [])])].slice(0, 18);
  const last = Math.max(+S.summary.asof || 0, (S.live && +S.live.date) || 0);
  for (const c of codes) {
    const r = S.rows && S.rows.get(c);
    if (!r) continue;
    const q = quote(r);
    if (!isNum(q.px)) continue;
    out.push({ k: c, n: r.n, px: fmt.px(q.px), pc: q.pc, d: q.date && last && q.date < last ? q.date : null });
  }
  return out;
}
export function paintTicker() {
  const top = $('#top');
  if (!top) return;
  let el = $('.sk-ticker', top);
  if (!TICKER.has(skinId()) || !S.summary) { if (el) el.remove(); tkLast = ''; return; }
  const items = tickerItems();
  if (!items.length) { if (el) el.remove(); tkLast = ''; return; }
  const html = items.map((x) => `<span class="tk-i"><b class="num">${esc(x.k)}</b>${x.n ? `<span>${esc(String(x.n).slice(0, 8))}</span>` : ''}${x.d ? `<small class="num">${esc(fmt.d(x.d))}</small>` : ''}<span class="num">${esc(x.px)}</span><span class="num ${dirCls(x.pc)}">${isNum(x.pc) ? `${x.pc > 0 ? '▲' : x.pc < 0 ? '▼' : ''}${Math.abs(x.pc).toFixed(2)}%` : '—'}</span></span>`).join('');
  if (!el) { el = document.createElement('div'); el.className = 'sk-ticker'; el.setAttribute('aria-hidden', 'true'); top.appendChild(el); tkLast = ''; }
  if (html === tkLast) return;
  tkLast = html;
  el.innerHTML = `<div class="tk-run" style="--dur:${Math.max(28, items.length * 5)}s">${html}${html}</div>`;
}
/** 抬頭重畫時呼叫：跑馬燈、配樂的心情 */
export function skinLive() { paintTicker(); syncMood(); }

// ------------------------------------------------------------------ 配樂
export function setMusic(on) {
  settings.bgm = !!on;
  saveSettings();
  MUSIC.setOn(!!on);
  if (on) FX.unlock();
}
export function setMusicVol(v, save = true) { settings.bgmVol = FX.volNorm(v); if (save) saveSettings(); MUSIC.setVol(settings.bgmVol); }

// ------------------------------------------------------------------ 音量拉桿（設定頁：音效、配樂）
/** 0～3 → 畫面上的百分比（1、2、3＝以前的小、中、大＝33%、67%、100%） */
export const volPct = (v) => Math.round(FX.volNorm(v) / 3 * 100);
export function volSliderHTML(id, v, label) {
  const x = FX.volNorm(v), p = volPct(x);
  return `<div class="vol-sl"><input type="range" id="${id}" min="0" max="3" step="0.05" value="${x}" aria-label="${esc(label)}" aria-valuetext="${p}%" style="--vp:${p}%"><output class="num" for="${id}">${p}%</output></div>`;
}
/** 拉的時候馬上變（onInput 收到 0～3）；放開、或停下來 0.4 秒才存（不會每動一格就寫一次） */
export function bindVolSlider(el, onInput) {
  if (!el) return;
  const out = el.parentElement && el.parentElement.querySelector('output');
  let t = 0;
  el.addEventListener('input', () => {
    const v = FX.volNorm(+el.value), p = volPct(v);
    el.style.setProperty('--vp', `${p}%`);
    el.setAttribute('aria-valuetext', `${p}%`);
    if (out) out.textContent = `${p}%`;
    onInput(v);
    clearTimeout(t); t = setTimeout(saveSettings, 400);
  });
  el.addEventListener('change', () => { clearTimeout(t); saveSettings(); });
}
/** 開機畫面待命時先不放；按「啟動」才放（releaseMusic），按「不用聲音，直接進入」這次打開就不放（到設定再打開就會放） */
export const holdMusic = () => MUSIC.hold();
export const releaseMusic = () => MUSIC.release();
/** 盤勢 → 配樂的心情（每次重畫時呼叫，很便宜） */
export function moodInputs() {
  const tx = S.summary ? taiexNow() : null;
  const t = marketTemp();
  return { pc: tx && isNum(tx.pc) ? tx.pc : null, temp: t ? t.level : null, when: tx ? tx.when : '' };
}
export function syncMood() { MUSIC.setMood(MUSIC.musicMood(moodInputs())); }
function moodText() {
  const i = moodInputs();
  const m = MUSIC.musicMood(i);
  const bits = [];
  if (i.pc != null) bits.push(`加權 ${i.pc > 0 ? '+' : i.pc < 0 ? '−' : ''}${Math.abs(i.pc).toFixed(2)}%（${i.when}）`);
  if (i.temp) bits.push(`市場溫度${i.temp}`);
  const why = bits.length ? `${bits.join('、')}：` : '';
  return `${why}${m === 0 ? '照原本的速度' : m === 1 ? '放慢一點、暗一點' : '放慢、放低、樂器變少'}。規則：大盤單日漲跌 1% 以上或市場溫度陰就放慢；2% 以上或雨再慢、再低。大漲也一樣放慢，不煽動追高`;
}

// ------------------------------------------------------------------ 設定頁：換裝與配樂
const original = () => skinId() === 'hud' && !musicOn();
const origText = () => (original() ? '現在就是原本的樣子（機甲 HUD、沒有配樂）' : '一次換回機甲 HUD、關掉配樂，和 11/20 一模一樣；之後想換再來這裡選');
export function skinSettingsHTML() {
  const cur = skinId();
  const v = bgmVol();
  return `<div class="sec-h"><h2>換裝與配樂</h2><span class="aside">11/21 新增・只存在這支手機</span></div>
    <section class="panel set skin-set">
      <p class="hs-intro">每一套換畫面、字型、音效、配樂和開場；只改外觀與聲音，資料、計算、建議都不變。顏色的意思每一套都一樣：紅漲綠跌、琥珀＝小心、紫＝你自己。</p>
      <div class="skin-grid" role="radiogroup" aria-label="換裝">${SKINS.map((s) => `<button type="button" class="skin-card" role="radio" data-skin-pick="${s.k}" aria-checked="${cur === s.k}" style="--sa:${s.sw[0]};--sb:${s.sw[1]};--sc:${s.sw[2]}">
        <span class="sk-sw" aria-hidden="true"><i></i><i></i><i></i></span><span class="sk-t"><b>${esc(s.t)}</b><small class="num">${esc(s.en)}</small></span><span class="sk-d">${esc(s.d)}</span></button>`).join('')}</div>
      <div class="srow"><div><div class="h">配樂</div><div class="d">每一套有自己的配樂，全部在手機上即時合成。副官念晨報時自動壓低；App 到背景、iPhone 側邊靜音時不出聲</div></div><button class="switch" role="switch" id="s-bgm" aria-checked="${musicOn()}" aria-label="配樂"></button></div>
      <div class="srow col"><div><div class="h">配樂音量</div><div class="d">和按鍵音效的音量分開調；拉的時候馬上聽得到，配樂關著時往右拉會直接打開</div></div>${volSliderHTML('s-bgmvol', v, '配樂音量')}</div>
      <div class="srow"><div><div class="h">配樂跟著盤勢讓你冷靜</div><div class="d" id="s-mood">${esc(moodText())}</div></div></div>
      <div class="srow"><div><div class="h">看這一套的開場</div><div class="d">每天第一次打開時播；換了新的一套也可以在這裡先看</div></div><button class="btn small ghost" id="s-skin-boot">播放</button></div>
      <div class="srow"><div><div class="h">回到原本</div><div class="d" id="s-orig-d">${origText()}</div></div><button class="btn small ghost" id="s-skin-orig"${original() ? ' disabled' : ''}>回到原本</button></div>
    </section>`;
}
export function bindSkinSettings(sh, redraw) {
  $$('[data-skin-pick]', sh).forEach((b) => b.addEventListener('click', async () => {
    const k = b.dataset.skinPick;
    if (k === skinId()) return;
    $$('[data-skin-pick]', sh).forEach((z) => z.setAttribute('aria-checked', z === b));
    await setSkin(k);
    redraw();
    toast(`已換成「${skinInfo(k).t}」`);
  }));
  const bgm = $('#s-bgm', sh);
  if (bgm) bgm.addEventListener('click', () => { setMusic(!musicOn()); bgm.setAttribute('aria-checked', musicOn()); redraw(); });
  bindVolSlider($('#s-bgmvol', sh), (v) => {
    FX.unlock();
    setMusicVol(v, false);
    if (v > 0 && !musicOn()) {   // 配樂關著時往右拉：直接打開（拉到一半不能整頁重畫，開關和「回到原本」就地改）
      setMusic(true);
      if (bgm) bgm.setAttribute('aria-checked', 'true');
      const ob2 = $('#s-skin-orig', sh), od = $('#s-orig-d', sh);
      if (ob2) ob2.disabled = original();
      if (od) od.textContent = origText();
    }
  });
  const rb = $('#s-skin-boot', sh);
  if (rb) rb.addEventListener('click', () => skinHooks.replay());
  const ob = $('#s-skin-orig', sh);
  if (ob) ob.addEventListener('click', async () => {
    setMusic(false);
    if (skinId() !== 'hud') await setSkin('hud'); else skinHooks.after();
    redraw();
    toast('已回到原本：機甲 HUD、沒有配樂（設定這裡隨時可以再換）');
  });
}

// ------------------------------------------------------------------ 音效組的音量校正（skins/*.js 用）
/**
 * 每一個聲音另外加減幾 dB（tests/audio_test.mjs 量出來的：每一套的每一個聲音，最大瞬間音量都和機甲 HUD 同一個聲音差不多）。
 * 只是把配方裡每一個音的音量乘上同一個倍數，聲音的樣子不變。
 */
export function trimBank(bank, trims = {}) {
  const out = {};
  for (const [name, fn] of Object.entries(bank)) {
    const db = trims[name] || 0;
    if (!db) { out[name] = fn; continue; }
    const k = Math.pow(10, db / 20);
    const g = (o, d) => ({ ...o, gain: (o && o.gain != null ? o.gain : d) * k });
    out[name] = (A) => fn({
      ...A,
      tone: (f, at, dur, o = {}) => A.tone(f, at, dur, g(o, 0.1)),
      noise: (at, dur, o = {}) => A.noise(at, dur, g(o, 0.08)),
      pluck: (f, at, o = {}) => A.pluck(f, at, g(o, 0.12)),
      fm: (f, at, dur, o = {}) => A.fm(f, at, dur, g(o, 0.08)),
      bell: (f, at, dur, o = {}) => A.bell(f, at, dur, g(o, 0.06)),
    });
  }
  return out;
}

// ------------------------------------------------------------------ 開場共用的小工具（skins/*.js 用）
/** #rrggbb（或 rgb()）加透明度 */
export function hexA(c, a) {
  a = Math.max(0, Math.min(1, a));
  const m = /^#([0-9a-f]{6})$/i.exec(String(c).trim());
  if (m) { const n = parseInt(m[1], 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`; }
  const r = /rgba?\(([^)]+)\)/.exec(c);
  if (r) { const [x, y, z] = r[1].split(',').map((v) => parseFloat(v)); return `rgba(${x},${y},${z},${a.toFixed(3)})`; }
  return c;
}
/** 從畫面的 CSS 變數拿顏色（每一套自己的色調） */
export function skinColors(el) {
  const css = getComputedStyle(el);
  const col = (v, d) => (css.getPropertyValue(v) || '').trim() || d;
  return { ice: col('--glacier', '#4ee0ff'), me: col('--aurora', '#b59cff'), amber: col('--amber', '#ffb02e'), void: col('--void', '#02060c'), frost: col('--frost', '#e3f1ff'), frost3: col('--frost-3', '#6c83a3'), up: col('--up', '#ff4d6a'), down: col('--down', '#17d39a'), line: col('--frame-2', 'rgba(78,224,255,.42)'), seal: col('--seal', '#a8332b') };
}
/**
 * 開場的畫布：鋪滿開機畫面、跟著螢幕大小、每一格呼叫 draw(g, { W, H, now, t, dt })。
 * 回傳 { cv, g, stop() }。待命（還沒按啟動）時 30fps 就夠。
 */
export function stage(boot, draw, { sleepy = () => false } = {}) {
  const cv = document.createElement('canvas');
  cv.className = 'bt-eye';
  cv.setAttribute('aria-hidden', 'true');
  boot.prepend(cv);
  const g = cv.getContext('2d');
  if (!g) { cv.remove(); return null; }
  let W = 0, H = 0, dpr = 1, raf = 0, stopped = false, last = 0, prev = 0;
  const size = () => { dpr = Math.min(2, window.devicePixelRatio || 1); W = boot.clientWidth; H = boot.clientHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); };
  size();
  window.addEventListener('resize', size);
  const t0 = performance.now();
  const frame = (now) => {
    if (stopped) return;
    raf = requestAnimationFrame(frame);
    if (sleepy() && now - last < 33) return;
    last = now;
    const dt = prev ? Math.min(0.1, (now - prev) / 1000) : 0.016;
    prev = now;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    try { draw(g, { W, H, now, t: (now - t0) / 1000, dt }); } catch { /* 開場畫不出來不影響開機 */ }
  };
  raf = requestAnimationFrame(frame);
  return { cv, g, stop() { stopped = true; cancelAnimationFrame(raf); window.removeEventListener('resize', size); } };
}
/** 某個元素的中心（相對開機畫面）；沒有就用畫面上方三分之一 */
export function centerIn(boot, el) {
  const br = boot.getBoundingClientRect();
  if (el) { const r = el.getBoundingClientRect(); if (r.width) return [r.left - br.left + r.width / 2, r.top - br.top + r.height / 2]; }
  return [br.width / 2, br.height * 0.32];
}
/**
 * 把字變成點陣（號子電視牆的 LED、交易終端的方塊字用）：在小畫布上寫字，回傳 { w, h, on(x, y) }。
 * h＝幾排點；字型用系統的黑體，中文也寫得出來。
 */
export function dotText(text, h = 16, weight = 900) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = `${weight} ${h}px "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif`;
  g.font = font;
  const w = Math.max(1, Math.ceil(g.measureText(text).width));
  c.width = w; c.height = h;
  g.font = font;
  g.textBaseline = 'middle';
  g.fillStyle = '#fff';
  g.fillText(text, 0, h / 2 + 1);
  const d = g.getImageData(0, 0, w, h).data;
  return { w, h, on: (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 110 };
}
