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

// 星期一到五的交易日（假的行事曆），可以挖掉幾天當作國定假日
const weekdays = (from, to, holidays = []) => { const out = []; for (let d = from; d <= to; d = pf.addDays(d, 1)) { const w = new Date(Date.UTC(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100)).getUTCDay(); if (w >= 1 && w <= 5 && !holidays.includes(d)) out.push(d); } return out; };

t('定期定額計畫格式：舊版 { day }、v2 轉成 v3；怪資料擋掉或修正（也用在還原備份）；刪掉的那幾期搬到設定', () => {
  const p = C.normPlan({ id: 'old1', c: '0050', day: 6, amt: 3000 }, 20261021);
  assert.deepEqual(p, { id: 'old1', c: '0050', days: [6], amt: 3000, fee: 1, start: 20261021, end: null, stop: null, sb: true, v: 3 });   // 舊版照原本的扣款日算開始、停扣
  assert.equal(C.normPlan({ c: '0050', days: [6], amt: 3000, start: 20250101 }, 20261021).sb, undefined);   // 表單新存的：看成交日
  assert.deepEqual(C.normPlan({ c: '0050', days: [6], amt: 3000, start: 20250101, end: 20261013, stop: 20261009 }, 20261021).stop, 20261009);
  assert.equal(C.normPlan({ c: '<img>', days: [6], amt: 3000 }, 20261021), null);
  assert.equal(C.normPlan({ c: '0050', days: [0, 32, 'x'], amt: 3000 }, 20261021), null);
  assert.equal(C.normPlan({ c: '0050', days: [6], amt: 50 }, 20261021), null);
  const q = C.normPlan({ id: 'x"><script>', c: '00878', days: [31, 6, 6], amt: 1000.4, fee: -3, start: 20250101, end: 20240101, back: 'yes', skip: [20250106, 'bad', 20250106], v: 2 }, 20261021);
  assert.equal(q.id, '00878-20250101-6_31');
  assert.deepEqual(q.days, [6, 31]);
  assert.equal(q.amt, 1000); assert.equal(q.fee, 1); assert.equal(q.end, null); assert.equal(q.v, 3);
  assert.ok(!('skip' in q) && !('back' in q));
  assert.equal(C.normPlan({ c: '00679b', days: [6], amt: 3000 }, 20261021).c, '00679B');
  assert.deepEqual(C.planSkipKeys({ c: '00878', skip: [20250106, 'bad', 20250106] }), ['00878|20250106', '00878|20250106']);
  assert.deepEqual(C.planSkipKeys({ c: '<x>', skip: [20250106] }), []);
  assert.deepEqual(C.normSkips(['0050|20250106', 'bad', '0050|20250106', '<x>|20250101', '0050|20251399', 7]), ['0050|20250106']);
  assert.ok(C.plansOverlap({ c: '0050', days: [6, 16], start: 20250101, end: null }, { c: '0050', days: [16], start: 20260101, end: null }));
  assert.ok(!C.plansOverlap({ c: '0050', days: [6], start: 20250101, end: null }, { c: '0050', days: [16], start: 20250101, end: null }));
  assert.ok(!C.plansOverlap({ c: '0050', days: [6], start: 20250101, end: 20251231 }, { c: '0050', days: [6], start: 20260101, end: null }));
  assert.ok(!C.plansOverlap({ c: '0050', days: [6], start: 20250101, end: null }, { c: '0056', days: [6], start: 20250101, end: null }));
});

