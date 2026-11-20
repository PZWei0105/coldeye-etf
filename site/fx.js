/* 冷眼 — 聲光：音效（WebAudio 即時合成，不用下載任何音檔）、繁體中文語音播報、震動回饋、畫面特效。
   - 手機規定「先點一下」才能出聲：第一次點擊或按鍵時解鎖。
   - 分頁在背景、設定關掉、iPhone 側邊靜音開關打開時都不出聲；「減少動態效果」打開時不放特效。
   - 這個檔案不讀寫任何資料：設定由 app.js 用 bind() 傳進來。 */

const DEF = { sfx: true, vol: 2, voice: true, fx: true, haptic: true };
let getPrefs = () => DEF;
/** app.js 開機時把 settings 傳進來（之後改設定會即時生效） */
export function bind(fn) { getPrefs = () => ({ ...DEF, ...(fn() || {}) }); }
const prefs = () => getPrefs();
const reduce = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
export const fxOn = () => prefs().fx !== false && !reduce();

// ------------------------------------------------------------------ 音效引擎
let ctx = null, master = null, wet = null, noiseBuf = null, comp = null, H = null, musicIn = null;
const VOL = { 1: 0.45, 2: 0.85, 3: 1.35 };
function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    // iPhone：跟著側邊的靜音開關（靜音時不出聲），不會打斷正在聽的音樂
    if (navigator.audioSession) navigator.audioSession.type = 'ambient';
  } catch { /* 舊版 Safari */ }
  try { ctx = new AC({ latencyHint: 'interactive' }); } catch { ctx = new AC(); }
  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
  master = ctx.createGain();
  master.gain.value = VOL[prefs().vol] || VOL[2];
  master.connect(comp).connect(ctx.destination);
  // 一點點「機艙迴音」：短延遲＋回授＋低通，讓上鎖、揭曉的聲音有尾巴
  const dly = ctx.createDelay(0.5); dly.delayTime.value = 0.13;
  const fb = ctx.createGain(); fb.gain.value = 0.28;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
  wet = ctx.createGain(); wet.gain.value = 1;
  wet.connect(dly); dly.connect(lp); lp.connect(fb); fb.connect(dly); lp.connect(master);
  noiseBuf = makeNoise(ctx);
  H = makeSynth(ctx, master, wet, noiseBuf);
  return ctx;
}
/** 固定種子的雜訊（1.2 秒）：每次聽起來都一樣 */
export function makeNoise(c) {
  const len = Math.floor(c.sampleRate * 1.2);
  const b = c.createBuffer(1, len, c.sampleRate);
  const ch = b.getChannelData(0);
  let seed = 7;
  for (let i = 0; i < len; i++) { seed = (seed * 16807) % 2147483647; ch[i] = (seed / 2147483647) * 2 - 1; }
  return b;
}
let unlocked = false;
const unlockSubs = new Set();
/** 音效引擎喚醒之後通知（配樂 music.js 用：手機要先點一下才能出聲） */
export function onUnlock(fn) { unlockSubs.add(fn); return () => unlockSubs.delete(fn); }
/** 每一次點擊或按鍵時呼叫（app.js 掛在整個頁面上）：建立並喚醒音效引擎 */
export function unlock() {
  const c = ensure();
  if (!c) return;
  // iPhone 從背景回來時是 interrupted（不是 suspended），一樣要在點擊當下叫醒
  if (c.state !== 'running') c.resume().then(() => { for (const fn of unlockSubs) { try { fn(); } catch { /* 不影響音效 */ } } }).catch(() => {});
  if (!unlocked) {
    try {   // iOS 要在點擊當下播一段聲音才算解鎖
      const b = c.createBuffer(1, 1, c.sampleRate);
      const s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0);
    } catch { /* 不支援 */ }
    unlocked = true;
  }
  if (c.state === 'running') for (const fn of unlockSubs) { try { fn(); } catch { /* 不影響音效 */ } }
}
export const audioReady = () => !!(ctx && ctx.state === 'running');
/** 配樂用：同一個音效引擎（跟著 iPhone 靜音開關），自己的音量與壓縮，不經過音效的音量 */
export function audioCtx() { return ensure(); }
export function musicOut() {
  const c = ensure();
  if (!c) return null;
  if (!musicIn) {
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -10; lim.knee.value = 6; lim.ratio.value = 6; lim.attack.value = 0.005; lim.release.value = 0.25;
    musicIn = c.createGain();
    musicIn.gain.value = 1;
    musicIn.connect(lim).connect(c.destination);
  }
  return musicIn;
}
export const noiseBuffer = () => (ensure() ? noiseBuf : null);

