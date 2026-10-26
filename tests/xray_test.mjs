// ETF 透視與判斷教練的測試：node tests/xray_test.mjs [hist 資料夾] [data 資料夾]
// 透視：最完整的清單、這期和上期的差別、穿透持股（加總、來源、沒有資料的 ETF）、產業、重疊度、矩形樹圖。
// 教練：歷史分布（和任何一天並列）、級距、新聞的固定規則、六種情境都算得出來而且不會炸、隱藏金額時不出現金額。
// 給 hist 資料夾（data/hist）會用真實的 0050 跑大跌、漲多的統計；給 data 資料夾會用真實的 hold/、stocks.json 跑透視。
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

const X = await import('../site/xray.js');
const K = await import('../site/coach.js');
const { TERMS } = await import('../site/learn.js');
const { LESSONS } = await import('../site/lessons.js');
const { CASES } = await import('../site/cases.js');
const PF = await import('../site/pf.js');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
const bad = (s) => /undefined|NaN|\[object|null(?!\w)/.test(String(s));
const [histDir, dataDir] = process.argv.slice(2);

// ------------------------------------------------------------------ 透視
const H = (p, rows) => ({ p, h: rows });
const A = { c: 'A', m: H('202609', [['2330', '台積電', 'tse', 50], ['2454', '聯發科', 'tse', 10], ['2317', '鴻海', 'tse', 5]]),
  q: H('202609', [['2330', '台積電', 'tse', 50], ['2454', '聯發科', 'tse', 10], ['2317', '鴻海', 'tse', 5], ['2308', '台達電', 'tse', 3]]),
  pq: H('202606', [['2330', '台積電', 'tse', 48], ['2454', '聯發科', 'tse', 11], ['2412', '中華電', 'tse', 4]]) };
const B = { c: 'B', m: H('202609', [['2891', '中信金', 'tse', 10], ['2330', '台積電', 'tse', 8], ['US67066G1040', 'NVIDIA CORP', 'f', 2]]) };
const BOND = { c: 'BB', q: H('202609', [['US912810UK24', 'US TREASURY N/B 4.75% 05/15/2055', 'b', 5.28]]) };

t('最完整的清單：每季明細不比每月舊 2 個月以上就用每季，不然用每月', () => {
  assert.equal(X.bestList(A).k, 'q');
  assert.equal(X.bestList({ m: H('202612', []), q: H('202609', [['x', 'x', 'tse', 1]]) }).k, 'm');   // 舊 3 個月
  assert.equal(X.bestList({ m: H('202611', []), q: H('202609', [['x', 'x', 'tse', 1]]) }).k, 'q');   // 舊 2 個月
  assert.equal(X.bestList({ m: H('202609', [['x', 'x', 'tse', 1]]) }).k, 'm');
  assert.equal(X.bestList(null), null);
});
t('這期和上期比：新進、退出、比重變動（0.5 個百分點以上）', () => {
  const ch = X.changes(A.q, A.pq);
  assert.deepEqual(ch.added.map((r) => r[0]), ['2317', '2308']);
  assert.deepEqual(ch.removed.map((r) => r[0]), ['2412']);
  assert.deepEqual(ch.moved.map((x) => [x.r[0], x.d]), [['2330', 2], ['2454', -1]]);
  assert.equal(X.changes(A.q, null), null);
});
t('穿透持股：比重 × 成分比例加總；同一家公司跨 ETF 合併、記下來源；沒有資料的 ETF 列出來', () => {
  const lt = X.lookThrough([{ code: 'A', w: 0.4, slot: 0 }, { code: 'B', w: 0.2, slot: 1 }, { code: 'L', w: 0.1, slot: 2 }], { A, B, L: null });
  const tsmc = lt.items.find((x) => x.key === '2330');
  near(tsmc.w, 0.4 * 0.5 + 0.2 * 0.08);
  assert.deepEqual(tsmc.via.map((v) => v.code), ['A', 'B']);   // 大的在前
  assert.equal(lt.items[0].key, '2330');
  near(lt.cov, 0.4 * 0.68 + 0.2 * 0.2);
  near(lt.etfW, 0.7);
  assert.deepEqual(lt.missing, ['L']);
  near(lt.byKind.f, 0.2 * 0.02);
  const ind = X.byIndustry(lt.items, { s: { 2330: ['台積電', 'tse', '半導體業'], 2454: ['聯發科', 'tse', '半導體業'], 2891: ['中信金', 'tse', '金融保險業'] } });
  assert.equal(ind[0].k, '半導體業');
  near(ind[0].w, tsmc.w + 0.4 * 0.1);
  assert.ok(ind.some((g) => g.k === '國外股票'));
  assert.ok(ind.some((g) => g.k === '其他國內股票'));   // 2317、2308 沒有產業資料
});
t('重疊度：Σ 兩邊較小的比例；對稱、0～1；完全一樣＝涵蓋率', () => {
  const ab = X.overlap(X.bestList(A), X.bestList(B));
  const ba = X.overlap(X.bestList(B), X.bestList(A));
  near(ab.o, 0.08);
  near(ab.o, ba.o);
  assert.deepEqual(ab.shared.map((x) => x.key), ['2330']);
  const self = X.overlap(X.bestList(A), X.bestList(A));
  near(self.o, 0.68);
  assert.equal(X.overlap(null, X.bestList(A)), null);
  const lt = X.lookThrough([{ code: 'A', w: 0.5 }], { A });
  const mine = X.overlapWithMine(X.bestList(A), lt);
  near(mine.o, 0.68, 1e-9);   // 自己和自己：穿透後換成比例，重疊＝這檔公布的部分
  assert.equal(X.overlapWithMine(X.bestList(A), { items: [] }), null);
});
t('矩形樹圖：面積和比例一致、都在框內、不重疊', () => {
  const vals = [56.45, 6.74, 3.4, 2.86, 2.1, 1.9, 1.5, 1.2, 1.1, 1.0, 19.75];
  const W = 1000, Hh = 420;
  const R = X.treemap(vals, W, Hh);
  assert.equal(R.length, vals.length);
  const tot = vals.reduce((s, v) => s + v, 0);
  for (const r of R) {
    near(r.w * r.h, vals[r.i] / tot * W * Hh, 1e-6);
    assert.ok(r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= W + 1e-6 && r.y + r.h <= Hh + 1e-6);
  }
  for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
    const a = R[i], b = R[j];
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    assert.ok(!(ox > 1e-6 && oy > 1e-6), `重疊 ${i} ${j}`);
  }
  assert.deepEqual(X.treemap([], 10, 10), []);
});
t('穿透持股：這次抓不到（undefined）和確定沒有（null）分開，抓不到的不算成「沒有成分股」', () => {
  const lt = X.lookThrough([{ code: 'A', w: 0.4 }, { code: 'B', w: 0.2 }, { code: 'L', w: 0.1 }], { A, B: undefined, L: null });
  assert.deepEqual(lt.failed, ['B']);
  assert.deepEqual(lt.missing, ['L']);
  assert.equal(lt.items[0].key, '2330');
});
t('新聞標題提到的公司：只找你透過 ETF 間接持有的國內公司', () => {
  const lt = X.lookThrough([{ code: 'A', w: 0.4 }, { code: 'B', w: 0.2 }], { A, B });
  assert.deepEqual(X.namesIn('台積電法說會今日登場', lt).map((x) => x.key), ['2330']);
  assert.deepEqual(X.namesIn('NVIDIA CORP 財報', lt), []);   // 國外的英文名不比
  assert.deepEqual(X.namesIn('', lt), []);
});
t('設定頁說明照常數產生', () => {
  const h = X.xrayRulesHTML();
  assert.ok(h.includes(`${X.XR.oneCo * 100}%`) && h.includes(`${X.XR.overlapHi * 100}%`) && !bad(h));
});
t('成分股價格：盤中用即時行情、官方收盤出來就換官方的；還沒成交、整天沒成交、即時行情比較舊都照實處理', () => {
  const rec = ['台積電', 'tse', '半導體業', 2385, -1.45, 20261022, 27.65, 0.92, 9.61, 20261022, 54.65, 41.11, '202609'];
  const st = { s: { 2330: rec } };
  const ts = (d, hm) => Date.UTC(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100, Math.floor(hm / 100) - 8, hm % 100) / 1000;
  const q = (z, y, d, hm) => ({ q: { 2330: [z, y, null, null, null, 0, ts(d, hm), d] } });
  let p = X.stockPx('2330', st, q(2400, 2385, 20261027, 1031));
  assert.equal(p.kind, 'live'); near(p.px, 2400); near(p.pct, (2400 / 2385 - 1) * 100); assert.equal(p.d, 20261027);
  p = X.stockPx('2330', st, q(2400, 2385, 20261027, 1330));          // 13:30 那一筆：即時行情的收盤
  assert.equal(p.kind, 'close'); assert.equal(p.src, 'mis');
  const st2 = { s: { 2330: [...rec] } };
  st2.s['2330'][3] = 2405; st2.s['2330'][5] = 20261027;                 // 官方 10/27 收盤出來了
  p = X.stockPx('2330', st2, q(2400, 2385, 20261027, 1330));
  assert.equal(p.src, 'official'); near(p.px, 2405); assert.equal(p.d, 20261027);
  p = X.stockPx('2330', st, q(null, 2385, 20261027, 901));            // 今天還沒成交
  assert.equal(p.kind, 'ref'); assert.equal(p.px, null); near(p.ref, 2385);
  p = X.stockPx('2330', st, q(null, 2385, 20261027, 1330));           // 整天沒成交：用上一次的官方收盤（照實標日期）
  assert.equal(p.src, 'official'); assert.equal(p.d, 20261022);
  p = X.stockPx('2330', st, q(2300, 2290, 20261021, 1330));           // 即時行情比官方舊：官方
  assert.equal(p.src, 'official');
  assert.equal(X.stockPx('9999', st, null), null);
  assert.equal(X.stockPx('2330', null, null), null);
  // 舊格式的 stocks.json（每檔 10 欄、日期在整份上）讀進來會轉成新格式，價格和日期不會錯位
  const old = X.normStocks({ d: 20261022, d_otc: 20261021, rev: '202609', s: { 2330: ['台積電', 'tse', '半導體業', 2385, -1.45, 27.65, 0.92, 9.61, 54.65, 41.11], 5274: ['信驊', 'otc', '', null, null, null, null, null, null, null] } });
  assert.deepEqual(old.s['2330'], rec);
  assert.deepEqual(old.s['5274'], ['信驊', 'otc', '', null, null, null, null, null, null, null, null, null, null]);
  p = X.stockPx('2330', old, null);
  assert.equal(p.src, 'official'); assert.equal(p.d, 20261022); near(p.px, 2385);
});