t('定期定額排程（國泰規則）：可以選好幾天、那個月沒有的日期不買、週末和國定假日順延；開始和停扣看成交日', () => {
  const cal = weekdays(20260101, 20260430, [20260216, 20260217, 20260218, 20260219, 20260220, 20260227]);   // 春節、228 補假
  const plan = { days: [6, 30, 16, 6], start: 20260101 };
  const s = C.dcaSchedule(plan, cal, 20260420);
  const by = Object.fromEntries(s.map((x) => [x.s, x.d]));
  assert.equal(by[20260106], 20260106);
  assert.equal(by[20260116], 20260116);
  assert.equal(by[20260130], 20260130);
  assert.equal(by[20260216], 20260223);      // 春節：順延到 2/23
  assert.equal(by[20260230], undefined);     // 2 月沒有 30 號：那一期不買
  assert.equal(by[20260306], 20260306);
  assert.equal(by[20260316], 20260316);
  assert.equal(by[20260330], 20260330);
  assert.equal(by[20260406], 20260406);
  assert.equal(by[20260416], 20260416);
  assert.equal(by[20260430], undefined);     // 超過 upto
  assert.equal(s.length, 10);
  // 開始和停扣：看實際成交的交易日（含）
  assert.equal(C.dcaSchedule({ days: [6], start: 20260110, end: 20260310 }, cal, 20260420).map((x) => x.s).join(','), '20260206,20260306');
  assert.equal(C.dcaSchedule({ days: [6], start: 20260110, end: 20260305 }, cal, 20260420).map((x) => x.s).join(','), '20260206');
  // 4/4 是週六、順延到 4/6 成交：從 4/6 開始的計畫也算這一期
  assert.deepEqual(C.dcaSchedule({ days: [4], start: 20260406 }, cal, 20260420), [{ s: 20260404, d: 20260406 }]);
  // 最後一個已知交易日之後才會成交的，先不列（4/4 是週六，下一個交易日還沒進資料）
  const cal2 = weekdays(20260401, 20260403);
  assert.equal(C.dcaSchedule({ days: [4], start: 20260401 }, cal2, 20260405).length, 0);
  // 舊版轉過來的（sb）：開始、停扣照原本的扣款日算 → 5/31（週六、6/2 成交）不算進 6/1 開始的計畫；新版看成交日就算
  const cal4 = weekdays(20250501, 20250731);
  assert.deepEqual(C.dcaSchedule({ days: [31], start: 20250601, sb: true }, cal4, 20250731).map((x) => x.s), [20250731]);
  assert.deepEqual(C.dcaSchedule({ days: [31], start: 20250601 }, cal4, 20250731).map((x) => x.s), [20250531, 20250731]);
  assert.deepEqual(C.dcaSchedule({ days: [31], start: 20250101, end: 20250531, sb: true }, cal4, 20250731).map((x) => x.s), [20250531]);
  // 閏年：2024/2/29 有、2025/2/29 沒有
  const cal3 = weekdays(20240101, 20250331);
  const s3 = C.dcaSchedule({ days: [29], start: 20240101 }, cal3, 20250331).map((x) => x.s);
  assert.ok(s3.includes(20240229) && !s3.some((x) => x === 20250229));
});

t('國泰生效規則：送出後 1 個交易日生效、再下一個交易日才扣得到；市場交易日用好幾檔聯集（不會漏掉單一檔停止交易的日子）', () => {
  const cal = weekdays(20261001, 20261023, [20261009]);
  assert.equal(C.dcaCutover(20261005, cal), 20261007);      // 國泰的例子：週一送出、週二生效、週三扣得到
  assert.equal(C.dcaCutover(20261008, cal), 20261013);      // 10/9 放假：10/12 生效、10/13 才扣得到
  assert.equal(C.dcaCutover(20261022, cal), 20261026);      // 已知資料之後：先當作星期一到五都開市
  assert.equal(C.addTradingDays(20261023, 1, cal), 20261026);
  assert.deepEqual(C.marketCal([[20250610, 20250618], [20250610, 20250611, 20250612, 20250618], [20250611]]), [20250610, 20250611, 20250612, 20250618]);
});

t('成交日的官方收盤：停止交易（分割）那幾天國泰不扣；冷門 ETF 沒成交用前一次收盤；下市不記；還不知道就等', () => {
  const cal = weekdays(20250602, 20250627);
  const h0050 = { d: cal.filter((d) => d < 20250611 || d >= 20250618), p: cal.filter((d) => d < 20250611 || d >= 20250618).map((d) => (d < 20250611 ? 190 : 47.5)), splits: [[20250618, 4]] };
  const row = { d: 20250627, p: 48 };
  assert.deepEqual(C.dcaPrice({ h: h0050, row, cal }, 20250610), { st: 'ok', px: 190, pd: 20250610 });
  assert.deepEqual(C.dcaPrice({ h: h0050, row, cal }, 20250611), { st: 'none', why: 'halt' });
  assert.deepEqual(C.dcaPrice({ h: h0050, row, cal }, 20250617), { st: 'none', why: 'halt' });
  assert.deepEqual(C.dcaPrice({ h: h0050, row, cal }, 20250618), { st: 'ok', px: 47.5, pd: 20250618 });
  const thin = { d: [20250602, 20250605], p: [20, 21], splits: [] };
  assert.deepEqual(C.dcaPrice({ h: thin, row: { d: 20250605, p: 21 }, cal }, 20250604), { st: 'ok', px: 20, pd: 20250602 });
  const gap = { d: [20250602, 20250627], p: [20, 21], splits: [] };
  assert.deepEqual(C.dcaPrice({ h: gap, row: { d: 20250627, p: 21 }, cal }, 20250624), { st: 'none', why: 'thin' });   // 超過 10 個交易日沒成交
  const upTo = { d: [20250602, 20250603], p: [20, 21], splits: [] };
  assert.deepEqual(C.dcaPrice({ h: upTo, row: { d: 20250604, p: 22 }, cal }, 20250604), { st: 'ok', px: 22, pd: 20250604 });   // 歷史檔還沒有最新一天
  assert.deepEqual(C.dcaPrice({ h: upTo, row: { d: 20250603, p: 21 }, cal }, 20250604), { st: 'wait' });   // 還在停止交易、還沒恢復
  assert.deepEqual(C.dcaPrice({ h: upTo, row: null, cal }, 20250604), { st: 'none', why: 'gone' });
  assert.deepEqual(C.dcaPrice({ hist404: true, row: { d: 20250604, p: 10 }, cal }, 20250604), { st: 'ok', px: 10, pd: 20250604 });
  assert.deepEqual(C.dcaPrice({ hist404: true, row: { d: 20250605, p: 10 }, cal }, 20250604), { st: 'wait' });
  assert.deepEqual(C.dcaPrice({ hist404: true, row: null, cal }, 20250604), { st: 'unknown' });   // 下市、合併後連歷史檔都沒了：已經記的先留著
  assert.deepEqual(C.dcaPrice({ row: { d: 20250604, p: 10 }, cal }, 20250604), { st: 'unknown' });
});

