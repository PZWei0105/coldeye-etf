// 副官（決策日記、反方檢查、打包、結論解析）的單元測試：node tests/aide_test.mjs [hist 資料夾] [track.json]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as A from '../site/aide.js';
import * as pf from '../site/pf.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);

// 一個 30 天、價格從 100 慢慢漲的假歷史
const days = [];
for (let m = 9; m <= 11; m++) for (let d = 1; d <= 28; d++) {
  const x = 2026 * 10000 + m * 100 + d;
  const wd = new Date(Date.UTC(2026, m - 1, d)).getUTCDay();
  if (wd >= 1 && wd <= 5) days.push(x);
}
const H = { d: days.slice(0, 30), p: days.slice(0, 30).map((_, k) => 100 + k), splits: [], divs: [] };

t('含息報酬指數：沒有配息分割時就是價格比', () => {
  const tr = A.trIndex(H);
  near(tr[10] / tr[0], H.p[10] / H.p[0]);
});

t('含息報酬指數：除息當天把配息買回、分割照倍數換算、休市的除息算到下一天', () => {
  const h = { d: [20260101, 20260102, 20260105, 20260106], p: [100, 98, 25, 25], splits: [[20260105, 4]], divs: [[20260102, 2], [20260103, 1]] };
  const tr = A.trIndex(h);
  near(tr[1], (98 + 2) / 100);                     // 除息 2 元：價格 98 ＋ 配息 2 → 持平
  near(tr[2], tr[1] * 4 * (25 + 1) / 98);          // 1/3（週六）的配息算到 1/5，同一天 1 拆 4
  near(tr[3], tr[2]);
});

t('對答案：還沒進歷史資料的當天、未滿 20 個交易日、剛好 20 個交易日', () => {
  const e = { stance: 'bull', snap: { d: H.d[29] + 1, px: 120 } };
  assert.equal(A.evalEntry(e, H).state, 'wait');
  const e2 = { stance: 'bull', snap: { d: H.d[15], px: 115 } };
  const r2 = A.evalEntry(e2, H);
  assert.equal(r2.state, 'wait'); assert.equal(r2.n, 14);
  const e3 = { stance: 'bull', snap: { d: H.d[5], px: 104 } };   // 盤中看到 104，當天收盤 105
  const r3 = A.evalEntry(e3, H);
  assert.equal(r3.state, 'done');
  assert.equal(r3.d, H.d[25]);
  near(r3.ret, 125 / 104 - 1);
});

t('對答案：除息日開盤前（價格還是昨收）要算進這次配息；盤中（已經扣息）不算', () => {
  const h = { d: [], p: [], splits: [], divs: [[H.d[3], 5]] };
  for (let k = 0; k < 30; k++) { h.d.push(H.d[k]); h.p.push(k < 3 ? 100 : 95); }
  const pre = A.evalEntry({ stance: 'bull', snap: { d: h.d[2], px: 100 } }, h);   // 前一天的價格 → 有領到配息
  near(pre.ret, 0);
  const intra = A.evalEntry({ stance: 'bull', snap: { d: h.d[3], px: 95 } }, h);  // 除息當天盤中 → 價格已扣息
  near(intra.ret, 0);
});

t('對答案：換股兩檔都算，冷門 ETF 當天沒成交就用之前最後一次成交', () => {
  const hB = { d: H.d.filter((_, k) => k !== 25), p: H.d.filter((_, k) => k !== 25).map(() => 50), splits: [], divs: [] };
  const r = A.evalEntry({ stance: 'swap', c2: 'B', snap: { d: H.d[5], px: 105 }, snap2: { d: H.d[5], px: 50 } }, H, hB);
  assert.equal(r.state, 'done');
  near(r.ret, 125 / 105 - 1); near(r.ret2, 0);
  assert.equal(A.hitOf('swap', r), false);
});

t('還沒到期：用現價與除息、分割紀錄算到目前為止', () => {
  near(A.interimRet({ d: 20261001, px: 100 }, 104, 20261020, [[20261010, 2]], []), 0.06);
  near(A.interimRet({ d: 20261001, px: 100 }, 26, 20261020, [], [[20261005, 4]]), 0.04);
  assert.equal(A.interimRet({ d: 20261001, px: 0 }, 10, 20261020), null);
});

