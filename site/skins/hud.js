/* 冷眼換裝 — 機甲 HUD（原本的樣子）：畫面、音效、開場都是原本的（styles.css、fx.js 的 SOUNDS、eye.js 的睜眼），這裡只有配樂。
   配樂「低速巡航」：A 小調、每分鐘 84 拍；暖的鋸齒波墊音（Am9 → Fmaj9 → Cmaj7 → G6，每個和弦兩小節）、
   很輕的八分音符琶音（附點八分的迴音）、心跳一樣的低音鼓、偶爾一聲像聲納的鐘聲，和介面音效同一組五聲音階。 */

const CH = [
  { bass: 45, pad: [57, 60, 64, 71], arp: [69, 72, 76, 79, 81, 83] },   // Am9
  { bass: 41, pad: [57, 60, 64, 67], arp: [65, 69, 72, 76, 79, 81] },   // Fmaj9
  { bass: 48, pad: [55, 59, 64, 67], arp: [67, 71, 72, 76, 79, 83] },   // Cmaj7
  { bass: 43, pad: [55, 59, 62, 64], arp: [67, 71, 74, 76, 79, 83] },   // G6
];
const PENTA = [76, 79, 81, 84, 86, 88, 91];   // E5 G5 A5 C6 D6 E6 G6（A 小調五聲）
let lead = 3;                                  // 小旋律從哪個音開始（每一句換一次）

export const song = {
  id: 'hud',
  bpm: 84,
  gain: 1,   // 音量的基準（其他四首都量過，調到和這首一樣大聲）
  delay: { beats: 0.75, fb: 0.3, lp: 2400 },
  step(A, x) {
    const ch = CH[Math.floor(x.bar / 2) % CH.length];
    const { t, s, mood, s16, spb, rnd } = x;
    // 墊音：每個和弦的第一拍，慢慢進來，尾巴和下一個和弦疊在一起
    if (x.bar % 2 === 0 && s === 0) A.pad(t, ch.pad, spb * 8 + 1.2, { gain: 0.085, attack: 1.6, rel: 2.4, lp: mood ? 820 : 1250, det: 8, wet: 0.45 });
    // 低音：平常三下（切分），放慢時兩下，最慢一下
    const bs = mood === 0 ? [0, 6, 10] : mood === 1 ? [0, 8] : [0];
    if (bs.includes(s) && !(mood === 2 && x.bar % 2 === 1)) A.bass(t, ch.bass + (s === 10 ? 12 : 0), s16 * (s === 0 ? 5 : 3), { gain: 0.1, lp: 520 });
    // 心跳
    if (mood === 0 && (s === 0 || s === 8)) A.kick(t, { gain: 0.13, f: 92, to: 40 });
    if (mood === 1 && s === 0) A.kick(t, { gain: 0.1, f: 88, to: 40 });
    // 琶音：平常八分音符（偶爾休息），放慢時四分音符，最慢不彈
    const arpOn = mood === 0 ? s % 2 === 0 && rnd() < 0.84 : mood === 1 ? s % 4 === 0 && rnd() < 0.62 : false;
    if (arpOn) {
      const k = (x.bar * 8 + (s >> 1)) % 10;
      const idx = k < 6 ? k : 10 - k;   // 上去再下來
      A.note(t, ch.arp[Math.min(idx, ch.arp.length - 1)], s16 * 1.7, { type: 'triangle', gain: mood ? 0.016 : 0.021, attack: 0.006, lp: 2600, dly: 0.36, wet: 0.25, pan: (s % 4 === 0 ? -0.28 : 0.28) });
    }
    // 腳步一樣的細碎聲
    if (mood === 0 && s % 4 === 2) A.hat(t, { gain: 0.011, pan: 0.2 });
    if (mood === 0 && s % 2 === 1 && rnd() < 0.18) A.hat(t, { gain: 0.005, pan: -0.25 });
    // 聲納鐘聲：每四小節一聲（最慢時八小節）
    if (s === 0 && x.bar % (mood === 2 ? 8 : 4) === 1) A.bell(t + s16 * 2, PENTA[Math.floor(rnd() * PENTA.length)], 3.2, { gain: 0.03, wet: 0.65, dly: 0.25 });
    // 無線電的小旋律：每四小節的第三小節，三、四個音
    if (mood < 2 && x.bar % 4 === 2 && [0, 3, 6, 10].includes(s) && !(mood === 1 && s > 3)) {
      if (s === 0) lead = 2 + Math.floor(rnd() * 3);
      else lead = Math.max(0, Math.min(PENTA.length - 1, lead + Math.floor(rnd() * 3) - 1));
      const i = lead;
      A.note(t, PENTA[i] - 12, s16 * 3.2, { type: 'sine', gain: 0.034, attack: 0.02, vib: { rate: 5.2, depth: 9, delay: 0.12 }, dly: 0.4, wet: 0.5 });
    }
  },
};