t('預估一期買到的股數：每期金額已含 1 元手續費，用收盤價買零股、無條件捨去', () => {
  const e = C.dcaEstimate(3000, 1, 108.15);
  assert.equal(e.sh, 27); near(e.spent, 27 * 108.15 + 1, 1e-9);
  assert.equal(C.dcaEstimate(100, 1, 150), null);     // 連 1 股都買不起
  assert.equal(C.dcaEstimate(2999 + 1, 1, 29.99).sh, 100);
});

t('自動入帳的比對：補缺的、刪重複的、計畫改了就照新的、停止交易不記、刪掉的不補、你自己記過的先問', () => {
  const cal = weekdays(20250601, 20250731);
  const px = (c, d) => ({ st: 'ok', px: c === 'A' ? 50 : 20, pd: d });
  const plan = { id: 'p1', c: 'A', days: [6], amt: 3001, fee: 1, start: 20250601, end: null, v: 3 };
  const base = { cal, upto: 20250731, skip: new Set(), noAsk: new Set(), priceOf: px };
  const r1 = C.dcaReconcile({ ...base, plans: [plan], lots: [] });
  assert.deepEqual(r1.add.map((l) => `${l.d}:${l.sh}`), ['20250606:60', '20250707:60']);   // 7/6 是週日 → 7/7
  assert.equal(r1.del.length, 0);
  const lots = r1.add.map((l, i) => ({ ...l, id: `e${i}`, at: `2025-08-0${i + 1}` }));
  const r2 = C.dcaReconcile({ ...base, plans: [plan], lots });   // 再跑一次：什麼都不用做
  assert.equal(r2.add.length + r2.del.length + r2.ask.length, 0);
  // 重複的預估（兩個分頁同時記）：留一筆
  const r3 = C.dcaReconcile({ ...base, plans: [plan], lots: [...lots, { ...lots[0], id: 'dup', at: '2025-09-01' }] });
  assert.deepEqual(r3.del, ['dup']); assert.equal(r3.add.length, 0);
  // 改了扣款日（6 → 16）：舊日子的預估刪掉、照新日子補；核對過的那一筆不動，而且算在 6/16 那一期（不重複記）
  const lots4 = [{ ...lots[0], dca: { ...lots[0].dca, est: false } }, lots[1]];
  const r4 = C.dcaReconcile({ ...base, plans: [{ ...plan, days: [16] }], lots: lots4 });
  assert.deepEqual(r4.del, ['e1']);
  assert.deepEqual(r4.add.map((l) => l.dca.s), [20250716]); assert.equal(r4.moved, 1);
  // 改了金額：不一樣的預估換掉
  const r5 = C.dcaReconcile({ ...base, plans: [{ ...plan, amt: 5001 }], lots });
  assert.deepEqual(r5.del.sort(), ['e0', 'e1']); assert.deepEqual(r5.add.map((l) => l.sh), [100, 100]);
  // 開始日往後移：之前的預估刪掉
  const r6 = C.dcaReconcile({ ...base, plans: [{ ...plan, start: 20250701 }], lots });
  assert.deepEqual(r6.del, ['e0']); assert.equal(r6.add.length, 0);
  // 同一檔兩個重疊的計畫：同一期只記一次
  const r7 = C.dcaReconcile({ ...base, plans: [plan, { ...plan, id: 'p2', start: 20250701 }], lots: [] });
  assert.equal(r7.add.length, 2);
  // 刪掉的那一期：不補、剩下的預估也刪
  const r8 = C.dcaReconcile({ ...base, skip: new Set(['A|20250606']), plans: [plan], lots });
  assert.deepEqual(r8.del, ['e0']); assert.equal(r8.add.length, 0);
  // 停止交易：不記；以前記成順延那天的刪掉
  const halt = (c, d) => (c === 'A' && d >= 20250611 && d <= 20250617 ? { st: 'none', why: 'halt' } : px(c, d));
  const p16 = { ...plan, days: [16] };
  const old = { id: 'h', c: 'A', side: 'buy', d: 20250618, sh: 60, px: 50, fee: 1, at: '2025-07-01', dca: { plan: 'p1', s: 20250616, est: true } };
  const r9 = C.dcaReconcile({ ...base, priceOf: halt, plans: [p16], lots: [old] });
  assert.deepEqual(r9.del, ['h']); assert.deepEqual(r9.add.map((l) => l.dca.s), [20250716]); assert.equal(r9.none.length, 1);
  // 沒停止交易的另一檔、以前被記錯成 6/18 的：換成 6/16
  const p16b = { ...p16, id: 'pb', c: 'B' };
  const r10 = C.dcaReconcile({ ...base, priceOf: halt, plans: [p16b], lots: [{ ...old, c: 'B', px: 20, dca: { plan: 'pb', s: 20250616, est: true } }] });
  assert.deepEqual(r10.del, ['h']); assert.equal(r10.add[0].d, 20250616);
  // 那幾天你自己記了一筆同一檔的買進：先問，不記；說過「不是」的就記
  const man = { id: 'm', c: 'A', side: 'buy', d: 20250609, sh: 61, px: 49 };
  const r11 = C.dcaReconcile({ ...base, plans: [plan], lots: [man] });
  assert.deepEqual(r11.ask.map((x) => `${x.key}:${x.cand.id}`), ['A|20250606:m']);
  assert.deepEqual(r11.add.map((l) => l.dca.s), [20250706]);
  const r12 = C.dcaReconcile({ ...base, noAsk: new Set(['A|20250606']), plans: [plan], lots: [man] });
  assert.equal(r12.ask.length, 0); assert.equal(r12.add.length, 2);
  // 計畫刪掉、選擇留著的預估：不動（重複的照樣刪）
  const r13 = C.dcaReconcile({ ...base, plans: [], lots: [...lots, { ...lots[0], id: 'dup', at: '2025-09-01' }] });
  assert.deepEqual(r13.del, ['dup']);
  // 這次沒拿到價格：不新增也不刪
  const r14 = C.dcaReconcile({ ...base, priceOf: () => ({ st: 'unknown' }), plans: [{ ...plan, amt: 5001 }], lots });
  assert.equal(r14.add.length + r14.del.length, 0); assert.equal(r14.wait, 0);
  const r15 = C.dcaReconcile({ ...base, priceOf: () => ({ st: 'wait' }), plans: [plan], lots: [] });
  assert.equal(r15.add.length, 0); assert.equal(r15.wait, 2);
});