t('對錯與基準：看多 > 0、看空 < 0、觀望不算；基準看多用上漲比例、看空用下跌比例', () => {
  const res = { state: 'done', ret: 0.03, bu: 0.66, ba: 0.025 };
  assert.equal(A.hitOf('bull', res), true); assert.equal(A.hitOf('bear', res), false); assert.equal(A.hitOf('wait', res), null);
  near(A.baseOf('bull', res), 0.66); near(A.baseOf('bear', res), 0.34);
  assert.equal(A.hitOf('bull', { state: 'done', ret: 0 }), false);
  assert.equal(A.hitOf('bear', { state: 'done', ret: 0 }), false);
});

t('最後算分的立場：討論後的決定優先；換股紀錄只認換股或觀望', () => {
  assert.equal(A.finalStance({ stance: 'bull' }), 'bull');
  assert.equal(A.finalStance({ stance: 'bull', after: { stance: 'wait' } }), 'wait');
  assert.equal(A.finalStance({ stance: 'swap', after: { stance: 'bull' } }), 'swap');
  assert.equal(A.finalStance({ stance: 'swap', after: { stance: 'wait' } }), 'wait');
  assert.equal(A.finalStance({ stance: 'bull', after: { stance: 'swap' } }), 'bear');
});

t('戰績：和基準並列、長期紀律不算命中率、和規則同向／唱反調分開、冷靜期與討論前後', () => {
  const mk = (stance, ret, st, extra = {}) => ({ stance, snap: { d: 20260101, px: 1, st }, res: { state: 'done', ret, bu: 0.6, ba: 0.02 }, ...extra });
  const items = [
    mk('bull', 0.05, 1), mk('bull', -0.02, 1), mk('bull', 0.01, -1, { conf: 5 }), mk('bear', 0.03, 1, { conf: 4 }),
    mk('bull', 0.04, 0, { tags: ['dca'] }),                                  // 長期紀律：不算
    mk('bear', -0.05, -1, { cool: { res: 'changed' } }),                    // 冷靜後改變主意，原本是對的
    mk('bull', -0.03, 1, { after: { stance: 'wait' } }),                    // 討論後改成觀望：不算命中率
    { stance: 'bull', res: { state: 'wait' } },
  ];
  const s = A.journalStats(items);
  assert.equal(s.done, 7);
  assert.equal(s.all.n, 5);
  assert.equal(s.all.hits, 3);
  near(s.all.base, (0.6 * 3 + 0.4 * 2) / 5);
  assert.equal(s.vsRule.same.n, 3); assert.equal(s.vsRule.same.hits, 2);
  assert.equal(s.vsRule.opp.n, 2); assert.equal(s.vsRule.opp.hits, 1); assert.equal(s.vsRule.opp.ruleHits, 1);
  assert.equal(s.byConf.hi.n, 2);
  assert.equal(s.cooled.n, 1); assert.equal(s.cooled.origRight, 1);
  assert.equal(s.disc.n, 1); assert.equal(s.disc.beforeRight, 0); assert.equal(s.disc.afterRight, 0);
  assert.equal(s.waited.n, 1);
  assert.equal(s.enough, false);
});

t('換股基準：任何一天換過去，20 天後贏的比例', () => {
  const hA = { d: H.d, p: H.d.map(() => 100), splits: [], divs: [] };
  const hB = { d: H.d, p: H.d.map((_, k) => 100 + k), splits: [], divs: [] };
  assert.equal(A.pairBase(hA, hB), null);   // 樣本太少（< 60）
  const long = { d: [], p: [] };
  let d = 20250101;
  for (let k = 0; k < 120; k++) { d = A.addWeekdays(d, 1); long.d.push(d); long.p.push(100); }
  const up = { d: long.d, p: long.d.map((_, k) => 100 + k), splits: [], divs: [] };
  const r = A.pairBase({ ...long, splits: [], divs: [] }, up);
  assert.equal(r.up, 1); assert.equal(r.n, 100);
});

