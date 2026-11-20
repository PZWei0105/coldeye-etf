/* 冷眼換裝 — 交易終端：音效組、配樂、開場。
   音效：機械鍵盤（按下、彈起兩聲）、終端機的方波嗶聲、繼電器的「喀」、電傳打字機的鈴、撥接數據機、點陣印表機。
   配樂「深夜交易室」：D 多利安、每分鐘 76 拍、搖擺的十六分音符；FM 電鋼琴的爵士和弦（Dm9 → G13 → Cmaj9 → A7♭13）、
   木貝斯、很輕的 lo-fi 鼓、黑膠底噪，偶爾有人在鍵盤上打一串字。
   開場：映像管開機的一條亮線撐開整個畫面，「冷眼」兩個字由方塊一格一格印出來，資料來源一個一個 [OK]。 */
import { stage, centerIn, skinColors, hexA, trimBank, dotText } from '../skin.js';

// ------------------------------------------------------------------ 音效
const key = (A, at = 0, g = 1) => {
  A.noise(at, 0.014, { type: 'highpass', f: 3800, gain: 0.15 * g, attack: 0.001 });
  A.noise(at, 0.032, { type: 'bandpass', f: 1250, q: 3, gain: 0.068 * g, attack: 0.001 });
  A.noise(at + 0.048, 0.01, { type: 'highpass', f: 5200, gain: 0.06 * g, attack: 0.001 });
};
const beep = (A, f, at, dur, g = 0.03) => A.tone(f, at, dur, { type: 'square', gain: g, lp: 2600, attack: 0.002 });
const burst = (A, n, span, g = 0.7) => { for (let i = 0; i < n; i++) key(A, (i / n) * span + Math.random() * (span / n) * 0.6, g * (0.7 + Math.random() * 0.4)); };
const RAW = {
  tap: (A) => key(A, 0, 0.85),
  nav: (A) => { key(A, 0, 0.2); key(A, 0.07, 0.16); },
  open: (A) => { key(A, 0, 0.8); A.noise(0.02, 0.13, { f: 900, glide: 3800, q: 2, gain: 0.03 }); beep(A, 1568, 0.11, 0.05, 0.02); },
  close: (A) => { key(A, 0, 0.5); A.noise(0.02, 0.12, { f: 3200, glide: 700, q: 2, gain: 0.028 }); },
  ok: (A) => { beep(A, 1046.5, 0, 0.06, 0.045); beep(A, 1568, 0.075, 0.11, 0.04); },
  scan: (A) => { burst(A, 7, 0.42, 0.42); A.tone(400, 0, 0.46, { type: 'square', gain: 0.011, glide: 1600, lp: 1800 }); },
  good: (A) => beep(A, 1318.5, 0, 0.06, 0.019),
  warn: (A) => { beep(A, 659.3, 0, 0.08, 0.032); beep(A, 622.3, 0.1, 0.1, 0.03); },
  stop: (A) => A.tone(110, 0, 0.28, { type: 'sawtooth', gain: 0.055, lp: 600 }),
  lock: (A) => { A.noise(0, 0.04, { type: 'lowpass', f: 900, gain: 0.15, attack: 0.001 }); A.tone(92, 0, 0.13, { gain: 0.16, glide: 48 }); beep(A, 1760, 0.05, 0.12, 0.024); },
  alert: (A) => { A.bell(2093, 0, 0.75, { gain: 0.03, wet: 0.2 }); A.bell(2093, 0.22, 0.65, { gain: 0.025, wet: 0.2 }); },
  err: (A) => A.tone(98, 0, 0.22, { type: 'square', gain: 0.045, lp: 500 }),
  ping: (A) => beep(A, 2093, 0, 0.05, 0.018),
  pxUp: (A) => { A.noise(0, 0.008, { type: 'highpass', f: 4200, gain: 0.07, attack: 0.001 }); beep(A, 2637, 0.02, 0.03, 0.03); },
  pxDown: (A) => { A.noise(0, 0.008, { type: 'highpass', f: 4200, gain: 0.07, attack: 0.001 }); beep(A, 1760, 0.02, 0.03, 0.03); },
  hit: (A) => [1046.5, 1318.5, 1568, 2093].forEach((f, i) => beep(A, f, i * 0.07, 0.09, 0.042)),
  miss: (A) => [784, 659.3, 523.3].forEach((f, i) => beep(A, f, i * 0.1, 0.12, 0.032)),
  comms: (A) => {
    A.tone(1200, 0, 0.08, { type: 'square', gain: 0.032, lp: 3000 }); A.tone(2400, 0.08, 0.06, { type: 'square', gain: 0.026, lp: 3200 });
    A.noise(0.14, 0.12, { f: 2000, q: 1.5, gain: 0.048 }); A.tone(980, 0.27, 0.06, { type: 'square', gain: 0.03, lp: 2600 });
  },
  tick: (A) => A.noise(0, 0.006, { type: 'highpass', f: 5000, gain: 0.04, attack: 0.001 }),
  ignite: (A) => {
    A.tone(55, 0, 0.5, { gain: 0.2, glide: 32, attack: 0.003 });
    A.noise(0, 0.06, { type: 'lowpass', f: 1200, gain: 0.1, attack: 0.001 });
    A.tone(50, 0.05, 1.3, { type: 'sawtooth', gain: 0.03, lp: 260, attack: 0.05 });
    A.tone(7800, 0.2, 1.3, { gain: 0.0035, attack: 0.3 });
    beep(A, 1046.5, 1.05, 0.12, 0.03); beep(A, 1568, 1.18, 0.2, 0.03);
  },
  online: (A) => { beep(A, 1318.5, 0, 0.07, 0.038); beep(A, 1760, 0.09, 0.14, 0.038); },
  stamp: (A) => { for (let k = 0; k < 10; k++) A.noise(k * 0.022, 0.016, { f: 2600, q: 2, gain: 0.14, attack: 0.001 }); A.tone(120, 0, 0.2, { type: 'square', gain: 0.06, lp: 400 }); },
  iris: (A) => { burst(A, 10, 0.6, 1.2); A.tone(300, 0, 0.6, { type: 'square', gain: 0.009, glide: 1400, lp: 1600 }); },
  reveal: (A) => { A.tone(110, 0, 0.45, { gain: 0.1, glide: 55 }); [1318.5, 1568, 2093].forEach((f, i) => beep(A, f, 0.05 + i * 0.06, 0.1, 0.024)); },
  storm: (A) => {
    A.noise(0, 0.12, { type: 'highpass', f: 3500, gain: 0.07 });
    A.noise(0.04, 1.0, { type: 'lowpass', f: 400, glide: 80, gain: 0.18, attack: 0.03 });
    for (let k = 0; k < 12; k++) A.noise(Math.random() * 1.2, 0.01, { type: 'highpass', f: 6000, gain: 0.035, attack: 0.001 });
    A.tone(55, 0.05, 1.2, { type: 'sawtooth', gain: 0.04, glide: 33, lp: 150 });
  },
};
/** 音量校正（dB）：tests/audio_test.mjs 量的，讓每一個聲音和機甲 HUD 同一個聲音差不多大聲 */
const TRIM = { tap: -3, nav: 6.5, ok: 6.5, good: 6.5, warn: -3, lock: 4.5, alert: -5, err: -4, ping: 5.5, hit: 6, miss: 4.5, ignite: -3.5, online: 6, stamp: 7, iris: 5, reveal: 4.5, storm: 1.5 };
export const sfx = trimBank(RAW, TRIM);
export const sfxTrim = TRIM;

