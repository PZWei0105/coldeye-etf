// 介面效果的測試：node tests/hud_test.mjs
// 光環（盤中即時價直接用頂端狀態列的判斷、收盤後的完整分析什麼時候算「等」「晚了」）、數字翻牌（只翻變了的位數、方向、
// 隱藏金額不翻、拼回來一定是新的字）、回到原本（四個效果都關掉時，每一個產生畫面的小工具輸出和改之前一模一樣）、
// 顯示模式（關掉三段模式固定作戰）、鏡頭轉場（換分頁時不縮回去、只略過一次）、設定頁的開關。
// 畫面上「全部關掉＝11/16 的樣子」另外用瀏覽器逐張截圖比對（見 CLAUDE.md 的介面效果）。
import assert from 'node:assert/strict';
import fs from 'node:fs';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.window = globalThis;
if (!globalThis.navigator) globalThis.navigator = { userAgent: 'node', language: 'zh-TW' };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
const bodyCls = new Set();
globalThis.document = {
  hidden: false, visibilityState: 'visible',
  body: { classList: { add: (c) => bodyCls.add(c), remove: (c) => bodyCls.delete(c), toggle: (c, on) => (on ? bodyCls.add(c) : bodyCls.delete(c)), contains: (c) => bodyCls.has(c) } },
  querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
  createElement: () => ({ style: {}, classList: { add() {} }, appendChild() {}, setAttribute() {} }), activeElement: null,
};
globalThis.history = { pushState() {}, replaceState() {}, back() {} };
globalThis.location = { hash: '' };
globalThis.performance = globalThis.performance || { now: () => Date.now() };

