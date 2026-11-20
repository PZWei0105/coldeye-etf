/* 冷眼換裝 — 水墨禪：音效組、配樂、開場。
   音效：古琴的撥弦（Karplus–Strong 即時合成）、木魚、磬、水滴、毛筆刷過紙的聲音。
   配樂「古琴」：A 羽調（A C D E G 五聲）、每分鐘 54 拍；很低的長音像拉弦（A → D → A → G，每個四小節），
   古琴一句兩小節、留白兩小節，偶爾一個泛音、偶爾一聲磬，風聲很輕。盤勢不好時句子更短、音更低。
   開場：宣紙上一滴墨，一筆畫出圓相（禪宗的一筆圓），資料來源像墨點落在圓上，最後蓋上冷眼的印章。 */
import { stage, centerIn, skinColors, hexA, trimBank } from '../skin.js';
import { rng } from '../music.js';

// ------------------------------------------------------------------ 音效
const pl = (A, f, at, g, damp = 0.994, len = 1.4) => A.pluck(f, at, { gain: g, damp, soft: 2, len, lp: 3200 });
const wood = (A, f, at, g) => { A.noise(at, 0.045, { type: 'bandpass', f, q: 9, gain: g, attack: 0.001 }); A.tone(f * 0.5, at, 0.05, { gain: g * 0.6, attack: 0.001 }); };
const BOWL = [[1, 1], [2.0, 0.5], [2.92, 0.35], [4.1, 0.2]];
const RAW = {
  tap: (A) => wood(A, 1800, 0, 0.07),
  nav: (A) => pl(A, 1318.5, 0, 0.08, 0.99, 0.5),
  open: (A) => { pl(A, 659.3, 0, 0.1); pl(A, 987.8, 0.05, 0.08); },
  close: (A) => { pl(A, 784, 0, 0.045, 0.993, 0.6); pl(A, 587.3, 0.06, 0.04, 0.993, 0.6); },
  ok: (A) => { pl(A, 880, 0, 0.1); A.bell(1760, 0.02, 1.2, { gain: 0.02, wet: 0.3 }); },
  scan: (A) => { A.noise(0, 0.5, { type: 'bandpass', f: 800, glide: 3000, q: 0.7, gain: 0.02, attack: 0.15 }); [587.3, 659.3, 784, 880, 1046.5].forEach((f, i) => pl(A, f, i * 0.08, 0.032)); },
  good: (A) => pl(A, 1174.7, 0, 0.055, 0.993, 0.8),
  warn: (A) => { pl(A, 440, 0, 0.035, 0.985, 0.35); pl(A, 392, 0.14, 0.035, 0.985, 0.35); },
  stop: (A) => { wood(A, 600, 0, 0.1); wood(A, 520, 0.18, 0.09); },
  lock: (A) => { wood(A, 900, 0, 0.2); A.bell(1046.5, 0.05, 2.2, { gain: 0.05, wet: 0.35 }); },
  alert: (A) => { A.bell(880, 0, 2.5, { gain: 0.03, wet: 0.3 }); A.bell(880, 0.5, 2, { gain: 0.02, wet: 0.3 }); },
  err: (A) => pl(A, 110, 0, 0.05, 0.97, 0.5),
  ping: (A) => { A.tone(1800, 0, 0.06, { gain: 0.04, glide: 900 }); A.tone(1200, 0.05, 0.25, { gain: 0.012, wet: 0.3 }); },
  pxUp: (A) => pl(A, 1318.5, 0, 0.06, 0.99, 0.5),
  pxDown: (A) => pl(A, 987.8, 0, 0.06, 0.99, 0.5),
  hit: (A) => [523.3, 587.3, 659.3, 784, 880, 1046.5].forEach((f, i) => pl(A, f, i * 0.07, 0.07)),
  miss: (A) => [784, 659.3, 587.3, 523.3].forEach((f, i) => pl(A, f, i * 0.11, 0.06, 0.99)),
  comms: (A) => { const fs = [2093, 2349.3, 2637, 3136]; for (let k = 0; k < 3; k++) A.bell(fs[Math.floor(Math.random() * 4)], Math.random() * 0.3, 0.9, { gain: 0.025, wet: 0.3 }); },
  tick: (A) => wood(A, 2400, 0, 0.018),
  ignite: (A) => {
    A.bell(110, 0, 4, { gain: 0.08, wet: 0.4, parts: BOWL });
    A.bell(220, 0.02, 3, { gain: 0.03, parts: BOWL });
    pl(A, 220, 0.9, 0.1, 0.997, 2.5); pl(A, 329.6, 1.05, 0.08, 0.997, 2.5);
  },
  online: (A) => [659.3, 784, 987.8].forEach((f, i) => pl(A, f, i * 0.09, 0.08)),
  stamp: (A) => { A.noise(0, 0.08, { type: 'lowpass', f: 300, gain: 0.16 }); A.tone(90, 0, 0.14, { gain: 0.12, glide: 60 }); A.noise(0.02, 0.12, { type: 'bandpass', f: 2500, q: 0.8, gain: 0.02 }); },
  iris: (A) => { A.noise(0, 1.0, { type: 'bandpass', f: 600, glide: 2400, q: 0.6, gain: 0.04, attack: 0.3 }); A.bell(523.3, 0.6, 2, { gain: 0.03, wet: 0.4 }); },
  reveal: (A) => { pl(A, 220, 0, 0.12, 0.997, 2.5); pl(A, 329.6, 0.03, 0.1, 0.997, 2.5); pl(A, 440, 0.06, 0.1, 0.997, 2.5); A.bell(880, 0.1, 2, { gain: 0.025, wet: 0.4 }); },
  storm: (A) => {
    A.noise(0, 1.6, { type: 'highpass', f: 4000, gain: 0.015, attack: 0.3, rel: 0.8 });
    A.noise(0.2, 1.2, { type: 'lowpass', f: 200, glide: 60, gain: 0.075, attack: 0.1 });
    pl(A, 110, 0.3, 0.1, 0.99, 1.5);
  },
};
/** 音量校正（dB）：tests/audio_test.mjs 量的，讓每一個聲音和機甲 HUD 同一個聲音差不多大聲 */
const TRIM = { nav: 2.5, open: -9, close: -8, scan: -5, warn: -3.5, alert: -7, err: -4, pxUp: -2.5, pxDown: -6, hit: 2, miss: 2.5, comms: -8, ignite: -5.5, stamp: 5.5, storm: -3 };
export const sfx = trimBank(RAW, TRIM);
export const sfxTrim = TRIM;

