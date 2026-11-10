// 盤勢脈動的測試：node tests/pulse_test.mjs [data 資料夾]
// 今日戰報（每一檔加起來＝今日損益、沒成交的算 0、今天出清的也列、和 0050 同一天才比）、資金輪動（照前 20 日成交值加權、
// 只算今天有成交的、5／20 日用還原價）、同類排行（同值同名次、少於 3 檔不排）、盤中走勢小圖（日期要對、分鐘在 09:00～13:30）。
// 畫面：不出現 undefined／NaN、隱藏金額時沒有金額、名詞都在小辭典。給 data 資料夾（summary.json、spark.json）會用真實資料算一遍。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

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
const P_ = await import('../site/pulse.js');
const { TERMS } = await import('../site/learn.js');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
const bad = (s) => /undefined|NaN|\[object|Infinity/.test(String(s));

// ------------------------------------------------------------------ 今日戰報
const rowsPF = new Map([['A', { c: 'A', k: 'broad', n: 'A 市值' }], ['B', { c: 'B', k: 'div', n: 'B 高息' }], ['C', { c: 'C', k: 'bond', n: 'C 債' }], ['D', { c: 'D', k: 'theme', n: 'D 主題' }]]);
const lotsPF = [
  { id: '1', c: 'A', side: 'buy', d: 20260101, sh: 1000, px: 10, fee: 20 },
  { id: '2', c: 'B', side: 'buy', d: 20260101, sh: 1000, px: 20, fee: 20 },
  { id: '3', c: 'B', side: 'buy', d: 20261027, sh: 100, px: 19.5, fee: 20 },   // B 今天還沒成交、今天又買了 100 股
  { id: '4', c: 'C', side: 'buy', d: 20260101, sh: 2000, px: 30, fee: 20 },    // C 今天還沒成交
  { id: '5', c: 'D', side: 'buy', d: 20260101, sh: 500, px: 40, fee: 20 },
  { id: '6', c: 'D', side: 'sell', d: 20261027, sh: 500, px: 41, fee: 20, tax: 20 },   // D 今天全部賣掉
];
const qsPF = {
  A: { px: 11, ch: 0.5, pc: 4.76, date: 20261027 }, B: { px: 19, ch: -1, pc: -5, date: 20261026 },
  C: { px: 31, ch: 0.2, pc: 0.65, date: 20261026 }, D: { px: 40.5, ch: 0.5, pc: 1.25, date: 20261027 },
};
const P = pf.buildPortfolio({ cash: 0, lots: lotsPF }, rowsPF, (r) => qsPF[r.c], {}, pf.DEFAULT_FEE, 20261027);

t('今日戰報：每一檔加起來＝今日損益（含今天出清的）', () => {
  const R = C.dayReport(P, { pc: 1.1, date: 20261027 }, lotsPF);
  assert.equal(R.date, 20261027);
  near(R.total, P.totals.day);
  near(R.items.reduce((a, x) => a + x.day, 0), P.totals.day);
  near(R.total, 500 - 50 + 0 + 500);
  assert.deepEqual(R.items.map((x) => x.code), ['A', 'D', 'B', 'C']);   // 金額大的在前，同金額照代號
});
t('今日戰報：今天還沒成交的算 0；今天有買賣的只算買賣的價差；出清的標出來', () => {
  const R = C.dayReport(P, null, lotsPF);
  const by = Object.fromEntries(R.items.map((x) => [x.code, x]));
  near(by.A.day, 500); assert.equal(by.A.stale, false); assert.equal(by.A.traded, false); assert.equal(by.A.pc, 4.76);
  near(by.B.day, (19 - 19.5) * 100); assert.equal(by.B.stale, true); assert.equal(by.B.traded, true); assert.equal(by.B.pc, null);
  assert.equal(by.C.day, 0); assert.equal(by.C.stale, true); assert.equal(by.C.traded, false);
  near(by.D.day, 500); assert.equal(by.D.held, false); assert.equal(by.D.traded, true);
  assert.equal(R.up, 2); assert.equal(R.down, 1); assert.equal(R.flat, 0); assert.equal(R.wait, 1);   // C 還沒成交：不算「平」
});
t('今日戰報：0050 同一天才比，日期不同不比', () => {
  assert.deepEqual(C.dayReport(P, { pc: 1.1, date: 20261027 }, lotsPF).bench, { pc: 1.1 });
  assert.equal(C.dayReport(P, { pc: 1.1, date: 20261026 }, lotsPF).bench, null);
  assert.equal(C.dayReport(P, null, lotsPF).bench, null);
  assert.equal(C.dayReport(null), null);
});
t('今日戰報：停止交易中的那一檔照實寫（00662 分割停止交易）', () => {
  const rows = new Map([['00662', { c: '00662', k: 'overseas', n: '富邦NASDAQ' }], ['A', { c: 'A', k: 'broad', n: 'A' }]]);
  const lots = [{ id: '1', c: '00662', side: 'buy', d: 20260601, sh: 300, px: 98.5, fee: 42 }, { id: '2', c: 'A', side: 'buy', d: 20260101, sh: 1000, px: 10, fee: 20 }];
  const qs = { '00662': { px: 117.8, ch: 3.4, pc: 2.97, date: 20261110 }, A: { px: 11, ch: 0.5, pc: 4.76, date: 20261111 } };
  const P2 = pf.buildPortfolio({ cash: 0, lots }, rows, (r) => qs[r.c], {}, pf.DEFAULT_FEE, 20261111);
  const R = C.dayReport(P2, null, lots);
  const x = R.items.find((y) => y.code === '00662');
  assert.equal(x.day, 0); assert.equal(x.stale, true); assert.equal(R.wait, 1); assert.equal(R.flat, 0);
  assert.ok(C.haltOn('00662', 20261111) && C.haltOn('0053', 20261202) && !C.haltOn('0053', 20261208));
});
t('今日戰報：今天出清、但那一檔今天還沒成交：漲跌不是今天的，不寫百分比', () => {
  const rows = new Map([['Z', { c: 'Z', k: 'theme', n: 'Z' }], ['A', { c: 'A', k: 'broad', n: 'A' }]]);
  const lots = [{ id: '1', c: 'Z', side: 'buy', d: 20260101, sh: 1000, px: 10, fee: 0 }, { id: '2', c: 'Z', side: 'sell', d: 20261111, sh: 1000, px: 11.2, fee: 0, tax: 0 },
    { id: '3', c: 'A', side: 'buy', d: 20260101, sh: 1000, px: 10, fee: 0 }];
  const qs = { Z: { px: 11, ch: 0.26, pc: 2.46, date: 20261110 }, A: { px: 11, ch: 0.5, pc: 4.76, date: 20261111 } };
  const P2 = pf.buildPortfolio({ cash: 0, lots }, rows, (r) => qs[r.c], {}, pf.DEFAULT_FEE, 20261111);
  const R = C.dayReport(P2, null, lots);
  const z = R.items.find((x) => x.code === 'Z');
  assert.equal(z.held, false); assert.equal(z.stale, true); assert.equal(z.pc, null);
  near(z.day, (11.2 - 11) * 1000);   // 只算今天賣出的價差
  near(R.total, P2.totals.day);
});
t('今日戰報：很久以前出清的不列進來', () => {
  const lots = [...lotsPF, { id: '7', c: 'A', side: 'buy', d: 20250101, sh: 0, px: 1, fee: 0 }];
  const rows = new Map([...rowsPF, ['E', { c: 'E', k: 'bond', n: 'E' }]]);
  const lots2 = [...lots, { id: '8', c: 'E', side: 'buy', d: 20250101, sh: 100, px: 10, fee: 1 }, { id: '9', c: 'E', side: 'sell', d: 20250601, sh: 100, px: 11, fee: 1, tax: 1 }];
  const P2 = pf.buildPortfolio({ cash: 0, lots: lots2 }, rows, (r) => qsPF[r.c] || { px: 12, ch: 0.3, pc: 2.5, date: 20261027 }, {}, pf.DEFAULT_FEE, 20261027);
  const R = C.dayReport(P2, null, lots2);
  assert.ok(!R.items.some((x) => x.code === 'E'));
  near(R.total, P2.totals.day);
});

// ------------------------------------------------------------------ 資金輪動
const sp = (a, b) => Array.from({ length: 40 }, (_, i) => a + (b - a) * (i / 39));   // 40 天，從 a 線性到 b
const rowsR = [
  { c: 'A', k: 'broad', d: 20261027, val: 150, v20: 100, sp: sp(90, 100) },
  { c: 'B', k: 'broad', d: 20261027, val: 300, v20: 300, sp: sp(100, 100) },
  { c: 'S', k: 'broad', d: 20261026, val: 80, v20: 900, sp: sp(50, 10) },      // 今天還沒成交：今天不算、5/20 日也不算（資料不是最新一天）
  { c: 'X', k: 'bond', d: 20261027, val: 25, v20: 50, sp: sp(30, 29) },
  { c: 'Y', k: 'bond', d: 20261027, val: 60, v20: null, sp: [30, 31] },         // 沒有 v20：權重改用當天成交值、熱度不算它；sp 不夠長不算 5/20 日
  { c: 'Z', k: 'inv', d: 20261027, val: 0, v20: 0, sp: sp(10, 9) },            // 沒有權重：不算進平均
];
const qR = (r) => ({ A: { pc: 2, date: 20261027 }, B: { pc: -1, date: 20261027 }, S: { pc: 9, date: 20261026 }, X: { pc: 0.5, date: 20261027 }, Y: { pc: 0, date: 20261027 }, Z: { pc: -3, date: 20261027 } }[r.c]);
t('資金輪動：照前 20 日平均成交值加權，只算今天有成交的', () => {
  const R = C.rotation(rowsR, qR, 20261027);
  assert.equal(R.date, 20261027); assert.equal(R.asof, 20261027);
  const by = Object.fromEntries(R.cats.map((c) => [c.k, c]));
  near(by.broad.day, (2 * 100 + -1 * 300) / 400);
  assert.equal(by.broad.n, 3); assert.equal(by.broad.nDay, 2); assert.equal(by.broad.up, 1); assert.equal(by.broad.down, 1);
  near(by.bond.day, (0.5 * 50 + 0 * 60) / 110);
  assert.equal(by.bond.flat, 1);
  assert.equal(by.inv.day, null);   // 唯一一檔沒有權重
  assert.equal(by.inv.nDay, 1);
});
t('資金輪動：5／20 日用還原價、只算最新一天有資料的；熱度＝今天 ÷ 平常', () => {
  const R = C.rotation(rowsR, qR, 20261027);
  const by = Object.fromEntries(R.cats.map((c) => [c.k, c]));
  const ret = (a, k) => a[a.length - 1] / a[a.length - 1 - k] - 1;
  near(by.broad.r5, (ret(rowsR[0].sp, 5) * 100 + 0 * 300) / 400);
  near(by.broad.r20, (ret(rowsR[0].sp, 20) * 100) / 400);
  near(by.broad.heat, (150 + 300) / (100 + 300));
  near(by.bond.heat, 25 / 50);
  near(by.bond.r5, ret(rowsR[3].sp, 5));   // Y 的 sp 不夠長：只剩 X
});
t('資金輪動：照今天漲跌由高到低排，沒有的放最後', () => {
  const R = C.rotation(rowsR, qR, 20261027);
  assert.deepEqual(R.cats.map((c) => c.k), ['bond', 'broad', 'inv']);
  assert.deepEqual(C.rotation([], qR, 20261027), { date: null, asof: 20261027, cats: [] });
});

// ------------------------------------------------------------------ 同類排行
const rowsP = [
  { c: 'P1', k: 'theme', r1y: 0.5, y: 3 }, { c: 'P2', k: 'theme', r1y: 0.2, y: 5 }, { c: 'P3', k: 'theme', r1y: 0.2 },
  { c: 'P4', k: 'theme', r1y: null, y: 1 }, { c: 'Q1', k: 'bond', r1y: 0.9, y: 9 },
];
t('同類排行：同一類裡排第幾高，同值同名次；中位數；沒有數字的不排', () => {
  const R = C.peerRank(rowsP, 'P2');
  const r1y = R.find((m) => m.k === 'r1y');
  assert.equal(r1y.n, 3); assert.equal(r1y.rank, 2); near(r1y.med, 0.2); assert.deepEqual(r1y.vals, [0.5, 0.2, 0.2]);
  assert.equal(C.peerRank(rowsP, 'P3').find((m) => m.k === 'r1y').rank, 2);
  assert.equal(C.peerRank(rowsP, 'P1').find((m) => m.k === 'r1y').rank, 1);
  const y = R.find((m) => m.k === 'y');
  assert.equal(y.n, 3); assert.equal(y.rank, 1); near(y.med, 3);   // 別類（Q1）的 9 不算
  const p4 = C.peerRank(rowsP, 'P4').find((m) => m.k === 'r1y');
  assert.equal(p4.v, null); assert.equal(p4.rank, null);
  assert.equal(C.peerRank(rowsP, 'NONE'), null);
  assert.deepEqual(C.PEER_METRICS.map((m) => m.k), ['r1y', 'vol', 'mdd', 'y', 'aum', 'hd', 'v20', 'pr']);
});
t('同類排行：少於 3 檔有數字就不排名次，中位數照樣算', () => {
  const R = C.peerRank([{ c: 'a', k: 'x', hd: 10 }, { c: 'b', k: 'x', hd: 30 }], 'a');
  const hd = R.find((m) => m.k === 'hd');
  assert.equal(hd.rank, null); assert.equal(hd.n, 2); near(hd.med, 20);
});

// ------------------------------------------------------------------ 盤中走勢小圖
t('盤中走勢：日期要和報價同一天，分鐘在 09:00～13:30，少於 2 點不畫', () => {
  const s = { d: 20261110, at: 'x', s: { A: [0, 100, 5.5, 101, 270, 99, 400, 98], B: [3, 10], N: [1, null, 2, 5, 3, 6] } };
  assert.deepEqual(C.daySpark(s, 'A', 20261110), { d: 20261110, pts: [[0, 100], [5.5, 101], [270, 99]] });
  assert.equal(C.daySpark(s, 'A', 20261109), null);
  assert.equal(C.daySpark(s, 'B', 20261110), null);
  assert.deepEqual(C.daySpark(s, 'N', 20261110).pts, [[2, 5], [3, 6]]);
  assert.equal(C.daySpark(s, 'Q', 20261110), null);
  assert.equal(C.daySpark(null, 'A', 20261110), null);
  const svg = Core.daySparkSVG([[0, 100], [100, 101], [200, 99]], 100, 58, 26, 1, true);
  assert.ok(svg.includes('class="spark day live"') && svg.includes('stroke-dasharray') && !bad(svg));
  assert.equal(Core.daySparkSVG([[0, 100]], 100), '');
});

// ------------------------------------------------------------------ 畫面
Core.S.summary = { asof: 20261027, generated: 'x', etfs: [
  { c: '0050', n: '元大台灣50', k: 'broad', d: 20261027, p: 100, pc: 1.1, ch: 1.09, val: 1e10, v20: 9e9, sp: sp(90, 100), r1y: 0.6, vol: 0.3, mdd: 0.2, y: 1.6, aum: 2.5e12, hd: 3.8e6, pr: -0.03 },
  { c: '006208', n: '富邦台50', k: 'broad', d: 20261027, p: 200, pc: 1.2, ch: 2.37, val: 1e9, v20: 1.2e9, sp: sp(180, 200), r1y: 0.61, vol: 0.3, mdd: 0.21, y: 3.6, aum: 4.4e11, hd: 7.4e5, pr: 0.19 },
  { c: '00692', n: '富邦公司治理', k: 'broad', d: 20261027, p: 50, pc: 0.9, ch: 0.45, val: 1e8, v20: 2e8, sp: sp(45, 50), r1y: 0.5, vol: 0.28, mdd: 0.19, y: 2.5, aum: 3e10, hd: 1e5, pr: 0.1 },
  { c: '00679B', n: '元大美債20年', k: 'bond', d: 20261027, p: 26.8, pc: 0.15, ch: 0.04, val: 6e8, v20: 9e8, sp: sp(27, 26.8), r1y: 0.005, vol: 0.1, mdd: 0.11, y: 4.2, aum: 1.6e11, hd: 2.2e5, pr: -0.57 },
] };
Core.S.rows = new Map(Core.S.summary.etfs.map((r) => [r.c, r]));
Core.S.live = null;

t('畫面：今日戰報不出現 undefined／NaN，隱藏金額時沒有金額', () => {
  Core.settings.privacy = false;
  Core.book.lots = lotsPF;   // 畫面用的是這一本的交易紀錄（P 就是從它算的）
  const h = P_.dayReportHTML(P);
  assert.ok(h.includes('戰報') && h.includes('dr-row') && !bad(h), h.slice(0, 300));
  assert.ok(/(今天還沒成交|那天沒有成交)，只算/.test(h) && h.includes('出清'), '沒成交、出清的說明');
  assert.ok(h.includes('>+500<') && /\d 元/.test(h), '看得到金額（下面隱藏金額的檢查才有意義）');
  Core.settings.privacy = true;
  const hp = P_.dayReportHTML(P);
  assert.ok(!/[+−-]?\d{1,3}(,\d{3})*(\.\d+)? 元/.test(hp) && !hp.includes('>+500<') && !hp.includes('>+950<') && !hp.includes('data-v='), '隱藏金額時不能有金額（原始碼裡也不能有）');
  Core.settings.privacy = false;
  assert.equal(P_.dayReportHTML(null), '');
});
t('畫面：資金輪動、同類排行不出現 undefined／NaN', () => {
  const r = P_.rotationHTML();
  assert.ok(r.includes('資金輪動') && r.includes('data-cat="broad"') && r.includes('data-cat="bond"') && !bad(r), r.slice(0, 300));
  const p = P_.peerHTML(Core.S.rows.get('0050'));
  assert.ok(p.includes('同類排行') && p.includes('第 <b class="num">') && !bad(p), p.slice(0, 300));
  assert.equal(P_.peerHTML(Core.S.rows.get('00679B')), '');   // 同類不到 3 檔不顯示
});
t('名詞：今日戰報、資金輪動、同類排行與每一項比較都在小辭典', () => {
  for (const k of ['dayrep', 'rot', 'peer', 'r1y', 'vol', 'mdd', 'y', 'aum', 'hd', 'val', 'prem']) assert.ok(TERMS[k], k);
  for (const k of ['dayrep', 'rot', 'peer']) {
    let ex = '';
    assert.doesNotThrow(() => { ex = TERMS[k].ex ? TERMS[k].ex(Core.S.rows.get('0050')) : ''; }, k);
    assert.ok(!bad(ex), `${k}：${ex}`);
  }
});

// ------------------------------------------------------------------ 真實資料
const dir = process.argv[2];
if (dir && fs.existsSync(path.join(dir, 'summary.json'))) {
  const sum = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
  const q = (r) => ({ px: r.p, pc: r.pc, date: r.d });
  const R = C.rotation(sum.etfs, q, sum.asof);
  console.log(`\n真實資料 ${sum.asof}（${sum.etfs.length} 檔）資金輪動：`);
  for (const c of R.cats) {
    console.log(`  ${(Core.catName(c.k) || c.k).padEnd(6, '　')} 今天 ${c.day == null ? '—' : c.day.toFixed(2) + '%'}  5日 ${c.r5 == null ? '—' : (c.r5 * 100).toFixed(1) + '%'}  20日 ${c.r20 == null ? '—' : (c.r20 * 100).toFixed(1) + '%'}  熱度 ${c.heat == null ? '—' : c.heat.toFixed(2)}  ${c.nDay}/${c.n} 檔`);
    assert.ok(c.nDay <= c.n && c.up + c.down + c.flat === c.nDay);
    if (c.heat != null) assert.ok(c.heat > 0 && c.heat < 50, `${c.k} 熱度 ${c.heat}`);
  }
  let checked = 0;
  for (const r of sum.etfs) {
    const res = C.peerRank(sum.etfs, r.c);
    for (const m of res) {
      if (m.rank != null) assert.ok(m.rank >= 1 && m.rank <= m.n, `${r.c} ${m.k} 第 ${m.rank}／${m.n}`);
      if (m.med != null) assert.ok(m.med <= m.vals[0] + 1e-9 && m.med >= m.vals[m.vals.length - 1] - 1e-9);
      checked++;
    }
  }
  const has20 = sum.etfs.filter((r) => r.v20 != null).length;
  console.log(`同類排行：${sum.etfs.length} 檔 × ${C.PEER_METRICS.length} 項都檢查過（${checked}）；有 v20 的 ${has20} 檔`);
  const spf = path.join(dir, 'spark.json');
  if (fs.existsSync(spf)) {
    const s = JSON.parse(fs.readFileSync(spf, 'utf8'));
    const k = Object.keys(s.s || {}).filter((c) => C.daySpark(s, c, s.d)).length;
    console.log(`盤中走勢：spark.json ${s.d}（at ${s.at || '—'}）有 ${k} 檔畫得出來`);
  }
}
console.log(`\n${n} 個測試通過`);