/**
 * 合成器：c＝AudioContext（或離線的 OfflineAudioContext，測試量音量用），out＝輸出，wetIn＝殘響／迴音的入口，nb＝雜訊。
 * 時間一律是「從現在起幾秒後」（at）。tone／noise 是原本機甲 HUD 的配方，參數和以前完全一樣；
 * 加了幾個選用的參數給換裝與配樂用（rel 起落包絡、det 微調、pan 左右、lpTo 濾波掃動、vib 顫音、out 另外的輸出），沒給就和以前一模一樣。
 */
export function makeSynth(c, out, wetIn, nb) {
  const T = (at) => c.currentTime + at;
  const route = (node, o) => {
    let n = node;
    if (o.pan) { try { const p = c.createStereoPanner(); p.pan.value = o.pan; n.connect(p); n = p; } catch { /* 舊瀏覽器 */ } }
    n.connect(o.out || out);
    if (o.wet && (o.wetTo || wetIn)) { const w = c.createGain(); w.gain.value = o.wet; n.connect(w); w.connect(o.wetTo || wetIn); }
    if (o.sends) for (const [dst, amt] of o.sends) { if (!dst || !amt) continue; const w = c.createGain(); w.gain.value = amt; n.connect(w); w.connect(dst); }
  };
  // 包絡：預設（原本的）＝指數起音、指數衰減到 dur；rel＝起音後維持，最後 rel 秒收掉（墊音、持續音用）
  const env = (g, t0, dur, peak, a, o) => {
    if (o.rel) {
      const r = Math.min(o.rel, dur * 0.95);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(peak, t0 + a);
      g.gain.setValueAtTime(peak, Math.max(t0 + a, t0 + dur - r));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    } else {
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    }
  };
  function tone(f, at, dur, o = {}) {
    const t0 = T(at);
    const osc = c.createOscillator();
    if (o.wave) osc.setPeriodicWave(o.wave); else osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(f, t0);
    if (o.det) osc.detune.setValueAtTime(o.det, t0);
    if (o.glide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.glide), t0 + (o.glideT || dur));
    let lfo = null;
    if (o.vib) {
      lfo = c.createOscillator(); lfo.frequency.value = o.vib.rate || 5.5;
      const d = c.createGain(); d.gain.setValueAtTime(0, t0); d.gain.linearRampToValueAtTime(o.vib.depth || 12, t0 + (o.vib.delay || 0.15));
      lfo.connect(d).connect(osc.detune); lfo.start(t0); lfo.stop(t0 + dur + 0.05);
    }
    const g = c.createGain();
    env(g, t0, dur, o.gain ?? 0.1, o.attack ?? 0.004, o);
    let node = osc;
    if (o.lp) {
      const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.setValueAtTime(o.lp, t0);
      if (o.q) fl.Q.value = o.q;
      if (o.lpTo) fl.frequency.exponentialRampToValueAtTime(Math.max(40, o.lpTo), t0 + (o.lpT || dur));
      osc.connect(fl); node = fl;
    }
    node.connect(g);
    route(g, o);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }
  function noise(at, dur, o = {}) {
    const t0 = T(at);
    const src = c.createBufferSource();
    src.buffer = nb;
    const fl = c.createBiquadFilter();
    fl.type = o.type || 'bandpass';
    fl.frequency.setValueAtTime(o.f || 1200, t0);
    if (o.glide) fl.frequency.exponentialRampToValueAtTime(o.glide, t0 + dur);
    fl.Q.value = o.q ?? 1;
    const g = c.createGain();
    env(g, t0, dur, o.gain ?? 0.08, o.attack ?? 0.01, o);
    src.connect(fl).connect(g);
    route(g, o);
    src.start(t0, o.off ?? Math.random() * 0.2);
    src.stop(t0 + dur + 0.05);
  }
  // 撥弦（Karplus–Strong）：雜訊在一圈延遲裡越磨越圓，像古琴、吉他的弦；同一個音高只算一次
  const plucks = new Map();
  function pluckBuf(f, damp, soft, len) {
    const key = `${Math.round(f * 10)}|${damp}|${soft}|${len}|${c.sampleRate}`;
    let b = plucks.get(key);
    if (b) return b;
    const sr = c.sampleRate, N = Math.max(2, Math.round(sr / f)), L = Math.floor(sr * len);
    b = c.createBuffer(1, L, sr);
    const y = b.getChannelData(0);
    const ring = new Float32Array(N);
    let seed = 1234 + N;
    for (let i = 0; i < N; i++) { seed = (seed * 16807) % 2147483647; ring[i] = (seed / 2147483647) * 2 - 1; }
    for (let k = 0; k < soft; k++) for (let i = 0; i < N; i++) ring[i] = 0.5 * (ring[i] + ring[(i + 1) % N]);   // 起音柔一點
    let mx = 0;
    for (let i = 0; i < N; i++) mx = Math.max(mx, Math.abs(ring[i]));
    const sc = mx > 0 ? 1 / mx : 1;
    let idx = 0;
    for (let i = 0; i < L; i++) {
      const cur = ring[idx], nxt = ring[(idx + 1) % N];
      y[i] = cur * sc;
      ring[idx] = damp * 0.5 * (cur + nxt);
      idx = (idx + 1) % N;
    }
    if (plucks.size > 80) plucks.delete(plucks.keys().next().value);
    plucks.set(key, b);
    return b;
  }
  function pluck(f, at, o = {}) {
    const t0 = T(at);
    const len = o.len || 2.2;
    const src = c.createBufferSource();
    src.buffer = pluckBuf(f, o.damp ?? 0.996, o.soft ?? 1, len);
    const g = c.createGain();
    const peak = o.gain ?? 0.12;
    g.gain.setValueAtTime(peak, t0);
    if (o.dur) { g.gain.setValueAtTime(peak, t0 + Math.max(0.01, o.dur - 0.08)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur); }
    let node = src;
    if (o.lp) { const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = o.lp; src.connect(fl); node = fl; }
    node.connect(g);
    route(g, o);
    src.start(t0);
    src.stop(t0 + (o.dur || len) + 0.05);
  }
  // 電鋼琴（FM）：調變器的深度一開始大、很快變小，聽起來像敲在金屬片上的琴
  function fm(f, at, dur, o = {}) {
    const t0 = T(at);
    const car = c.createOscillator(); car.frequency.setValueAtTime(f, t0);
    const mod = c.createOscillator(); mod.frequency.setValueAtTime(f * (o.ratio || 1), t0);
    const mg = c.createGain();
    const idx = (o.idx ?? 2.2) * f;
    mg.gain.setValueAtTime(idx, t0);
    mg.gain.exponentialRampToValueAtTime(Math.max(1, idx * (o.idxEnd ?? 0.12)), t0 + Math.min(dur, o.idxT || 0.7));
    mod.connect(mg).connect(car.frequency);
    const g = c.createGain();
    env(g, t0, dur, o.gain ?? 0.08, o.attack ?? 0.003, o);
    car.connect(g);
    route(g, o);
    car.start(t0); mod.start(t0);
    car.stop(t0 + dur + 0.05); mod.stop(t0 + dur + 0.05);
  }
  // 鐘、磬、缽：幾個不成整數倍的泛音，各自慢慢消失
  function bell(f, at, dur, o = {}) {
    const parts = o.parts || [[1, 1], [2.0, 0.42], [2.76, 0.3], [5.4, 0.14], [8.93, 0.06]];
    const peak = o.gain ?? 0.06;
    for (const [r, a] of parts) {
      const fr = f * r;
      if (fr > 16000) continue;
      tone(fr, at, dur * (1.1 - Math.min(0.75, r * 0.07)), { gain: peak * a, attack: o.attack ?? 0.002, out: o.out, wet: o.wet, wetTo: o.wetTo, pan: o.pan, sends: o.sends });
    }
  }
  return { c, tone, noise, pluck, fm, bell, now: () => c.currentTime };
}

