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

// ---------------------------------------------------------------- 加碼計畫（allocAdds）：可動用的錢、同類型、單一公司、溢價
const mkRow = (c, k, o = {}) => ({ c, n: c, k, st: 1, sc: 1.2, cf: 80, ps: 'add', dl: 90, iv: 92, atr: 1.5, pb: 98, fl: [], ...o });
const H0 = (row, px = 100, sh = 0, prem = 0) => ({ row, sh, avg: sh ? px : null, cost: sh * px, px, prem });
const base0 = (o = {}) => ({ T: 1000000, cash: 300000, cashAll: 300000, profile: 'mid', fee: cfg, today: 20261030, catMV: {}, coAmt: {}, lists: {}, ...o });

t('加碼計畫：可動用的錢分給候選，排在前面的先拿；總共不會超過可動用的錢', () => {
  const A = mkRow('A', 'broad', { cf: 90 }), B = mkRow('B', 'div', { cf: 75 }), C = mkRow('C', 'theme', { ps: 'hold', st: 0, cf: null });
  const R = pf.allocAdds([{ code: 'C', H: H0(C) }, { code: 'B', H: H0(B) }, { code: 'A', H: H0(A) }], base0({ cash: 90000, cashAll: 90000 }));
  assert.deepEqual(R.order, ['A', 'B', 'C']);          // 可加碼（信心高的先）→ 續抱
  const spend = [...R.adv.values()].reduce((t, a) => t + (a.plan ? a.plan.spend : 0), 0);
  assert.ok(spend <= 90000 + 1, spend);
  assert.ok(R.adv.get('A').plan.n > 0 && R.adv.get('A').plan.limit === 'cash', R.adv.get('A').plan.limit);
});

t('加碼計畫：同類型合計到上限，第二檔就不加（不會兩檔各算一次）', () => {
  // 穩健型市值型上限 60%：已經有 55%（其他市值型），剩 5 萬的空間給 A、B 兩檔市值型
  const A = mkRow('A', 'broad', { cf: 90 }), B = mkRow('B', 'broad', { cf: 80 });
  const R = pf.allocAdds([{ code: 'A', H: H0(A) }, { code: 'B', H: H0(B) }], base0({ catMV: { broad: 550000 } }));
  const a = R.adv.get('A'), b = R.adv.get('B');
  assert.equal(a.plan.limit, 'cat');
  assert.ok(a.plan.n * 100 <= 50000 && a.plan.n * 100 > 45000, a.plan.n);
  assert.equal(b.plan.n, 0);
  assert.equal(b.key, 'full');
  assert.equal(b.label, '先不買');
  assert.ok(b.lines.some((l) => l.text.includes('市值型合計已經到上限 60%')), b.lines.map((l) => l.text));
});

t('加碼計畫：透過 ETF 間接持有的同一家公司到上限（穿透），含它的 ETF 就少買或不買', () => {
  const A = mkRow('A', 'broad', { cf: 90 }), B = mkRow('B', 'theme', { cf: 85 });
  const lists = { A: { h: [['2330', '台積電', 'tse', 50], ['2317', '鴻海', 'tse', 5]] }, B: { h: [['2330', '台積電', 'tse', 25], ['xx', '公債', 'b', 60]] } };
  // 穩健型單一公司上限 30%：已經間接持有台積電 28 萬（28%），剩 2 萬；A 有一半是台積電 → 最多買 4 萬
  const R = pf.allocAdds([{ code: 'A', H: H0(A) }, { code: 'B', H: H0(B) }], base0({ lists, coAmt: { 2330: { name: '台積電', amt: 280000 } } }));
  const a = R.adv.get('A'), b = R.adv.get('B');
  assert.equal(a.plan.limit, 'co');
  assert.equal(a.plan.coName, '台積電');
  assert.ok(a.plan.n * 100 <= 40000 && a.plan.n * 100 >= 39000, a.plan.n);
  assert.equal(b.plan.n, 0);                         // A 用掉了台積電剩下的空間
  assert.equal(b.key, 'full');
  assert.ok(pf.planWhy(b.plan).includes('台積電'), pf.planWhy(b.plan));
  // 明細還沒載入：不擋（照樣算），但記下來
  const R2 = pf.allocAdds([{ code: 'A', H: H0(A) }], base0({ lists: { A: undefined }, coAmt: { 2330: { name: '台積電', amt: 300000 } } }));
  assert.ok(R2.adv.get('A').plan.n > 0);
  assert.equal(R2.adv.get('A').plan.coNote, 'pending');
});

