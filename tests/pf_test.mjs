// 冷眼「我的部位」計算核心的單元測試：node tests/pf_test.mjs [summary.json] [divs.json] [track.json]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as pf from '../site/pf.js';

const cfg = { disc: 1, min: 20, minOdd: 1 };
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('手續費：整股、折扣、最低收費', () => {
  assert.equal(pf.feeOf(108150, false, cfg), 154);
  assert.equal(pf.feeOf(108150, false, { ...cfg, disc: 0.6 }), 92);
  assert.equal(pf.feeOf(5000, false, cfg), 20);
  assert.equal(pf.feeOf(5000, true, cfg), 7);
  assert.equal(pf.feeOf(300, true, cfg), 1);
  assert.equal(pf.feeOf(0, true, cfg), 0);
});

t('賣出：整股與零股分開計算手續費與證交稅', () => {
  const c = pf.tradeCost('sell', 1500, 32.45, 'div', 20261020, cfg);
  assert.equal(c.amount, 48675);
  assert.equal(c.fee, 46 + 23);
  assert.equal(c.tax, 32 + 16);
  assert.equal(c.net, 48675 - 69 - 48);
  const b = pf.tradeCost('buy', 1500, 32.45, 'div', 20261020, cfg);
  assert.equal(b.tax, 0);
  assert.equal(b.net, 48675 + 69);
});

t('債券 ETF 停徵證交稅到 2026/12/31', () => {
  assert.equal(pf.tradeCost('sell', 1000, 30, 'bond', 20261231, cfg).tax, 0);
  assert.equal(pf.tradeCost('sell', 1000, 30, 'bond', 20270104, cfg).tax, 30);
  assert.equal(pf.tradeCost('sell', 1000, 30, 'broad', 20261020, cfg).tax, 30);
});

t('移動平均成本與已實現損益', () => {
  const lots = [
    { c: 'X', side: 'buy', d: 20250101, sh: 1000, px: 30, fee: 42 },
    { c: 'X', side: 'buy', d: 20250601, sh: 500, px: 32, fee: 22 },
    { c: 'X', side: 'sell', d: 20250901, sh: 600, px: 33, fee: 28, tax: 19 },
  ];
  const h = pf.holdingFromLots(lots, []);
  assert.equal(h.sh, 900);
  const avg = 46064 / 1500;
  assert.ok(Math.abs(h.avg - avg) < 1e-9);
  assert.ok(Math.abs(h.realized - (19800 - 47 - avg * 600)) < 1e-6);
  assert.ok(Math.abs(h.cost - (46064 - avg * 600)) < 1e-6);
});

t('今日損益：某一檔在最新交易日沒有新價格（沒成交），那天的漲跌算 0，不把前一天的漲跌算進今天', () => {
  const rows = new Map([['A', { c: 'A', k: 'broad', n: 'A' }], ['B', { c: 'B', k: 'div', n: 'B' }]]);
  const lots = [
    { c: 'A', side: 'buy', d: 20260101, sh: 1000, px: 10, fee: 20 },
    { c: 'B', side: 'buy', d: 20260101, sh: 1000, px: 20, fee: 20 },
    { c: 'B', side: 'buy', d: 20261027, sh: 100, px: 19.5, fee: 20 },   // 今天買的那一筆：用買進價和現價的差
  ];
  const qs = { A: { px: 11, ch: 0.5, date: 20261027 }, B: { px: 19, ch: -1, date: 20261026 } };   // B 今天還沒成交
  const P = pf.buildPortfolio({ cash: 0, lots }, rows, (r) => qs[r.c], {}, pf.DEFAULT_FEE, 20261027);
  const A = P.holdings.find((x) => x.code === 'A'), B = P.holdings.find((x) => x.code === 'B');
  assert.ok(Math.abs(A.day - 500) < 1e-9, A.day);
  assert.ok(Math.abs(B.day - (19 - 19.5) * 100) < 1e-9, B.day);       // 不是 1000 × (−1)
  assert.ok(Math.abs(P.totals.day - (500 - 50)) < 1e-9, P.totals.day);
  // 全部都是同一天的報價（例如開盤前）：照常是那一天的漲跌
  const P2 = pf.buildPortfolio({ cash: 0, lots: lots.slice(0, 2) }, rows, (r) => ({ ...qs[r.c], date: 20261026 }), {}, pf.DEFAULT_FEE, 20261027);
  assert.ok(Math.abs(P2.totals.day - (500 - 1000)) < 1e-9, P2.totals.day);
});