t('改了扣款日之後：核對過的那一筆算在最接近的新那一期，不重複記；開始日往後移不會亂配；之後才自己記的同一筆也會問', () => {
  const cal = weekdays(20250601, 20251031);
  const px = (c, d) => ({ st: 'ok', px: 50, pd: d });
  const base = { cal, upto: 20251031, skip: new Set(), noAsk: new Set(), priceOf: px };
  const plan = { id: 'p1', c: 'A', days: [6], amt: 3001, fee: 1, start: 20250601, end: null, v: 3 };
  const r0 = C.dcaReconcile({ ...base, plans: [plan], lots: [] });
  // 全部對齊過（核對過）之後，把扣款日改成 7 號（當初填錯）：不能每個月多一筆
  const ok = r0.add.map((l, i) => ({ ...l, id: `c${i}`, at: `2025-11-0${i}`, dca: { ...l.dca, est: false, cal: 20251101 } }));
  const r1 = C.dcaReconcile({ ...base, plans: [{ ...plan, days: [7] }], lots: ok });
  assert.equal(r1.add.length, 0); assert.equal(r1.del.length, 0); assert.equal(r1.moved, ok.length);
  // 只有兩期核對過、其他是預估：核對過的那兩個月不重複，其他月照新日子
  const mix = r0.add.map((l, i) => ({ ...l, id: `m${i}`, at: `2025-11-0${i}`, dca: { ...l.dca, est: i < 2 ? false : true } }));
  const r2 = C.dcaReconcile({ ...base, plans: [{ ...plan, days: [7] }], lots: mix });
  assert.equal(r2.add.length, r0.add.length - 2); assert.equal(r2.del.length, r0.add.length - 2);
  // 國泰那邊改了：9/1 送出 → 9/3 起新的 8 號；舊的 7 號那一期 9/7 已經核對過（其實是 9/8 那一筆）→ 9/8 不另外記
  const old7 = { ...plan, days: [7], end: 20250902 }, new8 = { ...plan, id: 'p2', days: [8], start: 20250903, prev: 'p1' };
  const sept = [{ id: 's9', c: 'A', side: 'buy', d: 20250908, sh: 60, px: 50, fee: 1, at: '2025-09-09', dca: { plan: 'p1', s: 20250907, est: false } }];
  const r3 = C.dcaReconcile({ ...base, plans: [old7, new8], lots: sept });
  assert.ok(!r3.add.some((l) => l.dca.s === 20250908), 'September doubled');
  // 開始日往後移、一個月扣兩次：核對過、在新開始日之前的那一筆，不能拿去抵 6/16
  const two = { ...plan, days: [6, 16], start: 20250610 };
  const r4 = C.dcaReconcile({ ...base, plans: [two], lots: [{ id: 'j6', c: 'A', side: 'buy', d: 20250606, sh: 60, px: 50, fee: 1, dca: { plan: 'p1', s: 20250606, est: false } }] });
  assert.ok(r4.add.some((l) => l.dca.s === 20250616), '6/16 wrongly covered');
  // 預估已經記了、之後你又自己記了同一筆：問是不是同一筆（是 → 留你記的、刪預估）
  const est = r0.add.slice(0, 1).map((l) => ({ ...l, id: 'e0', at: '2025-06-06' }));
  const r5 = C.dcaReconcile({ ...base, plans: [plan], lots: [...est, { id: 'man', c: 'A', side: 'buy', d: 20250606, sh: 61, px: 49 }] });
  assert.deepEqual(r5.ask.map((x) => `${x.key}:${x.cand.id}:${x.est}`), ['A|20250606:man:e0']);
  assert.equal(r5.del.length, 0);
  // 春節三期都順延到同一天、你只記了一筆：一起問
  const cny = weekdays(20250101, 20250228, [20250127, 20250128, 20250129, 20250130, 20250131]);
  const p3 = { id: 'p3', c: 'A', days: [29, 30, 31], amt: 3001, fee: 1, start: 20250101, end: null, v: 3 };
  const r6 = C.dcaReconcile({ plans: [p3], lots: [{ id: 'one', c: 'A', side: 'buy', d: 20250203, sh: 180, px: 50 }], cal: cny, upto: 20250228, skip: new Set(), noAsk: new Set(), priceOf: px });
  assert.equal(r6.ask.length, 1); assert.equal(r6.ask[0].more.length, 2); assert.equal(r6.add.length, 0);
  // 你記的只有其中一期的股數：不一起問，只問那一期，其他兩期照記
  const r7 = C.dcaReconcile({ plans: [p3], lots: [{ id: 'one', c: 'A', side: 'buy', d: 20250203, sh: 60, px: 50 }], cal: cny, upto: 20250228, skip: new Set(), noAsk: new Set(), priceOf: px });
  assert.equal(r7.ask.length, 1); assert.equal(r7.ask[0].more, undefined); assert.equal(r7.add.length, 2);
});

