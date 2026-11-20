/* 冷眼換裝 — 聲納艙：音效組、配樂、開場。
   音效：水滴、聲納的「嗶——」和它的回音、氣泡、艙壁的悶響、無線電雜訊。
   配樂「深海」：D 小調、每分鐘 58 拍、沒有鼓；很低的嗡鳴（每個和弦四小節：Dm → B♭maj7 → F → C）、慢慢起伏的墊音、
   偶爾一聲遠處的聲納和它的回音、幾顆氣泡，偶爾一聲像鯨魚的長音。
   開場：聲納螢幕亮起來、一聲聲納擴散出去，每個資料來源像一個接觸點出現在螢幕上，掃描光掃過時亮一下。 */
import { stage, centerIn, skinColors, hexA, trimBank } from '../skin.js';

// ------------------------------------------------------------------ 音效
const ping = (A, f, at, dur, g, wet = 0.55) => A.tone(f, at, dur, { gain: g, attack: 0.003, wet });
const RAW = {
  tap: (A) => A.tone(1500, 0, 0.05, { gain: 0.05, glide: 700, attack: 0.002 }),
  nav: (A) => { ping(A, 880, 0, 0.1, 0.045, 0.3); ping(A, 1318.5, 0.06, 0.14, 0.04, 0.35); },
  open: (A) => { A.tone(110, 0, 0.22, { gain: 0.05, glide: 220 }); ping(A, 1174.7, 0.05, 0.38, 0.018, 0.45); },
  close: (A) => A.tone(900, 0, 0.16, { gain: 0.04, glide: 420, wet: 0.2 }),
  ok: (A) => ping(A, 1318.5, 0, 0.75, 0.06, 0.55),
  scan: (A) => { ping(A, 1046.5, 0, 0.5, 0.02, 0.5); A.tone(600, 0.1, 0.5, { gain: 0.009, glide: 2400, lp: 3000 }); A.noise(0, 0.6, { f: 500, glide: 2500, q: 6, gain: 0.009 }); },
  good: (A) => ping(A, 1760, 0, 0.3, 0.022, 0.4),
  warn: (A) => { ping(A, 523.3, 0, 0.25, 0.03, 0.3); ping(A, 493.9, 0.2, 0.3, 0.027, 0.3); },
  stop: (A) => A.tone(98, 0, 0.6, { type: 'sawtooth', gain: 0.045, lp: 320, attack: 0.05 }),
  lock: (A) => { A.tone(73, 0, 0.25, { gain: 0.18, glide: 45 }); ping(A, 1760, 0.04, 0.8, 0.05, 0.6); },
  alert: (A) => { for (let k = 0; k < 3; k++) ping(A, 1975.5, k * 0.16, 0.25, 0.04, 0.4); },
  err: (A) => { A.tone(130, 0, 0.25, { gain: 0.045, glide: 70 }); A.tone(400, 0.1, 0.08, { gain: 0.015, glide: 900 }); },
  ping: (A) => ping(A, 1046.5, 0, 0.9, 0.012, 0.65),
  pxUp: (A) => A.tone(600, 0, 0.06, { gain: 0.03, glide: 1200 }),
  pxDown: (A) => A.tone(900, 0, 0.06, { gain: 0.03, glide: 450 }),
  hit: (A) => [784, 987.8, 1174.7, 1568].forEach((f, i) => ping(A, f, i * 0.09, 0.5, 0.045, 0.45)),
  miss: (A) => [880, 698.5, 587.3].forEach((f, i) => ping(A, f, i * 0.12, 0.5, 0.04, 0.4)),
  comms: (A) => { A.noise(0, 0.12, { f: 1800, q: 2, gain: 0.06 }); A.tone(1318.5, 0.1, 0.08, { gain: 0.08 }); ping(A, 1760, 0.2, 0.12, 0.07, 0.3); },
  tick: (A) => A.tone(2600, 0, 0.02, { gain: 0.01 }),
  ignite: (A) => {
    A.noise(0, 1.3, { type: 'lowpass', f: 60, glide: 400, gain: 0.11, attack: 0.4 });
    A.tone(41, 0, 1.4, { gain: 0.095, glide: 82, attack: 0.3 });
    ping(A, 1046.5, 1.0, 1.6, 0.048, 0.7); A.tone(523.3, 1.0, 1.8, { gain: 0.03, wet: 0.6 });
  },
  online: (A) => { ping(A, 1318.5, 0, 0.6, 0.045, 0.5); ping(A, 1975.5, 0.12, 0.7, 0.035, 0.55); },
  stamp: (A) => { A.noise(0, 0.1, { type: 'lowpass', f: 400, gain: 0.085 }); A.tone(80, 0, 0.3, { gain: 0.095, glide: 45 }); },
  iris: (A) => { ping(A, 1046.5, 0, 1.2, 0.055, 0.7); ping(A, 1046.5, 0.45, 0.9, 0.02, 0.6); ping(A, 1046.5, 0.9, 0.7, 0.01, 0.5); },
  reveal: (A) => { [523.3, 659.3, 784].forEach((f, i) => A.tone(f, i * 0.02, 1.2, { gain: 0.035, wet: 0.6 })); A.tone(220, 0, 1.4, { gain: 0.03, glide: 330, attack: 0.2 }); },
  storm: (A) => {
    A.noise(0, 1.4, { type: 'lowpass', f: 300, glide: 70, gain: 0.3, attack: 0.05 });
    for (let k = 0; k < 8; k++) { const f = 300 + Math.random() * 500; A.tone(f, 0.2 + Math.random(), 0.06, { gain: 0.02, glide: f * 2.2 }); }
  },
};
/** 音量校正（dB）：tests/audio_test.mjs 量的，讓每一個聲音和機甲 HUD 同一個聲音差不多大聲 */
const TRIM = { tap: -2, open: -6, close: -7, scan: -4, warn: -5.5, stop: -1.5, alert: -5, err: -3, ping: -4, pxUp: 2, pxDown: 2, miss: -1.5, comms: -5.5, tick: 5, ignite: -1.5, stamp: 4, iris: -4, reveal: 1.5, storm: 3.5 };
export const sfx = trimBank(RAW, TRIM);
export const sfxTrim = TRIM;