/** 每個聲音的配方：同一組音高（A 小調五聲）讓整套聲音像同一台機體（這是機甲 HUD 的音效組；換裝可以換掉，見 setBank） */
const SOUNDS = {
  tap: (A) => A.tone(1850, 0, 0.035, { type: 'triangle', gain: 0.06 }),
  nav: (A) => { A.tone(1318.5, 0, 0.05, { gain: 0.07 }); A.tone(1760, 0.045, 0.07, { gain: 0.06, wet: 0.2 }); },
  open: (A) => { A.tone(392, 0, 0.16, { type: 'sawtooth', gain: 0.035, glide: 1250, lp: 2600 }); A.noise(0, 0.14, { gain: 0.035, f: 2500, glide: 7000, q: 2 }); A.tone(2349, 0.12, 0.05, { gain: 0.035 }); },
  close: (A) => { A.tone(1046.5, 0, 0.11, { type: 'sawtooth', gain: 0.03, glide: 330, lp: 2000 }); },
  ok: (A) => { A.tone(880, 0, 0.11, { gain: 0.09 }); A.tone(1318.5, 0.07, 0.22, { gain: 0.08, wet: 0.35 }); },
  scan: (A) => {
    [659.3, 784, 987.8, 1174.7, 1318.5, 1568, 1760, 1975.5].forEach((f, i) => A.tone(f, i * 0.055, 0.045, { type: 'square', gain: 0.018, lp: 3200 }));
    A.noise(0, 0.55, { gain: 0.03, f: 700, glide: 5200, q: 5 });
  },
  good: (A) => A.tone(1568, 0, 0.07, { gain: 0.05, wet: 0.2 }),
  warn: (A) => { A.tone(523.3, 0, 0.07, { type: 'square', gain: 0.025, lp: 1500 }); A.tone(493.9, 0.085, 0.08, { type: 'square', gain: 0.022, lp: 1500 }); },
  stop: (A) => { A.tone(220, 0, 0.18, { type: 'sawtooth', gain: 0.05, lp: 900 }); A.tone(207.7, 0.2, 0.22, { type: 'sawtooth', gain: 0.045, lp: 900 }); },
  lock: (A) => { A.tone(147, 0, 0.18, { gain: 0.2, glide: 70 }); A.noise(0, 0.05, { type: 'lowpass', f: 1800, gain: 0.08 }); A.tone(1760, 0.06, 0.28, { gain: 0.06, wet: 0.5 }); A.tone(2637, 0.11, 0.32, { gain: 0.035, wet: 0.5 }); },
  alert: (A) => { for (let k = 0; k < 3; k++) A.tone(987.8, k * 0.13, 0.075, { type: 'square', gain: 0.035, lp: 2600 }); },
  err: (A) => A.tone(155, 0, 0.17, { type: 'sawtooth', gain: 0.055, lp: 700 }),
  ping: (A) => A.tone(1318.5, 0, 0.09, { gain: 0.035, wet: 0.25 }),
  pxUp: (A) => { A.tone(1568, 0, 0.05, { gain: 0.03 }); A.tone(2093, 0.04, 0.06, { gain: 0.025 }); },
  pxDown: (A) => { A.tone(784, 0, 0.05, { gain: 0.03 }); A.tone(587.3, 0.04, 0.06, { gain: 0.025 }); },
  hit: (A) => [523.3, 659.3, 784, 1046.5].forEach((f, i) => A.tone(f, i * 0.07, 0.2, { gain: 0.07, wet: 0.35 })),
  miss: (A) => [440, 349.2, 293.7].forEach((f, i) => A.tone(f, i * 0.09, 0.24, { type: 'triangle', gain: 0.06, wet: 0.25 })),
  comms: (A) => { A.noise(0, 0.08, { gain: 0.03, f: 3000, q: 3 }); A.tone(1046.5, 0.05, 0.05, { gain: 0.05 }); A.tone(1568, 0.11, 0.08, { gain: 0.05 }); },
  tick: (A) => A.tone(2400, 0, 0.022, { type: 'square', gain: 0.014, lp: 4200 }),
  ignite: (A) => {
    A.noise(0, 1.15, { type: 'lowpass', f: 90, glide: 700, gain: 0.12, attack: 0.25 });
    A.tone(55, 0, 1.15, { type: 'sawtooth', gain: 0.05, glide: 110, lp: 420, attack: 0.2 });
    A.tone(110, 0.15, 0.95, { gain: 0.06, glide: 440, attack: 0.1 });
    [220, 329.6, 440, 554.4].forEach((f, i) => A.tone(f, 0.98 + i * 0.03, 1.4, { type: 'triangle', gain: 0.04, attack: 0.05, wet: 0.4 }));
    A.tone(1760, 1.05, 0.6, { gain: 0.03, wet: 0.5 });
  },
  online: (A) => [880, 1108.7, 1318.5, 1760].forEach((f, i) => A.tone(f, i * 0.065, 0.18, { gain: 0.05, wet: 0.4 })),
  stamp: (A) => { A.noise(0, 0.07, { type: 'lowpass', f: 900, gain: 0.14 }); A.tone(98, 0, 0.22, { gain: 0.18, glide: 55 }); A.tone(1975.5, 0.08, 0.3, { gain: 0.03, wet: 0.5 }); },
  // 2026/11/18 超級大更新：冷眼睜開（虹膜轉起來的一串亮音＋一口氣）、戰況揭曉、歷史風暴的雷聲
  iris: (A) => {
    A.noise(0, 0.6, { f: 400, glide: 6000, q: 3, gain: 0.04, attack: 0.18 });
    [440, 554.4, 659.3, 880, 1108.7, 1318.5].forEach((f, i) => A.tone(f, 0.08 + i * 0.05, 0.5, { type: 'triangle', gain: 0.035, attack: 0.02, wet: 0.45 }));
    A.tone(2637, 0.42, 0.7, { gain: 0.025, wet: 0.6 });
  },
  reveal: (A) => { A.tone(110, 0, 0.5, { gain: 0.12, glide: 55 }); [659.3, 987.8, 1318.5].forEach((f, i) => A.tone(f, 0.04 + i * 0.03, 0.9, { gain: 0.045, attack: 0.01, wet: 0.5 })); A.noise(0, 0.25, { type: 'lowpass', f: 2400, glide: 300, gain: 0.05 }); },
  storm: (A) => {
    A.noise(0, 0.12, { type: 'highpass', f: 3000, gain: 0.08 });
    A.noise(0.05, 1.0, { type: 'lowpass', f: 380, glide: 90, gain: 0.2, attack: 0.03 });
    A.noise(0.55, 0.95, { type: 'lowpass', f: 220, glide: 60, gain: 0.14, attack: 0.08 });
    A.tone(55, 0.05, 1.3, { type: 'sawtooth', gain: 0.05, glide: 33, lp: 160, attack: 0.05 });
  },
};
/** 全部聲音的名字（換裝的音效組要每一個都有，tests/skin_test.mjs 會檢查） */
export const SOUND_NAMES = Object.keys(SOUNDS);
/** 機甲 HUD 的原始配方（測試量音量用） */
export const HUD_SOUNDS = SOUNDS;
// 換裝的音效組：{ 名字: (A) => … }；null＝機甲 HUD 原本的聲音
let bank = null;
export function setBank(b) { bank = b && typeof b === 'object' ? b : null; }
const lastAt = new Map();
let recent = [];
/** 播一個音效（沒解鎖、關掉音效、分頁在背景時不播；同一個聲音 45ms 內不重複） */
export function sfx(name) {
  const p = prefs();
  if (!p.sfx || document.hidden || !SOUNDS[name]) return;
  if (!ctx || ctx.state !== 'running') return;
  const now = performance.now();
  if (now - (lastAt.get(name) || 0) < 45) return;
  recent = recent.filter((t) => now - t < 300);
  if (recent.length >= 8) return;
  lastAt.set(name, now);
  recent.push(now);
  master.gain.value = VOL[p.vol] || VOL[2];
  const fn = (bank && bank[name]) || SOUNDS[name];
  try { fn(H); } catch { /* 不讓音效影響 App */ }
}

