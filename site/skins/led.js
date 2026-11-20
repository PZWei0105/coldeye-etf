/* 冷眼換裝 — 號子電視牆：音效組、配樂、開場。
   音效：90 年代電子看板與電玩的方波「嗶嗶」、三角波的低音、收銀機一樣的「叮」。
   配樂「號子」：C 大調、每分鐘 92 拍的城市流行／老電玩風（Fmaj7 → G7 → Em7 → Am7 → Dm7 → G7 → Cmaj7 → C7），
   八度跳動的貝斯、反拍的和弦、方波主旋律、偶爾看板更新的嗶聲；盤勢不好時拿掉鼓和旋律，只剩和弦與貝斯。
   開場：整面 LED 由上往下亮起來，「冷眼」兩個字用點陣打出來，下面一排跑馬燈，資料來源一個一個亮燈。 */
import { stage, centerIn, skinColors, hexA, trimBank, dotText } from '../skin.js';

// ------------------------------------------------------------------ 音效
const sq = (A, f, at, dur, g) => A.tone(f, at, dur, { type: 'square', gain: g, lp: 4000, attack: 0.002 });
const tri = (A, f, at, dur, g) => A.tone(f, at, dur, { type: 'triangle', gain: g, attack: 0.002 });
const RAW = {
  tap: (A) => sq(A, 1760, 0, 0.025, 0.05),
  nav: (A) => { sq(A, 1318.5, 0, 0.04, 0.025); sq(A, 1760, 0.045, 0.05, 0.022); },
  open: (A) => [523.3, 784, 1046.5].forEach((f, i) => sq(A, f, i * 0.035, 0.05, 0.022)),
  close: (A) => [1046.5, 784].forEach((f, i) => sq(A, f, i * 0.04, 0.05, 0.02)),
  ok: (A) => { sq(A, 1568, 0, 0.05, 0.05); sq(A, 1568, 0.08, 0.07, 0.05); },
  scan: (A) => [523.3, 659.3, 784, 1046.5, 1318.5, 1568, 2093, 2637].forEach((f, i) => sq(A, f, i * 0.04, 0.04, 0.016)),
  good: (A) => tri(A, 2093, 0, 0.08, 0.02),
  warn: (A) => [880, 659.3, 880, 659.3].forEach((f, i) => sq(A, f, i * 0.07, 0.06, 0.022)),
  stop: (A) => { sq(A, 196, 0, 0.12, 0.04); sq(A, 164.8, 0.13, 0.16, 0.04); },
  lock: (A) => { sq(A, 987.8, 0, 0.06, 0.07); sq(A, 1318.5, 0.06, 0.24, 0.07); },
  alert: (A) => { for (let k = 0; k < 4; k++) sq(A, k % 2 ? 1046.5 : 1318.5, k * 0.09, 0.08, 0.026); },
  err: (A) => sq(A, 110, 0, 0.2, 0.04),
  ping: (A) => tri(A, 1760, 0, 0.06, 0.018),
  pxUp: (A) => { sq(A, 1046.5, 0, 0.03, 0.026); sq(A, 1318.5, 0.03, 0.04, 0.026); },
  pxDown: (A) => { sq(A, 1046.5, 0, 0.03, 0.026); sq(A, 880, 0.03, 0.04, 0.026); },
  hit: (A) => { [523.3, 659.3, 784, 1046.5].forEach((f, i) => sq(A, f, i * 0.08, i === 3 ? 0.32 : 0.07, 0.026)); tri(A, 130.8, 0.24, 0.4, 0.07); },
  miss: (A) => [392, 370, 349.2, 329.6].forEach((f, i) => tri(A, f, i * 0.12, i === 3 ? 0.45 : 0.11, 0.06)),
  comms: (A) => { const fs = [1046.5, 1318.5, 1568, 2093]; for (let k = 0; k < 8; k++) sq(A, fs[Math.floor(Math.random() * 4)], k * 0.03, 0.025, 0.032); },
  tick: (A) => sq(A, 3000, 0, 0.01, 0.016),
  ignite: (A) => {
    A.tone(110, 0, 0.6, { type: 'square', glide: 880, gain: 0.022, lp: 2000 });
    A.noise(0, 0.25, { type: 'highpass', f: 3000, gain: 0.03 });
    [523.3, 659.3, 784, 1046.5].forEach((f) => sq(A, f, 0.62, 0.5, 0.018));
    tri(A, 130.8, 0.62, 0.6, 0.07);
  },
  online: (A) => [784, 1046.5, 1318.5, 1568].forEach((f, i) => sq(A, f, i * 0.07, 0.06, 0.04)),
  stamp: (A) => { A.noise(0, 0.06, { type: 'lowpass', f: 1200, gain: 0.2 }); sq(A, 98, 0, 0.1, 0.07); },
  iris: (A) => [261.6, 329.6, 392, 523.3, 659.3, 784, 1046.5, 1318.5, 1568, 2093].forEach((f, i) => sq(A, f, i * 0.03, 0.04, 0.036)),
  reveal: (A) => { [523.3, 659.3, 784, 987.8].forEach((f) => sq(A, f, 0, 0.4, 0.024)); tri(A, 130.8, 0, 0.5, 0.08); },
  storm: (A) => { A.noise(0, 1.1, { type: 'lowpass', f: 600, glide: 120, gain: 0.16, attack: 0.02 }); A.tone(55, 0, 1, { type: 'square', gain: 0.02, lp: 200 }); },
};
/** 音量校正（dB）：tests/audio_test.mjs 量的，讓每一個聲音和機甲 HUD 同一個聲音差不多大聲 */
const TRIM = { nav: 7.5, open: 1.5, ok: 7, good: 8.5, warn: -1.5, stop: -2, lock: 6, err: -3, ping: 9, hit: 4, tick: 2, ignite: 4, online: 5.5, stamp: 9, iris: 5.5, reveal: 5, storm: 2.5 };
export const sfx = trimBank(RAW, TRIM);
export const sfxTrim = TRIM;