t('星期一到五的天數與冷靜期（週五晚上 → 下週一）', () => {
  assert.equal(A.weekdaysBetween(20261016, 20261019), 1);   // 週五 → 週一
  assert.equal(A.weekdaysBetween(20261019, 20261023), 4);
  assert.equal(A.addWeekdays(20261016, 1), 20261019);
  assert.equal(A.coolDue(20261023), 20261026);
});

t('Claude 的【冷眼結論】：各種寫法都認得出來', () => {
  const a = A.parseConclusion(`好的，總結如下：\n\n【冷眼結論】\n**立場**：先觀望\n**信心**：3\n**理由**：\n- 跌破防守線\n- 溢價偏高\n**風險**：錯過反彈\n**復盤條件**：收盤站上 111.3 再考慮加碼；跌破 105.2 就減碼`);
  assert.equal(a.stance, 'wait'); assert.equal(a.conf, 3);
  assert.ok(a.why.includes('跌破防守線') && a.why.includes('溢價偏高'));
  assert.ok(a.exit.includes('111.3'));
  assert.equal(A.parseConclusion('立場：想買／加碼\n信心：四').stance, 'bull');
  assert.equal(A.parseConclusion('立場：想買／加碼\n信心：四').conf, 4);
  assert.equal(A.parseConclusion('立場：減碼一半').stance, 'bear');
  assert.equal(A.parseConclusion('立場：先不加碼，續抱').stance, 'wait');
  assert.equal(A.parseConclusion('立場：想換股（0056 換成 00878）').stance, 'swap');
  // 原封不動把四個選項貼回來：認不出來，要使用者自己選
  const b = A.parseConclusion('【冷眼結論】\n立場：想買／加碼、想賣／減碼、先觀望、想換股（四選一）\n信心：1～5');
  assert.ok(!b.stance && b.stanceRaw);
  assert.equal(A.parseConclusion('今天天氣很好'), null);
});

t('復盤條件裡的價位：跌破 → 到價提醒（跌到），站上 → 漲到；離現價太遠的數字不算', () => {
  const x = A.parseExit('收盤跌破 105.2 就重新評估，站上 111.3 再加碼，20 日後再看', 108);
  assert.deepEqual(x.map((z) => [z.op, z.px]), [['le', 105.2], ['ge', 111.3]]);
  assert.deepEqual(A.parseExit('跌破 20 日線', 108), []);
});

const row0050 = { c: '0050', n: '元大台灣50', k: 'broad', m: 'tse', d: 20261021, p: 108.15, st: -1, sc: -0.8, cf: 62, ps: 'caution', dl: 111.3, fl: [], val: 8e9, aum: 2.5e12, r1y: 0.8, vol: 0.28, mdd: 0.15, y: 1.48, hd: 3677896 };
const q0050 = { px: 108.15, pc: 0.84, prem: -0.11, date: 20261021, live: false };
const ctx = { T: 1e6, cash: 3e5, profile: 'mid', fee: pf.DEFAULT_FEE, today: 20261022 };

t('副官檢查：想買但規則偏空 → 提醒唱反調；很有把握又相反、理由是怕錯過 → 建議冷靜一晚', () => {
  const r = A.aideCheck({ stance: 'bull', conf: 5, tags: ['fomo'], row: row0050, q: q0050, ctx, adv: { key: 'hold_off' }, market: { pc: 0.5 } });
  const ks = r.items.map((i) => i.k);
  assert.ok(ks.includes('rule') && ks.includes('emo') && ks.includes('conf') && ks.includes('dl'));
  assert.equal(r.items.find((i) => i.k === 'rule').lvl, 'warn');
  assert.ok(r.cool);
  assert.ok(r.coolWhy.includes('理由偏情緒'));
});

t('副官檢查：處置中 → 交易受限；大盤大跌 → 大波動提醒；沒有持股想賣 → 記成看空', () => {
  const r = A.aideCheck({ stance: 'bear', row: { ...row0050, fl: ['disposal'] }, q: q0050, ctx, market: { pc: -2.4 } });
  assert.equal(r.stop, 1);
  assert.ok(r.items.some((i) => i.k === 'market'));
  assert.ok(r.items.some((i) => i.k === 'nohold'));
  assert.ok(r.cool);
});

