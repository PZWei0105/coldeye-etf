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
let ctx = null, master = null, wet = null, noiseBuf = null;
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
  const comp = ctx.createDynamicsCompressor();
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
  const len = Math.floor(ctx.sampleRate * 1.2);
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const ch = noiseBuf.getChannelData(0);
  let seed = 7;   // 固定種子的雜訊：每次聽起來都一樣
  for (let i = 0; i < len; i++) { seed = (seed * 16807) % 2147483647; ch[i] = (seed / 2147483647) * 2 - 1; }
  return ctx;
}
let unlocked = false;
/** 第一次點擊時呼叫（app.js 掛在整個頁面上）：建立並喚醒音效引擎 */
export function unlock() {
  const c = ensure();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  if (!unlocked) {
    try {   // iOS 要在點擊當下播一段聲音才算解鎖
      const b = c.createBuffer(1, 1, c.sampleRate);
      const s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0);
    } catch { /* 不支援 */ }
    unlocked = true;
  }
}
export const audioReady = () => !!(ctx && ctx.state === 'running');

function tone(f, at, dur, o = {}) {
  const t0 = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(f, t0);
  if (o.glide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.glide), t0 + dur);
  const g = ctx.createGain();
  const peak = o.gain ?? 0.1;
  const a = o.attack ?? 0.004;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let node = osc;
  if (o.lp) { const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = o.lp; osc.connect(fl); node = fl; }
  node.connect(g);
  g.connect(master);
  if (o.wet) { const w = ctx.createGain(); w.gain.value = o.wet; g.connect(w); w.connect(wet); }
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}
function noise(at, dur, o = {}) {
  const t0 = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const fl = ctx.createBiquadFilter();
  fl.type = o.type || 'bandpass';
  fl.frequency.setValueAtTime(o.f || 1200, t0);
  if (o.glide) fl.frequency.exponentialRampToValueAtTime(o.glide, t0 + dur);
  fl.Q.value = o.q ?? 1;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(o.gain ?? 0.08, t0 + (o.attack ?? 0.01));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(fl).connect(g).connect(master);
  if (o.wet) { const w = ctx.createGain(); w.gain.value = o.wet; g.connect(w); w.connect(wet); }
  src.start(t0, Math.random() * 0.2);
  src.stop(t0 + dur + 0.05);
}

