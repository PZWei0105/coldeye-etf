// 今日一課、案例教室的測試：node tests/lessons_test.mjs [hist 資料夾]
// 內容完整性（每一課有出處、連結的名詞／案例存在）、輪課順序、「現在的例子」不會炸、案例的統計與文字用真實歷史檔算得出來。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// 最小的瀏覽器環境：介面模組在載入時只碰 localStorage／matchMedia（都包在 try 裡），這裡給它們假的
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.window = globalThis;
if (!globalThis.navigator) globalThis.navigator = { userAgent: 'node', language: 'zh-TW' };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.document = { hidden: false, body: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false } }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, classList: { add() {} }, appendChild() {} }), activeElement: null };
globalThis.history = { pushState() {}, replaceState() {}, back() {} };
globalThis.location = { hash: '' };
globalThis.performance = globalThis.performance || { now: () => Date.now() };

const L = await import('../site/lessons.js');
const C = await import('../site/cases.js');
const { TERMS } = await import('../site/learn.js');
const core = await import('../site/core.js');
const { linesSVG } = await import('../site/viz.js');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const bad = (s) => /undefined|NaN|null|\[object/.test(String(s));
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);

// ------------------------------------------------------------------ 課程內容
t('每一課：id 不重複、類別合法、有標題、重點、內文、官方出處（https）', () => {
  const ids = new Set();
  for (const x of L.LESSONS) {
    assert.ok(x.id && !ids.has(x.id), `id ${x.id}`); ids.add(x.id);
    assert.ok(L.LESSON_CATS[x.k], `${x.id} 類別 ${x.k}`);
    assert.ok(x.t && x.hook && Array.isArray(x.b) && x.b.length >= 2, `${x.id} 內文太少`);
    assert.ok(Array.isArray(x.src) && x.src.length >= 1, `${x.id} 沒有出處`);
    for (const s of x.src) assert.ok(/^https:\/\//.test(s.u) && s.n, `${x.id} 出處 ${s.u}`);
    for (const p of [...x.b, ...(x.do || [])]) assert.ok(typeof p === 'string' && p.length > 10 && !bad(p), `${x.id}：${p}`);
    for (const k of x.terms || []) assert.ok(TERMS[k], `${x.id} 名詞 ${k} 不在小辭典`);
    for (const c of x.cases || []) assert.ok(C.CASES.some((z) => z.id === c), `${x.id} 案例 ${c} 不存在`);
    if (x.nav) assert.ok((x.nav.tab && ['home', 'pf', 'radar', 'aide', 'news', 'track'].includes(x.nav.tab)) || ['tm', 'duel', 'cases'].includes(x.nav.sheet), `${x.id} nav`);
  }
  assert.ok(L.LESSONS.length >= 30);
  for (const k of Object.keys(L.LESSON_CATS)) assert.ok(L.LESSONS.filter((x) => x.k === k).length >= 8, `${k} 太少`);
});

t('輪課順序：三類輪流、每一課都排到、照日期輪、輪完從頭', () => {
  const order = L.lessonOrder();
  assert.equal(new Set(order).size, L.LESSONS.length);
  assert.equal(order.length, L.LESSONS.length);
  const ks = order.slice(0, 3).map((id) => L.lessonById(id).k);
  assert.deepEqual(ks, ['basic', 'trap', 'read']);
  assert.equal(L.todayLessonIdx(20261022), 0);
  assert.equal(L.todayLessonIdx(20261023), 1);
  assert.equal(L.todayLessonIdx(20261022 + 0 + 0), 0);
  // 11/1 是第 10 天（10/22 → 11/1）
  assert.equal(L.todayLessonIdx(20261101), 10);
  const N = order.length;
  const far = 20270101;   // 71 天後
  assert.equal(L.todayLessonIdx(far), 71 % N);
  assert.equal(L.todayLessonIdx(20261021), N - 1);   // 第一課之前的日子也不會壞
});

t('「現在的例子」：沒有資料時不會炸、有資料時不會印出 undefined', () => {
  core.S.summary = null; core.S.rows = new Map(); core.S.breadth = null; core.S.track = null; core.S.P = null; core.S.live = null;
  for (const x of L.LESSONS) { if (!x.ex) continue; let s = ''; try { s = x.ex(); } catch (e) { assert.fail(`${x.id} 沒資料時炸了：${e.message}`); } assert.ok(!bad(s), `${x.id}：${s}`); }
  const etfs = [
    { c: '0050', n: '元大台灣50', k: 'broad', p: 108, pc: 0.8, pr: 0.12, y: 1.4, r1y: 0.42, aum: 9e11, hd: 3677896, val: 2e10, dl: 100, fl: [], dv: { d: 20261122, cash: 1.2 }, d: 20261021 },
    { c: '0056', n: '元大高股息', k: 'div', p: 58, pc: 0.5, pr: 0.3, y: 5.1, r1y: 0.22, aum: 5e11, hd: 1715967, val: 5e9, dl: 55, fl: ['notice'], dv: { d: 20261123, cash: null }, d: 20261021 },
    { c: '00631L', n: '元大台灣50正2', k: 'lev', p: 36, pc: 1.6, pr: 0.9, y: 0, r1y: 0.9, aum: 1e11, hd: 300000, val: 3e9, dl: 30, fl: [], d: 20261021 },
    { c: '00632R', n: '元大台灣50反1', k: 'inv', p: 2.5, pc: -0.8, pr: 0.2, y: 0, r1y: -0.4, aum: 2e10, hd: 50000, val: 1e9, dl: 3, fl: [], d: 20261021 },
    { c: '00400A', n: '主動國泰動能高息', k: 'active', p: 14.8, pc: 1.5, pr: 0.27, y: 3.2, r1y: 0.2, aum: 3e10, hd: 139338, val: 3e8, dl: 14, fl: [], d: 20261021 },
    { c: '00662', n: '富邦NASDAQ', k: 'overseas', p: 90, pc: 0.2, pr: 1.2, y: 0, r1y: 0.3, aum: 1e11, hd: 200000, val: 2e9, dl: 85, fl: [], d: 20261021 },
  ];
  core.S.summary = { asof: 20261021, generated: '2026-10-21T22:25:22+08:00', etfs, market: { d: 20261021, close: 46887.77, chg: 594.84, pct: 1.28, ma60: 46166.97, insti: { f: 9.6e8, t: 1.29e10, d: -1.33e10, date: 20261021 } }, cats: {} };
  core.S.rows = new Map(etfs.map((r) => [r.c, r]));
  core.S.breadth = { n: 300, bull: 180, neu: 80, bear: 40, pBull: 0.6 };
  core.S.track = { delisted_n: 37, overall: { n: 71947, start: 20200721, end: 20260918, bull: { hit: 0.5854 }, bear: { hit: 0.4968 } }, overall_adj: { bull: 0.56, bear: 0.46 }, pos: { '*': { add: { up: 0.58 }, trim: { up: 0.47 } } }, pos_adj: { add: { up: 0.57 }, trim: { up: 0.55 } } };
  core.S.live = { at: '2026-10-22T11:12:32+08:00', etfs: {}, date: 20261022 };
  core.settings.watch = ['0050', '0056', '00662'];
  let withEx = 0;
  for (const x of L.LESSONS) { if (!x.ex) continue; const s = x.ex(); assert.ok(!bad(s), `${x.id}：${s}`); if (s) withEx++; }
  assert.ok(withEx >= 20, `有例子的課太少：${withEx}`);
});

t('指揮台小卡：有今天那一課的標題、按鈕；上過的課會記在手機', () => {
  const html = L.lessonHomeHTML();
  const Ltoday = L.lessonById(L.lessonOrder()[L.todayLessonIdx()]);
  assert.ok(html.includes(Ltoday.t.replace(/&/g, '&amp;')));
  assert.ok(html.includes('data-lesson="open"') && html.includes('data-lesson="cases"'));
  assert.equal(L.seenCount(), 0);
});

// ------------------------------------------------------------------ 案例：純計算
const mk = (dates, prices, extra = {}) => ({ c: 'X', d: dates, p: prices, sig: [], splits: [], divs: [], ...extra });
t('windowStats：起點 100、含息報酬、最大回檔與低點日期', () => {
  const h = mk([20240101, 20240102, 20240103, 20240104, 20240105], [100, 110, 99, 120, 115]);
  const w = C.windowStats(h, 20240101, 20240105);
  near(w.idx[0], 100); near(w.ret, 0.15); near(w.mdd, 99 / 110 - 1); assert.equal(w.lowD, 20240103); assert.equal(w.peakD, 20240102);
  assert.equal(C.windowStats(h, 20250101, 20250131), null);
  // 期間切在中間：起點換成那一天
  const w2 = C.windowStats(h, 20240103, 20240104);
  near(w2.idx[1], 120 / 99 * 100);
});
t('recoverAfter：大跌後回到前一天水準的交易日數、最低點', () => {
  const h = mk([20240801, 20240802, 20240805, 20240806, 20240807, 20240808], [100, 100, 91, 88, 95, 101]);
  const r = C.recoverAfter(h, 20240805);
  near(r.drop, -0.09); near(r.low, -0.12); assert.equal(r.lowD, 20240806); assert.equal(r.backD, 20240808); assert.equal(r.backN, 3); assert.equal(r.preD, 20240802);
  const r2 = C.recoverAfter(mk([20240801, 20240802, 20240805], [100, 100, 91]), 20240805);
  assert.equal(r2.backD, null);
});
t('divFill：除息前後的價格、填息天數；配息算進含息指數', () => {
  const h = mk([20221017, 20221018, 20221019, 20221020, 20221021], [25.5, 25.84, 23.95, 24.5, 25.9], { divs: [[20221019, 2.1]] });
  const d = C.divFill(h, 20221019);
  near(d.pre, 25.84); near(d.ex, 23.95); near(d.cash, 2.1); near(d.drop, 23.95 - 25.84, 1e-9); assert.equal(d.fillD, 20221021); assert.equal(d.fillN, 2);
  const w = C.windowStats(h, 20221018, 20221019);
  near(w.ret, (23.95 + 2.1) / 25.84 - 1);
});
t('sigChanges：只記換訊號的那幾筆', () => {
  const h = mk([1], [1], { sig: [[20220104, 'wait'], [20220111, 'wait'], [20220125, 'caution'], [20220224, 'trim'], [20220304, 'trim'], [20230110, 'wait']] });
  assert.deepEqual(C.sigChanges(h, 20220101, 20221231), [[20220104, 'wait'], [20220125, 'caution'], [20220224, 'trim']]);
});

t('每個案例：id 不重複、有出處、相關課程存在、文字段落合法', () => {
  const ids = new Set();
  for (const x of C.CASES) {
    assert.ok(x.id && !ids.has(x.id)); ids.add(x.id);
    assert.ok(x.t && x.sub && x.codes.length >= 1 && x.from, x.id);
    assert.ok(x.src.length >= 1 && x.src.every((s) => /^https:\/\//.test(s.u)), x.id);
    for (const l of x.lessons || []) assert.ok(L.lessonById(l), `${x.id} 課 ${l}`);
    for (const k of ['tell', 'judge', 'trap']) assert.ok(Array.isArray(x[k]) && x[k].length >= 2, `${x.id} ${k}`);
    for (const m of x.marks || []) assert.ok(m.d >= x.from && (!x.to || m.d <= x.to), `${x.id} 標記 ${m.d} 不在期間內`);
  }
  assert.ok(C.CASES.length >= 8);
});

t('折線圖的事件標記：畫出來、靠右的標籤靠左對齊', () => {
  const dates = Array.from({ length: 50 }, (_, i) => 20240101 + i);
  const svg = linesSVG({ dates, series: [{ name: 'a', col: 'red', vals: dates.map((_, i) => 100 + i) }], marks: [{ i: 2, t: '開始' }, { i: 48, t: '結束' }, { i: 99, t: '不在圖裡' }] });
  assert.equal((svg.match(/class="mark"/g) || []).length, 2);
  assert.ok(svg.includes('text-anchor="start" class="mk">開始') && svg.includes('text-anchor="end" class="mk">結束'));
});

// ------------------------------------------------------------------ 案例：用真實歷史檔算一遍（有給資料夾才跑）
const dir = process.argv[2];
if (dir && fs.existsSync(dir)) {
  const hists = {};
  const load = (c) => { if (!(c in hists)) { const f = path.join(dir, `${c}.json`); hists[c] = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; } return hists[c]; };
  for (const x of C.CASES) {
    t(`案例 ${x.id}：統計算得出來、每一段文字沒有 undefined／NaN`, () => {
      const H = {};
      for (const c of x.codes) { H[c] = load(c); assert.ok(H[c] && H[c].d && H[c].d.length > 100, `${x.id} 缺 ${c} 的歷史檔`); }
      const st = C.caseStats(x, H);
      for (const c of x.codes) { assert.ok(st[c] && st[c].dates.length > 10, `${x.id} ${c} 期間沒資料`); assert.ok(Number.isFinite(st[c].ret) && Number.isFinite(st[c].mdd), `${x.id} ${c}`); }
      for (const k of ['tell', 'judge', 'trap']) for (const p of x[k]) { const s = typeof p === 'function' ? p(st) : p; assert.ok(typeof s === 'string' && s.length > 10 && !bad(s), `${x.id} ${k}：${s}`); }
      // 標記的日期在主角那檔的資料範圍裡（允許落在休市日，畫圖時取之後第一個交易日）
      const D = st[x.codes[0]].dates;
      for (const m of x.marks || []) assert.ok(m.d >= D[0] && m.d <= D[D.length - 1], `${x.id} 標記 ${m.d} 不在走勢裡`);
    });
  }
  t('案例的硬數字和資料一致：2024/8/5 0050 四個交易日回來、0056 2022/10 除息 33 個交易日填息、0050 分割 6/18 恢復', () => {
    const r = C.recoverAfter(load('0050'), 20240805);
    assert.equal(r.backN, 4);
    const d = C.divFill(load('0056'), 20221019);
    assert.equal(d.fillN, 33); near(d.cash, 2.1);
    const h = load('0050');
    const i = h.d.indexOf(20250610);
    assert.ok(i > 0 && h.d[i + 1] === 20250618, '0050 分割停止交易 6/11～6/17');
    near(h.p[i] / h.p[i + 1], 4, 0.05);   // 一拆四
    const r25 = C.recoverAfter(load('0050'), 20250407);
    assert.equal(r25.backN, 24);
  });
} else {
  console.log('（沒有給 hist 資料夾，略過真實資料的案例檢查）');
}
console.log(`\n${n} 個測試通過`);
