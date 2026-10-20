// 冷眼純計算的單元測試：node tests/calc_test.mjs [hist/0050.json]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as C from '../site/calc.js';
import * as pf from '../site/pf.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);

t('大盤之瞳：不算反向型與沒有觀點的', () => {
  const b = C.breadth([{ st: 1, k: 'broad' }, { st: -1, k: 'div', blw: true }, { st: 0, k: 'bond' }, { st: 1, k: 'inv' }, { st: null, k: 'broad' }]);
  assert.equal(b.n, 3); assert.equal(b.bull, 1); assert.equal(b.bear, 1); assert.equal(b.neu, 1); assert.equal(b.below, 1);
});

t('扣款日：遇休市順延、還沒到的月份不算、不重複', () => {
  const dates = [20240102, 20240103, 20240206, 20240207, 20240305, 20240306];
  assert.deepEqual(C.deductionDays(dates, 202401, 3), [20240103, 20240206, 20240305]);
  assert.deepEqual(C.deductionDays(dates, 202401, 28), [20240206, 20240305]);
  assert.deepEqual(C.deductionDays(dates, 202403, 10), []);
});

t('固定金額能買的股數：含手續費不超過預算', () => {
  const fee = { disc: 1, min: 20, minOdd: 1 };
  const n = C.sharesFor(10000, 108.15, 'broad', 20261020, fee);
  assert.ok(pf.tradeCost('buy', n, 108.15, 'broad', 20261020, fee).net <= 10000);
  assert.ok(pf.tradeCost('buy', n + 1, 108.15, 'broad', 20261020, fee).net > 10000);
});

t('XIRR：投入 100、一年後拿回 110 → 年化 10%', () => {
  near(C.xirr([[20210101, -100], [20220101, 110]]), 0.1, 1e-4);
  near(C.xirr([[20210101, -100], [20210701, -100], [20220101, 210]]), C.xirr([[20210101, -100], [20210701, -100], [20220101, 210]]));
  assert.equal(C.xirr([[20210101, -100]]), null);
});

t('時光機：沒有配息、沒有分割、價格不變 → 總投入等於現值（扣掉手續費）', () => {
  const d = [], p = [];
  for (let m = 1; m <= 12; m++) for (const day of [5, 6, 20]) { d.push(2024 * 10000 + m * 100 + day); p.push(50); }
  const h = { d, p, sig: [[20231201, 'add']], splits: [], divs: [] };
  const r = C.timeMachine(h, { start: 202401, amount: 10000, day: 6, reinvest: true, fee: { disc: 1, min: 20, minOdd: 1 }, cat: 'broad' });
  assert.equal(r.months, 12);
  const s = r.strats.dca;
  assert.equal(s.invested, 120000);
  assert.ok(s.value <= 120000 && s.value > 119800);
  assert.equal(s.buys, 12);
  // 全部訊號都是可加碼 → 三種買法結果一樣
  assert.equal(r.strats.add.value, s.value);
  assert.equal(r.strats.pause.value, s.value);
});

t('時光機：分割後股數乘上倍數、配息照除息當時的股數', () => {
  const h = { d: [20240105, 20240205, 20240206, 20240305], p: [100, 100, 25, 25], sig: [[20240101, 'add']], splits: [[20240206, 4]], divs: [[20240305, 1]] };
  const r = C.timeMachine(h, { start: 202401, amount: 10000, day: 5, reinvest: false, fee: { disc: 0, min: 0, minOdd: 0 }, cat: 'broad' });
  // 1 月買 100 股、2 月買 100 股 → 分割後 800 股；3 月 5 日先除息（800 × 1 元）再買 400 股
  assert.equal(r.strats.dca.sh, 1200);
  assert.equal(r.strats.dca.div, 800);
});

t('時光機：只在可加碼時買，沒買的錢留到下次', () => {
  const h = { d: [20240105, 20240205, 20240305], p: [10, 10, 10], sig: [[20240101, 'hold'], [20240301, 'add']], splits: [], divs: [] };
  const r = C.timeMachine(h, { start: 202401, amount: 1000, day: 5, reinvest: true, fee: { disc: 0, min: 0, minOdd: 0 }, cat: 'broad' });
  assert.equal(r.strats.add.waits, 2);
  assert.equal(r.strats.add.buys, 1);
  assert.equal(r.strats.add.sh, 300);
  assert.equal(r.strats.pause.buys, 3);
});

t('模擬倉基準：分割與配息都算進去', () => {
  const v = C.benchValue({ d: 20250101, cash0: 100000, px0: 200 }, [[20250201, 2], [20250801, 1]], [[20250618, 4]], 50, 20251001);
  // 500 單位 → 2/1 領 1000；6/18 變 2000 單位 → 8/1 領 2000；現值 2000 × 50 + 3000
  near(v.value, 103000);
});

t('百分位：越大越好與越小越好', () => {
  assert.equal(C.percentile([1, 2, 3, 4, 5], 5), 1);
  assert.equal(C.percentile([1, 2, 3, 4, 5], 1), 0);
  assert.equal(C.percentile([1, 2, 3, 4, 5], 1, false), 1);
});

t('熱力圖：面積和數值成正比、不超出範圍', () => {
  const items = [6, 6, 4, 3, 2, 2, 1].map((v, i) => ({ v, id: i }));
  const out = C.squarify(items, 0, 0, 600, 400);
  assert.equal(out.length, 7);
  const tot = 24;
  for (const r of out) {
    near(r.w * r.h, (r.v / tot) * 600 * 400, 1e-6);
    assert.ok(r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= 600 + 1e-6 && r.y + r.h <= 400 + 1e-6);
  }
});

const file = process.argv[2];
if (file && fs.existsSync(file)) {
  const h = JSON.parse(fs.readFileSync(file, 'utf8'));
  const start = C.firstMonth(h);
  const r = C.timeMachine(h, { start, amount: 10000, day: 6, reinvest: true, fee: { disc: 1, min: 20, minOdd: 1 }, cat: 'broad' });
  console.log('實際資料', h.c, '從', start, '共', r.months, '個月');
  for (const [k, s] of Object.entries(r.strats)) console.log(' ', s.name.padEnd(8, '　'), '投入', s.invested, '現值', s.value, '報酬', (s.ret * 100).toFixed(1) + '%', '年化', s.irr == null ? '—' : (s.irr * 100).toFixed(1) + '%', '買', s.buys, '等', s.waits, '股息', s.div, '最差', (s.worst * 100).toFixed(1) + '%');
}
console.log(`\n${n} 組測試通過`);
