// 歷史風暴重演的測試：node tests/storm_test.mjs [hist 資料夾]
// 起點＝基準在期間內最大跌幅開始的那天、部位＝現金＋每一檔 w × 含息報酬、沒資料用同類代替、連代替都沒有就不算進去（照比例放大）、
// 谷底與回到原點、拖累加起來＝部位的跌幅。給 hist 資料夾會用真實資料把四場風暴算一遍（數字不能是 NaN、跌幅要在合理範圍）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const C = await import('../site/calc.js');

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('✓', name); };
// 人工資料：20 個交易日，基準 100 → 跌到 70（第 8 天）→ 回到 105（第 18 天）
const D = Array.from({ length: 20 }, (_, i) => 20200101 + i);
const mk = (vals) => ({ d: D.slice(D.length - vals.length), p: vals, splits: [], divs: [] });
const bench = mk([100, 101, 102, 95, 90, 85, 80, 75, 70, 72, 76, 80, 85, 90, 95, 98, 99, 101, 105, 106]);
const half = mk([50, 50.5, 51, 49, 47, 45, 44, 43, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53]);
const late = mk([20, 20, 19, 18, 17, 16, 15, 14, 15, 16, 17, 18]);   // 第 8 天才開始有資料（太晚）
const sc = { from: 20200101, to: 20200110 };

ok('起點是期間內最大跌幅開始的那天（高點），谷底是基準的低點', () => {
  const r = C.stormRun(sc, bench, [{ code: 'A', name: 'A', k: 'broad', w: 1 }], 0, { A: bench });
  assert.equal(r.peakD, 20200103);
  assert.equal(r.lowD, 20200109);
  assert.ok(Math.abs(r.drop - (70 / 102 - 1)) < 1e-9);
  assert.equal(r.lowAt, 20200109);
});
ok('回到原點：谷底之後第一次回到起點的水準', () => {
  const r = C.stormRun(sc, bench, [{ code: 'A', name: 'A', k: 'broad', w: 1 }], 0, { A: bench });
  assert.equal(r.back, 20200119);   // 105 ≥ 102
  assert.equal(r.backN, 10);
});
ok('現金不跌：一半現金時跌幅減半', () => {
  const r = C.stormRun(sc, bench, [{ code: 'A', name: 'A', k: 'broad', w: 0.5 }], 0.5, { A: bench });
  assert.ok(Math.abs(r.drop - (70 / 102 - 1) / 2) < 1e-9);
  assert.ok(Math.abs(r.cashW - 0.5) < 1e-9);
});
ok('拖累加起來＝部位的跌幅', () => {
  const r = C.stormRun(sc, bench, [{ code: 'A', name: 'A', k: 'broad', w: 0.6 }, { code: 'B', name: 'B', k: 'div', w: 0.3 }], 0.1, { A: bench, B: half });
  const sum = r.items.reduce((a, x) => a + x.contrib, 0);
  assert.ok(Math.abs(sum - r.drop) < 1e-9, `${sum} vs ${r.drop}`);
  assert.equal(r.items[0].code, 'A');   // 拖最多的排第一
});
ok('太晚上市：用同類代替，畫面看得到是代替的', () => {
  const r = C.stormRun(sc, bench, [{ code: 'NEW', name: '新', k: 'div', w: 1 }], 0, { NEW: late, '0056': half });
  assert.equal(r.items[0].proxy, true);
  assert.equal(r.items[0].src, '0056');
  assert.equal(r.skipped.length, 0);
});
ok('連代替的都沒有：不算進去、其他照比例放大、coverage 寫出來', () => {
  const r = C.stormRun(sc, bench, [{ code: 'A', name: 'A', k: 'broad', w: 0.5 }, { code: 'F', name: '期貨', k: 'fut', w: 0.5 }], 0, { A: bench });
  assert.equal(r.skipped.length, 1);
  assert.ok(Math.abs(r.coverage - 0.5) < 1e-9);
  assert.ok(Math.abs(r.drop - (70 / 102 - 1)) < 1e-9);
});
ok('主動式債券（尾碼 D）用債券代替，其他主動式用 0050', () => {
  assert.equal(C.stormProxyOf('00980D', 'active'), '00679B');
  assert.equal(C.stormProxyOf('00981A', 'active'), '0050');
  assert.equal(C.stormProxyOf('00900', 'fut'), null);
});
ok('沒有下跌（一路漲）或基準沒資料：null', () => {
  assert.equal(C.stormRun(sc, mk(D.map((_, i) => 100 + i)), [{ code: 'A', w: 1 }], 0, {}), null);
  assert.equal(C.stormRun(sc, null, [], 0, {}), null);
});
ok('一直沒回來：back 是 null', () => {
  const down = mk([100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 85, 84, 83, 82, 81]);
  const r = C.stormRun({ from: 20200101, to: 20200120 }, down, [{ code: 'A', name: 'A', k: 'broad', w: 1 }], 0, { A: down });
  assert.equal(r.back, null);
  assert.equal(r.backN, null);
});

const dir = process.argv[2];
if (dir) {
  const H = {};
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) H[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const holds = [{ code: '0050', name: '0050', k: 'broad', w: 0.4 }, { code: '00878', name: '00878', k: 'div', w: 0.2 }, { code: '00919', name: '00919', k: 'div', w: 0.15 }, { code: '00679B', name: '00679B', k: 'bond', w: 0.1 }, { code: '00646', name: '00646', k: 'overseas', w: 0.05 }];
  for (const s of [{ id: 'covid', from: 20200102, to: 20200731 }, { id: '2022', from: 20220103, to: 20230630 }, { id: '0805', from: 20240701, to: 20240930 }, { id: 'tariff', from: 20250303, to: 20250630 }]) {
    ok(`真實資料：${s.id}`, () => {
      const r = C.stormRun(s, H['0050'], holds, 0.1, H);
      assert.ok(r && r.port, 'no result');
      assert.ok(r.port.every((v) => Number.isFinite(v)) && r.bench.every((v) => Number.isFinite(v)));
      assert.ok(r.drop < 0 && r.drop > -0.6, `drop ${r.drop}`);
      assert.ok(r.bDrop < 0 && r.bDrop > -0.6);
      const sum = r.items.reduce((a, x) => a + x.contrib, 0);
      assert.ok(Math.abs(sum - r.drop) < 1e-9);
      console.log(`   ${s.id}: ${r.peakD}→${r.lowD} 部位 ${(r.drop * 100).toFixed(1)}%（${r.back || '未回'}）0050 ${(r.bDrop * 100).toFixed(1)}%（${r.bBack || '未回'}）`);
    });
  }
}
console.log(`全部通過（${n} 項）`);