// ------------------------------------------------------------------ 震動（Android 有效；iPhone 的網頁不支援）
const HAPTIC = { tap: 6, nav: 8, ok: 14, open: 10, lock: [16, 40, 26], stamp: [22, 30, 14], alert: [30, 70, 30, 70, 30], err: [50, 40, 50], warn: [14, 50, 14], stop: [40, 60, 40], hit: [12, 30, 12, 30, 40], miss: [45], ignite: [20, 60, 20, 60, 60], online: [10, 40, 10], storm: [40, 80, 20, 60, 30] };
export function haptic(kind = 'tap') {
  if (prefs().haptic === false) return;
  // 瀏覽器規定：使用者點過畫面之後才能震動（不然只會在主控台留下錯誤）
  try { if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return; } catch { /* 舊瀏覽器 */ }
  const p = HAPTIC[kind] ?? (typeof kind === 'number' ? kind : 10);
  try { if (navigator.vibrate) navigator.vibrate(p); } catch { /* 不支援 */ }
}
/** 聲音＋震動一起 */
export function cue(name) { sfx(name); if (HAPTIC[name] != null) haptic(name); }

// ------------------------------------------------------------------ 語音播報（只用裝置內建的語音，不連網）
let voices = [];
const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
const voiceSubs = new Set();
/** 語音清單載入或改變時通知（設定頁的語音選單用；iPhone、Android 常常晚一點才給清單） */
export function onVoices(fn) { voiceSubs.add(fn); return () => voiceSubs.delete(fn); }
// 清單真的變了才通知；通知裡又來讀清單（設定頁重畫語音那一行）不會再觸發一次。
// 沒有任何語音的裝置（每次讀都是空的）以前會在設定頁重畫時一直互相觸發，卡住畫面
let voicesKey = null, loadingVoices = false;
function loadVoices() {
  if (loadingVoices) return;
  loadingVoices = true;
  try {
    try { voices = window.speechSynthesis.getVoices() || []; } catch { voices = []; }
    const key = voices.map((v) => `${v.name}|${v.lang}|${v.localService}`).join(',');
    if (key !== voicesKey) {
      voicesKey = key;
      for (const fn of voiceSubs) { try { fn(); } catch { /* 不影響播報 */ } }
    }
  } finally { loadingVoices = false; }
}
if (canSpeak()) {
  loadVoices();
  try { window.speechSynthesis.addEventListener('voiceschanged', loadVoices); } catch { /* 舊瀏覽器 */ }
}
/*
 * 中文語音分三種：台灣（國語）、其他普通話（中國大陸、新加坡）、粵語（香港、澳門）。
 * 粵語一律不用（冷眼的稿子是台灣國語）；有台灣的就用台灣的，沒有才用其他普通話，並在設定頁提醒安裝台灣語音。
 * 以前用「Hant（繁體）」判斷台灣，結果「粵語（繁體，香港）」也被當成台灣——繁體字不等於台灣口音。
 */