t('不會跨計畫亂配：刪掉一個計畫留下的紀錄，不會吃掉同一檔另一個計畫的預估；扣款日差超過 15 天也不重複記', () => {
  const cal = weekdays(20250601, 20251031);
  const px = (c, d) => ({ st: 'ok', px: 50, pd: d });
  const base = { cal, upto: 20251031, skip: new Set(), noAsk: new Set(), priceOf: px };
  const p6 = { id: 'p6', c: 'A', days: [6], amt: 3001, fee: 1, start: 20250601, end: null, v: 3 };
  const p20 = { id: 'p20', c: 'A', days: [20], amt: 3001, fee: 1, start: 20250601, end: null, v: 3 };
  const r0 = C.dcaReconcile({ ...base, plans: [p6, p20], lots: [] });
  const lots = r0.add.map((l, i) => ({ ...l, id: `x${i}`, at: `2025-11-0${i}`, dca: { ...l.dca, est: l.dca.plan === 'p6' ? false : true } }));
  const r1 = C.dcaReconcile({ ...base, plans: [p20], lots });   // 刪掉 6 號的計畫（紀錄留著）
  assert.equal(r1.del.length, 0); assert.equal(r1.add.length, 0); assert.equal(r1.moved, 0);
  // 當初填錯：6 號改成 26 號，而且都核對過了 → 同一個月的那一期，不重複
  const conf = r0.add.filter((l) => l.dca.plan === 'p6').map((l, i) => ({ ...l, id: `c${i}`, at: `2025-11-0${i}`, dca: { ...l.dca, est: false } }));
  const r2 = C.dcaReconcile({ ...base, plans: [{ ...p6, days: [26] }], lots: conf });
  assert.equal(r2.add.length, 0); assert.equal(r2.moved, conf.length);
  // 國泰那邊改了（8/3 送出 → 8/5 起 26 號）：8/6 核對過的那一筆其實是 8/26 那一筆
  const head = { ...p6, end: 20250804 }, tail = { ...p6, id: 'p26', days: [26], start: 20250805, prev: 'p6' };
  const aug = [{ id: 'a8', c: 'A', side: 'buy', d: 20250806, sh: 60, px: 50, fee: 1, at: '2025-08-07', dca: { plan: 'p6', s: 20250806, est: false } }];
  const r3 = C.dcaReconcile({ ...base, plans: [head, tail], lots: aug });
  assert.ok(!r3.add.some((l) => l.dca.s === 20250826), 'August doubled');
  // 國泰 8/1 改成每月 1 號（8/5 起）：舊的 5 號在 8/5 那一筆核對過，但新的設定 8 月沒有扣款 → 問你是不是多記了
  const h5 = { id: 'p5', c: 'A', days: [5], amt: 3001, fee: 1, start: 20250601, end: 20250804, v: 3 }, t1 = { id: 'p1x', c: 'A', days: [1], amt: 3001, fee: 1, start: 20250805, prev: 'p5', v: 3 };
  const five = [20250605, 20250707, 20250805, 20250905].map((d, i) => ({ id: `f${i}`, c: 'A', side: 'buy', d, sh: 60, px: 50, fee: 1, at: `2025-10-0${i + 1}`, dca: { plan: 'p5', s: d === 20250707 ? 20250705 : d, est: false, cal: 20250930 } }));
  const r4 = C.dcaReconcile({ ...base, upto: 20250930, plans: [h5, t1], lots: five });
  assert.deepEqual(r4.extras.map((x) => x.id), ['f2']); assert.equal(r4.add.length, 0); assert.equal(r4.moved, 1);
  const r5 = C.dcaReconcile({ ...base, upto: 20250930, noAsk: new Set(['A|20250805|f2']), plans: [h5, t1], lots: five });
  assert.equal(r5.extras.length, 0);
});