// ------------------------------------------------------------------ 判斷教練：純計算
/** 合成的歷史：一天漲一點，偶爾大跌 */
function synth(n = 600, seed = 7) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const d = [], p = [];
  let px = 100, day = new Date(Date.UTC(2020, 0, 2));
  for (let i = 0; i < n; i++) {
    while ([0, 6].includes(day.getUTCDay())) day = new Date(day.getTime() + 864e5);
    d.push(day.getUTCFullYear() * 10000 + (day.getUTCMonth() + 1) * 100 + day.getUTCDate());
    const r = i % 50 === 25 ? -0.045 : i % 37 === 3 ? -0.025 : (rnd() - 0.45) * 0.02;
    px *= 1 + r;
    p.push(+px.toFixed(2));
    day = new Date(day.getTime() + 864e5);
  }
  return { c: 'T', d, p, divs: [], splits: [] };
}
t('歷史分布：只算有後面 20 天的日子，和「任何一天」並列；上漲比例、中位數、最差 10% 合理', () => {
  const h = synth();
  const T = h.p.map((x) => x / h.p[0]);
  const all = K.fwdDist(T, () => true);
  assert.equal(all.n, T.length - 1 - 20);
  assert.ok(all.p10 <= all.med && all.med <= all.p90);
  assert.ok(all.up >= 0 && all.up <= 1);
  const ds = K.dropStats(h, -4);
  assert.ok(ds && ds.hit.n >= 5 && ds.base.n === all.n);
  assert.ok(ds.days >= ds.hit.n && ds.perYear > 0);
  const gs = K.gainStats(h, 5);
  assert.ok(gs === null || (gs.hit.n > 0 && gs.base.n > 0));
  assert.equal(K.dropStats({ d: [1], p: [1] }, -2), null);
  near(K.retSince(h, h.d[0]), (h.p[h.p.length - 1] / h.p[0] - 1) * 100, 1e-6);
  near(K.ret20(h), (h.p[h.p.length - 1] / h.p[h.p.length - 21] - 1) * 100, 1e-6);
});
t('級距：跌 1.8% 用 2% 那組、跌 3.5% 用 3%、跌 5% 用 4%；漲 12% 用 10%', () => {
  assert.equal(K.dropBin(-1.8), -2);
  assert.equal(K.dropBin(-3.5), -3);
  assert.equal(K.dropBin(-5), -4);
  assert.equal(K.dropBin(null), -2);
  assert.equal(K.gainBin(12), 10);
  assert.equal(K.gainBin(3), 5);
  assert.equal(K.gainBin(20), 15);
});
t('新聞的固定規則：預測的字、事實的字、相關的類別', () => {
  const a = K.newsRead('台股27日有探底壓力　法人：半年線支撐受考驗');
  assert.ok(a.cats.includes('broad'));
  const b = K.newsRead('央行宣布維持利率不變');
  assert.ok(b.factual.includes('宣布') && b.cats.includes('bond'));
  const c = K.newsRead('外資預估AI伺服器需求恐放緩');
  assert.ok(c.forecast.includes('預估') && c.cats.includes('broad'));
  assert.deepEqual(K.newsRead('').cats, []);
});