// ------------------------------------------------------------------ 配樂
const ROOTS = [45, 50, 45, 43];                        // A2 D3 A2 G2
const SCALE = [45, 48, 50, 52, 55, 57, 60, 62, 64, 67]; // A2 … G4（A 羽調五聲）
const RHY = [[0, 6, 10], [0, 4, 8, 14], [0, 10], [2, 8, 12], [0, 3, 8], [0, 7, 12]];
let rhy = RHY[0];
let pos = 5;
export const song = {
  id: 'ink',
  bpm: 54,
  gain: 0.73,   // 音量事先量過（和機甲 HUD 一樣大聲）
  delay: { beats: 1, fb: 0.3, lp: 1800 },
  step(A, x) {
    const { t, s, mood, s16, spb, rnd } = x;
    const root = ROOTS[Math.floor(x.bar / 4) % ROOTS.length];
    // 長音（像拉弦）：根音、五度、八度
    if (x.bar % 4 === 0 && s === 0) {
      const len = spb * 16 + 2;
      A.note(t, root, len, { type: 'sine', gain: 0.065, attack: 2.5, rel: 3 });
      A.note(t, root + 7, len, { type: 'triangle', gain: 0.018, attack: 3, rel: 3, lp: 520 });
      A.note(t, root + 12, len, { type: 'sine', gain: 0.014, attack: 3.5, rel: 3, det: 4 });
      A.noise(t, len, { type: 'bandpass', f: 520, q: 0.5, gain: 0.008, attack: 2.5, rel: 2.5, off: rnd() * 0.5 });
    }
    // 古琴：一句兩小節、留白兩小節（最慢時一句只彈第一個音）
    const phrase = x.bar % 4 < 2 || (mood === 0 && x.bar % 8 === 2);
    if (phrase) {
      if (s === 0) rhy = RHY[Math.floor(rnd() * RHY.length)];
      if (rhy.includes(s) && !(mood === 1 && rnd() < 0.35) && !(mood === 2 && (s !== rhy[0] || x.bar % 4 !== 0))) {
        if (s === rhy[0] && x.bar % 4 === 0) pos = SCALE.indexOf(root) >= 0 ? SCALE.indexOf(root) + 2 : 5;
        else pos = Math.max(0, Math.min(SCALE.length - 1, pos + (rnd() < 0.5 ? -1 : 1) * (rnd() < 0.7 ? 1 : 2)));
        let m = SCALE[pos];
        if (mood === 2 && m >= 57) m -= 12;
        A.pluck(t, m, { gain: 0.15, damp: 0.9965, soft: 3, len: 3, lp: 2400, wet: 0.45, dly: 0.2 });
        if (mood === 0 && rnd() < 0.15) A.pluck(t + 0.02, m + 12, { gain: 0.06, damp: 0.996, soft: 3, len: 2.5, lp: 2600, wet: 0.45 });
        if (rnd() < 0.2) A.note(t + s16 * 0.5, m + (rnd() < 0.5 ? 12 : 19), 1.8, { type: 'sine', gain: 0.018, attack: 0.004, wet: 0.6 });   // 泛音
      }
    }
    // 磬：每八小節一聲
    if (x.bar % 8 === 0 && s === 4) A.bell(t, rnd() < 0.5 ? 81 : 76, 6, { gain: mood === 2 ? 0.02 : 0.028, wet: 0.6 });
    // 水滴
    if (mood === 0 && rnd() < 0.025) { const f = 1600 + rnd() * 800; A.tone(t + rnd() * s16, f, 0.05, { gain: 0.008, glide: f * 0.55, attack: 0.002, pan: rnd() - 0.5 }); }
  },
};