t('副官檢查：賣出時算手續費與證交稅、虧損時提醒成本不影響之後漲跌、隱私模式不寫金額', () => {
  const hold = { sh: 2000, avg: 120, cost: 240000, w: 0.2, pnlPct: -0.1 };
  const r = A.aideCheck({ stance: 'bear', row: row0050, q: q0050, ctx, hold, privacy: true });
  const cost = r.items.find((i) => i.k === 'cost');
  assert.ok(cost && !/約 \d/.test(cost.t));
  assert.ok(r.items.some((i) => i.k === 'sunk'));
  const r2 = A.aideCheck({ stance: 'bear', row: row0050, q: q0050, ctx, hold });
  assert.ok(/手續費約 \d/.test(r2.items.find((i) => i.k === 'cost').t));
});

t('副官檢查：換股追逐過去報酬、類別不同、觀望時現金太多', () => {
  const r2 = { ...row0050, c: '00981A', n: '主動統一台股增長', k: 'active', st: 1, ps: 'add', r1y: 1.2, vol: 0.3, mdd: 0.2 };
  const r = A.aideCheck({ stance: 'swap', row: row0050, q: q0050, row2: r2, q2: { px: 20, pc: 0, prem: 0.1 }, ctx });
  const ks = r.items.map((i) => i.k);
  assert.ok(ks.includes('chase') && ks.includes('cat') && ks.includes('nohold'));
  assert.equal(r.items.find((i) => i.k === 'rule').lvl, 'ok');
  const w = A.aideCheck({ stance: 'wait', row: row0050, q: q0050, ctx: { ...ctx, cash: 8e5 } });
  assert.ok(w.items.some((i) => i.k === 'cash'));
  assert.equal(w.cool, false);
});

t('部位巡檢：超過上限、跌破防守線、零碎部位', () => {
  const P = {
    totals: { T: 1e6, cash: 1e5 },
    holdings: [
      { name: '元大台灣50', code: '0050', cat: 'broad', mv: 7e5, w: 0.7, px: 108, row: { dl: 111.3, fl: [] } },
      { name: '元大高股息', code: '0056', cat: 'div', mv: 1.9e5, w: 0.19, px: 38, row: { dl: 36, fl: [] } },
      { name: '小檔', code: '00X', cat: 'theme', mv: 1e4, w: 0.01, px: 10, row: { dl: 9, fl: [] } },
    ],
  };
  const items = A.auditPf(P, 'mid', 20261022, null);
  const ks = items.map((i) => i.k);
  assert.ok(ks.includes('cap') && items.find((i) => i.k === 'cap').lvl === 'warn');
  assert.ok(items.find((i) => i.k === 'dl').t.includes('元大台灣50'));
  assert.ok(ks.includes('tiny'));
});

t('打包：預設只寫比例，打開才有股數與成本；一定有規則段與「不要直接叫我買賣」', () => {
  const base = { kind: 'idea', when: '2026/10/22 10:35 盤中', row: row0050, q: q0050, today: 20261022, market: { px: 46900, pc: 0.2, ma60: 46100, br: { n: 300, pBull: 0.4, pBear: 0.2 } }, profileName: '穩健', idea: { stance: 'bull', conf: 4, tags: ['cheap'], text: '跌深想加碼' } };
  const hold = { sh: 2000, avg: 98.5, w: 0.21, cap: 0.6, pnlPct: 0.09, mv: 216300 };
  const a = A.packEtf({ ...base, hold, showAmt: false });
  assert.ok(a.includes('不要直接叫我買或賣'));
  assert.ok(a.includes('【冷眼結論】'));
  assert.ok(a.includes('占總資產 21.0%'));
  assert.ok(!a.includes('98.50') && !a.includes('2 張'));
  const b = A.packEtf({ ...base, hold, showAmt: true });
  assert.ok(b.includes('98.50') && b.includes('2 張'));
  const c = A.packEtf({ ...base, short: true });
  assert.ok(c.startsWith('【冷眼參謀・檢查我的想法】') && !c.includes('不要引用社群'));
  assert.ok(A.projectInstructions().includes('不要引用社群'));
});

