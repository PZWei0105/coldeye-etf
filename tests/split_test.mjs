// 分割（收盤資料還沒算進去的那一段）的單元測試：node tests/split_test.mjs
// 情境：00662 在 2026/11/10 收 120 元，11/11～11/16 停止交易，11/17 一拆五恢復交易（參考價 24 元）。
import assert from 'node:assert/strict';
import * as C from '../site/calc.js';
import * as PF from '../site/pf.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);

t('合併分割紀錄：同一次（倍數一樣、10 天內）只算一次', () => {
  assert.deepEqual(C.mergeSplit([], 20261117, 5), [[20261117, 5]]);
  assert.deepEqual(C.mergeSplit([[20261117, 5]], 20261117, 5), [[20261117, 5]]);
  assert.deepEqual(C.mergeSplit([[20261117, 5]], 20261116, 5), [[20261117, 5]]);    // 盤中先認出來的日期差一天也不重複
  assert.deepEqual(C.mergeSplit([[20250618, 4]], 20261117, 5), [[20250618, 4], [20261117, 5]]);
  assert.deepEqual(C.mergeSplit(null, 20261117, 1), []);
});

t('還沒算進收盤資料的分割：只算 after 之後、upto 以前', () => {
  const sp = [[20250618, 4], [20261117, 5]];
  assert.deepEqual(C.pendingSplit(sp, 20261110, 20261117), { k: 5, d: 20261117 });
  assert.equal(C.pendingSplit(sp, 20261117, 20261117), null);   // 收盤資料已經是 11/17 的
  assert.equal(C.pendingSplit(sp, 20261110, 20261116), null);   // 還在停止交易
});

t('收盤資料的一列換算成分割後：價位除以 5、量不動、記下換算到哪一天', () => {
  const row = { c: '00662', d: 20261110, p: 120, ch: 1.5, iv: 110.05, s1: 115, r1: 125.5, dl: 112.3, pb: 117, m20: 118.4, atr: 2.4, sp: [118, 119, 120], v: 9000, val: 1e9, pr: 0.3 };
  C.scaleRow(row, 5, 20261117);
  assert.equal(row.p, 24); near(row.ch, 0.3); assert.equal(row.iv, 22.01); assert.equal(row.dl, 22.46); assert.equal(row.s1, 23);
  assert.deepEqual(row.sp, [23.6, 23.8, 24]);
  assert.equal(row.v, 9000); assert.equal(row.val, 1e9); assert.equal(row.pr, 0.3);
  assert.equal(row.sx, 20261117); assert.equal(row.sk, 5);
});

t('文字裡的價位換算，億元、百萬元、百分比不動', () => {
  assert.equal(C.scaleText('收盤跌破 115.20 元觀點作廢；溢價 0.30%', 5), '收盤跌破 23.04 元觀點作廢；溢價 0.30%');
  assert.equal(C.scaleText('近 20 日平均成交值僅約 3.2 百萬元', 5), '近 20 日平均成交值僅約 3.2 百萬元');
  assert.equal(C.scaleText('參考目標 1,250.00 元', 5), '參考目標 250.00 元');
});

t('單檔分析換算：走勢、均線、關鍵價位、文字', () => {
  const det = {
    asof: 20261110, price: 120,
    bars: { d: [20261107, 20261110], o: [118, 119], h: [121, 121], l: [117, 118], c: [119, 120], v: [1000, 2000] },
    ma: { 20: [118, 118.5], 60: [110, 111], 120: [100, 101] },
    nav: { d: [20261107, 20261110], nav: [119.5, 120.2], c: [119, 120] },
    view: {
      summary: '收盤 120.00 元', levels: { support: [{ price: 115, label: 'a' }], resistance: [{ price: 125, label: 'b' }], invalid: { price: 110, label: 'c' }, turn_bull: null, turn_bear: null, pullback: { price: 117.5, label: 'd' } },
      position: { dl: 112, ma20: 118.5 }, risk: { atr: 2.5 }, advice: { detail: '收盤跌破 110.00 元出場。' }, components: [{ text: '近 12 個月配息合計 0.00 元' }], flags: [],
    },
  };
  C.scaleDetail(det, 5, 20261117);
  assert.deepEqual(det.bars.c, [23.8, 24]); assert.deepEqual(det.bars.v, [5000, 10000]);
  assert.equal(det.view.levels.invalid.price, 22); assert.equal(det.view.levels.pullback.price, 23.5);
  assert.equal(det.view.advice.detail, '收盤跌破 22.00 元出場。');
  near(det.nav.c[1] / det.nav.nav[1], 120 / 120.2, 1e-4);   // 折溢價不變
  assert.equal(det.sx, 20261117);
});