t('問你的時候挑最像的那一筆；說「不是」只算那一筆；核對過的那一期你又記了一筆，會問是不是重複', () => {
  const cal = weekdays(20251001, 20251031);
  const px = (c, d) => ({ st: 'ok', px: 58.75, pd: d });
  const plan = { id: 'p', c: 'A', days: [7], amt: 3000, fee: 1, start: 20251001, end: null, v: 3 };
  const base = { cal, upto: 20251031, skip: new Set(), noAsk: new Set(), priceOf: px };
  const lump = { id: 'lump', c: 'A', side: 'buy', d: 20251007, sh: 1000, px: 58 };
  const mine = { id: 'mine', c: 'A', side: 'buy', d: 20251008, sh: 51, px: 58.7 };
  const r1 = C.dcaReconcile({ ...base, plans: [plan], lots: [lump, mine] });
  assert.equal(r1.ask[0].cand.id, 'mine');
  const r2 = C.dcaReconcile({ ...base, noAsk: new Set(['A|20251007|mine']), plans: [plan], lots: [lump, mine] });
  assert.equal(r2.ask[0].cand.id, 'lump');                 // 那一筆說過不是，還會問另一筆
  const r3 = C.dcaReconcile({ ...base, noAsk: new Set(['A|20251007|mine', 'A|20251007|lump']), plans: [plan], lots: [lump, mine] });
  assert.equal(r3.ask.length, 0); assert.equal(r3.add.length, 1);
  const conf = { id: 'cf', c: 'A', side: 'buy', d: 20251007, sh: 51, px: 58.75, fee: 1, dca: { plan: 'p', s: 20251007, est: false } };
  const r4 = C.dcaReconcile({ ...base, plans: [plan], lots: [conf, mine] });
  assert.deepEqual(r4.ask.map((a) => `${a.cand.id}:${a.dup && a.dup.id}`), ['mine:cf']);
  assert.deepEqual(C.normNoAsk(['A|20251007', '0050|20251007|ab_1', '0050|20251007|<x>', 'bad']), ['0050|20251007|ab_1']);
});

