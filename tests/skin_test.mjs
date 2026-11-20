// 換裝與配樂（skin.js、music.js、skins/）：node tests/skin_test.mjs
// 不用瀏覽器就能檢查的部分：盤勢 → 配樂的心情、每一套音效組都齊全、每一首歌每一格都跑得動而且越不平靜樂器越少、
// 換裝的 CSS 只作用在自己那一套（機甲 HUD 一行都不受影響）、顏色的意思不變（紅漲綠跌、琥珀＝小心、紫＝你自己）、
// 新檔案都在 service worker 的清單裡。聲音的實際音量用瀏覽器離線渲染量（見 CLAUDE.md「換裝與配樂」）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const FX = await import(path.join(ROOT, 'fx.js'));
const MU = await import(path.join(ROOT, 'music.js'));
const SK = await import(path.join(ROOT, 'skin.js'));
let n = 0;
const fails = [];
function ok(cond, msg) { n += 1; if (!cond) fails.push(msg); }

// ------------------------------------------------------------------ 1 盤勢 → 心情
const mm = MU.musicMood;
ok(mm({ pc: 0.5, temp: '晴' }) === 0, '平常：照原本的速度');
ok(mm({ pc: -0.99 }) === 0, '跌不到 1% 照常');
ok(mm({ pc: -1.2 }) === 1, '跌 1% 以上放慢');
ok(mm({ pc: 1.5 }) === 1, '大漲也放慢（不煽動追高）');
ok(mm({ pc: -2.3 }) === 2, '跌 2% 以上再慢、再低');
ok(mm({ pc: 2.0 }) === 2, '漲 2% 以上也一樣');
ok(mm({ temp: '陰' }) === 1, '市場溫度陰：放慢');
ok(mm({ temp: '雨', pc: 0.1 }) === 2, '市場溫度雨：再慢、再低');
ok(mm({ temp: '陰', pc: -2.5 }) === 2, '取比較不平靜的那一個');
ok(mm({ pc: NaN }) === 0 && mm({}) === 0 && mm() === 0, '沒有資料照常');
ok(MU.MOODS.every((m, i) => i === 0 || (m.tempo < MU.MOODS[i - 1].tempo && m.gain < MU.MOODS[i - 1].gain && m.lp < MU.MOODS[i - 1].lp)), '越不平靜越慢、越小聲、越暗');