t('到價提醒：分割前設的換算、分割後設的不動、換過的不再換', () => {
  const sp = [[20261117, 5]];
  const before = { id: 'a', c: '00662', op: 'le', px: 100, at: '2026-11-05T02:00:00.000Z', hit: null };
  const b = C.alertSplit(before, sp, 20261117, 24);
  assert.equal(b.px, 20); assert.equal(b.was, 100); assert.equal(b.sk, 5); assert.equal(b.sx, 20261117);
  assert.equal(C.alertSplit(b, sp, 20261117, 24), null);
  assert.equal(C.alertSplit(before, sp, 20261116, 120), null);       // 還沒恢復交易：先不換
  // 11/17 早上 01:00（UTC 11/16 17:00）在台灣已經是 11/17：分割後設的，不換
  const after = { id: 'b', c: '00662', op: 'ge', px: 26, at: '2026-11-16T17:00:00.000Z' };
  const a2 = C.alertSplit(after, sp, 20261117, 24);
  assert.equal(a2.px, 26); assert.equal(a2.was, undefined); assert.equal(a2.sx, 20261117);
  // 舊備份沒有設定時間：價位接近分割前的才換
  assert.equal(C.alertSplit({ c: '00662', op: 'le', px: 110 }, sp, 20261117, 24).px, 22);
  assert.equal(C.alertSplit({ c: '00662', op: 'ge', px: 26 }, sp, 20261117, 24).was, undefined);
});

t('已公告的停止交易：那幾天定期定額不扣、不留錢、不記', () => {
  assert.ok(C.haltOn('00662', 20261111));
  assert.ok(C.haltOn('00662', 20261116));
  assert.equal(C.haltOn('00662', 20261117), null);
  assert.equal(C.haltOn('0050', 20261112), null);
  assert.ok(C.haltNear('00662', 20261105));
  assert.equal(C.haltNear('00662', 20261101), null);
  assert.equal(C.haltNear('00662', 20261120), null);
  // 每月 12 號扣 00662、6 號扣 0050：11/12 那一期不用留錢
  const plans = [C.normPlan({ c: '00662', days: [12], amt: 3000, start: 20260101 }, 20261105), C.normPlan({ c: '0050', days: [12], amt: 5000, start: 20260101 }, 20261105)];
  const r = C.dcaReserve(plans, [], 20261105, { months: 1 });
  assert.deepEqual(r.items.map((x) => `${x.c}|${x.s}`), ['0050|20261112']);
  // 自動入帳：那幾天直接當作國泰沒扣（不用等之後的資料）
  assert.deepEqual(C.dcaPrice({ h: { d: [20261110], p: [120], splits: [] }, row: { d: 20261110, p: 120 }, cal: [20261110, 20261111], c: '00662' }, 20261111), { st: 'none', why: 'halt' });
  assert.deepEqual(C.dcaPrice({ h: { d: [20261110], p: [120], splits: [] }, row: { d: 20261110, p: 120 }, cal: [20261110, 20261111], c: '0050' }, 20261111), { st: 'wait' });
});

t('持股換算：盤中認出的分割加進去之後，股數 ×5、成本 ÷5、總成本不變', () => {
  const lots = [{ id: 'x', c: '00662', side: 'buy', d: 20261001, sh: 100, px: 118, fee: 20, tax: 0 }];
  const h0 = PF.holdingFromLots(lots, []);
  const h1 = PF.holdingFromLots(lots, C.mergeSplit([], 20261117, 5));
  assert.equal(h1.sh, h0.sh * 5); near(h1.avg, h0.avg / 5, 1e-6); near(h1.cost, h0.cost, 1e-6);
});

console.log(`\n${n} 項全部通過`);
