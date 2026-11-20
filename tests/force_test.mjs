// 冷眼「兵力」的單元測試：node tests/force_test.mjs [hist 資料夾]
// 給 hist 資料夾（data/hist）時，另外用真實的 0050、00878 檢查回測和存股時光機的「每月定期定額」一模一樣。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as PF from '../site/pf.js';
import { freeCash, trimFrom, forceOrders, coreFollowSim, dcaMonthly } from '../site/force.js';
import { timeMachine, firstMonth } from '../site/calc.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const TODAY = 20261120;
const cfg = PF.DEFAULT_FEE;

// ---- 小工具：一檔一列 summary、定期定額的一期、自己買的一筆
const rowOf = (c, k, o = {}) => ({ c, n: `測試${c}`, k, d: TODAY, p: 100, ch: -1, pc: -1, st: -1, ps: 'trim', sc: -1.2, cf: 70, dl: 110, iv: 108, r1: 112, s1: 95, fl: [], ...o });
let seq = 0;
const dcaLot = (c, d, sh, px = 100) => ({ id: `d${++seq}`, c, side: 'buy', d, sh, px, fee: 1, at: `${String(d).slice(0, 4)}-${String(d).slice(4, 6)}-${String(d).slice(6)}T07:00:00.000Z`, dca: { plan: `p${c}`, s: d, est: false } });
const myLot = (c, d, sh, px = 100, side = 'buy', o = {}) => ({ id: `m${++seq}`, c, side, d, sh, px, fee: 20, tax: side === 'sell' ? Math.floor(sh * px * 0.001) : 0, at: `${String(d).slice(0, 4)}-${String(d).slice(4, 6)}-${String(d).slice(6)}T08:00:00.000Z`, ...o });
/** 照 App 的順序算：自由資金 → 部位 → 兵力（加碼計畫的建議用 adv 直接給） */
function run({ rows, lots, cash = 0, adv = {}, order = null, coreFollow = false, since = {}, profile = 'mid' }) {
  const R = new Map(rows.map((r) => [r.c, r]));
  const book = { cash, cashD: 20261001, cashAt: '2026-10-01T00:00:00.000Z', lots };
  const fc = freeCash(book, { today: TODAY });
  const P = PF.buildPortfolio({ ...book, cash: Math.max(0, fc.now) }, R, (r) => ({ px: r.p, ch: r.ch, pc: r.pc, date: r.d }), {}, cfg, TODAY);
  return forceOrders({
    holdings: P.holdings, lots, splitsOf: () => [], adv: (c) => adv[c] || null, order: order || rows.map((r) => r.c), rowOf: (c) => R.get(c),
    T: P.totals.T, profile, fee: cfg, today: TODAY, coreFollow, free: { now: fc.now, reserve: 0, usable: Math.max(0, fc.now) },
    since: (c) => since[c] ?? null,
  });
}
const item = (F, c) => F.items.find((i) => i.code === c);

// ================================================================== 自由資金
t('自由資金：設定的金額＋之後記的單筆買賣；定期定額預設另外扣、不算', () => {
  const lots = [
    myLot('A', 20260930, 100),                       // 設定那天以前：已經算在設定的金額裡
    myLot('A', 20261005, 100, 50),                   // 之後的買進：扣 5,000＋20
    myLot('A', 20261010, 50, 60, 'sell'),            // 之後的賣出：加回 3,000－20－3
    dcaLot('A', 20261013, 30),                       // 定期定額：另外扣
    myLot('A', 20261015, 10, 70, 'buy', { free: false }),   // 你勾掉「用自由資金」
    { ...myLot('A', 20261016, 10), d: null },        // 沒填日期
  ];
  const f = freeCash({ cash: 100000, cashD: 20261001, cashAt: '2026-10-01T03:00:00.000Z', lots }, { today: TODAY });
  assert.equal(f.items.length, 2);
  assert.equal(f.flow, -5020 + (3000 - 20 - 3));
  assert.equal(f.now, 100000 + f.flow);
  const g = freeCash({ cash: 100000, cashD: 20261001, cashAt: '2026-10-01T03:00:00.000Z', lots }, { today: TODAY, dcaFree: true });
  assert.equal(g.items.length, 3, '選「從自由資金扣」時，定期定額那一期也扣');
  assert.equal(g.now, f.now - (30 * 100 + 1));
});