t('加碼計畫：盤中溢價超過警戒線減半、超過 2 倍先不買', () => {
  const A = mkRow('A', 'broad', { cf: 90 });
  const n0 = pf.allocAdds([{ code: 'A', H: H0(A, 100, 0, 0.1) }], base0()).adv.get('A').plan.n;
  const half = pf.allocAdds([{ code: 'A', H: H0(A, 100, 0, 0.7) }], base0()).adv.get('A');
  assert.ok(half.plan.n > 0 && Math.abs(half.plan.n - Math.floor(n0 / 2)) <= 1, `${half.plan.n} vs ${n0}`);
  assert.equal(half.label, '可小額分批買進');
  const zero = pf.allocAdds([{ code: 'A', H: H0(A, 100, 0, 1.2) }], base0()).adv.get('A');
  assert.equal(zero.plan.n, 0);
  assert.equal(zero.key, 'hold_off');
  assert.ok(zero.lines.some((l) => l.text.includes('先不買')));
});

t('加碼計畫：沒有可動用的錢時說清楚是緊急預備金、定期定額扣掉的', () => {
  const A = mkRow('A', 'broad', { cf: 90 });
  const a = pf.allocAdds([{ code: 'A', H: H0(A) }], base0({ cash: 0, cashAll: 50000 })).adv.get('A');
  assert.equal(a.plan.n, 0);
  assert.equal(a.key, 'add');                        // 訊號照樣可加碼，只是沒有錢
  assert.ok(pf.planWhy(a.plan).includes('緊急預備金'), pf.planWhy(a.plan));
  const b = pf.allocAdds([{ code: 'A', H: H0(A) }], base0({ cash: 0, cashAll: 0 })).adv.get('A');
  assert.ok(pf.planWhy(b.plan).includes('還沒設定可投入現金'));
});

t('加碼計畫：照順序分（可加碼的先），觀點中性的關注 ETF 不會把可加碼的那幾檔稀釋掉', () => {
  // 可動用 30 萬：2 檔可加碼＋6 檔觀點中性（續抱）。可加碼的各拿一份（10 萬），中性的拿剩下的（每檔最多半份）
  const adds = ['A1', 'A2'].map((c, i) => mkRow(c, ['broad', 'div'][i], { cf: 90 - i }));
  const neu = ['N1', 'N2', 'N3', 'N4', 'N5', 'N6'].map((c) => mkRow(c, 'theme', { ps: 'hold', st: 0, cf: null, sc: 0.1 }));
  const cands = [...neu, ...adds].map((r) => ({ code: r.c, H: H0(r) }));
  const R = pf.allocAdds(cands, base0({ T: 10000000 }));
  assert.deepEqual(R.order.slice(0, 2), ['A1', 'A2']);
  for (const c of ['A1', 'A2']) {
    const p = R.adv.get(c).plan;
    assert.ok(p.spend > 99000 && p.spend <= 100000 + 1e-6, `${c} ${p.spend}`);   // 一份 10 萬，不會因為中性的那 6 檔被稀釋
    assert.equal(p.limit, 'cash');
    assert.equal(pf.planShort(p), false);
  }
  const spend = [...R.adv.values()].reduce((t, a) => t + (a.plan && a.plan.n > 0 ? a.plan.spend : 0), 0);
  assert.ok(spend <= 300000 + 1e-6 && spend > 290000, spend);           // 分完：剩下的給中性的，不會留一大塊沒用
  const neuP = neu.map((r) => R.adv.get(r.c).plan);
  assert.ok(neuP[0].n > 0 && neuP[0].spend <= 50000 + 1e-6, neuP[0].spend);    // 中性的：半份
  const last = neuP[neuP.length - 1];
  assert.equal(last.n, 0);                                                  // 錢分完了：排在最後的沒有
  assert.ok(pf.planWhy(last).includes('排在前面'), pf.planWhy(last));
  assert.ok(R.left >= 0 && R.left < 10000, R.left);
});