t('和國泰庫存對齊：只改預估、每筆花的錢不變；差太多不給對齊；分割前的紀錄照倍數換算', () => {
  const holdingOf = (ls) => pf.holdingFromLots(ls, [[20250618, 4]]);
  const lots = [
    { id: 'm', c: 'X', side: 'buy', sh: 1000, px: 100 },                        // 不記得日期的舊股（手動記的）
    { id: 'a', c: 'X', side: 'buy', d: 20250506, sh: 10, px: 190, fee: 1 },     // 分割前（1 股＝4 股）
    { id: 'b', c: 'X', side: 'buy', d: 20250706, sh: 40, px: 50, fee: 1 },
    { id: 'c', c: 'X', side: 'buy', d: 20250806, sh: 39, px: 51, fee: 1 },
  ];
  const r = C.dcaCalibrate(lots, ['a', 'b', 'c'], [[20250618, 4]], 1125, holdingOf);
  assert.ok(r.ok, r.why);
  assert.equal(r.before, 1000 + 40 + 40 + 39);
  assert.equal(r.after, 1125); assert.equal(r.miss, 0);
  near(r.k, (1125 - 1000) / 119, 1e-12);
  for (const ch of r.changes) { const l = lots.find((x) => x.id === ch.id); near(ch.sh * ch.px, l.sh * l.px, 0.01); }
  assert.equal(C.dcaCalibrate(lots, ['a'], [], 10, holdingOf).kind, 'low');      // 比其他紀錄加起來還少
  assert.equal(C.dcaCalibrate(lots, [], [], 1200, holdingOf).ok, false);
  assert.ok(C.dcaCalibrate(lots, ['a', 'b', 'c'], [[20250618, 4]], 1100, holdingOf).ok);           // 預估 119 股 → 100 股（0.84）：還在漲跌幅說得通的範圍
  assert.equal(C.dcaCalibrate(lots, ['a', 'b', 'c'], [[20250618, 4]], 1094, holdingOf).kind, 'low');   // → 94 股（0.79）：說不通
});

t('和國泰庫存對齊：打錯字（少一位數）、差兩成以上都擋下；零頭補得剛好；分割前只能整份調時說清楚差多少', () => {
  const holdingOf = (ls) => pf.holdingFromLots(ls, []);
  const est = Array.from({ length: 20 }, (_, i) => ({ id: `e${i}`, c: 'X', side: 'buy', d: 20250106 + i, sh: 100 + (i % 7), px: 30 + i / 10, fee: 1 }));
  const ids = est.map((l) => l.id);
  const sum = est.reduce((a, l) => a + l.sh, 0);
  assert.equal(C.dcaCalibrate(est, ids, [], Math.round(sum / 10), holdingOf).kind, 'low');      // 少打一位數
  assert.equal(C.dcaCalibrate(est, ids, [], sum * 10, holdingOf).kind, 'high');
  for (const k of [0.8, 0.93, 0.999, 1.001, 1.07, 1.25]) {
    const r = C.dcaCalibrate(est, ids, [], Math.round(sum * k), holdingOf);
    assert.ok(r.ok, `${k} ${r.why}`);
    assert.equal(r.after, Math.round(sum * k)); assert.equal(r.miss, 0);
    for (const ch of r.changes) { const l = est.find((x) => x.id === ch.id); near(ch.sh * ch.px, l.sh * l.px, 0.01); }
  }
  // 只有分割前的預估：一股＝4 股，只能 4 股 4 股地調
  const hs = (ls) => pf.holdingFromLots(ls, [[20250618, 4]]);
  const pre = [{ id: 'p', c: 'X', side: 'buy', d: 20250506, sh: 25, px: 190, fee: 1 }];
  const r = C.dcaCalibrate(pre, ['p'], [[20250618, 4]], 102, hs);
  assert.ok(r.ok); assert.equal(Math.abs(r.miss), 2); assert.equal(r.after, 102 - r.miss);
});

t('定期定額提醒：週末順延、那個月沒有的日期不提醒、開始前和停扣後不提醒，每一期剛好提醒一次；平日放假順延到下一個開市日', () => {
  for (const day of [1, 15, 28, 29, 30, 31]) {
    const plan = { days: [day], start: 20261101 };
    const hits = [];
    for (let d = 20261101; d <= 20281130; d = pf.addDays(d, 1)) if (C.dcaDueToday(plan, d)) hits.push(d);
    const months = new Set(hits.map((d) => { const due = [0, 1, 2].map((k) => pf.addDays(d, -k)).find((x) => x % 100 === day); return Math.floor(due / 100); }));
    assert.equal(months.size, hits.length, `day ${day}`);    // 每一期只提醒一次
    // 應該提醒的：那個月有這一天、週末順延後的成交日在開始日（含）之後（10/31 週六 → 11/2 成交，也算）
    const expect = [];
    for (let y = 2026; y <= 2028; y++) for (let m = 1; m <= 12; m++) {
      if (day > new Date(Date.UTC(y, m, 0)).getUTCDate()) continue;
      let d = y * 10000 + m * 100 + day;
      while ([0, 6].includes(new Date(Date.UTC(y, m - 1, d % 100)).getUTCDay()) && d % 100 === day) d = pf.addDays(d, 1);
      for (let g = 0; g < 3 && [0, 6].includes(new Date(Date.UTC(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100)).getUTCDay()); g++) d = pf.addDays(d, 1);
      if (d >= 20261101 && d <= 20281130) expect.push(d);
    }
    assert.deepEqual(hits, expect, `day ${day}`);  // 2 月沒有 29～31 號就不提醒
  }
  assert.equal(C.dcaDueToday({ days: [27], start: 20270101 }, 20270301), true);   // 2027/2/27 週六 → 3/1 週一
  assert.equal(C.dcaDueToday({ days: [6], start: 20261101, end: 20261130 }, 20261207), false);
  // 2026/10/9（週五）國慶補假：9 號那一期 10/12 才扣；上一個交易日是 10/8
  assert.equal(C.dcaRolledToday({ days: [9], start: 20260101 }, 20261012, 20261008), true);
  assert.equal(C.dcaRolledToday({ days: [12], start: 20260101 }, 20261012, 20261008), false);
  assert.equal(C.dcaRolledToday({ days: [9], start: 20261013 }, 20261012, 20261008), false);
});