// ------------------------------------------------------------------ 配樂
const CH = [
  { bass: 38, ep: [53, 57, 60, 64], next: 43 },   // Dm9
  { bass: 43, ep: [53, 59, 64, 69], next: 48 },   // G13
  { bass: 48, ep: [52, 55, 59, 62], next: 45 },   // Cmaj9
  { bass: 45, ep: [55, 61, 65, 69], next: 38 },   // A7♭13
];
const MEL = [74, 77, 79, 81, 84, 86];   // D5 F5 G5 A5 C6 D6
export const song = {
  id: 'term',
  bpm: 76,
  swing: 0.16,
  gain: 1.2,   // 音量事先量過（tests：手機聽得到的部分和機甲 HUD 一樣大聲）
  delay: { beats: 0.75, fb: 0.24, lp: 1800 },
  step(A, x) {
    const ci = Math.floor(x.bar / 2) % CH.length;
    const ch = CH[ci];
    const { t, s, mood, s16, spb, rnd } = x;
    const first = x.bar % 2 === 0;
    // 電鋼琴：和弦稍微「撥」開（低音先、高音後）
    const hit = (notes, g, dur) => notes.forEach((m, i) => A.ep(t + i * 0.012, m, dur, { gain: g, idx: 1.6, ratio: 1, wet: 0.3, pan: (i - 1.5) * 0.18 }));
    if (mood === 0) {
      if (first && s === 0) hit(ch.ep, 0.05, spb * 3.2);
      if (first && s === 7) hit(ch.ep.slice(2), 0.034, spb * 1.4);
      if (!first && s === 4) hit(ch.ep, 0.04, spb * 2.6);
      if (!first && s === 14 && rnd() < 0.6) hit(ch.ep.slice(3), 0.03, spb);
    } else if (mood === 1) {
      if (first && s === 0) hit(ch.ep, 0.046, spb * 4);
      if (!first && s === 8) hit(ch.ep.slice(1), 0.034, spb * 3);
    } else if (first && s === 0) hit(ch.ep, 0.042, spb * 7);
    // 木貝斯
    if (s === 0) A.bass(t, ch.bass, s16 * 6, { gain: 0.13, lp: 480, type: 'triangle' });
    if (mood === 0 && s === 8) A.bass(t, ch.bass + 7, s16 * 4, { gain: 0.1, lp: 460, type: 'triangle' });
    if (mood === 1 && s === 8) A.bass(t, ch.bass, s16 * 6, { gain: 0.1, lp: 440, type: 'triangle' });
    if (mood === 0 && !first && s === 14 && rnd() < 0.55) A.bass(t, ch.next + (rnd() < 0.5 ? -1 : 1), s16 * 2, { gain: 0.08, lp: 460, type: 'triangle' });
    // lo-fi 鼓
    if (mood === 0) {
      if (s === 0 || (s === 10 && rnd() < 0.8)) A.kick(t, { gain: 0.19, f: 72, to: 38 });
      if (s === 4 || s === 12) A.snare(t, { gain: 0.045, f: 2300, dur: 0.11, body: 220, wet: 0.2 });
      if (s % 2 === 0 && rnd() < 0.9) A.hat(t, { gain: s % 4 === 0 ? 0.011 : 0.007, f: 8200, pan: 0.2 });
    } else if (mood === 1) {
      if (s === 0) A.kick(t, { gain: 0.14, f: 70, to: 38 });
      if (s === 12) A.snare(t, { gain: 0.03, f: 2300, dur: 0.1, body: 220, wet: 0.3 });
    }
    // 黑膠底噪：每一格偶爾「啪」一下
    if (rnd() < 0.32) A.noise(t + rnd() * s16, 0.004, { type: 'highpass', f: 3200, gain: 0.008 + rnd() * 0.008, attack: 0.001, pan: rnd() - 0.5 });
    // 有人在打字（每八小節一次）
    if (mood === 0 && x.bar % 8 === 5 && s % 2 === 0 && rnd() < 0.55) {
      A.noise(t + rnd() * s16, 0.012, { type: 'highpass', f: 3800, gain: 0.02, attack: 0.001, pan: 0.35 });
      A.noise(t + rnd() * s16, 0.02, { type: 'bandpass', f: 1300, q: 3, gain: 0.01, attack: 0.001, pan: 0.35 });
    }
    // 偶爾一句鈴聲般的旋律（每四小節的最後一小節）
    if (mood === 0 && x.bar % 4 === 3 && [2, 6, 11].includes(s)) A.ep(t, MEL[Math.floor(rnd() * MEL.length)], spb * 1.5, { gain: 0.024, idx: 3.2, ratio: 3.5, wet: 0.45, dly: 0.3 });
  },
};