/** 每個聲音的配方：同一組音高（A 小調五聲）讓整套聲音像同一台機體 */
const SOUNDS = {
  tap: () => tone(1850, 0, 0.035, { type: 'triangle', gain: 0.06 }),
  nav: () => { tone(1318.5, 0, 0.05, { gain: 0.07 }); tone(1760, 0.045, 0.07, { gain: 0.06, wet: 0.2 }); },
  open: () => { tone(392, 0, 0.16, { type: 'sawtooth', gain: 0.035, glide: 1250, lp: 2600 }); noise(0, 0.14, { gain: 0.035, f: 2500, glide: 7000, q: 2 }); tone(2349, 0.12, 0.05, { gain: 0.035 }); },
  close: () => { tone(1046.5, 0, 0.11, { type: 'sawtooth', gain: 0.03, glide: 330, lp: 2000 }); },
  ok: () => { tone(880, 0, 0.11, { gain: 0.09 }); tone(1318.5, 0.07, 0.22, { gain: 0.08, wet: 0.35 }); },
  scan: () => {
    [659.3, 784, 987.8, 1174.7, 1318.5, 1568, 1760, 1975.5].forEach((f, i) => tone(f, i * 0.055, 0.045, { type: 'square', gain: 0.018, lp: 3200 }));
    noise(0, 0.55, { gain: 0.03, f: 700, glide: 5200, q: 5 });
  },
  good: () => tone(1568, 0, 0.07, { gain: 0.05, wet: 0.2 }),
  warn: () => { tone(523.3, 0, 0.07, { type: 'square', gain: 0.025, lp: 1500 }); tone(493.9, 0.085, 0.08, { type: 'square', gain: 0.022, lp: 1500 }); },
  stop: () => { tone(220, 0, 0.18, { type: 'sawtooth', gain: 0.05, lp: 900 }); tone(207.7, 0.2, 0.22, { type: 'sawtooth', gain: 0.045, lp: 900 }); },
  lock: () => { tone(147, 0, 0.18, { gain: 0.2, glide: 70 }); noise(0, 0.05, { type: 'lowpass', f: 1800, gain: 0.08 }); tone(1760, 0.06, 0.28, { gain: 0.06, wet: 0.5 }); tone(2637, 0.11, 0.32, { gain: 0.035, wet: 0.5 }); },
  alert: () => { for (let k = 0; k < 3; k++) tone(987.8, k * 0.13, 0.075, { type: 'square', gain: 0.035, lp: 2600 }); },
  err: () => tone(155, 0, 0.17, { type: 'sawtooth', gain: 0.055, lp: 700 }),
  ping: () => tone(1318.5, 0, 0.09, { gain: 0.035, wet: 0.25 }),
  pxUp: () => { tone(1568, 0, 0.05, { gain: 0.03 }); tone(2093, 0.04, 0.06, { gain: 0.025 }); },
  pxDown: () => { tone(784, 0, 0.05, { gain: 0.03 }); tone(587.3, 0.04, 0.06, { gain: 0.025 }); },
  hit: () => [523.3, 659.3, 784, 1046.5].forEach((f, i) => tone(f, i * 0.07, 0.2, { gain: 0.07, wet: 0.35 })),
  miss: () => [440, 349.2, 293.7].forEach((f, i) => tone(f, i * 0.09, 0.24, { type: 'triangle', gain: 0.06, wet: 0.25 })),
  comms: () => { noise(0, 0.08, { gain: 0.03, f: 3000, q: 3 }); tone(1046.5, 0.05, 0.05, { gain: 0.05 }); tone(1568, 0.11, 0.08, { gain: 0.05 }); },
  tick: () => tone(2400, 0, 0.022, { type: 'square', gain: 0.014, lp: 4200 }),
  ignite: () => {
    noise(0, 1.15, { type: 'lowpass', f: 90, glide: 700, gain: 0.12, attack: 0.25 });
    tone(55, 0, 1.15, { type: 'sawtooth', gain: 0.05, glide: 110, lp: 420, attack: 0.2 });
    tone(110, 0.15, 0.95, { gain: 0.06, glide: 440, attack: 0.1 });
    [220, 329.6, 440, 554.4].forEach((f, i) => tone(f, 0.98 + i * 0.03, 1.4, { type: 'triangle', gain: 0.04, attack: 0.05, wet: 0.4 }));
    tone(1760, 1.05, 0.6, { gain: 0.03, wet: 0.5 });
  },
  online: () => [880, 1108.7, 1318.5, 1760].forEach((f, i) => tone(f, i * 0.065, 0.18, { gain: 0.05, wet: 0.4 })),
  stamp: () => { noise(0, 0.07, { type: 'lowpass', f: 900, gain: 0.14 }); tone(98, 0, 0.22, { gain: 0.18, glide: 55 }); tone(1975.5, 0.08, 0.3, { gain: 0.03, wet: 0.5 }); },
};
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
  try { SOUNDS[name](); } catch { /* 不讓音效影響 App */ }
}

// ------------------------------------------------------------------ 震動（Android 有效；iPhone 的網頁不支援）
const HAPTIC = { tap: 6, nav: 8, ok: 14, open: 10, lock: [16, 40, 26], stamp: [22, 30, 14], alert: [30, 70, 30, 70, 30], err: [50, 40, 50], warn: [14, 50, 14], stop: [40, 60, 40], hit: [12, 30, 12, 30, 40], miss: [45], ignite: [20, 60, 20, 60, 60], online: [10, 40, 10] };
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
function loadVoices() {
  try { voices = window.speechSynthesis.getVoices() || []; } catch { voices = []; }
  for (const fn of voiceSubs) { try { fn(); } catch { /* 不影響播報 */ } }
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