t('定期定額順延：證交所休市日期表（光復節補假 10/26）不用這支手機親眼看過', () => {
  const cal = { holidays: [20261009, 20261026], closed: [20261023] };
  const isC = (d) => C.calClosed(cal, d);
  assert.equal(C.calClosed(cal, 20261026), true);
  assert.equal(C.calClosed(cal, 20261023), true);    // 颱風假（用實際成交推出來的）
  assert.equal(C.calClosed(cal, 20261027), false);
  assert.equal(C.calClosed(null, 20261026), false);  // 沒有表：當作不知道
  // 26 號那一期：10/26 補假 → 10/27 扣；上一個交易日 10/22（10/23 颱風、週末、10/26 補假）
  assert.equal(C.rolledKnownBy({ days: [26] }, 20261027, 20261022, isC), true);
  // 23 號那一期：10/23 颱風、10/26 補假都確定休市 → 也是 10/27 扣
  assert.equal(C.rolledKnownBy({ days: [23] }, 20261027, 20261022, isC), true);
  // 沒有表也沒親眼看過：資料可能只是晚到，不亂說
  assert.equal(C.rolledKnownBy({ days: [26] }, 20261027, 20261022, () => false), false);
  // 只知道 10/26 休市、不知道 10/23：23 號那一期不說順延到今天
  assert.equal(C.rolledKnownBy({ days: [23] }, 20261027, 20261022, (d) => d === 20261026), false);
  assert.equal(C.rolledKnownBy({ days: [27] }, 20261027, 20261022, isC), false);   // 今天本來就是扣款日，不是順延
  assert.equal(C.rolledKnownBy({ days: [26] }, 20261027, 20261027, isC), false);
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
  // 定期定額：用真的官方資料檢查 0050 分割停止交易（2025/6/11～6/17）那幾天
  const dir = file.replace(/[^/]+$/, '');
  const load = (c) => (fs.existsSync(`${dir}${c}.json`) ? JSON.parse(fs.readFileSync(`${dir}${c}.json`, 'utf8')) : null);
  const hs = { '0050': h, '0056': load('0056'), '006208': load('006208'), '00919': load('00919') };
  if (hs['0056'] && hs['006208'] && hs['00919']) {
    const cal = C.marketCal([hs['0050'].d, hs['0056'].d, hs['006208'].d]);
    for (const d of [20250611, 20250612, 20250613, 20250616, 20250617]) assert.ok(cal.includes(d) && !h.d.includes(d), `市場 ${d} 有開市、0050 停止交易`);
    const upto = cal[cal.length - 1];
    const priceOf = (c, d) => C.dcaPrice({ h: hs[c], row: { d: hs[c].d[hs[c].d.length - 1], p: hs[c].p[hs[c].p.length - 1] }, cal }, d);
    const r1 = C.dcaReconcile({ plans: [{ id: 'a', c: '0050', days: [11, 16], amt: 3000, fee: 1, start: 20250501, end: 20250731, v: 3 }], lots: [], cal, upto, priceOf });
    assert.deepEqual(r1.add.map((l) => l.dca.s), [20250511, 20250516, 20250711, 20250716]);   // 5/11 是週日、5/12 成交
    assert.deepEqual(r1.none.map((x) => `${x.s}:${x.why}`), ['20250611:halt', '20250616:halt']);
    const r2 = C.dcaReconcile({ plans: [{ id: 'b', c: '00919', days: [16], amt: 5000, fee: 1, start: 20250601, end: 20250630, v: 3 }], lots: [], cal, upto, priceOf });
    const k = hs['00919'].d.indexOf(20250616);
    assert.deepEqual(r2.add.map((l) => [l.d, l.px]), [[20250616, hs['00919'].p[k]]]);
    console.log('定期定額實際資料：0050 分割停止交易那幾天不記、00919 照 6/16 收盤', r2.add[0].sh, '股 @', r2.add[0].px);
  }
}
console.log(`\n${n} 組測試通過`);
