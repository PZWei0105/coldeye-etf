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

t('時光機：「漲多分批」也算可以買；訊號只用扣款日之前的（不用當天收盤才算得出來的）', () => {
  const h = { d: [20240105, 20240205, 20240305], p: [10, 10, 10], sig: [[20240101, 'wait'], [20240205, 'caution'], [20240305, 'caution']], splits: [], divs: [] };
  const r = C.timeMachine(h, { start: 202401, amount: 1000, day: 5, reinvest: true, fee: { disc: 0, min: 0, minOdd: 0 }, cat: 'broad' });
  // 1/5 用 1/1 的 wait → 買；2/5 用 1/1 的 wait（2/5 當天的 caution 還不能用）→ 買；3/5 用 2/5 的 caution → 等
  assert.equal(r.strats.add.buys, 2);
  assert.equal(r.strats.add.waits, 1);
  assert.equal(r.strats.pause.buys, 2);
});

t('時光機：除息日沒有成交時，股息在下一個交易日入帳', () => {
  const h = { d: [20240105, 20240205, 20240207], p: [10, 10, 10], sig: [[20240101, 'add']], splits: [], divs: [[20240206, 0.5]] };
  const r = C.timeMachine(h, { start: 202401, amount: 1000, day: 5, reinvest: false, fee: { disc: 0, min: 0, minOdd: 0 }, cat: 'broad' });
  // 1/5、2/5 各買 100 股，2/6 除息（那天沒成交）→ 2/7 入帳 200 × 0.5
  assert.equal(r.strats.dca.div, 100);
});