// ------------------------------------------------------------------ 配樂
const CH = [
  { drone: 38, pad: [62, 65, 69] },   // Dm
  { drone: 46, pad: [62, 65, 69] },   // B♭maj7（同一組音放在 B♭ 上面）
  { drone: 41, pad: [60, 65, 69] },   // F
  { drone: 48, pad: [60, 64, 67] },   // C
];
const PINGS = [81, 84, 86, 88, 93];   // A5 C6 D6 E6 A6
let pingAt = -1;
export const song = {
  id: 'sonar',
  bpm: 58,
  gain: 0.64,   // 音量事先量過（和機甲 HUD 一樣大聲）
  delay: { beats: 1.5, fb: 0.4, lp: 1500 },
  step(A, x) {
    const ch = CH[Math.floor(x.bar / 4) % CH.length];
    const { t, s, mood, s16, spb, rnd } = x;
    const chord = x.bar % 4 === 0 && s === 0;
    // 嗡鳴：根音＋五度，四小節一個，慢慢進來、慢慢退
    if (chord) {
      const len = spb * 16 + 2.5;
      A.note(t, ch.drone, len, { type: 'sine', gain: 0.075, attack: 3, rel: 3.5 });
      A.note(t, ch.drone + 12, len, { type: 'triangle', gain: 0.022, attack: 3.5, rel: 3.5, det: 6, lp: 600 });
      A.note(t, ch.drone + 7, len, { type: 'sine', gain: 0.03, attack: 4, rel: 3.5, det: -5 });
      A.pad(t + spb, ch.pad, len - spb, { type: 'triangle', gain: mood === 2 ? 0.04 : 0.055, attack: 3, rel: 3.5, lp: 900, det: 9, wet: 0.6 });
      A.noise(t, len, { type: 'lowpass', f: 360, gain: 0.012, attack: 2.5, rel: 3, off: rnd() * 0.5 });
    }
    // 遠處的聲納：每兩小節在一個隨機的位置（最慢時四小節）
    const every = mood === 2 ? 4 : 2;
    if (s === 0 && x.bar % every === 0) pingAt = Math.floor(rnd() * 12);
    if (x.bar % every === 0 && s === pingAt) A.note(t, PINGS[Math.floor(rnd() * PINGS.length)] - (mood === 2 ? 12 : 0), 2.8, { type: 'sine', gain: 0.034, attack: 0.004, wet: 0.75, dly: 0.45 });
    // 氣泡
    if (mood < 2 && rnd() < (mood ? 0.03 : 0.06)) { const f = 280 + rnd() * 620; A.tone(t + rnd() * s16, f, 0.07, { gain: 0.012, glide: f * 2.2, attack: 0.003, pan: rnd() - 0.5 }); }
    // 艙壁的心跳：每小節一下，很輕
    if (mood === 0 && s === 0) A.kick(t, { gain: 0.06, f: 58, to: 34, dur: 0.4 });
    // 鯨魚：每八小節一次
    if (mood === 0 && x.bar % 8 === 6 && s === 0) A.tone(t, 196, spb * 6, { type: 'sine', gain: 0.026, attack: 1.2, rel: 1.6, glide: 311, glideT: spb * 3, wet: 0.75, vib: { rate: 3, depth: 18, delay: 1 } });
  },
};