// ------------------------------------------------------------------ 配樂
const CH = [
  { b: 41, c: [57, 60, 64] },   // Fmaj7
  { b: 43, c: [59, 62, 65] },   // G7
  { b: 40, c: [55, 59, 62] },   // Em7
  { b: 45, c: [55, 60, 64] },   // Am7
  { b: 38, c: [57, 60, 65] },   // Dm7
  { b: 43, c: [59, 62, 65] },   // G7
  { b: 48, c: [55, 59, 64] },   // Cmaj7
  { b: 48, c: [58, 60, 64] },   // C7
];
const SCALE = [67, 69, 72, 74, 76, 79, 81, 84];   // G4 A4 C5 D5 E5 G5 A5 C6（C 大調五聲）
const RHY = [[0, 3, 6, 8, 10, 12], [0, 2, 4, 7, 10], [0, 6, 8, 11, 14], [2, 4, 6, 8, 12], [0, 3, 6, 10, 12, 14]];
let rhy = RHY[0];
let pos = 3;
export const song = {
  id: 'led',
  bpm: 92,
  gain: 1.36,   // 音量事先量過（和機甲 HUD 一樣大聲）
  delay: { beats: 0.5, fb: 0.18, lp: 3000 },
  step(A, x) {
    const ch = CH[x.bar % CH.length];
    const { t, s, mood, s16, rnd } = x;
    // 反拍的和弦（像老電子琴）
    const stabs = mood === 0 ? [4, 10, 12] : mood === 1 ? [4, 12] : [0];
    if (stabs.includes(s)) ch.c.forEach((m, i) => A.note(t, m, s16 * (mood === 2 ? 12 : 1.6), { type: 'square', gain: mood === 2 ? 0.011 : 0.014, lp: 2000, attack: 0.004, pan: (i - 1) * 0.3, wet: 0.15 }));
    // 八度跳動的貝斯
    if (mood === 0 && s % 2 === 0) A.note(t, ch.b + (s % 4 === 2 ? 12 : 0), s16 * 1.7, { type: 'triangle', gain: 0.13, lp: 1400, attack: 0.003 });
    if (mood === 1 && s % 4 === 0) A.note(t, ch.b, s16 * 3, { type: 'triangle', gain: 0.12, lp: 1200, attack: 0.003 });
    if (mood === 2 && (s === 0 || s === 8)) A.note(t, ch.b, s16 * 7, { type: 'triangle', gain: 0.11, lp: 1000, attack: 0.003 });
    // 鼓機
    if (mood === 0) {
      if (s === 0 || s === 8 || (s === 6 && rnd() < 0.4)) A.kick(t, { gain: 0.2, f: 110, to: 45 });
      if (s === 4 || s === 12) A.snare(t, { gain: 0.06, f: 2000, dur: 0.12, body: 200 });
      if (s % 2 === 0) A.hat(t, { gain: s % 4 === 0 ? 0.012 : 0.008, f: 9000 });
    } else if (mood === 1) {
      if (s === 0 || s === 8) A.kick(t, { gain: 0.13, f: 100, to: 45 });
      if (s === 12) A.snare(t, { gain: 0.035, f: 2000, dur: 0.1, body: 200 });
    }
    // 方波主旋律：三小節唱、一小節休息（放慢時只唱兩小節、音也比較少）
    const sing = mood === 0 ? x.bar % 4 !== 3 : mood === 1 ? x.bar % 4 === 0 || x.bar % 4 === 2 : false;
    if (sing) {
      if (s === 0) { rhy = RHY[Math.floor(rnd() * RHY.length)]; if (mood === 1) rhy = rhy.filter((v, i) => i % 2 === 0); if (x.bar % 4 === 0) pos = 2 + Math.floor(rnd() * 3); }
      if (rhy.includes(s)) {
        const strong = s % 4 === 0;
        const tones = SCALE.filter((m) => ch.c.some((c) => (((m - c) % 12) + 12) % 12 === 0));
        if (strong && tones.length && rnd() < 0.7) { const near = tones.reduce((a, m) => (Math.abs(m - SCALE[pos]) < Math.abs(a - SCALE[pos]) ? m : a), tones[0]); pos = SCALE.indexOf(near); }
        else pos = Math.max(0, Math.min(SCALE.length - 1, pos + (rnd() < 0.5 ? -1 : 1) * (rnd() < 0.75 ? 1 : 2)));
        const nxt = rhy.find((v) => v > s);
        const len = ((nxt ?? 16) - s) * s16 * 0.92;
        A.note(t, SCALE[pos], Math.max(s16, len), { type: 'square', gain: 0.022, lp: 3200, attack: 0.005, vib: { rate: 6, depth: 14, delay: 0.14 }, dly: 0.18, wet: 0.12 });
      }
    }
    // 看板更新的嗶聲
    if (mood < 2 && x.bar % 2 === 1 && s === 9 && rnd() < 0.5) A.note(t, rnd() < 0.5 ? 96 : 100, 0.05, { type: 'triangle', gain: 0.012 });
  },
};