const ZH = /^(zh|cmn|yue)([-_]|$)/i;
const ZH_NAME = /中文|國語|國語|普通話|普通话|粵語|粤语|Chinese|Mandarin|Cantonese/i;
const CANTO = /(^|[^a-z])(yue|zh[-_](hant[-_])?(hk|mo))([^a-z]|$)|香港|澳門|澳门|粵|粤|廣東|广东|Cantonese|Hong\s?Kong|Macau|Sinji|善怡|Tracy|HiuGaai|HiuMaan|WanLung/i;
const TWV = /(^|[^a-z])(zh|cmn)([-_]hant)?[-_]tw([^a-z]|$)|臺灣|台灣|Taiwan|國語|Mei-?Jia|美佳|Hanhan|Yating|Zhiwei|HsiaoChen|HsiaoYu/i;
const isZh = (v) => !!v && (ZH.test(v.lang || '') || ZH_NAME.test(v.name || ''));
/** 一個語音是哪一種：'tw' 台灣國語、'cn' 其他普通話、'yue' 粵語、null 不是中文 */
export function classifyVoice(v) {
  if (!isZh(v)) return null;
  const t = `${v.lang || ''} ${v.name || ''}`;
  if (CANTO.test(t)) return 'yue';
  return TWV.test(t) ? 'tw' : 'cn';
}
/**
 * 從語音清單挑一個（純函式，tests/voice_test.mjs 有測）：只用裝置內建（離線）的語音，網路語音（桌機 Chrome 的「Google 國語」、
 * Edge 的 Online 語音）會把要念的文字送出去，而晨報裡有你的持股和戰績。want：設定頁選的語音名稱（找不到就自動挑）。
 */