// ------------------------------------------------------------------ 開場
const TAU = Math.PI * 2;
const ease = (k) => 1 - Math.pow(1 - Math.max(0, Math.min(1, k)), 3);
export function opening(boot, { labels = [], anchor = () => null } = {}) {
  const C = skinColors(boot);
  let openAt = null;
  const n = Math.max(1, labels.length);
  const lit = labels.map(() => 0), warn = labels.map(() => false);
  // 每個接觸點固定的方位與距離（看起來隨機，但每次一樣）
  const spot = labels.map((_, i) => ({ a: -Math.PI / 2 + (i + 0.5) * (TAU / n) + 0.2 * Math.sin(i * 2.3), r: 0.56 + 0.3 * (((i * 37) % 10) / 10) }));
  const st = stage(boot, (g, { W, H, now, t }) => {
    g.clearRect(0, 0, W, H);
    const [cx, cy] = centerIn(boot, anchor());
    // 螢幕和方位數字都要放得下：上面不超出畫面
    const R = Math.max(70, Math.min(Math.min(W, H) * 0.26, 160, cy - 30));
    const awake = openAt != null;
    const k = awake ? (now - openAt) / 1000 : 0;
    const on = awake ? ease(k / 0.9) : 0;
    // 螢幕：距離環、方位刻度
    g.lineWidth = 1;
    for (const r of [0.25, 0.5, 0.75, 1]) { g.strokeStyle = hexA(C.ice, (awake ? 0.12 + 0.2 * on : 0.08) * (r === 1 ? 1.6 : 1)); g.beginPath(); g.arc(cx, cy, R * r, 0, TAU); g.stroke(); }
    for (let d = 0; d < 360; d += 10) {
      const a = (d / 180) * Math.PI - Math.PI / 2, long = d % 30 === 0;
      g.strokeStyle = hexA(C.ice, (awake ? 0.25 + 0.4 * on : 0.12) * (long ? 1 : 0.6));
      g.beginPath(); g.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.lineTo(cx + Math.cos(a) * (R + (long ? 8 : 4)), cy + Math.sin(a) * (R + (long ? 8 : 4))); g.stroke();
    }
    if (awake) {
      g.font = '11px "Share Tech Mono", ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = hexA(C.ice, 0.55 * on);
      [['000', 0], ['090', 90], ['180', 180], ['270', 270]].forEach(([s, d]) => { const a = (d / 180) * Math.PI - Math.PI / 2; g.fillText(s, cx + Math.cos(a) * (R + 20), cy + Math.sin(a) * (R + 20)); });
      g.strokeStyle = hexA(C.ice, 0.1 * on); g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
    }
    // 掃描光（待命時很慢、很淡）
    const sweep = awake ? (k / 2.6) * TAU - Math.PI / 2 : (t / 9) * TAU - Math.PI / 2;
    for (let j = 0; j < 14; j++) {
      const a0 = sweep - (j + 1) * 0.06;
      g.fillStyle = hexA(C.ice, (awake ? 0.13 : 0.05) * (1 - j / 14));
      g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, a0, a0 + 0.062); g.closePath(); g.fill();
    }
    g.strokeStyle = hexA(C.ice, awake ? 0.8 : 0.3); g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(sweep) * R, cy + Math.sin(sweep) * R); g.stroke();
    if (!awake) return;
    // 一聲聲納擴散出去
    for (const d0 of [0, 0.45]) {
      const p = (k - d0) / 1.3;
      if (p > 0 && p < 1) { g.strokeStyle = hexA(C.ice, 0.7 * (1 - p)); g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, R * 1.9 * ease(p), 0, TAU); g.stroke(); }
    }
    // 接觸點：出現時一圈擴散，掃描光經過時亮一下
    g.font = '600 11px "Share Tech Mono", ui-monospace, monospace';
    labels.forEach((name, i) => {
      if (!lit[i]) return;
      const sp = spot[i];
      const x = cx + Math.cos(sp.a) * R * sp.r, y = cy + Math.sin(sp.a) * R * sp.r;
      const age = (now - lit[i]) / 1000;
      let da = ((sweep - sp.a) % TAU + TAU) % TAU;
      const glow = Math.max(0, 1 - da / 1.6);
      const c = warn[i] ? C.amber : C.ice;
      const a = Math.min(1, age / 0.15) * (0.45 + 0.55 * glow);
      if (age < 0.9) { g.strokeStyle = hexA(c, 0.8 * (1 - age / 0.9)); g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 4 + 26 * ease(age / 0.9), 0, TAU); g.stroke(); }
      g.fillStyle = hexA(c, a); g.shadowColor = c; g.shadowBlur = 10 * a;
      g.beginPath(); g.arc(x, y, 3.4, 0, TAU); g.fill();
      g.shadowBlur = 0;
      g.fillStyle = hexA(C.frost, 0.35 + 0.6 * a);
      g.textAlign = Math.cos(sp.a) >= 0 ? 'left' : 'right';
      g.fillText(name, x + (Math.cos(sp.a) >= 0 ? 9 : -9), y);
    });
  }, { sleepy: () => openAt == null });
  if (!st) return null;
  return {
    open() { if (openAt == null) openAt = performance.now(); },
    lock(i, isWarn = false) { if (i < 0 || i >= labels.length) return; lit[i] = performance.now(); warn[i] = !!isWarn; },
    stop() { st.stop(); },
  };
}
