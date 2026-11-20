/* 冷眼 — 配樂（2026/11/21，PZ：「冷眼是否能夠與『解包』一樣做一個音效、配樂版，而且能夠更換 SKIN」）
   每一套換裝有自己的配樂（skins/*.js 的 song），全部用 WebAudio 即時合成，不下載任何音檔：
   - 步進編曲：每一小節 16 格（十六分音符），歌的 step(A, x) 決定這一格彈什麼；亂數用「歌＋第幾小節」當種子，
     每一小節有一點不一樣（不會一直重複同一段），但同一小節重播一樣。
   - 跟著盤勢讓你冷靜（musicMood）：大盤單日漲跌 1% 以上、或市場溫度「陰」→ 慢一點、暗一點；
     2% 以上、或「雨」→ 再慢、再低、樂器變少。大漲也一樣放慢——冷眼不煽動追高，也不跟著恐慌。
   - 副官念晨報時壓低；App 到背景時淡出並停下來（回來再淡入）；和音效用同一個音效引擎，所以 iPhone 側邊靜音時不出聲。
   - 換裝：舊的淡出 1.4 秒、新的淡入 1.6 秒；每首歌的音量事先量過（song.gain），換來換去一樣大聲。
   這個檔案不讀寫任何資料：開關、音量由 skin.js 傳進來。 */
import * as FX from './fx.js';

/** 三種心情：tempo 速度倍數、gain 音量倍數、lp 整體的低通（越低越暗） */
export const MOODS = [
  { k: 0, t: '平常', d: '照原本的速度', tempo: 1, gain: 1, lp: 15000 },
  { k: 1, t: '放慢', d: '慢一點、暗一點', tempo: 0.88, gain: 0.8, lp: 3800 },
  { k: 2, t: '放慢、放低', d: '再慢、再低，樂器變少', tempo: 0.76, gain: 0.64, lp: 1700 },
];
/**
 * 盤勢 → 配樂的心情（純函式，tests/skin_test.mjs 有測）。
 * pc：加權指數單日漲跌（%）；temp：市場溫度（'晴'／'陰'／'雨'）。回傳 0 平常、1 放慢、2 放慢放低。
 */
export function musicMood({ pc, temp } = {}) {
  let m = 0;
  if (temp === '陰') m = 1;
  if (temp === '雨') m = 2;
  const a = typeof pc === 'number' && isFinite(pc) ? Math.abs(pc) : 0;
  if (a >= 1) m = Math.max(m, 1);
  if (a >= 2) m = 2;
  return m;
}
export const VOLS = { 1: 0.5, 2: 0.8, 3: 1.15 };
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
/** 固定種子的亂數（mulberry32） */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hashStr = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/** 殘響：一段立體聲的雜訊，指數衰減、越後面越暗（產生一次） */
export function makeIR(c, sec = 3.2, decay = 2.6) {
  const sr = c.sampleRate, L = Math.floor(sr * sec);
  const b = c.createBuffer(2, L, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let seed = 99 + ch * 7, lp = 0;
    for (let i = 0; i < L; i++) {
      seed = (seed * 16807) % 2147483647;
      const n = (seed / 2147483647) * 2 - 1;
      const k = i / L;
      const cut = 0.65 - 0.5 * k;   // 尾巴越來越暗
      lp += cut * (n - lp);
      d[i] = lp * Math.pow(1 - k, decay) * (i < sr * 0.012 ? i / (sr * 0.012) : 1);
    }
  }
  return b;
}

/**
 * 一首歌的樂器（給 song.step 用）。時間 t 一律是 AudioContext 的絕對時間；m 是 MIDI 音高（60＝中央 C）。
 * syn：fx.js 的 makeSynth（輸出到這首歌自己的音量）、wet：殘響入口、dly：迴音入口（可以沒有）。
 */