t('自由資金：設定那一天的交易，看記下的時間有沒有比設定的那一刻晚', () => {
  const early = { ...myLot('A', 20261001, 10), at: '2026-10-01T02:00:00.000Z' };
  const late = { ...myLot('A', 20261001, 20), at: '2026-10-01T05:00:00.000Z' };
  const f = freeCash({ cash: 50000, cashD: 20261001, cashAt: '2026-10-01T03:00:00.000Z', lots: [early, late] }, { today: TODAY });
  assert.deepEqual(f.items.map((x) => x.id), [late.id]);
  // 舊資料沒有設定的時間：同一天的一律當作已經算在金額裡
  const g = freeCash({ cash: 50000, cashD: 20261001, lots: [early, late] }, { today: TODAY });
  assert.equal(g.items.length, 0);
  // 從來沒設定過：沒有「之後」，就是設定的金額
  assert.equal(freeCash({ cash: 0, lots: [late] }).now, 0);
});

t('自由資金：買超過了是負的（畫面要照實說，總資產用 0 算）', () => {
  const f = freeCash({ cash: 1000, cashD: 20261001, cashAt: '2026-10-01T00:00:00.000Z', lots: [myLot('A', 20261005, 100)] }, { today: TODAY });
  assert.ok(f.now < 0);
});

t('定期定額每月扣多少：還在扣的計畫 × 每月幾個扣款日；停扣的不算', () => {
  const plans = [{ c: '0050', amt: 15000, days: [13] }, { c: '00878', amt: 2500, days: [6, 16] }, { c: '0056', amt: 3000, days: [6], end: 20260101 }];
  assert.equal(dcaMonthly(plans, TODAY), 20000);
  assert.equal(dcaMonthly(plans, TODAY, '00878'), 5000);
});

// ================================================================== 這一輪減碼從哪天開始
t('這一輪減碼：往回找連續的減碼，從前一次取樣的隔天算起', () => {
  assert.equal(trimFrom([[20261015, 'add'], [20261022, 'caution'], [20261029, 'trim'], [20261105, 'trim']]), 20261023);
  assert.equal(trimFrom([[20261015, 'add'], [20261022, 'caution']]), 20261023, '剛轉減碼、還沒取樣到：最後一次取樣的隔天');
  assert.equal(trimFrom([[20261029, 'trim'], [20261105, 'trim']]), 20261029, '從有資料開始就是減碼');
  assert.equal(trimFrom([]), null);
  assert.equal(trimFrom(null), null);
});

// ================================================================== 每一檔
t('全部是定期定額買的：減碼訊號也照扣、不賣（核心照扣）', () => {
  const F = run({ rows: [rowOf('A', 'broad')], lots: [dcaLot('A', 20260113, 600), dcaLot('A', 20260213, 600)], cash: 500000 });
  const a = item(F, 'A');
  assert.equal(a.act, 'keep');
  assert.equal(a.sell, null);
  assert.deepEqual(a.chip, ['核心照扣', 'core']);
  assert.equal(a.core, 1200);
  assert.equal(a.mob, 0);
  assert.equal(a.hold.after, 1200);
  assert.ok(a.wait.includes('108.00'), '等什麼：轉多線');
  assert.ok(F.head.startsWith('今天不用動'), F.head);
  assert.ok(F.head.includes('照扣、不賣'), F.head);
  assert.ok(F.orders.some((o) => o.k === 'core' && o.items[0].n === 1200));
});