const C = await import('../site/calc.js');
const Core = await import('../site/core.js');
const H = await import('../site/hud.js');
const { settings } = Core;

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
const bad = (s) => /undefined|NaN|\[object|Infinity/.test(String(s));

// ------------------------------------------------------------------ 光環：盤中即時價
t('盤中即時價：剛更新是滿的、越舊越空，12 分鐘空掉', () => {
  assert.deepEqual(C.haloLive('live', 0), { st: 'ok', f: 1 });
  near(C.haloLive('live', 3).f, 0.75);
  near(C.haloLive('live', 6).f, 0.5);
  assert.equal(C.haloLive('live', 12).f, 0);
  assert.equal(C.haloLive('live', 40).f, 0);      // 不會變成負的
  assert.equal(C.haloLive('live', -2).f, 1);      // 手機時鐘比後台慢：不會超過滿
  assert.equal(C.haloLive('live', null).f, 1);    // 算不出幾分鐘前：當作剛更新（狀態列也說「盤中」）
  near(C.haloLive('live', 5, 10).f, 0.5);         // 門檻可以換
});
t('盤中即時價：延遲＝琥珀、等第一筆＝空心、收盤或休市＝靜止的完整環（照頂端狀態列的四種）', () => {
  assert.deepEqual(C.haloLive('lag', 3), { st: 'late', f: 1 });
  assert.deepEqual(C.haloLive('wait', 0), { st: 'wait', f: 0 });
  assert.deepEqual(C.haloLive('idle', 500), { st: 'rest', f: 1 });
  assert.deepEqual(C.haloLive(undefined), { st: 'rest', f: 1 });
});

// ------------------------------------------------------------------ 光環：收盤後的完整分析
t('收盤後的完整分析：開市日 13:35 起「等」、14:40 起「晚了」，換成今天的就是完整', () => {
  const base = { asof: 20261113, td: 20261116, trading: true };
  assert.equal(C.haloEod({ ...base, hm: 900 }).st, 'rest');          // 盤中用的就是上一個交易日收盤算的
  assert.equal(C.haloEod({ ...base, hm: 900 }).k, 'prev');
  assert.equal(C.haloEod({ ...base, hm: 1334 }).st, 'rest');
  assert.deepEqual(C.haloEod({ ...base, hm: 1335 }), { st: 'wait', f: 0, k: 'soon' });
  assert.equal(C.haloEod({ ...base, hm: 1439 }).st, 'wait');
  assert.deepEqual(C.haloEod({ ...base, hm: 1440 }), { st: 'late', f: 1, k: 'late' });
  assert.equal(C.haloEod({ ...base, hm: 2330 }).st, 'late');
  assert.deepEqual(C.haloEod({ ...base, asof: 20261116, hm: 1500 }), { st: 'rest', f: 1, k: 'today' });
});
t('收盤後的完整分析：休市、週末、資料還沒載入都不催', () => {
  assert.equal(C.haloEod({ asof: 20261113, td: 20261114, hm: 1600, trading: false }).st, 'rest');
  assert.equal(C.haloEod({ asof: null, td: 20261116, hm: 1600, trading: true }).st, 'rest');
  assert.equal(C.haloEod({ asof: 20261113, td: null, hm: 1600, trading: true }).st, 'rest');
});

// ------------------------------------------------------------------ 數字翻牌
const roll = (a, b) => (C.rollPlan(a, b) || []).filter((p) => p.r).map((p) => `${p.o}${p.r}${p.c}`).join(' ');
t('數字翻牌：只翻變了的位數，從右邊對齊，變大往上、變小往下', () => {
  assert.equal(roll('773,940', '774,105'), '3u4 9u1 4u0 0u5');
  assert.equal(roll('52.30', '51.85'), '2d1 3d8 0d5');
  assert.equal(roll('1', '2'), '1u2');
  const p = C.rollPlan('773,940', '774,105');
  assert.deepEqual(p.map((x) => x.i), [6, 5, 4, 3, 2, 1, 0]);   // 從右邊數第幾個（動畫照這個錯開）
  assert.equal(p.map((x) => x.c).join(''), '774,105');
});
t('數字翻牌：多一位數時左邊長出來（淡入），正負號換了淡入', () => {
  assert.equal(roll('99.50', '100.10'), 'f1 9u0 9u0 5u1');
  assert.equal(roll('+1.20%', '−0.35%'), '+f− 1d0 2d3 0d5');
  assert.equal(roll('−0.35%', '+1.20%'), '−f+ 0u1 3u2 5u0');
  assert.equal(roll('1,000', '999'), '0d9 0d9 0d9');            // 少一位：左邊的直接不見
});
t('數字翻牌：沒變、隱藏金額（••••）、沒有數字（—）都不翻', () => {
  assert.equal(C.rollPlan('774,105', '774,105'), null);
  assert.equal(C.rollPlan('••••', '••••'), null);
  assert.equal(C.rollPlan('1,234', '••••'), null);
  assert.equal(C.rollPlan('••••', '1,234'), null);
  assert.equal(C.rollPlan('—', '12.30'), null);
  assert.equal(C.rollPlan(null, '1'), null);
  assert.equal(C.rollPlan(undefined, undefined), null);
});
t('數字翻牌：隨機 5000 組，拼回來一定是新的字、方向和數值一致、只有數字對數字才翻', () => {
  let seed = 20261117;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const fmtN = (v, d) => (v < 0 ? '−' : rnd() < 0.3 ? '+' : '') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) + (rnd() < 0.3 ? '%' : '');
  let rolled = 0;
  for (let i = 0; i < 5000; i++) {
    const d = Math.floor(rnd() * 3);
    const a = (rnd() - 0.3) * 10 ** Math.floor(rnd() * 7), b = a * (1 + (rnd() - 0.5) * (rnd() < 0.2 ? 3 : 0.04));
    const sa = fmtN(a, d), sb = fmtN(b, d);
    const p = C.rollPlan(sa, sb);
    if (sa === sb) { assert.equal(p, null); continue; }
    if (!p) continue;
    assert.equal(p.map((x) => x.c).join(''), sb, `${sa} → ${sb}`);
    for (const x of p) {
      assert.ok([null, 'u', 'd', 'f'].includes(x.r));
      if (x.r === 'u' || x.r === 'd') { assert.match(x.c, /[0-9]/); assert.match(x.o, /[0-9]/); assert.notEqual(x.c, x.o); rolled++; }
      if (x.r == null) assert.equal(x.c, x.o);
    }
    const na = parseFloat(sa.replace('−', '-').replace(/[^0-9.\-]/g, '')), nb = parseFloat(sb.replace('−', '-').replace(/[^0-9.\-]/g, ''));
    if (nb > na) assert.ok(!p.some((x) => x.r === 'd'), `${sa} → ${sb} 變大卻往下翻`);
    if (nb < na) assert.ok(!p.some((x) => x.r === 'u'), `${sa} → ${sb} 變小卻往上翻`);
  }
  assert.ok(rolled > 5000);
});