// ------------------------------------------------------------------ 開場
export function opening(boot, { labels = [], anchor = () => null, log = () => null } = {}) {
  const C = skinColors(boot);
  const chrome = (getComputedStyle(boot).getPropertyValue('--chrome') || '').trim() || '#ff9a1f';
  const dots = dotText('冷眼', 16, 900);
  let openAt = null;
  const lit = labels.map(() => 0), warn = labels.map(() => false);
  let pulse = 0;
  const st = stage(boot, (g, { W, H, now, t }) => {
    g.clearRect(0, 0, W, H);
    const [cx, cy] = centerIn(boot, anchor());
    const cell = Math.max(3, Math.min(8, Math.floor(Math.min(W * 0.7, 300) / dots.w)));
    const bw = dots.w * cell, bh = dots.h * cell;
    const x0 = Math.round(cx - bw / 2), y0 = Math.round(cy - bh / 2);
    if (openAt == null) {   // 待命：游標在閃
      if (Math.floor(t * 1.9) % 2 === 0) { g.fillStyle = hexA(C.frost, 0.9); g.fillRect(cx - cell * 1.1, cy - cell * 2.2, cell * 2.2, cell * 4.4); }
      return;
    }
    const k = (now - openAt) / 1000;
    if (k < 0.34) {        // 映像管開機：一條亮線往上下撐開
      const e = k / 0.34;
      const h = Math.max(2, H * e * e);
      g.fillStyle = hexA('#fff3d6', 0.92 * (1 - e * 0.5));
      g.fillRect(0, H / 2 - h / 2, W, h);
      g.fillStyle = hexA(chrome, 0.5 * (1 - e));
      g.fillRect(0, H / 2 - 1, W, 2);
      return;
    }
    // 方塊字：像印表機一列一列印出來
    const p = Math.min(1, (k - 0.36) / 0.95);
    const shown = Math.floor(dots.w * dots.h * p);
    const path = new Path2D();
    for (let i = 0; i < shown; i++) {
      const y = Math.floor(i / dots.w), x = i % dots.w;
      if (dots.on(x, y)) path.rect(x0 + x * cell, y0 + y * cell, cell - 1, cell - 1);
    }
    const flick = 0.92 + 0.08 * Math.sin(now / 37) * Math.sin(now / 91);
    const pk = pulse ? Math.max(0, 1 - (now - pulse) / 260) : 0;
    g.save();
    g.shadowColor = chrome; g.shadowBlur = cell * (1.6 + pk * 2);
    g.fillStyle = hexA(chrome, Math.min(1, flick + pk * 0.3));
    g.fill(path);
    g.restore();
    // 印到哪裡的游標
    if (p < 1) { const i = shown, y = Math.floor(i / dots.w), x = i % dots.w; g.fillStyle = hexA(C.frost, 0.95); g.fillRect(x0 + x * cell, y0 + y * cell, cell, cell); }
    // 一道掃描帶慢慢往下
    const by = ((k * 120) % (H + 80)) - 40;
    const gr = g.createLinearGradient(0, by - 30, 0, by + 30);
    gr.addColorStop(0, hexA(chrome, 0)); gr.addColorStop(0.5, hexA(chrome, 0.06)); gr.addColorStop(1, hexA(chrome, 0));
    g.fillStyle = gr; g.fillRect(0, by - 30, W, 60);
    // 資料來源：[TWSE] [MIS] … 連上一個亮一個
    const lr = log() ? log().getBoundingClientRect() : null;
    const br = boot.getBoundingClientRect();
    const fs = Math.max(10, Math.min(12.5, cell * 1.6));
    g.font = `600 ${fs}px "IBM Plex Mono", ui-monospace, monospace`;
    g.textBaseline = 'middle'; g.textAlign = 'center';
    const per = Math.ceil(labels.length / 2);
    const rowY = lr && lr.height && lr.top - br.top - 40 > y0 + bh + 6 ? lr.top - br.top - 40 : y0 + bh + 18;
    labels.forEach((name, i) => {
      const row = Math.floor(i / per), col = i % per;
      const x = cx - bw / 2 - 20 + (bw + 40) * ((col + 0.5) / per);
      const y = rowY + row * 19;
      const on = lit[i] ? Math.min(1, (now - lit[i]) / 160) : 0;
      g.fillStyle = on ? hexA(warn[i] ? C.amber : C.frost, 0.35 + 0.65 * on) : hexA(chrome, 0.28);
      g.fillText(`[${name}]`, x, y);
    });
  }, { sleepy: () => openAt == null });
  if (!st) return null;
  return {
    open() { if (openAt == null) openAt = performance.now(); },
    lock(i, isWarn = false) { if (i < 0 || i >= labels.length) return; lit[i] = performance.now(); warn[i] = !!isWarn; pulse = performance.now(); },
    stop() { st.stop(); },
  };
}