// ------------------------------------------------------------------ 2 換裝清單
const ids = SK.SKINS.map((s) => s.k);
ok(JSON.stringify(ids) === JSON.stringify(['hud', 'term', 'sonar', 'led', 'ink']), `五套換裝：${ids}`);
ok(SK.SKINS[0].scheme === null && SK.SKINS[0].font == null, '機甲 HUD 不載入任何字型、照「外觀」設定');
for (const s of SK.SKINS.slice(1)) ok(['dark', 'light'].includes(s.scheme) && /^https:\/\/fonts\.googleapis\.com\/css2\?/.test(s.font) && /^#[0-9a-f]{6}$/i.test(s.color), `${s.k}：深淺色、字型、狀態列顏色`);

// ------------------------------------------------------------------ 3 每一套的音效組、配樂
const mods = {};
for (const k of ids) mods[k] = await import(path.join(ROOT, 'skins', `${k}.js`));
ok(!mods.hud.sfx && !mods.hud.opening && mods.hud.song, '機甲 HUD 只有配樂（音效、開場是原本的）');
for (const k of ids.slice(1)) {
  const m = mods[k];
  const miss = FX.SOUND_NAMES.filter((x) => typeof m.sfx[x] !== 'function');
  const extra = Object.keys(m.sfx).filter((x) => !FX.SOUND_NAMES.includes(x));
  ok(!miss.length && !extra.length, `${k} 音效組要和原本一樣齊全：少了 ${miss}、多了 ${extra}`);
  ok(typeof m.opening === 'function', `${k} 有開場`);
}
// 假的樂器：記下每一個音（不出聲）
function fakeA() {
  const calls = [];
  const rec = (name) => (...a) => { calls.push([name, ...a.map((v) => (typeof v === 'number' ? +v.toFixed(4) : Array.isArray(v) ? v.join('/') : typeof v === 'object' && v ? JSON.stringify(v) : v))].join(' ')); };
  const A = { c: { currentTime: 0 }, mtof: MU.mtof };
  for (const x of ['tone', 'note', 'noise', 'pluck', 'ep', 'bell', 'pad', 'bass', 'kick', 'snare', 'hat']) A[x] = rec(x);
  return { A, calls };
}
function play(song, mood, bars = 32) {
  const { A, calls } = fakeA();
  const spb = 60 / (song.bpm * MU.MOODS[mood].tempo);
  let t = 0, errs = 0;
  for (let bar = 0; bar < bars; bar++) {
    const rnd = MU.rng(MU.hashStr(song.id) ^ Math.imul(bar + 1, 2654435761));
    for (let s = 0; s < 16; s++) {
      try { song.step(A, { t, bar, s, mood, s16: spb / 4, spb, rnd }); } catch (e) { errs += 1; if (errs === 1) fails.push(`${song.id} 第 ${bar} 小節第 ${s} 格出錯：${e.message}`); }
      t += spb / 4;
    }
  }
  return { calls, errs };
}
for (const k of ids) {
  const song = mods[k].song;
  ok(song.id === k && song.bpm >= 40 && song.bpm <= 140 && song.gain > 0.3 && song.gain < 2, `${k} 配樂的基本設定`);
  const r = [0, 1, 2].map((m) => play(song, m));
  ok(r.every((x) => x.errs === 0), `${k} 每一格都跑得動`);
  ok(r[0].calls.length > 40, `${k} 平常有在彈（${r[0].calls.length} 個音）`);
  ok(r[1].calls.length < r[0].calls.length && r[2].calls.length < r[1].calls.length, `${k} 越不平靜樂器越少：${r.map((x) => x.calls.length)}`);
  const again = play(song, 0);
  ok(JSON.stringify(again.calls) === JSON.stringify(r[0].calls), `${k} 同樣的小節重播一樣（固定種子）`);
  const bars = new Set(r[0].calls.map((c) => c));
  ok(bars.size > r[0].calls.length * 0.3, `${k} 不是一直重複同一段`);
}

// ------------------------------------------------------------------ 4 換裝的 CSS 只作用在自己那一套；顏色的意思不變
function rules(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const walk = (s) => {
    let i = 0;
    while (i < s.length) {
      const j = s.indexOf('{', i);
      if (j < 0) break;
      const sel = s.slice(i, j).trim();
      let d = 1, k = j + 1;
      while (d && k < s.length) { if (s[k] === '{') d += 1; else if (s[k] === '}') d -= 1; k += 1; }
      const body = s.slice(j + 1, k - 1);
      if (/^@media|^@supports/.test(sel)) walk(body);
      else if (!/^@keyframes/.test(sel)) out.push({ sel, body });
      i = k;
    }
  };
  walk(css);
  return out;
}
/** 用逗號分開選擇器，但 :is( … ) 裡面的逗號不算 */
const parts = (sel) => { const out = []; let d = 0, cur = ''; for (const ch of sel) { if (ch === '(') d += 1; if (ch === ')') d -= 1; if (ch === ',' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; };
const hexOf = (body, v) => { const m = new RegExp(`${v}:\\s*(#[0-9a-f]{6})`, 'i').exec(body); return m ? m[1] : null; };
const hsv = (hex) => {
  const x = parseInt(hex.slice(1), 16), r = ((x >> 16) & 255) / 255, g = ((x >> 8) & 255) / 255, b = (x & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: mx ? d / mx : 0 };
};
const hueIn = (h, a, b) => (a <= b ? h >= a && h <= b : h >= a || h <= b);
const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
for (const k of ids.slice(1)) {
  const css = fs.readFileSync(path.join(ROOT, 'skins', `${k}.css`), 'utf8');
  const rs = rules(css);
  const bad = rs.filter((r) => parts(r.sel).some((p) => { return !(p.startsWith(`html[data-skin="${k}"]`) || p.startsWith(`html:root[data-skin="${k}"]`) || p.startsWith(`.skin-flash[data-k="${k}"]`)); }));
  ok(!bad.length, `${k}.css 每一條規則都只作用在這一套：${bad.map((r) => r.sel.slice(0, 60)).join(' | ')}`);
  const root = rs.find((r) => r.sel === `html:root[data-skin="${k}"]`);
  ok(!!root, `${k}.css 有自己的顏色`);
  if (root) {
    const up = hexOf(root.body, '--up'), down = hexOf(root.body, '--down'), amber = hexOf(root.body, '--amber'), me = hexOf(root.body, '--aurora'), sys = hexOf(root.body, '--glacier');
    ok(up && hueIn(hsv(up).h, 340, 15), `${k} 漲是紅色（${up}）`);
    ok(down && hueIn(hsv(down).h, 95, 165), `${k} 跌是綠色（${down}）`);
    ok(amber && hueIn(hsv(amber).h, 28, 50), `${k} 小心是琥珀色（${amber}）`);
    ok(me && hueIn(hsv(me).h, 250, 290), `${k} 你自己是紫色（${me}）`);
    const s = hsv(sys);
    ok(s.s < 0.3 || (hueDist(s.h, hsv(up).h) > 40 && hueDist(s.h, hsv(down).h) > 30 && hueDist(s.h, hsv(amber).h) > 30), `${k} 系統色（${sys}）不能和紅、綠、琥珀搞混`);
  }
  ok(!/var\(--(up|down)\)/.test(css), `${k}.css 紅綠只用在價格與損益（不拿來裝飾）`);
  const js = fs.readFileSync(path.join(ROOT, 'skins', `${k}.js`), 'utf8');
  ok(!/C\.(up|down)\b|--(up|down)\b/.test(js), `${k}.js 開場不用紅綠`);
}
{
  const css = fs.readFileSync(path.join(ROOT, 'skins', 'base.css'), 'utf8');
  const bad = rules(css).filter((r) => parts(r.sel).some((p) => { return !(p.startsWith('html[data-skin]:not([data-skin="hud"])') || /^html\[data-skin="(term|led)"\]/.test(p) || p.startsWith('.sk-ticker') || p.startsWith('.skin-flash')); }));
  ok(!bad.length, `base.css 只作用在換裝：${bad.map((r) => r.sel.slice(0, 60)).join(' | ')}`);
}
// 機甲 HUD 的 styles.css：換裝新增的只有設定頁的選單與換裝閃光（不影響原本的畫面）
{
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const tail = css.slice(css.indexOf('/* ================================================================ 2026/11/21 換裝與配樂'));
  const bad = rules(tail).filter((r) => !/^\.(skin-set|skin-card|skin-flash)/.test(r.sel));
  ok(tail.length > 50 && !bad.length, `styles.css 換裝那一段只有設定頁與閃光：${bad.map((r) => r.sel).join(' | ')}`);
}

// ------------------------------------------------------------------ 5 檔案清單
{
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const need = ['skin.js', 'music.js', 'skins/base.css', ...ids.map((k) => `skins/${k}.js`), ...ids.slice(1).map((k) => `skins/${k}.css`)];
  const miss = need.filter((f) => !sw.includes(`'${f}'`));
  ok(!miss.length, `service worker 要先存好換裝的檔案：少了 ${miss}`);
  const files = fs.readdirSync(path.join(ROOT, 'skins'));
  ok(files.every((f) => need.includes(`skins/${f}`)), `skins/ 底下沒有清單以外的檔案：${files}`);
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m = /\^\(([a-z|]+)\)\$/.exec(html);
  ok(m && m[1].split('|').sort().join() === ids.slice(1).sort().join(), 'index.html 開頭先放換裝 CSS 的清單和 SKINS 一樣');
}

if (fails.length) { console.log(`失敗 ${fails.length}／${n}：\n- ${fails.join('\n- ')}`); process.exit(1); }
console.log(`${n} 個測試通過`);