export function chooseVoice(list, want = '') {
  const L = (list || []).filter((v) => v && v.localService !== false && !/Online/i.test(v.name || '') && classifyVoice(v) && classifyVoice(v) !== 'yue');
  if (want) { const v = L.find((x) => x.name === want); if (v) return v; }
  const tw = L.filter((v) => classifyVoice(v) === 'tw');
  return tw.find((v) => /Mei-?Jia|美佳|Yating|Hanhan|HsiaoChen|HsiaoYu|Zhiwei/i.test(v.name || ''))
    || tw.find((v) => /^(zh|cmn)[-_]TW$/i.test(v.lang || '')) || tw[0] || L[0] || null;
}
function pickVoice() { return chooseVoice(voices, prefs().voiceName || ''); }
/** 設定頁的語音選單：可以用的中文語音（台灣的在前；粵語、網路語音不列） */
export function voiceList() {
  if (canSpeak() && !voices.length) loadVoices();
  return voices.filter((v) => v.localService !== false && !/Online/i.test(v.name || '') && ['tw', 'cn'].includes(classifyVoice(v)))
    .map((v) => ({ name: v.name, lang: v.lang, tw: classifyVoice(v) === 'tw' }))
    .sort((a, b) => b.tw - a.tw || a.name.localeCompare(b.name));
}
/** 現在會用哪一個語音（設定頁顯示）：{ name, lang, tw } 或 null */
export function voiceInfo() { const v = pickVoice(); return v ? { name: v.name, lang: v.lang, tw: classifyVoice(v) === 'tw' } : null; }
/** none：瀏覽器不支援；ok：有內建的國語語音；yue：只有粵語；remote：只有網路語音（不使用）；nozh：沒有中文語音；unknown：語音清單還沒載入 */
export function voiceStatus() {
  if (!canSpeak()) return 'none';
  if (!voices.length) loadVoices();
  if (!voices.length) return 'unknown';
  if (pickVoice()) return 'ok';
  const local = voices.filter((v) => v.localService !== false && !/Online/i.test(v.name || ''));
  if (local.some((v) => classifyVoice(v) === 'yue')) return 'yue';
  return voices.some(isZh) ? 'remote' : 'nozh';
}
export const hasVoice = () => ['ok', 'unknown'].includes(voiceStatus());
/** 這台裝置在哪裡安裝「中文（台灣）」語音 */
export function voiceInstallHint() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iPhone：設定 → 輔助使用 → 朗讀內容 → 聲音 → 中文（台灣）→ 下載「美佳」';
  if (/Android/i.test(ua)) return 'Android：設定 → 系統 → 語言 → 文字轉語音輸出 → Google 語音服務的設定 → 安裝語音資料 → 中文（台灣）';
  if (/Windows/i.test(ua)) return 'Windows：設定 → 時間與語言 → 語音 → 新增語音 → 中文（台灣）';
  if (/Mac OS/i.test(ua)) return 'Mac：系統設定 → 輔助使用 → 朗讀內容 → 系統聲音 → 管理聲音 → 中文（台灣）';
  return '在系統設定的「文字轉語音」安裝「中文（台灣）」語音';
}
/** 沒辦法念的時候，給使用者看的一句話 */
export function voiceWhy() {
  const s = voiceStatus();
  if (s === 'yue') return `這台裝置只有粵語（香港）的中文語音，冷眼不用它念。${voiceInstallHint()}`;
  if (s === 'remote') return `這台裝置只有「網路語音」：要念的內容會送到語音服務，為了不把你的持股送出去，冷眼不用它。${voiceInstallHint()}`;
  if (s === 'nozh' || s === 'unknown') return `這台裝置沒有內建的中文語音。${voiceInstallHint()}`;
  return '這個瀏覽器不支援語音播報';
}
/** 用的不是台灣口音時的提醒（設定頁顯示）；是台灣的就回空字串 */
export function voiceHint() {
  const v = voiceInfo();
  if (!v || v.tw) return '';
  return `這台裝置沒有台灣的中文語音，現在用的是其他地區的普通話（${v.name}）。${voiceInstallHint()}，裝好之後冷眼會自動改用台灣口音。`;
}
/** 念的時候用的語言標籤：台灣的語音一律標 zh-TW（Android 的 Chrome 常常只看這個標籤挑語音） */
const langOf = (v) => (classifyVoice(v) === 'tw' ? 'zh-TW' : v.lang);
/** 把畫面上的文字改成好念的句子：+0.84% → 上漲百分之 0.84、10/24 → 10 月 24 日、去掉千分位、
 *  ETF 代號一個字一個字念（0050 念「零零五零」，不是「五十」；00679B 念「零零六七九 B」，和台灣的念法一樣） */