// ------------------------------------------------------------------ 開場
export function opening(boot, { labels = [], anchor = () => null, log = () => null } = {}) {
  const C = skinColors(boot);
  const logo = dotText('冷眼', 18, 900);
  const marq = dotText('冷眼 COLDEYE・台股 ETF 指揮系統・官方一手資料・固定規則・不替你下單・', 10, 700);
  let openAt = null;
  const lit = labels.map(() => 0), warn = labels.map(() => false);
  let flashAt = 0;
  const P = 5;   // 點距（和背景的點陣一樣）
  const dotPath = (path, x, y, r) => { path.moveTo(x + r, y); path.arc(x, y, r, 0, Math.PI * 2); };
  const st = stage(boot, (g, { W, H, now, t }) => {
    g.clearRect(0, 0, W, H);
    const [cx, cy] = centerIn(boot, anchor());
    const awake = openAt != null;
    const k = awake ? (now - openAt) / 1000 : 0;
    // 跑馬燈（待命時就在跑，很暗）：放在開機清單上面
    const lr = log() ? log().getBoundingClientRect() : null;
    const br = boot.getBoundingClientRect();
    const my = lr && lr.height ? Math.max(cy + 80, lr.top - br.top - 30) : cy + 110;
    const mx0 = Math.floor(W / P);
    const off = Math.floor(t * 18) % marq.w;
    const mp = new Path2D();
    for (let col = 0; col < mx0; col++) {
      const sx = (col + off) % marq.w;
      for (let row = 0; row < marq.h; row++) if (marq.on(sx, row)) dotPath(mp, col * P + P / 2, my - (marq.h * P) / 2 + row * P, 1.5);
    }
    g.fillStyle = hexA(C.frost, awake ? 0.85 : 0.35);
    g.shadowColor = C.frost; g.shadowBlur = awake ? 6 : 0;
    g.fill(mp);
    g.shadowBlur = 0;
    if (!awake) return;
    // 由上往下一排一排亮起來（0～0.5 秒）
    if (k < 0.6) {
      const y = H * Math.min(1, k / 0.5);
      const gr = g.createLinearGradient(0, y - 120, 0, y);
      gr.addColorStop(0, hexA(C.ice, 0)); gr.addColorStop(1, hexA(C.ice, 0.22));
      g.fillStyle = gr; g.fillRect(0, y - 120, W, 120);
    }
    // 「冷眼」：點陣一格一格亮（0.35 秒起，0.7 秒內亮完），之後偶爾閃一下
    const cell = Math.max(5, Math.min(9, Math.floor(Math.min(W * 0.62, 280) / logo.w)));
    const x0 = cx - (logo.w * cell) / 2, y0 = cy - (logo.h * cell) / 2;
    const p = Math.max(0, Math.min(1, (k - 0.35) / 0.7));
    const lp = new Path2D(), dim = new Path2D();
    for (let y = 0; y < logo.h; y++) for (let x = 0; x < logo.w; x++) {
      const px = x0 + x * cell + cell / 2, py = y0 + y * cell + cell / 2;
      if (logo.on(x, y) && ((x * 7 + y * 13) % 97) / 97 < p) dotPath(lp, px, py, cell * 0.36);
      else dotPath(dim, px, py, cell * 0.28);
    }
    g.fillStyle = 'rgba(40,40,40,.9)'; g.fill(dim);
    const fl = flashAt ? Math.max(0, 1 - (now - flashAt) / 220) : 0;
    g.fillStyle = hexA(C.frost, 0.92 + 0.08 * fl);
    g.shadowColor = C.frost; g.shadowBlur = cell * (1.2 + fl * 1.5);
    g.fill(lp);
    g.shadowBlur = 0;
    // 資料來源：一格一格亮燈（綠＝跌，所以不用綠燈；連上了是白燈，有問題是琥珀）
    const per = Math.ceil(labels.length / 2);
    const rowY = Math.min(my - marq.h * P / 2 - 26, y0 + logo.h * cell + 22);
    g.font = '600 11px "DotGothic16", ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    labels.forEach((name, i) => {
      const row = Math.floor(i / per), col = i % per;
      const w = Math.min(W - 24, logo.w * cell + 60);
      const x = cx - w / 2 + w * ((col + 0.5) / per), y = rowY + row * 18;
      const on = lit[i] ? Math.min(1, (now - lit[i]) / 120) : 0;
      const c = warn[i] ? C.amber : C.frost;
      g.fillStyle = on ? hexA(c, 0.4 + 0.6 * on) : 'rgba(70,70,70,.9)';
      if (on) { g.shadowColor = c; g.shadowBlur = 6 * on; }
      g.fillText(name, x, y);
      g.shadowBlur = 0;
    });
  }, { sleepy: () => openAt == null });
  if (!st) return null;
  return {
    open() { if (openAt == null) openAt = performance.now(); },
    lock(i, isWarn = false) { if (i < 0 || i >= labels.length) return; lit[i] = performance.now(); warn[i] = !!isWarn; flashAt = performance.now(); },
    stop() { st.stop(); },
  };
}