t('模擬倉基準：開倉用的是開盤前的昨收時，當天的除息也要算', () => {
  const v = C.benchValue({ d: 20250201, pxd: 20250131, cash0: 100000, px0: 200 }, [[20250201, 2]], [], 198, 20250201);
  near(v.value, 500 * 198 + 1000);
  const w = C.benchValue({ d: 20250201, pxd: 20250201, cash0: 100000, px0: 198 }, [[20250201, 2]], [], 198, 20250201);
  near(w.value, 100000);
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

t('定期定額扣款日：每個計畫每個月剛好提醒一次、都在星期一到五；2027/2/27（週六）順延到 3/1 也不會漏', () => {
  for (let day = 1; day <= 28; day++) {
    const perMonth = new Map();
    let d = 20261101;
    while (d <= 20281130) {
      if (C.dcaDueToday(day, d)) {
        const wd = new Date(Date.UTC(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100)).getUTCDay();
        assert.ok(wd >= 1 && wd <= 5, `${day}: ${d}`);
        // 算成「哪一期」：順延跨月的算上個月那一期
        const due = [0, 1, 2].map((k) => pf.addDays(d, -k)).find((x) => x % 100 === day);
        const key = Math.floor(due / 100);
        perMonth.set(key, (perMonth.get(key) || 0) + 1);
      }
      d = pf.addDays(d, 1);
    }
    assert.equal(perMonth.size, 25, `day ${day}: ${perMonth.size} 期`);
    for (const [k, v] of perMonth) assert.equal(v, 1, `day ${day} ${k}: ${v} 次`);
  }
  assert.equal(C.dcaDueToday(27, 20270301), true);     // 2027/2/27 週六 → 3/1 週一
  assert.equal(C.dcaDueToday(28, 20270301), true);     // 2027/2/28 週日 → 3/1 週一
  assert.equal(C.dcaDueToday(1, 20270301), true);
});

t('部位走勢：市值、淨投入、除息前一天買才領得到、分割後股數變多', () => {
  const h = { d: [20260105, 20260106, 20260107, 20260108, 20260109], p: [100, 102, 100, 25.5, 26], splits: [[20260108, 4]], divs: [[20260107, 2]] };
  const lots = [
    { c: 'A', side: 'buy', d: 20260105, sh: 1000, px: 100, fee: 142 },
    { c: 'A', side: 'buy', d: 20260107, sh: 100, px: 100, fee: 14 },      // 除息當天買：領不到這次配息
  ];
  const r = C.equityCurve(lots, { A: h });
  assert.deepEqual(r.d, h.d);
  assert.deepEqual(r.mv, [100000, 102000, 110000, 112200, 114400]);
  assert.deepEqual(r.inv, [100142, 100142, 110156, 110156, 110156]);
  assert.deepEqual(r.div, [0, 0, 2000, 2000, 2000]);
});

t('部位走勢：賣出拿回的錢、超賣不算、冷門 ETF 沒成交用前一次收盤、沒有歷史資料的列出來', () => {
  const hA = { d: [20260105, 20260106, 20260107], p: [50, 51, 52], splits: [], divs: [] };
  const hB = { d: [20260105, 20260107], p: [10, 11], splits: [], divs: [] };
  const lots = [
    { c: 'A', side: 'buy', d: 20260105, sh: 1000, px: 50, fee: 0 },
    { c: 'B', side: 'buy', d: 20260105, sh: 1000, px: 10, fee: 0 },
    { c: 'A', side: 'sell', d: 20260106, sh: 2000, px: 51, fee: 0, tax: 0 },   // 只有 1000 股可賣
    { c: 'Z', side: 'buy', d: 20260105, sh: 1000, px: 9, fee: 0 },
  ];
  const r = C.equityCurve(lots, { A: hA, B: hB }, { cash0: 100000 });
  assert.deepEqual(r.missing, ['Z']);
  assert.deepEqual(r.mv, [60000, 10000, 11000]);
  assert.deepEqual(r.inv, [60000, 9000, 9000]);
  assert.deepEqual(r.cash, [40000, 91000, 91000]);
});

t('部位走勢：比歷史資料還早買的，之前的配息也要算到；冷門 ETF 除息那天沒成交，市值不能和配息重複算', () => {
  // 2018 年買、歷史資料從 2020 年開始：2019 年的配息照樣入帳
  const hA = { d: [20200102, 20200103], p: [30, 30.5], splits: [], divs: [[20190716, 1.4], [20191023, 0.4]] };
  const a = C.equityCurve([{ c: 'A', side: 'buy', d: 20180601, sh: 5000, px: 25, fee: 0, at: '1' }], { A: hA });
  assert.equal(a.d[0], 20200102);
  assert.equal(a.div[0], 5000 * 1.8);
  // 冷門 T 在除息日 8/18 沒有成交（L 有成交，所以那天在曲線上）：參考價先扣掉配息
  const hT = { d: [20210816, 20210817, 20210819], p: [10, 10, 9.6], splits: [], divs: [[20210818, 0.5]] };
  const hL = { d: [20210816, 20210817, 20210818, 20210819], p: [50, 50, 50, 50], splits: [], divs: [] };
  const L = [{ c: 'T', side: 'buy', d: 20210816, sh: 1000, px: 10, fee: 0, at: '1' }, { c: 'L', side: 'buy', d: 20210816, sh: 1, px: 50, fee: 0, at: '2' }];
  const e = C.equityCurve(L, { T: hT, L: hL });
  const k = e.d.indexOf(20210818);
  assert.equal(e.div[k], 500);
  near(e.mv[k] + e.div[k], 1000 * 10 + 50);               // 除息當天：市值少 500、配息多 500
  near(e.mv[k + 1], 1000 * 9.6 + 50);                      // 隔天有成交：用真的價格
  // 分割那天沒成交：參考價除以倍數，市值不會暴增
  const hS = { d: [20250610, 20250611, 20250620], p: [200, 200, 50.5], splits: [[20250618, 4]], divs: [] };
  const hM = { d: [20250610, 20250611, 20250618, 20250620], p: [1, 1, 1, 1], splits: [], divs: [] };
  const s = C.equityCurve([{ c: 'S', side: 'buy', d: 20250610, sh: 100, px: 200, fee: 0, at: '1' }, { c: 'M', side: 'buy', d: 20250610, sh: 1, px: 1, fee: 0, at: '2' }], { S: hS, M: hM });
  near(s.mv[s.d.indexOf(20250618)], 400 * 50 + 1);
  // 從中間開始畫（例如只看近一年）：之前的除息不能拿來扣參考價
  const r = C.equityCurve([{ c: 'T', side: 'buy', d: 20210816, sh: 1000, px: 10, fee: 0, at: '1' }, { c: 'L', side: 'buy', d: 20210816, sh: 1, px: 50, fee: 0, at: '2' }], { T: hT, L: hL }, { from: 20210819 });
  near(r.mv[0], 1000 * 9.6 + 50);
  assert.equal(r.div[0], 500);
});

t('部位走勢：模擬倉最後一天的總資產＝部位計算的總資產', () => {
  const h = { d: [20260105, 20260106, 20260107, 20260108], p: [100, 101, 99, 103], splits: [], divs: [[20260107, 1.5]] };
  const fee = { disc: 1, min: 20, minOdd: 1 };
  const b = pf.tradeCost('buy', 2000, 100, 'broad', 20260105, fee);
  const s = pf.tradeCost('sell', 500, 99, 'broad', 20260107, fee);
  const lots = [
    { id: '1', c: 'A', side: 'buy', d: 20260105, sh: 2000, px: 100, fee: b.fee, tax: 0, at: '1' },
    { id: '2', c: 'A', side: 'sell', d: 20260107, sh: 500, px: 99, fee: s.fee, tax: s.tax, at: '2' },
  ];
  const r = C.equityCurve(lots, { A: h }, { cash0: 1e6 });
  const k = r.d.length - 1;
  const rows = new Map([['A', { c: 'A', k: 'broad', p: 103, d: 20260108 }]]);
  const P0 = pf.buildPortfolio({ cash: 0, lots }, rows, () => ({ px: 103, date: 20260108 }), { A: { d: h.divs, s: [] } }, fee, 20260108);
  const cash = 1e6 + pf.lotsCashFlow(lots) + P0.totals.divRecv;
  near(r.cash[k], cash, 1e-6);
  near(r.cash[k] + r.mv[k], cash + P0.totals.mv, 1e-6);
  assert.equal(r.div[k], 3000);
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