export function speechText(s) {
  return String(s || '')
    .replace(/\*\*/g, '')
    .replace(/(^|[^\d.,])(00\d{2,4})([A-Z]{0,2})(?![\d.])/g, (m, a, d, x) => `${a}${d.split('').join(' ')}${x ? ` ${x.split('').join(' ')}` : ''} `)
    .replace(/([+＋])\s?(\d+(?:\.\d+)?)\s?%/g, '上漲百分之$2')
    .replace(/([−\-－])\s?(\d+(?:\.\d+)?)\s?%/g, '下跌百分之$2')
    .replace(/(\d+(?:\.\d+)?)\s?%/g, '百分之$1')
    .replace(/(\d),(?=\d{3})/g, '$1')
    .replace(/(^|[^\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/g, '$1$2月$3日')
    .replace(/／/g, '、')
    .replace(/[「」『』]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
const speakSubs = new Set();
let speaking = false;
let speakToken = 0;
export function onSpeak(fn) { speakSubs.add(fn); return () => speakSubs.delete(fn); }
function setSpeaking(v) { speaking = v; for (const fn of speakSubs) { try { fn(v); } catch { /* 不影響播報 */ } } }
export const isSpeaking = () => speaking;
/** 念一段文字（長文分句念，避免部分瀏覽器念到一半停掉）。回傳 false 代表沒辦法念。 */
export function speak(text, { force = false } = {}) {
  if (!canSpeak() || (!force && prefs().voice === false)) return false;
  const s = speechText(text);
  if (!s) return false;
  stopSpeak();
  const my = ++speakToken;
  const cut = (str, re) => str.replace(re, '$1\u0000').split('\u0000');
  const parts = cut(s, /([。！？；\n])/g).map((x) => x.trim()).filter(Boolean)
    .flatMap((x) => (x.length > 140 ? cut(x, /([，、])/g) : [x]));
  if (!voices.length) loadVoices();
  const v = pickVoice();
  if (!v) return false;   // 沒有內建的中文語音：寧可不念，也不用網路語音
  const vol = { 1: 0.6, 2: 0.9, 3: 1 }[prefs().vol] || 0.9;
  setSpeaking(true);
  parts.forEach((p, i) => {
    const u = new SpeechSynthesisUtterance(p);
    u.lang = langOf(v);
    u.voice = v;
    u.rate = 1.04;
    u.pitch = 1;
    u.volume = vol;
    if (i === parts.length - 1) u.onend = () => { if (my === speakToken) setSpeaking(false); };
    u.onerror = () => { if (my === speakToken && i === parts.length - 1) setSpeaking(false); };
    window.speechSynthesis.speak(u);
  });
  // 有些瀏覽器不會觸發 onend：保險起見，估計念完的時間後也把狀態收掉
  const est = s.length * 230 + 2000;
  setTimeout(() => { if (my === speakToken && speaking && !window.speechSynthesis.speaking) setSpeaking(false); }, est);
  return true;
}
/** iPhone 規定語音要在「點擊的當下」先開口一次，之後才能自動念：開機點火時先念一個聽不到的空白 */
export function primeSpeech() {
  if (!canSpeak()) return;
  if (!voices.length) loadVoices();
  const v = pickVoice();
  // 語音清單還沒載入（iPhone 常見）也要在點擊當下先「開口」一次，不然之後的晨報念不出來；念的是空白、音量 0，沒有任何內容
  if (!v && voices.length) return;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    u.lang = v ? langOf(v) : 'zh-TW';
    if (v) u.voice = v;
    window.speechSynthesis.speak(u);
  } catch { /* 不支援 */ }
}
export function stopSpeak() {
  speakToken++;
  try { if (canSpeak()) window.speechSynthesis.cancel(); } catch { /* 不支援 */ }
  if (speaking) setSpeaking(false);
}

// ------------------------------------------------------------------ 畫面特效（全部可關，尊重「減少動態效果」）
/** 在畫面中間蓋一個章：「已記錄」「對了」…；tone：aurora（你自己）／glacier（系統）／amber（小心） */
export function stamp(text, tone = 'aurora', sub = '') {
  if (!fxOn()) return;
  const el = document.createElement('div');
  el.className = `fx-stamp tone-${tone}`;
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<div class="fx-st-in"><b></b>${sub ? '<small></small>' : ''}</div>`;
  el.querySelector('b').textContent = text;
  if (sub) el.querySelector('small').textContent = sub;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1250);
}
/** 給元素加一次性的動畫 class（播完自動拿掉） */
export function pulse(el, cls, ms = 700) {
  if (!el || !fxOn()) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}