t('加碼計畫：三批各自的最低手續費算進去，總花費不會超過分到的錢', () => {
  // 一份 60,100 元、每股 20 元、2.8 折：不算最低收費會買 3,003 股（三批各 1,001 股＝1 張＋1 股零股，各收 20＋1 元）
  const A = mkRow('A', 'broad', { cf: 90, dl: 18, iv: 18.5, atr: 0.3, pb: 19.5 });
  const fee = { disc: 0.28, min: 20, minOdd: 1 };
  const R = pf.allocAdds([{ code: 'A', H: H0(A, 20) }], base0({ T: 10000000, cash: 180300, cashAll: 180300, fee }));
  const p = R.adv.get('A').plan;
  assert.ok(p.n > 0);
  assert.ok(p.spend <= 60100 + 1e-6, `${p.n} 股、花 ${p.spend}`);
  assert.equal(p.limit, 'cash');
});

t('加碼計畫：可動用的錢很少時，照順序買得起的先買；後面的原因寫「分給排在前面的」，一份不夠買 1 股另外寫', () => {
  // 可動用 450 元、4 檔可加碼、每股 120 元：一份 150 元，前 3 檔各 1 股，第 4 檔沒有
  const rows = ['A', 'B', 'C', 'D'].map((c, i) => mkRow(c, ['broad', 'div', 'theme', 'overseas'][i], { cf: 90 - i, dl: 100, iv: 110, atr: 2, pb: 118 }));
  const R = pf.allocAdds(rows.map((r) => ({ code: r.c, H: H0(r, 120) })), base0({ T: 1000000, cash: 450, cashAll: 450 }));
  const ns = rows.map((r) => R.adv.get(r.c).plan.n);
  assert.deepEqual(ns, [1, 1, 1, 0]);
  assert.ok(pf.planWhy(R.adv.get('D').plan).includes('排在前面'), pf.planWhy(R.adv.get('D').plan));
  // 可動用 300 元：一份 100 元，一股都買不起
  const R2 = pf.allocAdds(rows.map((r) => ({ code: r.c, H: H0(r, 120) })), base0({ T: 1000000, cash: 300, cashAll: 300 }));
  assert.ok(rows.every((r) => R2.adv.get(r.c).plan.n === 0));
  assert.ok(pf.planWhy(R2.adv.get('A').plan).includes('一份不夠買 1 股'), pf.planWhy(R2.adv.get('A').plan));
});

t('加碼計畫：沒有分到的原因不會空白（到比重上限、資料不足），而且不寫金額', () => {
  const full = { key: 'full', label: '續抱', lines: [{ kind: 'pro', text: '占總資產 60.0%，上限 60%（穩健型、市值型）。' }, { kind: 'info', text: '比重已經到你設定的上限，續抱、不再加碼。' }], plan: null };
  assert.ok(pf.noPlanWhy(full, { k: 'broad' }).includes('上限'));
  const none = { key: 'none', lines: [], plan: null };
  assert.ok(pf.noPlanWhy(none, { young: 30 }).includes('30 個交易日'));
  const off = { key: 'hold_off', lines: [{ kind: 'con', text: '規則觀點偏空（分數 -0.80）。' }], plan: null };
  assert.equal(pf.noPlanWhy(off, {}), '規則觀點偏空（分數 -0.80）');
  // 你持有的 ETF 還沒拿到成分股明細：計畫照樣算，但記下來（畫面會提醒）
  const A = mkRow('A', 'broad', { cf: 90 });
  const p = pf.allocAdds([{ code: 'A', H: H0(A) }], base0({ coPending: ['X', 'A'] })).adv.get('A').plan;
  assert.deepEqual(p.coPend, ['X']);
});

t('加碼試算：同類型合計、單一公司、可動用的錢都檢查', () => {
  const A = mkRow('A', 'broad');
  const lists = { A: { h: [['2330', '台積電', 'tse', 50]] } };
  const ctx = { ...base0({ cash: 30000, cashAll: 80000, catMV: { broad: 580000 }, lists, coAmt: { 2330: { name: '台積電', amt: 290000 } } }),
    reserve: { cash: 80000, emergency: 50000, dca: { total: 0, items: [] }, usable: 30000 } };
  const sim = pf.simulateAdd(H0(A), 400, 100, ctx);
  const txt = sim.checks.map((c) => `${c.ok}:${c.text}`);
  assert.ok(txt.some((x) => x.startsWith('false:買進後市值型合計')), txt);
  assert.ok(txt.some((x) => x.startsWith('false:買進後透過 ETF 間接持有的台積電')), txt);
  assert.ok(txt.some((x) => x.startsWith('false:需要') && x.includes('緊急預備金')), txt);
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