t('賣超過持股會被擋下並提醒', () => {
  const h = pf.holdingFromLots([
    { c: 'X', side: 'buy', d: 20250101, sh: 100, px: 10, fee: 1 },
    { c: 'X', side: 'sell', d: 20250102, sh: 300, px: 11, fee: 1, tax: 1 },
  ], []);
  assert.equal(h.sh, 0);
  assert.equal(h.warnings.length, 1);
});

t('分割：分割前買的股數 ×4、價格 ÷4；配息用當時股數', () => {
  const splits = [[20250618, 4]];
  const lots = [{ c: '0050', side: 'buy', d: 20250101, sh: 100, px: 180, fee: 25 }];
  const h = pf.holdingFromLots(lots, splits);
  assert.equal(h.sh, 400);
  assert.ok(Math.abs(h.avg - (18025 / 400)) < 1e-9);
  const divs = [[20250117, 2.7], [20250721, 0.36], [20260122, 1.0]];
  const rec = pf.dividendsReceived(lots, divs, splits, 20260201);
  assert.deepEqual(rec.items.map((x) => x.amt), [270, 144, 400]);
  assert.equal(rec.total, 814);
});

t('配息資格：除息日當天買進領不到、當天賣出領得到', () => {
  const divs = [[20260226, 0.5]];
  const a = pf.dividendsReceived([{ c: 'X', side: 'buy', d: 20260226, sh: 1000, px: 20 }], divs, [], 20260301);
  assert.equal(a.total, 0);
  const b = pf.dividendsReceived([
    { c: 'X', side: 'buy', d: 20260225, sh: 1000, px: 20 },
    { c: 'X', side: 'sell', d: 20260226, sh: 1000, px: 20 },
  ], divs, [], 20260301);
  assert.equal(b.total, 500);
  const c = pf.dividendsReceived([{ c: 'X', side: 'buy', sh: 1000, px: 20 }], divs, [], 20260301);
  assert.equal(c.total, 0);
  assert.equal(c.undated, 1);
  // 「不記得日期」的舊股先賣掉、之後再買 2 張：新買的 2 張照樣領得到（賣出不能讓有日期的股數變成負的）
  const d = pf.dividendsReceived([
    { c: 'X', side: 'buy', sh: 3000, px: 18 },
    { c: 'X', side: 'sell', d: 20260105, sh: 3000, px: 19 },
    { c: 'X', side: 'buy', d: 20260210, sh: 2000, px: 20 },
  ], divs, [], 20260301);
  assert.equal(d.total, 1000);
});

t('近 12 個月配息與月份分布', () => {
  const divs = [[20251020, 9], [20251118, 0.4], [20260226, 0.42], [20260519, 0.66], [20260818, 1.01], [20261117, 0.5]];
  const r = pf.trailingDividends(divs, [], 20261020);
  assert.ok(Math.abs(r.ttm - 2.49) < 1e-9);
  assert.ok(Math.abs(r.months[10] - 0.4) < 1e-9);
  assert.ok(Math.abs(r.months[1] - 0.42) < 1e-9);
  assert.ok(Math.abs(r.months[7] - 1.01) < 1e-9);
});

t('損益兩平價', () => {
  assert.equal(pf.breakEven(1000, 30042, 'div', 20261020, cfg), 30.12);
  const p = pf.breakEven(3, 300, 'broad', 20261020, { disc: 1, min: 20, minOdd: 20 });
  assert.ok(pf.sellValue(3, p, 'broad', 20261020, { disc: 1, min: 20, minOdd: 20 }).net >= 300);
});

t('股數寫法', () => {
  assert.equal(pf.sharesText(3500), '3 張 500 股');
  assert.equal(pf.sharesText(2000), '2 張');
  assert.equal(pf.sharesText(37), '37 股');
});

t('顏色依加入順序固定，賣光後釋出', () => {
  let c = pf.assignColors({ colors: {} }, ['A', 'B', 'C']);
  assert.deepEqual(c, { A: 0, B: 1, C: 2 });
  c = pf.assignColors({ colors: c }, ['A', 'C', 'D']);
  assert.deepEqual(c, { A: 0, C: 2, D: 1 });
});