// ------------------------------------------------------------------ 開場：一筆圓相
const TAU = Math.PI * 2;
export function opening(boot, { labels = [], anchor = () => null } = {}) {
  const C = skinColors(boot);
  let openAt = null;
  const n = Math.max(1, labels.length);
  const lit = labels.map(() => 0), warn = labels.map(() => false);
  // 筆觸：從左上起筆、順時針將近一圈，前段飽滿、後段飛白（固定種子，每次一樣）
  const R0 = rng(20261121);
  const N = 520;
  const A0 = -Math.PI * 0.62, SPAN = TAU * 0.91;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    pts.push({ u, a: A0 + SPAN * u, rr: 1 + 0.035 * Math.sin(u * 9.1) + 0.02 * Math.sin(u * 23.7), w: u < 0.06 ? 0.55 + u * 7 : 1 - Math.pow(u, 1.6) * 0.78, dry: u > 0.55 ? (u - 0.55) / 0.45 : 0, j: R0() });
  }
  const off = document.createElement('canvas');
  const og = off.getContext('2d');
  let drawn = 0, lastKey = '';
  const st = stage(boot, (g, { W, H, now, t }) => {
    g.clearRect(0, 0, W, H);
    const [cx, cy] = centerIn(boot, anchor());
    // 圓和旁邊的字都要放得下：上面不超出畫面
    const R = Math.max(60, Math.min(Math.min(W, H) * 0.25, 160, (cy - 16) / 1.24));
    if (openAt == null) {   // 待命：一滴墨在呼吸
      const r = 5 + 1.2 * Math.sin(t * 1.6);
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r * 3);
      gr.addColorStop(0, hexA(C.frost, 0.85)); gr.addColorStop(0.35, hexA(C.frost, 0.55)); gr.addColorStop(1, hexA(C.frost, 0));
      g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r * 3, 0, TAU); g.fill();
      return;
    }
    const k = (now - openAt) / 1000;
    // 墨暈開的淡影
    const wk = Math.min(1, k / 1.6);
    const wash = g.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * (1.1 + 0.9 * wk));
    wash.addColorStop(0, hexA(C.frost, 0.07 * (1 - wk * 0.4))); wash.addColorStop(1, hexA(C.frost, 0));
    g.fillStyle = wash; g.fillRect(0, 0, W, H);
    // 圓相：畫在另一張畫布上，一點一點加（不用每一格重畫幾百筆）
    const key = `${Math.round(W)}x${Math.round(H)}|${Math.round(cx)}|${Math.round(cy)}`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (key !== lastKey) { off.width = Math.round(W * dpr); off.height = Math.round(H * dpr); drawn = 0; lastKey = key; }
    const p = Math.min(1, Math.max(0, (k - 0.15) / 1.05));
    const upto = Math.floor(p * p * (3 - 2 * p) * N);
    og.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bw = R * 0.16;
    for (; drawn < upto; drawn++) {
      const q = pts[drawn];
      const x = cx + Math.cos(q.a) * R * q.rr, y = cy + Math.sin(q.a) * R * q.rr;
      // 筆毛：幾條細線並排，後段飛白（有的筆毛沒墨）
      const nx = Math.cos(q.a), ny = Math.sin(q.a);
      for (let b = -4; b <= 4; b++) {
        const gap = q.dry > 0 && ((b * 13 + drawn * 3 + Math.floor(q.j * 7)) % 9) / 9 < q.dry * 0.75;
        if (gap) continue;
        const o = (b / 4) * bw * q.w * 0.5;
        og.fillStyle = hexA(C.frost, (0.2 + 0.25 * (1 - q.dry)) * (1 - Math.abs(b) / 6));
        og.beginPath(); og.arc(x + nx * o, y + ny * o, Math.max(0.6, bw * q.w * 0.16), 0, TAU); og.fill();
      }
    }
    g.drawImage(off, 0, 0, W, H);
    // 資料來源：墨點落在圓上，旁邊寫名字
    g.font = `600 12px ${getComputedStyle(boot).getPropertyValue('--f-sans') || 'serif'}`;
    g.textBaseline = 'middle';
    labels.forEach((name, i) => {
      if (!lit[i]) return;
      const a = A0 + 0.25 + (i / n) * (SPAN - 0.4);
      const x = cx + Math.cos(a) * R * 1.18, y = cy + Math.sin(a) * R * 1.18;
      const age = Math.min(1, (now - lit[i]) / 260);
      const c = warn[i] ? C.amber : C.frost;
      const r = 3.6 * (0.6 + 0.4 * age);
      const gr = g.createRadialGradient(x, y, 0, x, y, r * 2.2);
      gr.addColorStop(0, hexA(c, 0.9 * age)); gr.addColorStop(0.5, hexA(c, 0.55 * age)); gr.addColorStop(1, hexA(c, 0));
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r * 2.2, 0, TAU); g.fill();
      g.fillStyle = hexA(C.frost, 0.75 * age);
      g.textAlign = Math.cos(a) >= 0 ? 'left' : 'right';
      g.fillText(name, x + (Math.cos(a) >= 0 ? 10 : -10), y);
    });
  }, { sleepy: () => openAt == null });
  if (!st) return null;
  return {
    open() { if (openAt == null) openAt = performance.now(); },
    lock(i, isWarn = false) { if (i < 0 || i >= labels.length) return; lit[i] = performance.now(); warn[i] = !!isWarn; },
    stop() { st.stop(); },
  };
}