export function instruments(syn, { wet = null, dly = null } = {}) {
  const c = syn.c;
  const at = (t) => Math.max(0, t - c.currentTime);
  const send = (o) => {
    const r = { ...o };
    if (o.dly && dly) r.sends = [[dly, o.dly]];
    if (wet) r.wetTo = wet;
    return r;
  };
  const A = {
    c, mtof,
    tone: (t, f, dur, o = {}) => syn.tone(f, at(t), dur, send(o)),
    note: (t, m, dur, o = {}) => syn.tone(mtof(m), at(t), dur, send(o)),
    noise: (t, dur, o = {}) => syn.noise(at(t), dur, send(o)),
    pluck: (t, m, o = {}) => syn.pluck(mtof(m), at(t), send(o)),
    ep: (t, m, dur, o = {}) => syn.fm(mtof(m), at(t), dur, send(o)),
    bell: (t, m, dur, o = {}) => syn.bell(mtof(m), at(t), dur, send(o)),
    /** 墊音：每個音兩個微微走音的振盪器，慢慢進來、慢慢收 */
    pad(t, notes, dur, o = {}) {
      const n = notes.length || 1;
      notes.forEach((m, i) => {
        const pan = n > 1 ? (i / (n - 1) - 0.5) * (o.spread ?? 0.7) : 0;
        for (const det of [-(o.det ?? 7), o.det ?? 7]) {
          syn.tone(mtof(m), at(t), dur, send({ type: o.type || 'sawtooth', gain: (o.gain ?? 0.05) / n, attack: o.attack ?? 1.2, rel: o.rel ?? 1.6, lp: o.lp ?? 1100, lpTo: o.lpTo, q: o.q, det, pan, wet: o.wet ?? 0.4, dly: o.dly }));
        }
      });
    },
    /** 貝斯：三角波＋一點正弦，低通 */
    bass(t, m, dur, o = {}) {
      syn.tone(mtof(m), at(t), dur, send({ type: o.type || 'triangle', gain: o.gain ?? 0.12, attack: o.attack ?? 0.008, rel: o.rel, lp: o.lp ?? 700, wet: o.wet ?? 0 }));
      if (o.sub !== false) syn.tone(mtof(m), at(t), dur, send({ type: 'sine', gain: (o.gain ?? 0.12) * 0.6, attack: o.attack ?? 0.008, rel: o.rel }));
    },
    kick(t, o = {}) {
      syn.tone(o.f || 120, at(t), o.dur || 0.32, send({ gain: o.gain ?? 0.32, glide: o.to || 42, glideT: 0.12, attack: 0.002 }));
      syn.noise(at(t), 0.012, send({ type: 'lowpass', f: 2500, gain: (o.gain ?? 0.32) * 0.25, attack: 0.001 }));
    },
    snare(t, o = {}) {
      syn.noise(at(t), o.dur || 0.16, send({ type: 'bandpass', f: o.f || 1900, q: 0.8, gain: o.gain ?? 0.09, attack: 0.002, wet: o.wet ?? 0.15 }));
      syn.tone(o.body || 190, at(t), 0.08, send({ type: 'triangle', gain: (o.gain ?? 0.09) * 0.6, glide: (o.body || 190) * 0.7 }));
    },
    hat(t, o = {}) { syn.noise(at(t), o.dur || 0.035, send({ type: 'highpass', f: o.f || 7500, gain: o.gain ?? 0.03, attack: 0.001, pan: o.pan })); },
  };
  return A;
}

// ------------------------------------------------------------------ 播放
let want = false;          // 設定：配樂打開
let held = false;          // 這次打開選了「不用聲音」：等你自己在設定打開
let vol = 2;
let mood = 0;
let ducked = false;
let song = null;           // 現在這一套的歌
let players = [];
let timer = 0;
let master = null, moodLp = null, verbIn = null;
const lastBar = new Map(); // 每首歌上次停在第幾小節（回到 App 接著彈，不會每次都從頭）
const LOOK = 0.3;          // 往前排多少秒
const FADE_OUT = 1.4, FADE_IN = 1.6;