t('核心＋機動：減碼只減機動的三分之一（無條件進位），核心不動', () => {
  const F = run({ rows: [rowOf('A', 'broad')], lots: [dcaLot('A', 20260113, 1000), myLot('A', 20260301, 600)], cash: 200000, since: { A: 20261101 } });
  const a = item(F, 'A');
  assert.equal(a.act, 'sell');
  assert.equal(a.sell.n, 200);
  assert.equal(a.sell.mob, 200);
  assert.equal(a.sell.core, 0);
  assert.equal(a.hold.after, 1400);
  assert.deepEqual(a.chip, ['賣 200 股', 'warn2']);
  assert.ok(a.why.some((w) => w.includes('核心：照扣、不賣')));
  assert.ok(F.head.includes('賣 測試A 200 股'), F.head);
  const c = PF.sellValue(200, 100, 'broad', TODAY, cfg);
  assert.equal(a.sell.net, c.net);
  assert.equal(F.free.back, c.net);
});

t('這一輪已經賣過：不再叫你賣；只賣了一部分：補到三分之一', () => {
  const lots = [dcaLot('A', 20260113, 1000), myLot('A', 20260301, 600)];
  const done = run({ rows: [rowOf('A', 'broad')], lots: [...lots, myLot('A', 20261105, 200, 100, 'sell')], cash: 200000, since: { A: 20261101 } });
  const a = item(done, 'A');
  assert.equal(a.act, 'keep');
  assert.deepEqual(a.chip, ['已減碼', 'mute']);
  assert.equal(a.trim.sold, 200);
  assert.ok(done.head.startsWith('今天不用動'), done.head);
  const half = run({ rows: [rowOf('A', 'broad')], lots: [...lots, myLot('A', 20261105, 120, 100, 'sell')], cash: 200000, since: { A: 20261101 } });
  assert.equal(item(half, 'A').sell.n, 80);
  // 歷史檔還沒載入（since 不知道）：當作今天才開始，前幾天賣的不算
  const unknown = run({ rows: [rowOf('A', 'broad')], lots: [...lots, myLot('A', 20261105, 200, 100, 'sell')], cash: 200000 });
  assert.equal(item(unknown, 'A').act, 'sell');
});

t('打開「核心也跟減碼訊號」：核心＋機動一起減三分之一，先賣機動', () => {
  const F = run({ rows: [rowOf('A', 'broad')], lots: [dcaLot('A', 20260113, 1000), myLot('A', 20260301, 600)], cash: 200000, coreFollow: true, since: { A: 20261101 } });
  const a = item(F, 'A');
  assert.equal(a.sell.n, 534);
  assert.equal(a.sell.mob, 534);
  assert.equal(a.sell.core, 0);
  const G = run({ rows: [rowOf('B', 'div')], lots: [dcaLot('B', 20260113, 900)], cash: 200000, coreFollow: true, since: { B: 20261101 } });
  const b = item(G, 'B');
  assert.equal(b.sell.n, 300);
  assert.equal(b.sell.core, 300);
  assert.ok(b.say.includes('核心'));
});

t('減碼幅度照類別：主題一半、槓桿全部', () => {
  const th = run({ rows: [rowOf('T', 'theme')], lots: [myLot('T', 20260301, 601)], cash: 500000, since: { T: 20261101 } });
  assert.equal(item(th, 'T').sell.n, 301);
  const lv = run({ rows: [rowOf('L', 'lev')], lots: [myLot('L', 20260301, 600)], cash: 500000, since: { L: 20261101 } });
  assert.equal(item(lv, 'L').sell.n, 600);
});