// ------------------------------------------------------------------ 判斷教練：六種情境
const row = (c, n, k, extra = {}) => ({ c, n, k, m: 'tse', d: 20261022, p: 100, pc: -2.5, ch: -2.56, st: 0, ps: 'caution', dl: 103, rsi: 40, y: 3.2, yp: 0.3, aum: 5e10, hd: 120000, val: 3e9, since: 20200102, r1y: 0.12, vol: 0.18, mdd: 0.1, hot: false, fl: [], dv: null, ...extra });
const rows = new Map([
  ['0050', row('0050', '元大台灣50', 'broad')],
  ['00878', row('00878', '國泰永續高股息', 'div', { dv: { d: 20261117, cash: 0.42 }, ps: 'add', st: 1 })],
  ['00999', row('00999', '新ETF', 'div', { since: 20260801, st: null, ps: null, hot: true, rsi: 80 })],
]);
const quote = (r) => ({ px: r.p, ch: r.ch, pc: r.pc, prem: r.c === '00999' ? 1.6 : 0.1, live: false, date: r.d });
const held = (code, w, sh, pct) => { const r = rows.get(code); const q = quote(r); return { code, name: r.n, row: r, cat: r.k, q, px: q.px, h: { sh, avg: 110, cost: sh * 110 }, mv: sh * q.px, w, pct, pnl: sh * (q.px - 110), day: sh * q.ch, slot: 0 }; };
const P = { holdings: [held('0050', 0.5, 5000, -0.09), held('00878', 0.2, 2000, -0.09)], totals: { T: 1e6, cash: 3e5, day: -18000, dayPct: -0.018 } };
const baseCtx = (o = {}) => ({
  today: 20261026, mkt: { px: 45000, ch: -1200, pc: -2.6, when: '10/22 收盤', ma60: 46000, insti: { f: -8e10, t: 9e9, d: -2e10, date: 20261022 }, spark: [], live: false, d: 20261022 },
  P, rows, quote, news: [{ t: '金管會發布新規', url: 'https://www.fsc.gov.tw/x', src: 'fsc', kind: 'official', d: 20261022 }],
  privacy: false, risk: 'mid', fee: PF.DEFAULT_FEE, watch: ['0050', '00878'], adv: () => ({ plan: { n: 1500, stop: 95.5, parts: [] } }),
  h0050: synth(), ...o,
});
const SECRET = /\b(18,000|5,000|1,500)\b|1,000,000/;
t('六種情境：每一步都有標題、內容、燈號、怎麼看或陷阱；不會出現 undefined／NaN', () => {
  const cases = [
    ['crash', baseCtx()],
    ['rally', baseCtx({ row: rows.get('0050'), h: synth(), overlap: '前三大：台積電 56%' })],
    ['news', baseCtx({ item: { t: '央行宣布調升利率半碼', url: 'https://www.cbc.gov.tw/x', src: 'cbc', kind: 'official', d: 20261022 } })],
    ['news', baseCtx({ item: { ext: true } })],
    ['div', baseCtx({ row: rows.get('00878'), dv: { d: 20261117, cash: 0.42 }, h: { ...synth(), divs: [[20250117, 0.5], [20250418, 0.47]] } })],
    ['hot', baseCtx({ row: rows.get('00999'), holders: { prev: 30000, now: 120000, x: 4 }, overlap: '重疊 60%', overlapWarn: true })],
    ['loss', baseCtx({ held: P.holdings[0], h: synth(), firstBuy: 20240102 })],
  ];
  for (const [id, ctx] of cases) {
    const steps = K.buildPlay(id, ctx);
    assert.ok(steps.length >= 4, `${id} 步數 ${steps.length}`);
    for (const s of steps) {
      assert.ok(s.t && s.v && ['ok', 'info', 'warn', 'stop'].includes(s.lvl), `${id} ${s.t}`);
      assert.ok(s.how || s.trap, `${id} ${s.t} 沒有怎麼看／陷阱`);
      assert.ok(!bad(s.v) && !bad(s.t) && !bad(s.how) && !bad(s.trap), `${id} ${s.t}：${s.v}`);
      const L = s.links || {};
      if (L.lesson) assert.ok(LESSONS.some((x) => x.id === L.lesson), `${id} 課程 ${L.lesson}`);
      if (L.case) assert.ok(CASES.some((x) => x.id === L.case), `${id} 案例 ${L.case}`);
      if (L.term) assert.ok(TERMS[L.term], `${id} 名詞 ${L.term}`);
      for (const x of L.src || []) assert.ok(/^https:\/\//.test(x.u), `${id} 出處`);
    }
    const sm = K.summarize(steps);
    assert.equal(sm.ok + sm.info + sm.warn + sm.stop, sm.total);
  }
  // 熱門新 ETF：溢價、上市不到一年、受益人數變 4 倍、重疊 → 都要小心
  const hot = K.buildPlay('hot', cases[5][1]);
  assert.ok(hot.filter((s) => s.lvl === 'warn').length >= 3);
  // 新聞：別的地方看到的 → 第一步要小心
  assert.equal(K.buildPlay('news', cases[3][1])[0].lvl, 'warn');
});
t('部位在虧：台股股票型才拿 0050 比；債券 ETF 改說它跟著利率走', () => {
  const bond = row('00679B', '元大美債20年', 'bond', { ps: 'hold', st: 0, dl: 25 });
  rows.set('00679B', bond);
  const x = { code: '00679B', name: bond.n, row: bond, cat: 'bond', q: quote(bond), px: 100, h: { sh: 5000, avg: 110, cost: 550000 }, mv: 500000, w: 0.1, pct: -0.09, pnl: -50000, slot: 2 };
  const steps = K.buildPlay('loss', baseCtx({ held: x, h: synth(), firstBuy: 20240102 }));
  assert.ok(steps.some((s) => s.t === '它跟著什麼在跌' && s.v.includes('殖利率') && !s.v.includes('0050 <b')), steps.map((s) => s.t).join('|'));
  assert.ok(!steps.some((s) => s.t === '是大盤拖累，還是它自己'));
  const eq = K.buildPlay('loss', baseCtx({ held: P.holdings[0], h: synth(), firstBuy: 20240102 }));
  assert.ok(eq.some((s) => s.t === '是大盤拖累，還是它自己'));
});
t('大盤大跌：官方公告只列最近一個交易日以來的', () => {
  const ctx = baseCtx({ news: [{ t: '舊公告', url: 'https://x', src: 'fsc', kind: 'official', d: 20261001 }, { t: '金管會新規', url: 'https://y', src: 'fsc', kind: 'official', d: 20261022 }, { t: '中央社', url: 'https://z', src: 'cna', kind: 'fact', d: 20261022 }] });
  const st = K.buildPlay('crash', ctx).find((s) => s.t === '官方有沒有發布大事');
  assert.ok(st.v.includes('金管會新規') && !st.v.includes('舊公告') && !st.v.includes('中央社：'), st.v);
});
t('大盤大跌：歷史比較一定和「任何一天」並列', () => {
  const steps = K.buildPlay('crash', baseCtx());
  const hist = steps.find((s) => s.t.startsWith('歷史上'));
  assert.ok(hist && hist.v.includes('任何一天'), hist && hist.v);
});
t('隱藏金額：帶去問 Claude 時（沒打開附上金額）六種情境都不出現金額、股數、會不會扣二代健保', () => {
  const ctxs = {
    crash: baseCtx(),
    rally: baseCtx({ row: rows.get('0050'), h: synth() }),
    news: baseCtx({ item: { t: '金管會新規', url: 'https://x', src: 'fsc', kind: 'official', d: 20261022 } }),
    div: baseCtx({ row: rows.get('00878'), dv: { d: 20261117, cash: 12 }, h: { ...synth(), divs: [[20250117, 0.5]] } }),
    hot: baseCtx({ row: rows.get('00999') }),
    loss: baseCtx({ held: P.holdings[0], h: synth(), firstBuy: 20240102 }),
  };
  const SH = /\d+ 張|\d+ 股|2 萬元以上，股利|未滿 2 萬元/;
  for (const [id, ctx] of Object.entries(ctxs)) {
    const pk = K.coachPacket(id, ctx, '測試', false);
    assert.ok(pk.lines.length >= 4, id);
    for (const l of pk.lines) {
      assert.ok(!SECRET.test(l), `${id}：${l}`);
      assert.ok(!/<[a-z]/.test(l) && !/&(amp|lt|gt|quot|#39);/.test(l), `${id} 有 HTML：${l}`);
      if (id !== 'div' || !l.includes('單次領 2 萬元以上，股利與利息所得的部分先扣')) assert.ok(!SH.test(l), `${id} 有股數或金額級距：${l}`);
    }
  }
  const withAmt = K.coachPacket('crash', baseCtx(), '測試', true);
  assert.ok(withAmt.lines.some((l) => /18,000/.test(l)));
  // 打開附上金額：股數照寫（rally 的「這次最多…」）
  assert.ok(K.coachPacket('rally', ctxs.rally, '測試', true).lines.some((l) => /1 張 500 股/.test(l)));
  // 名稱裡的 & 不會變成 &amp;
  const amp = { ...rows.get('0050'), c: '00646', n: '元大S&P500' };
  rows.set('00646', amp);
  assert.ok(K.coachPacket('rally', baseCtx({ row: amp, h: synth() }), '元大S&P500', false).lines[0].includes('漲了多少'));
  assert.ok(K.coachPacket('rally', baseCtx({ row: amp, h: synth() }), '元大S&P500', false).lines.some((l) => l.includes('元大S&P500')));
  rows.delete('00646');
});
t('教練的文字：不是今天的資料不說「今天」；證交所的公告不會顯示成 twse_news；部位在虧的最後一步不叫你賣', () => {
  const r = K.buildPlay('rally', baseCtx({ row: rows.get('0050'), h: synth() }));
  assert.ok(!r[0].v.startsWith('今天') && r[0].v.startsWith('10/22'), r[0].v);
  const n = K.buildPlay('news', baseCtx({ item: { t: '證交所公告', url: 'https://x', src: 'twse_news', kind: 'official', d: 20261022 } }));
  assert.ok(n[0].v.includes('證交所的官方原文') && !n[0].v.includes('twse_news'), n[0].v);
  const l = K.buildPlay('loss', baseCtx({ held: P.holdings[0], h: synth(), firstBuy: 20240102 }));
  const last = l[l.length - 1];
  assert.ok(!/賣出才有道理|越早越好/.test(last.how) && last.how.includes('副官'), last.how);
});
t('資料缺一塊也不會炸：沒有大盤、沒有歷史、沒有持股', () => {
  for (const id of ['crash', 'rally', 'news', 'div', 'hot', 'loss']) {
    const ctx = { today: 20261026, mkt: null, P: null, rows: new Map(), quote, news: [], privacy: true, risk: 'mid', fee: PF.DEFAULT_FEE, watch: [], adv: () => null, h0050: null };
    const steps = K.buildPlay(id, ctx);
    for (const s of steps) assert.ok(!bad(s.v), `${id}：${s.v}`);
  }
});
t('設定頁說明照常數產生；名詞都在小辭典', () => {
  const h = K.coachRulesHTML();
  assert.ok(h.includes(String(K.COACH.lowCash * 100)) && !bad(h));
  for (const k of ['xray', 'overlap', 'pe', 'pbr', 'rev', 'coach']) assert.ok(TERMS[k], k);
});

// ------------------------------------------------------------------ 真實資料
if (histDir && fs.existsSync(path.join(histDir, '0050.json'))) {
  const h = JSON.parse(fs.readFileSync(path.join(histDir, '0050.json'), 'utf8'));
  t('真實 0050：單日跌 2%／3%／4% 以上的日子都有，越大跌越少；每一組都和任何一天並列', () => {
    let prev = Infinity;
    for (const th of [-2, -3, -4]) {
      const ds = K.dropStats(h, th);
      assert.ok(ds && ds.hit.n > 0 && ds.hit.n <= prev, `${th}`);
      prev = ds.hit.n;
      assert.ok(ds.base.n > 1000);
      console.log(`   0050 單日跌 ${-th}% 以上：${ds.days} 天（每年 ${ds.perYear.toFixed(1)} 天），之後 20 日上漲 ${(ds.hit.up * 100).toFixed(0)}%、中位數 ${(ds.hit.med * 100).toFixed(1)}%；任何一天上漲 ${(ds.base.up * 100).toFixed(0)}%`);
    }
    const gs = K.gainStats(h, 10);
    assert.ok(gs && gs.hit.n > 0);
  });
}
if (dataDir && fs.existsSync(path.join(dataDir, 'hold.json'))) {
  const idx = JSON.parse(fs.readFileSync(path.join(dataDir, 'hold.json'), 'utf8'));
  const st = JSON.parse(fs.readFileSync(path.join(dataDir, 'stocks.json'), 'utf8'));
  const load = (c) => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'hold', `${c}.json`), 'utf8')); } catch { return null; } };
  t('真實成分股：0050 最大是台積電、比例合理；每檔的最完整清單都存在、比例加總不超過 100 多一點', () => {
    const o = load('0050');
    assert.equal(X.bestList(o).h[0][1], '台積電');
    assert.ok(X.bestList(o).h[0][3] > 30 && X.bestList(o).h[0][3] < 80);
    let cnt = 0;
    for (const c of Object.keys(idx.etf)) {
      const b = X.bestList(load(c));
      assert.ok(b && b.h.length, c);
      const s = b.h.reduce((a, r) => a + r[3], 0);
      assert.ok(s > 0 && s < 130, `${c} 合計 ${s}`);
      cnt++;
    }
    assert.ok(cnt > 250);
  });
  t('真實穿透：0050 30%＋00878 20%＋0056 10%，台積電最重、來源正確', () => {
    const holds = { '0050': load('0050'), '00878': load('00878'), '0056': load('0056') };
    const lt = X.lookThrough([{ code: '0050', w: 0.3 }, { code: '00878', w: 0.2 }, { code: '0056', w: 0.1 }], holds);
    assert.equal(lt.items[0].name, '台積電');
    assert.ok(lt.items[0].via[0].code === '0050');
    const ind = X.byIndustry(lt.items, st);
    assert.ok(ind[0].k === '半導體業', ind[0].k);
    const ov = X.overlap(X.bestList(holds['0050']), X.bestList(holds['00878']));
    console.log(`   0050 × 00878 重疊 ${(ov.o * 100).toFixed(1)}%（共同 ${ov.shared.length} 家）；台積電穿透 ${(lt.items[0].w * 100).toFixed(1)}%`);
    assert.ok(ov.o >= 0 && ov.o <= 1);
  });
  t('真實個股資料：每一檔都有名稱、市場；反查的 ETF 都在索引裡', () => {
    for (const [c, v] of Object.entries(st.s)) { assert.ok(v[0] && ['tse', 'otc'].includes(v[1]), c); }
    for (const [k, list] of Object.entries(st.by)) for (const [e] of list) assert.ok(idx.etf[e], `${k} → ${e}`);
  });
}

console.log(`\n${n} 個測試通過`);