// ------------------------------------------------------------------ 開關與回到原本
const ALL = ['halo', 'roll', 'zoom', 'modes'];
t('預設四個效果都打開、顯示模式是作戰', () => {
  for (const k of ALL) assert.equal(H.uiOn(k), true, k);
  assert.equal(H.dmode(), 'combat');
  assert.deepEqual(H.UI_FX.map((x) => x.k), ALL);
});
t('四個都打開時：光環、翻牌、模式按鈕照樣輸出', () => {
  assert.equal(H.haloHTML('live'), '<button type="button" class="halo" data-halo="live" aria-label="資料新鮮度"><i aria-hidden="true"></i></button>');
  assert.equal(H.rollAttr('px:0050', '52.30'), ' data-roll="px:0050" data-rv="52.30"');
  assert.equal(H.rollSpan('dpc:0050', '+1.20%'), '<span class="rl" data-roll="dpc:0050" data-rv="+1.20%">+1.20%</span>');
  assert.equal(H.rollSpan('x', '<b>"\''), '<span class="rl" data-roll="x" data-rv="&lt;b&gt;&quot;&#39;">&lt;b&gt;&quot;&#39;</span>');
  assert.match(H.dmodeChipHTML(), /id="dmode"[^>]*>.*<span>作戰<\/span><\/button>$/);
  assert.match(H.statusIcon({ key: 'live' }), /^<i class="hring st-ok" style="--f:1\.000"><\/i>$/);
  assert.match(H.statusIcon({ key: 'live', offline: true }), /st-off/);
});
t('「回到原本」：四個都關掉，每一個小工具輸出和改之前一模一樣（沒有新元素、沒有新屬性）', () => {
  H.setAllUi(false);
  for (const k of ALL) assert.equal(H.uiOn(k), false, k);
  assert.equal(H.haloHTML('live'), '');
  assert.equal(H.haloHTML('eod'), '');
  assert.equal(H.rollAttr('px:0050', '52.30'), '');
  assert.equal(H.rollSpan('dpc:0050', '+1.20%'), '+1.20%');
  assert.equal(H.rollSpan('x', '<b>'), '&lt;b&gt;');                 // 原本也是 esc() 過的文字
  assert.equal(H.dmodeChipHTML(), '');
  assert.equal(H.statusIcon({ key: 'live' }), '<i></i>');           // 原本頂端狀態列的菱形
  settings.dmode = 'deep';
  assert.equal(H.dmode(), 'combat');                                // 三段模式關掉：固定作戰（原本的畫面）
  H.paintDmode();
  assert.ok(!bodyCls.has('dm-deep') && !bodyCls.has('dm-cruise'));
  const saved = JSON.parse(mem.get('coldeye.settings'));
  assert.deepEqual(saved.ui, { halo: false, roll: false, zoom: false, modes: false });   // 存在這支手機，下次打開還是關的
  assert.equal(H.zoomReady('0050'), false);
  H.setAllUi(true);
  for (const k of ALL) assert.equal(H.uiOn(k), true, k);
  assert.equal(H.dmode(), 'deep');                                  // 打開回來：上次選的模式還在
  settings.dmode = 'combat';
});
t('一個一個關：只關掉那一個', () => {
  H.setUi('roll', false);
  assert.equal(H.uiOn('roll'), false);
  assert.equal(H.uiOn('halo'), true);
  assert.equal(H.rollAttr('T', '1'), '');
  assert.notEqual(H.haloHTML('live'), '');
  H.setUi('roll', true);
  assert.equal(H.uiOn('roll'), true);
});
t('顯示模式：巡航、深潛照設定，不認得的值當作戰；body 只有巡航、深潛才加 class', () => {
  H.setDmode('cruise');
  assert.equal(H.dmode(), 'cruise');
  assert.ok(bodyCls.has('dm-cruise') && !bodyCls.has('dm-deep'));
  H.setDmode('deep');
  assert.equal(H.dmode(), 'deep');
  assert.ok(bodyCls.has('dm-deep') && !bodyCls.has('dm-cruise'));
  H.setDmode('hack<script>');
  assert.equal(settings.dmode, 'combat');
  assert.equal(H.dmode(), 'combat');
  assert.ok(!bodyCls.has('dm-deep') && !bodyCls.has('dm-cruise'));
  settings.ui = '壞掉的值';                                          // 儲存空間被改壞：當作全部打開，不會炸
  assert.equal(H.uiOn('halo'), true);
  H.setAllUi(true);
});
t('鏡頭轉場：只有單檔頁（代號）才縮回去；換分頁、換模式時略過一次，下一次照常', () => {
  assert.equal(H.zoomReady('0050'), true);
  assert.equal(H.zoomReady('00679B'), true);
  assert.equal(H.zoomReady('__prefs'), false);
  assert.equal(H.zoomReady(null), false);
  H.zoomSkip();
  assert.equal(H.zoomReady('0050'), false);
  assert.equal(H.zoomReady('0050'), true);
  settings.fx = false;                                              // 畫面特效關掉：不動
  assert.equal(H.zoomReady('0050'), false);
  settings.fx = true;
  H.setUi('zoom', false);
  assert.equal(H.zoomReady('0050'), false);
  H.setUi('zoom', true);
});
t('光環說明：資料還沒載入時不說話', () => {
  assert.deepEqual(H.haloInfo('live'), { st: 'rest', f: 1, txt: '' });
  assert.deepEqual(H.haloInfo('eod'), { st: 'rest', f: 1, txt: '' });
});
t('設定頁「介面效果」：四個開關、模式、回到原本／全部打開，沒有 undefined', () => {
  const on = H.hudSettingsHTML();
  assert.ok(!bad(on));
  for (const x of H.UI_FX) assert.ok(on.includes(`data-ui="${x.k}" aria-checked="true"`), x.k);
  for (const m of H.DMODES) assert.ok(on.includes(`data-dm="${m.k}"`), m.k);
  assert.match(on, /id="s-uiall">回到原本</);
  assert.match(on, /只存在這支手機/);
  H.setAllUi(false);
  const off = H.hudSettingsHTML();
  assert.ok(!bad(off));
  for (const x of H.UI_FX) assert.ok(off.includes(`data-ui="${x.k}" aria-checked="false"`), x.k);
  assert.ok(!off.includes('data-dm='));                             // 三段模式關掉：不顯示模式選擇
  assert.match(off, /id="s-uiall">全部打開</);
  H.setAllUi(true);
});
t('不進備份：備份只帶固定幾個設定，沒有 ui、dmode', () => {
  const src = fs.readFileSync(new URL('../site/forms.js', import.meta.url), 'utf8');
  const m = src.match(/prefs: \{([^}]*)\}/);
  assert.ok(m, '找不到備份的 prefs');
  assert.ok(!/\bui\b|dmode/.test(m[1]));
});
console.log(`\n${n} 個測試通過`);