function level() { return (VOLS[vol] || VOLS[2]) * MOODS[mood].gain * (ducked ? 0.22 : 1); }
function graph() {
  const c = FX.audioCtx();
  if (!c) return null;
  if (!master) {
    const out = FX.musicOut();
    if (!out) return null;
    master = c.createGain(); master.gain.value = 0.0001;
    moodLp = c.createBiquadFilter(); moodLp.type = 'lowpass'; moodLp.frequency.value = MOODS[mood].lp; moodLp.Q.value = 0.5;
    master.connect(moodLp).connect(out);
    const conv = c.createConvolver();
    conv.buffer = makeIR(c);
    verbIn = c.createGain(); verbIn.gain.value = 1;
    const verbOut = c.createGain(); verbOut.gain.value = 0.9;
    verbIn.connect(conv).connect(verbOut).connect(master);
  }
  return c;
}
function ramp(param, v, sec) {
  const c = FX.audioCtx();
  if (!c || !param) return;
  const t = c.currentTime;
  try { param.cancelScheduledValues(t); param.setValueAtTime(Math.max(0.0001, param.value), t); param.exponentialRampToValueAtTime(Math.max(0.0001, v), t + sec); } catch { /* 舊瀏覽器 */ }
}
function makePlayer(s, c, fadeIn) {
  const bus = c.createGain(); bus.gain.value = 0.0001;
  const wsend = c.createGain(); wsend.gain.value = 1;
  bus.connect(master);
  wsend.connect(verbIn);
  let dly = null;
  if (s.delay) {
    // 跟著拍子的迴音（附點八分音符），回授一點點、越來越暗
    dly = c.createDelay(2);
    dly.delayTime.value = (60 / s.bpm) * (s.delay.beats || 0.75);
    const fb = c.createGain(); fb.gain.value = s.delay.fb ?? 0.32;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = s.delay.lp || 2600;
    dly.connect(lp); lp.connect(fb); fb.connect(dly); lp.connect(bus);
  }
  const syn = FX.makeSynth(c, bus, wsend, FX.noiseBuffer());
  const pl = { song: s, bus, wsend, dly, A: instruments(syn, { wet: wsend, dly }), next: c.currentTime + 0.08, step: 0, bar: lastBar.get(s.id) || 0, mood, rnd: null, stopAt: 0, seed: hashStr(s.id) };
  const g = (s.gain ?? 1);
  try { bus.gain.setValueAtTime(0.0001, c.currentTime); bus.gain.exponentialRampToValueAtTime(g, c.currentTime + (fadeIn ?? FADE_IN)); } catch { bus.gain.value = g; }
  return pl;
}
function retire(pl, sec) {
  const c = FX.audioCtx();
  if (!c || pl.stopAt) return;
  pl.stopAt = c.currentTime + sec;
  lastBar.set(pl.song.id, pl.bar);
  ramp(pl.bus.gain, 0.0001, sec);
  ramp(pl.wsend.gain, 0.0001, sec);
}
function tick() {
  const c = FX.audioCtx();
  if (!c || c.state !== 'running') return;
  const now = c.currentTime;
  for (const pl of players) {
    const s = pl.song;
    const steps = s.steps || 16;
    let guard = 0;
    while (pl.next < now + LOOK && guard++ < 64) {
      if (pl.stopAt && pl.next >= pl.stopAt) break;
      if (pl.next < now - 0.2) { pl.next = now + 0.02; }   // 被卡住（手機忙）：跳過，不要一次補一堆音
      if (pl.step === 0) { pl.mood = mood; pl.rnd = rng(pl.seed ^ Math.imul(pl.bar + 1, 2654435761)); }
      const md = MOODS[pl.mood];
      const spb = 60 / (s.bpm * md.tempo);
      const s16 = spb / 4;
      const sw = pl.step % 2 === 1 ? (s.swing || 0) * s16 : 0;
      try { s.step(pl.A, { t: pl.next + sw, bar: pl.bar, s: pl.step, mood: pl.mood, s16, spb, rnd: pl.rnd }); } catch { /* 一格出錯不影響 App */ }
      pl.next += s16;
      pl.step += 1;
      if (pl.step >= steps) { pl.step = 0; pl.bar += 1; }
    }
  }
  // 淡出完的拆掉
  players = players.filter((pl) => {
    if (pl.stopAt && now > pl.stopAt + 6) { try { pl.bus.disconnect(); pl.wsend.disconnect(); } catch { /* 已經拆了 */ } return false; }
    return true;
  });
  if (!players.length) { clearInterval(timer); timer = 0; }
}
const playing = () => players.some((pl) => !pl.stopAt);
function startLoop() { if (!timer) timer = setInterval(tick, 50); tick(); }
/** 現在可以出聲嗎：打開了、沒有選「不用聲音」、有歌、App 在前景、音效引擎醒著 */
const canPlay = () => want && !held && !!song && !document.hidden && FX.audioReady();

/** 該播就播（點一下畫面、回到 App、改設定時呼叫；重複呼叫沒關係） */
export function kick() {
  if (!canPlay()) return;
  const c = graph();
  if (!c) return;
  if (!playing()) {
    players.push(makePlayer(song, c));
    ramp(master.gain, level(), 0.6);
    startLoop();
  }
}
/** 停下來（淡出） */
export function halt(sec = 0.8) {
  for (const pl of players) retire(pl, sec);
}
/** 換一首（換裝）：正在播就交叉淡入淡出 */
export function setSong(s) {
  if (!s || (song && song.id === s.id)) { song = s || song; return; }
  song = s;
  const c = FX.audioCtx();
  if (!c || !playing()) { kick(); return; }
  for (const pl of players) retire(pl, FADE_OUT);
  if (canPlay()) { players.push(makePlayer(s, c, FADE_IN)); startLoop(); }
}
export function setOn(on) {
  want = !!on;
  if (want) { held = false; kick(); } else halt(0.6);
}
export function setVol(v) {
  vol = [1, 2, 3].includes(v) ? v : 2;
  if (master) ramp(master.gain, level(), 0.3);
}
/** 先不要放（開機畫面待命時；按「不用聲音，直接進入」就一直不放，到設定再打開才放） */
export function hold() { held = true; halt(0.4); }
/** 可以放了（開機畫面按「啟動」） */
export function release() { held = false; kick(); }
export function setMood(m) {
  const k = [0, 1, 2].includes(m) ? m : 0;
  if (k === mood) return;
  mood = k;
  if (master) { ramp(master.gain, level(), 3); ramp(moodLp.frequency, MOODS[mood].lp, 4); }
}
export const moodNow = () => mood;
export const isOn = () => want && !held;
export const isPlaying = () => playing();

// 副官念晨報：壓低；念完慢慢回來
FX.onSpeak((on) => { ducked = !!on; if (master) ramp(master.gain, level(), on ? 0.3 : 1.2); });
// 點一下畫面、音效引擎醒來：該播就播
FX.onUnlock(() => kick());
// 到背景：淡出、停；回來：接著彈
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { halt(0.5); return; }
    const c = FX.audioCtx();
    if (c && c.state !== 'running') c.resume().then(() => kick()).catch(() => {});
    else setTimeout(kick, 120);
  });
}