t('跳動單位', () => {
  assert.equal(pf.tickRound(49.996), 50);
  assert.equal(pf.tickDown(108.17), 108.15);
  assert.equal(pf.tickUp(108.11), 108.15);
  assert.equal(pf.tickDown(32.459), 32.45);
});

// ---------------------------------------------------------------- 用真實資料跑一遍
const [sumPath, divPath, trackPath] = process.argv.slice(2);
if (sumPath) {
  const S = JSON.parse(fs.readFileSync(sumPath, 'utf8'));
  const D = JSON.parse(fs.readFileSync(divPath, 'utf8'));
  const TR = JSON.parse(fs.readFileSync(trackPath, 'utf8'));
  const rows = new Map(S.etfs.map((r) => [r.c, r]));
  const quoteOf = (r) => ({ px: r.p, ch: r.ch, pc: r.pc, prem: r.pr, date: r.d });
  const today = 20261020;
  const book = {
    cash: 200000,
    lots: [
      { id: 1, c: '0050', side: 'buy', sh: 3000, px: 98.2, fee: 420 },
      { id: 2, c: '00919', side: 'buy', d: 20250310, sh: 5000, px: 30.12, fee: 214 },
      { id: 3, c: '00878', side: 'buy', d: 20250401, sh: 2000, px: 22, fee: 62 },
      { id: 4, c: '006208', side: 'buy', d: 20240105, sh: 400, px: 180, fee: 102 },
      { id: 5, c: '00679B', side: 'buy', d: 20250102, sh: 3000, px: 27.5, fee: 117 },
    ],
  };
  const P = pf.buildPortfolio(book, rows, quoteOf, D, cfg, today);
  console.log('\n總覽', JSON.stringify({ ...P.totals, months: P.totals.months.map((x) => Math.round(x)) }));
  for (const x of P.holdings) {
    const ctx = { T: P.totals.T, cash: P.totals.cash, profile: 'mid', fee: cfg, today, stats: TR.pos[x.cat] };
    const a = pf.advise({ row: x.row, sh: x.h.sh, avg: x.h.avg, cost: x.h.cost, px: x.px, prem: x.q.prem }, ctx);
    console.log(`\n${x.code} ${x.name} ${pf.sharesText(x.h.sh)} 均價 ${x.h.avg.toFixed(2)} 現價 ${x.px} 市值 ${Math.round(x.mv)} 損益 ${Math.round(x.pnl)} (${(x.pct * 100).toFixed(1)}%) 比重 ${(x.w * 100).toFixed(1)}% 今日 ${Math.round(x.day)} 已領息 ${x.divRecv} 年息 ${Math.round(x.annual)} 兩平 ${x.be}`);
    console.log(`  → [${a.key}] ${a.label}`);
    for (const l of a.lines) console.log(`    ${l.kind}: ${l.text}`);
    if (a.plan) console.log('    plan', JSON.stringify({ n: a.plan.n, ideal: a.plan.ideal, parts: a.plan.parts, stop: a.plan.stop, limit: a.plan.limit, loss: Math.round(a.plan.lossAtStop), newAvg: a.plan.newAvg && +a.plan.newAvg.toFixed(2), newW: a.plan.newW && +a.plan.newW.toFixed(3) }));
    if (a.sell) console.log('    sell', JSON.stringify(a.sell));
    assert.ok(a.label, 'label');
  }
  const stress = pf.stressToStops(P.holdings, { T: P.totals.T });
  console.log('\n風險地圖', Math.round(stress.loss), (stress.pct * 100).toFixed(2) + '%', stress.items.map((x) => `${x.code}:${Math.round(x.drop)}`).join(' '));
  const sim = pf.simulateAdd({ row: rows.get('00919'), sh: 5000, avg: 30.16, cost: 150814, px: 32.45, prem: -0.09 }, 1500, 32.45,
    { T: P.totals.T, cash: 200000, profile: 'mid', fee: cfg, today });
  console.log('\n加碼試算 00919 +1500', JSON.stringify(sim, null, 0));
  const notHeld = pf.advise({ row: rows.get('00662'), sh: 0, px: rows.get('00662').p, prem: rows.get('00662').pr },
    { T: P.totals.T, cash: 200000, profile: 'mid', fee: cfg, today, stats: TR.pos[rows.get('00662').k] });
  console.log('\n未持有 00662', notHeld.key, notHeld.label, notHeld.plan && notHeld.plan.n);
}
console.log(`\n${n} 組測試通過`);