t('比重超過上限：賣回上限以內，機動不夠就動到核心', () => {
  // 穩健型市值型上限 60%：持股 7,000 股 × 100 元＝70 萬、自由資金 30 萬 → 70%，要賣 1,000 股
  const hold = rowOf('A', 'broad', { st: 0, ps: 'hold' });
  const F = run({ rows: [hold], lots: [dcaLot('A', 20260113, 6500), myLot('A', 20260301, 500)], cash: 300000 });
  const a = item(F, 'A');
  assert.equal(a.act, 'sell');
  assert.equal(a.sell.n, 1000);
  assert.equal(a.sell.mob, 500);
  assert.equal(a.sell.core, 500);
  assert.equal(a.sell.by, 'over');
  assert.ok(a.why.some((w) => w.includes('超過你的上限 60%')));
  assert.ok(a.why.some((w) => w.includes('動到定期定額買的核心')));
  // 剛好在容許範圍內（多 2 個百分點以內）：不動
  const G = run({ rows: [hold], lots: [dcaLot('A', 20260113, 6150)], cash: 385000 });
  assert.equal(item(G, 'A').act, 'keep');
});

t('可加碼：照加碼計畫用自由資金買；續抱裡想加碼的只寫小額、不列成指令', () => {
  const add = rowOf('A', 'broad', { st: 1, ps: 'add', cf: 80 });
  const plan = { n: 300, spend: 30060, parts: [{}, {}, {}], stop: 95, stopName: '作廢線', limit: 'cash', cuts: [], slice: 100000, cashShare: 100000, newW: 0.2 };
  const F = run({ rows: [add], lots: [dcaLot('A', 20260113, 1000)], cash: 300000, adv: { A: { key: 'add', plan } } });
  const a = item(F, 'A');
  assert.equal(a.act, 'buy');
  assert.equal(a.buy.n, 300);
  assert.deepEqual(a.chip, ['買 300 股', 'go']);
  assert.equal(a.hold.after, 1300);
  assert.equal(F.free.use, 30060);
  assert.equal(F.free.left, 300000 - 30060);
  assert.ok(F.head.includes('用自由資金買 測試A 300 股'), F.head);
  const hold = rowOf('A', 'broad', { st: 0, ps: 'hold' });
  const G = run({ rows: [hold], lots: [dcaLot('A', 20260113, 1000)], cash: 300000, adv: { A: { key: 'hold', plan: { ...plan, n: 100 } } } });
  const b = item(G, 'A');
  assert.equal(b.act, 'keep');
  assert.equal(b.small.n, 100);
  assert.equal(G.orders.filter((o) => o.k === 'buy').length, 0);
});

t('關注清單（還沒持有）可加碼的：也列進今天要買的', () => {
  const plan = { n: 2000, spend: 52000, parts: [{}, {}, {}], stop: 25, stopName: '作廢線', limit: 'cash', cuts: ['conf'], slice: 100000, cashShare: 100000 };
  const F = run({ rows: [rowOf('A', 'broad'), rowOf('B', 'bond', { st: 1, ps: 'add', cf: 54 })], lots: [dcaLot('A', 20260113, 1000)], cash: 300000, adv: { B: { key: 'add', plan } }, order: ['B', 'A'] });
  assert.equal(F.buys.length, 1);
  assert.equal(F.buys[0].code, 'B');
  const o = F.orders.find((x) => x.k === 'buy');
  assert.equal(o.held, false);
  assert.equal(o.n, 2000);
  assert.ok(F.head.includes('用自由資金買 測試B 2,000 股') || F.head.includes('用自由資金買 測試B 2 張'), F.head);
  assert.ok(F.head.includes('定期定額照扣'), F.head);
});

t('注意／處置、資料不足：不加也不減', () => {
  const F = run({ rows: [rowOf('A', 'broad', { fl: ['disposal'] })], lots: [myLot('A', 20260301, 600)], cash: 100000, since: { A: 20261101 } });
  assert.equal(item(F, 'A').act, 'pause');
  const G = run({ rows: [rowOf('A', 'broad', { st: null, ps: null })], lots: [myLot('A', 20260301, 600)], cash: 100000 });
  assert.equal(item(G, 'A').act, 'none');
});