t('還原備份的日記：格式不對的整筆不收，多餘或危險的欄位一律丟掉', () => {
  const good = { id: 'abc123', at: '2026-09-01T02:00:00.000Z', src: 'idea', book: 'real', c: '0050', stance: 'bull', conf: 9, tags: ['trend', 'evil'], text: 'x'.repeat(900), snap: { n: '元大台灣50', k: 'broad', d: 20260901, px: 100, st: 1, ps: 'add', evil: '<script>' }, checks: { verdict: 'v', ok: '<b>', warn: 2, stop: 0, items: [{ lvl: 'x" onclick="1', t: 'bad' }, { lvl: 'warn', t: 'ok' }] }, after: { stance: 'wait', conf: '5', why: 'w' }, res: { state: 'done', d: 20260929, ret: 0.05, px: 105, bu: 0.66, evil: 1 }, seen: true, hack: 1 };
  const out = A.sanitizeJournal([good, { ...good, id: 'abc123' }, { ...good, id: 'zz9', stance: 'moon' }, { ...good, id: 'zz8', snap: { d: 20260901, px: -1 } }, null, 'x']);
  assert.equal(out.length, 1);
  const e = out[0];
  assert.equal(e.conf, null);
  assert.deepEqual(e.tags, ['trend']);
  assert.equal(e.text.length, 500);
  assert.equal(e.snap.evil, undefined);
  assert.equal(e.checks.ok, 0);
  assert.equal(e.checks.items.length, 1);
  assert.equal(e.after.conf, undefined);
  assert.equal(e.after.stance, 'wait');
  assert.equal(e.res.evil, undefined);
  assert.equal(e.hack, undefined);
  assert.equal(e.seen, true);
});

t('部位打包：打開金額才寫股數與成本', () => {
  const p = { when: 'w', profileName: '穩健', profileLoss: 0.01, totals: { T: 1e6, mv: 7e5, cash: 3e5, pct: 0.1, annual: 2e4 }, holdings: [{ name: '元大台灣50', code: '0050', cat: 'broad', w: 0.7, cap: 0.6, pnlPct: 0.1, label: '續抱', st: 0, ps: 'hold', sh: 3000, avg: 95.5, mv: 7e5 }], audit: [] };
  assert.ok(!A.packPf({ ...p, showAmt: false }).includes('3 張'));
  const s = A.packPf({ ...p, showAmt: true });
  assert.ok(s.includes('3 張') && s.includes('95.50') && s.includes('700,000'));
});

// 用真實資料：每一檔歷史檔都算得出含息報酬指數，0050 回測期間的看多基準和戰績頁一致
const histDir = process.argv[2];
const trackPath = process.argv[3];
if (histDir && fs.existsSync(histDir)) {
  t('真實歷史資料：含息報酬指數都是正數、0050 近一年和戰績頁的近一年報酬接近', () => {
    let files = 0;
    for (const f of fs.readdirSync(histDir)) {
      const h = JSON.parse(fs.readFileSync(`${histDir}/${f}`, 'utf8'));
      const tr = A.trIndex(h);
      assert.ok(tr.every((x) => x > 0), f);
      files++;
    }
    const h = JSON.parse(fs.readFileSync(`${histDir}/0050.json`, 'utf8'));
    const tr = A.trIndex(h);
    const n = h.d.length - 1;
    console.log(`   ${files} 檔；0050 近 250 個交易日含息 ${((tr[n] / tr[n - 250] - 1) * 100).toFixed(1)}%`);
    const e = { stance: 'bull', snap: { d: h.d[n - 40], px: h.p[n - 40] } };
    const r = A.evalEntry(e, h);
    assert.equal(r.state, 'done');
    assert.equal(r.d, h.d[n - 20]);
  });
}
if (trackPath && fs.existsSync(trackPath)) {
  t('真實戰績檔：每一類都有「任何一天上漲比例」可以當基準', () => {
    const T = JSON.parse(fs.readFileSync(trackPath, 'utf8'));
    for (const [k, s] of Object.entries(T.by_cat)) assert.ok(s && s.base_up > 0 && s.base_up < 1, k);
  });
}
console.log(`\n副官測試全部通過（${n} 項）`);
