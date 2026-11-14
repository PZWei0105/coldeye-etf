// 投入總覽與定期定額卡的測試：node tests/invest_test.mjs
// 你投入了多少（＝還在手上的股票的成本，對照國泰的總成本）、市值、全部賣掉實拿（整股零股分開算手續費、證交稅）、損益；
// 定期定額那一部分（賣出照國泰的規則先賣現股）、某一個月扣了哪幾期、和國泰總成本對帳；畫面不出現 undefined／NaN、隱藏金額時沒有金額。
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.window = globalThis;
if (!globalThis.navigator) globalThis.navigator = { userAgent: 'node', language: 'zh-TW' };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.document = { hidden: false, body: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false } }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, classList: { add() {} }, appendChild() {} }), activeElement: null };
globalThis.history = { pushState() {}, replaceState() {}, back() {} };
globalThis.location = { hash: '' };
globalThis.performance = globalThis.performance || { now: () => Date.now() };

const C = await import('../site/calc.js');
const pf = await import('../site/pf.js');
const Core = await import('../site/core.js');
const IV = await import('../site/invest.js');
const D = await import('../site/dca.js');
const { TERMS } = await import('../site/learn.js');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
const bad = (s) => /undefined|NaN|\[object|Infinity/.test(String(s));
const dca = (id, c, d, sh, px, fee = 1, est = false, plan = 'p1') => ({ id, c, side: 'buy', d, sh, px, fee, dca: { plan, s: d, est } });
const buy = (id, c, d, sh, px, fee = 20) => ({ id, c, side: 'buy', d, sh, px, fee });
const sell = (id, c, d, sh, px, fee = 20, tax = 0) => ({ id, c, side: 'sell', d, sh, px, fee, tax });

// ------------------------------------------------------------------ 定期定額那一部分
t('定期定額那一部分：每一期付出的錢加總、期數、預估、第一期與最近一期', () => {
  const r = C.dcaPart([dca('a', '0050', 20260906, 30, 99.5), dca('b', '0050', 20261006, 29, 101.2), dca('c', '0050', 20261106, 30, 99.7, 1, true)], []);
  near(r.dca.paid, 30 * 99.5 + 1 + 29 * 101.2 + 1 + 30 * 99.7 + 1);
  near(r.dca.cost, r.dca.paid);
  assert.equal(r.dca.sh, 89); assert.equal(r.dca.n, 3); assert.equal(r.dca.est, 1);
  assert.equal(r.dca.first, 20260906); assert.equal(r.dca.last, 20261106);
  assert.equal(r.other.sh, 0);
});
t('賣出照國泰的規則：先賣現股，不夠才賣定期定額的（成本照平均扣）', () => {
  const lots = [buy('m', '0050', 20260105, 1000, 10, 20), dca('a', '0050', 20260206, 100, 11), dca('b', '0050', 20260306, 100, 12), sell('s', '0050', 20260401, 1100, 13)];
  const r = C.dcaPart(lots, []);
  assert.equal(r.other.sh, 0);
  assert.equal(r.dca.sh, 100);
  near(r.dca.cost, (100 * 11 + 1 + 100 * 12 + 1) / 2);
  near(r.dca.paid, 100 * 11 + 1 + 100 * 12 + 1);
  // 只賣一部分：定期定額不動
  const r2 = C.dcaPart([...lots.slice(0, 3), sell('s', '0050', 20260401, 500, 13)], []);
  assert.equal(r2.other.sh, 500); assert.equal(r2.dca.sh, 200); near(r2.dca.cost, r2.dca.paid);
  // 先賣掉定期定額（那時候沒有現股），之後才自己買：賣掉的是定期定額的
  const r3 = C.dcaPart([dca('a', '0050', 20260206, 500, 11), sell('s', '0050', 20260301, 300, 12), buy('m', '0050', 20260401, 1000, 13)], []);
  assert.equal(r3.dca.sh, 200); assert.equal(r3.other.sh, 1000);
});
t('分割：分割前買的股數換算成目前的基準，花的錢不變', () => {
  const r = C.dcaPart([dca('a', '00662', 20261013, 25, 117.6), dca('b', '00662', 20261117, 125, 23.5)], [[20261117, 5]]);
  assert.equal(r.dca.sh, 25 * 5 + 125);
  near(r.dca.paid, 25 * 117.6 + 1 + 125 * 23.5 + 1);
});

// ------------------------------------------------------------------ 投入總覽
const rows = new Map([['0050', { c: '0050', k: 'broad', n: '元大台灣50' }], ['00878', { c: '00878', k: 'div', n: '國泰永續高股息' }], ['00679B', { c: '00679B', k: 'bond', n: '元大美債20年' }]]);
const fee = { disc: 0.28, min: 20, minOdd: 1 };
const lotsA = [
  dca('a', '0050', 20260906, 30, 99.5), dca('b', '0050', 20261006, 29, 101.2), dca('c', '0050', 20261106, 30, 99.7, 1, true),
  buy('m', '00878', 20260210, 2000, 22.1, 63),
  dca('d', '00679B', 20261016, 110, 27.1, 1, false, 'p2'),
];
const qs = { '0050': { px: 103.5, ch: 1.2, pc: 1.17, date: 20261113 }, '00878': { px: 33.2, ch: 0.1, pc: 0.3, date: 20261113 }, '00679B': { px: 26.9, ch: -0.1, pc: -0.37, date: 20261113 } };
const PA = pf.buildPortfolio({ cash: 0, lots: lotsA }, rows, (r) => qs[r.c], {}, fee, 20261114);
const VA = C.investView(PA, lotsA, () => [], fee, 20261114);
t('投入總覽：你投入了＝還在手上的股票的成本（含買進手續費），損益＝全部賣掉實拿 − 投入', () => {
  near(VA.cost, PA.holdings.reduce((a, x) => a + x.h.cost, 0));
  near(VA.cost, 30 * 99.5 + 29 * 101.2 + 30 * 99.7 + 3 + 2000 * 22.1 + 63 + 110 * 27.1 + 1);
  near(VA.mv, 89 * 103.5 + 2000 * 33.2 + 110 * 26.9);
  near(VA.paper, VA.mv - VA.cost);
  near(VA.real, PA.totals.pnl);   // 和部位卡的「未實現損益」同一個數字
  near(VA.sell.net, VA.mv - VA.sell.fee - VA.sell.tax);
  // 0050 89 股（零股）：手續費 floor(89×103.5×0.1425%×0.28)=3、最低 1；00878 2 張（整股）：floor(66400×0.1425%×0.28)=26；00679B 債券（2026 年底前免證交稅）
  assert.equal(PA.holdings.find((x) => x.code === '0050').sell.fee, Math.max(1, Math.floor(89 * 103.5 * 0.001425 * 0.28)));
  assert.equal(PA.holdings.find((x) => x.code === '00679B').sell.tax, 0);
  near(VA.sell.tax, Math.floor(89 * 103.5 * 0.001) + Math.floor(2000 * 33.2 * 0.001));
  assert.equal(VA.sold, false); near(VA.paidAll, VA.cost); assert.equal(VA.back, 0);
});
t('投入總覽：定期定額的部分每一檔各自算，加起來＋自己買的＝全部', () => {
  assert.deepEqual(VA.dca.codes.map((c) => c.code), ['0050', '00679B']);
  const c50 = VA.dca.codes.find((c) => c.code === '0050');
  assert.equal(c50.n, 3); assert.equal(c50.est, 1); assert.equal(c50.sh, 89);
  near(c50.paid, c50.cost); near(c50.mv, 89 * 103.5);
  near(c50.real, c50.sell.net - c50.cost);
  near(VA.dca.cost + VA.other.cost, VA.cost);
  assert.equal(VA.dca.n, 4); assert.equal(VA.dca.est, 1);
});
t('投入總覽：賣過的話，總共買進花的、賣掉拿回的分開算；「你投入了」只算還在手上的', () => {
  const lots = [...lotsA, sell('s', '00878', 20261101, 1000, 30, 20, 30)];
  const P = pf.buildPortfolio({ cash: 0, lots }, rows, (r) => qs[r.c], {}, fee, 20261114);
  const V = C.investView(P, lots, () => [], fee, 20261114);
  assert.equal(V.sold, true);
  near(V.paidAll, VA.paidAll);
  near(V.back, 1000 * 30 - 20 - 30);
  near(V.cost, P.holdings.reduce((a, x) => a + x.h.cost, 0));
  assert.ok(V.cost < V.paidAll);
});
t('投入總覽：沒有價格的那一檔，投入照算、市值和實拿不算，列出來', () => {
  const P = pf.buildPortfolio({ cash: 0, lots: lotsA }, rows, (r) => (r.c === '00878' ? null : qs[r.c]), {}, fee, 20261114);
  const V = C.investView(P, lotsA, () => [], fee, 20261114);
  assert.deepEqual(V.missing, ['00878']);
  near(V.cost, VA.cost);
  near(V.mv, 89 * 103.5 + 110 * 26.9);
  assert.equal(C.investView(null), null);
});

// ------------------------------------------------------------------ 某一個月扣了哪幾期
t('某一個月扣了哪幾期：看成交日，付出的錢＝股數 × 價＋手續費；國泰沒扣的、你標沒扣到的也列', () => {
  const lots = [dca('a', '0050', 20261006, 29, 101.2), dca('c', '0050', 20261106, 30, 99.7, 1, true), dca('d', '00679B', 20261110, 110, 27.1, 1, false, 'p2'), buy('m', '00878', 20261105, 100, 33)];
  const none = [{ c: '00662', s: 20261112, d: 20261112, why: 'halt', plan: 'p3' }, { c: '00662', s: 20261012, why: 'halt' }];
  const M = C.dcaMonth(lots, 202611, none, ['00919|20261103', '0050|20261006']);
  assert.deepEqual(M.items.map((x) => x.c), ['0050', '00679B']);
  near(M.total, 30 * 99.7 + 1 + 110 * 27.1 + 1, 0.01);
  assert.equal(M.est, 1);
  assert.deepEqual(M.missed.map((x) => `${x.c}|${x.s}|${x.why}`), ['00919|20261103|skip', '00662|20261112|halt']);
  assert.equal(C.dcaMonth(lots, 202612).items.length, 0);
});

// ------------------------------------------------------------------ 和國泰總成本對帳
t('和國泰對帳：差不多就說對得上；冷眼多、剛好是最近一期就提醒可能還在交割；冷眼少就是有東西沒記', () => {
  const ok = C.costGap(188950, 188924, { feeGap: 30 });
  assert.equal(ok.kind, 'ok');
  const more = C.costGap(206900, 188924, { feeGap: 0, recent: [{ d: 20261112, amt: 9000 }, { d: 20261113, amt: 8976 }] });
  assert.equal(more.kind, 'more'); near(more.diff, 17976, 0.01);
  assert.equal(more.near && more.near.all, true);   // 剛好是最近兩期加起來
  const one = C.costGap(197924, 188924, { recent: [{ d: 20261112, amt: 3000 }, { d: 20261113, amt: 9000 }] });
  assert.equal(one.near && one.near.d, 20261113);
  const less = C.costGap(170000, 188924, {});
  assert.equal(less.kind, 'less'); assert.equal(less.near, null);
  assert.equal(C.costGap(1, 0), null);
});

// ------------------------------------------------------------------ 畫面
Core.S.summary = { asof: 20261113, generated: 'x', etfs: [...rows.values()].map((r) => ({ ...r, d: 20261113, p: qs[r.c].px, pc: qs[r.c].pc, ch: qs[r.c].ch })) };
Core.S.rows = new Map(Core.S.summary.etfs.map((r) => [r.c, r]));
Core.S.live = null;
Core.book.lots = lotsA;
Core.settings.fee = fee;
Core.S.P = PA;
t('畫面：投入總覽不出現 undefined／NaN，有對照國泰的說明與對帳框', () => {
  Core.settings.privacy = false;
  const h = IV.investHTML(PA);
  assert.ok(h.includes('投入總覽') && h.includes('你投入了') && h.includes('全部賣掉實拿') && h.includes('iv-cathay') && !bad(h), h.slice(0, 400));
  assert.ok(h.includes('>1</b> 期是冷眼用收盤價'), '還有預估要提醒核對');
  assert.equal(IV.investHTML(null), '');
});
t('畫面：隱藏金額時，投入總覽和定期定額卡都沒有金額', () => {
  Core.settings.plans = [
    { id: 'p1', c: '0050', days: [6], amt: 3000, fee: 1, start: 20260901, end: null, stop: null, v: 3 },
    { id: 'p2', c: '00679B', days: [16], amt: 3000, fee: 1, start: 20261001, end: null, stop: null, v: 3 },
  ];
  Core.settings.privacy = false;
  const s0 = D.dcaStripHTML();
  assert.ok(s0.includes('pl-v') && s0.includes('賣掉實拿') && s0.includes('月扣款') && !bad(s0), s0.slice(0, 600));
  assert.ok(/>\+?[\d,]{3,}</.test(s0), '看得到金額（下面的檢查才有意義）');
  Core.settings.privacy = true;
  const h = IV.investHTML(PA);
  const s1 = D.dcaStripHTML();
  for (const x of [h, s1]) {
    assert.ok(!/>[+−-]?\d{1,3}(,\d{3})+</.test(x), `隱藏金額時不能有金額：${(x.match(/>[+−-]?\d{1,3}(,\d{3})+</) || [])[0]}`);
    assert.ok(!bad(x));
  }
  Core.settings.privacy = false;
});
t('名詞：投入、賣掉實拿都在小辭典', () => {
  for (const k of ['invest', 'netsell', 'dca']) assert.ok(TERMS[k], k);
  assert.ok(!bad(TERMS.invest.ex()));
});
console.log(`\n${n} 個測試通過`);