t('自由資金的摘要：可動用、今天用掉、留下；賣出約拿回', () => {
  const F = run({ rows: [rowOf('A', 'broad')], lots: [dcaLot('A', 20260113, 1000)], cash: 400000 });
  assert.equal(F.free.usable, 400000);
  assert.equal(F.free.use, 0);
  assert.equal(F.free.keep, 400000);
  assert.ok(F.orders.some((o) => o.k === 'free' && o.left === 400000));
  assert.ok(F.head.includes('自由資金沒有可加碼的，先留著'), F.head);
});

// ================================================================== 回測：核心要不要跟減碼訊號
function synthHist() {
  // 260 個交易日：先漲、中間跌三成、再漲回來；中間那段訊號是減碼，之後轉可加碼
  const d = [], p = [], sig = [];
  let day = 20240102;
  const next = (x) => { let y = PF.addDays(x, 1); for (;;) { const w = new Date(Date.UTC(Math.floor(y / 10000), Math.floor(y / 100) % 100 - 1, y % 100)).getUTCDay(); if (w !== 0 && w !== 6) return y; y = PF.addDays(y, 1); } };
  for (let i = 0; i < 260; i++) {
    d.push(day);
    const px = i < 100 ? 100 + i * 0.2 : i < 140 ? 120 - (i - 100) * 0.9 : 84 + (i - 140) * 0.35;
    p.push(Math.round(px * 100) / 100);
    if (i % 5 === 0) sig.push([day, i < 105 ? 'add' : i < 150 ? 'trim' : 'add']);
    day = next(day);
  }
  return { c: 'X', d, p, sig, splits: [], divs: [] };
}
t('回測：照扣不動和存股時光機的「每月定期定額」一模一樣；跟訊號會賣一次、買回一次，跌幅比較小', () => {
  const h = synthHist();
  const r = coreFollowSim(h, { amount: 10000, day: 5, cat: 'broad', fee: cfg });
  const tm = timeMachine(h, { start: firstMonth(h), amount: 10000, day: 5, reinvest: true, fee: cfg, cat: 'broad' });
  assert.equal(r.keep.value, tm.strats.dca.value);
  assert.equal(r.invested, tm.strats.dca.invested);
  assert.equal(r.follow.sells, 1);
  assert.equal(r.follow.backs, 1);
  assert.ok(r.follow.mdd > r.keep.mdd, `${r.follow.mdd} > ${r.keep.mdd}`);
  assert.equal(r.follow.side, 0);
  assert.equal(coreFollowSim({ d: [], p: [] }, {}), null);
});

const histDir = process.argv[2];
if (histDir && fs.existsSync(path.join(histDir, '0050.json'))) {
  t('真實資料：0050、00878 的「照扣不動」和存股時光機一樣；減碼與買回的次數合理', () => {
    for (const [c, k] of [['0050', 'broad'], ['00878', 'div']]) {
      const h = JSON.parse(fs.readFileSync(path.join(histDir, `${c}.json`), 'utf8'));
      const r = coreFollowSim(h, { amount: 5000, day: 13, cat: k, fee: cfg });
      const tm = timeMachine(h, { start: firstMonth(h), amount: 5000, day: 13, reinvest: true, fee: cfg, cat: k });
      assert.equal(r.keep.value, tm.strats.dca.value, c);
      assert.ok(r.follow.sells >= r.follow.backs && r.follow.backs >= 1, `${c} ${r.follow.sells} ${r.follow.backs}`);
      assert.ok(r.follow.dear <= r.follow.backs);
      assert.ok(r.keep.mdd < -0.1 && r.follow.mdd < 0);
      assert.ok(trimFrom(h.sig) == null || trimFrom(h.sig) > 20200101);
    }
  });
}

console.log(`\n${n} 個測試通過`);
