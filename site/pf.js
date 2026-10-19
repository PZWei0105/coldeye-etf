/* 冷眼 — 我的部位：成本、損益、配息、建議的計算核心。
   全部是純函式，不碰畫面、不連網，同樣的輸入永遠得到同樣的結果。
   所有門檻都寫在這個檔案的常數裡，App 的「規則說明」照抄這裡。 */

// ------------------------------------------------------------------ 交易成本
export const FEE_RATE = 0.001425;          // 券商手續費率（法定上限），實際依折扣
export const ETF_TAX = 0.001;              // ETF 賣出證交稅 0.1%
export const BOND_TAX_FREE_UNTIL = 20261231; // 債券 ETF 停徵證交稅到 2026/12/31
export const DEFAULT_FEE = { disc: 1, min: 20, minOdd: 1 };
export const NHI_RATE = 0.0211;            // 二代健保補充保費
export const NHI_THRESHOLD = 20000;        // 單次給付 2 萬元以上才扣

// ------------------------------------------------------------------ 風險屬性（單筆最多虧總資產幾 %、各類型單檔上限）
export const PROFILES = {
  cons: {
    name: '保守', loss: 0.005,
    caps: { broad: 0.5, div: 0.4, overseas: 0.3, bond: 0.7, theme: 0.15, active: 0.15, lev: 0.05, inv: 0.05, fut: 0.05 },
  },
  mid: {
    name: '穩健', loss: 0.01,
    caps: { broad: 0.6, div: 0.5, overseas: 0.4, bond: 0.6, theme: 0.25, active: 0.25, lev: 0.1, inv: 0.1, fut: 0.1 },
  },
  aggr: {
    name: '積極', loss: 0.02,
    caps: { broad: 0.8, div: 0.6, overseas: 0.5, bond: 0.5, theme: 0.35, active: 0.35, lev: 0.2, inv: 0.15, fut: 0.15 },
  },
};
export const DEFAULT_CAP = 0.25;
export const OVER_TOL = 0.02;              // 超過上限 2 個百分點以上才建議調節
export const TRIM_FRAC = { lev: 1, inv: 1, theme: 0.5, active: 0.5, fut: 0.5 }; // 其他類型減 1/3
export const TRIM_DEFAULT = 1 / 3;
export const DIV_SOON_DAYS = 21;           // 21 天內除息才提醒
export const CONF_FULL = 70;               // 信心 70 以上才給完整股數，否則減半
export const CASH_SLICES = 3;              // 可用現金分 3 份，每次加碼最多用 1 份（同時超過 3 檔可加碼時平均分）

export const CAT_NAMES = {
  broad: '市值型', div: '高股息', theme: '產業主題', overseas: '海外股票', bond: '債券',
  lev: '槓桿型', inv: '反向型', fut: '期貨／商品', active: '主動式',
};

const isNum = (x) => typeof x === 'number' && isFinite(x);
const round = (x, n = 0) => { const k = 10 ** n; return Math.round(x * k) / k; };

// ------------------------------------------------------------------ 日期（yyyymmdd 整數）
export function ymd(date) {
  return date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
}
export function twToday(now = Date.now()) {
  return ymd(new Date(now + 8 * 3600e3));
}
export function addDays(d, n) {
  const t = Date.UTC(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100) + n * 86400e3;
  return ymd(new Date(t));
}
export function daysBetween(a, b) {
  const ta = Date.UTC(Math.floor(a / 10000), Math.floor(a / 100) % 100 - 1, a % 100);
  const tb = Date.UTC(Math.floor(b / 10000), Math.floor(b / 100) % 100 - 1, b % 100);
  return Math.round((tb - ta) / 86400e3);
}

// ------------------------------------------------------------------ 價格跳動單位
export function tick(p) { return p < 50 ? 0.01 : 0.05; }
export function tickRound(p) {
  if (!isNum(p)) return null;
  const t = tick(p);
  return round(Math.round(p / t) * t, 2);
}
export function tickDown(p) {
  if (!isNum(p)) return null;
  const t = tick(p);
  return round(Math.floor(p / t + 1e-9) * t, 2);
}
export function tickUp(p) {
  if (!isNum(p)) return null;
  const t = tick(p);
  return round(Math.ceil(p / t - 1e-9) * t, 2);
}

// ------------------------------------------------------------------ 手續費與交易稅
/** 單筆委託的手續費：成交金額 × 0.1425% × 折扣，無條件捨去；整股、零股各有最低收費。 */
export function feeOf(amount, odd, cfg = DEFAULT_FEE) {
  if (!(amount > 0)) return 0;
  const raw = Math.floor(amount * FEE_RATE * (cfg.disc ?? 1) + 1e-9);
  return Math.max(raw, odd ? (cfg.minOdd ?? 1) : (cfg.min ?? 20));
}
export function taxRateOf(cat, date) {
  if (cat === 'bond' && (!date || date <= BOND_TAX_FREE_UNTIL)) return 0;
  return ETF_TAX;
}
/** 一筆買賣的費用。整股（1000 股的倍數）與零股要分開下單，所以分開計算。 */
export function tradeCost(side, sh, px, cat, date, cfg = DEFAULT_FEE) {
  const lots = Math.floor(sh / 1000) * 1000;
  const odd = round(sh - lots, 3);
  const amount = round(sh * px, 2);
  let fee = 0;
  let tax = 0;
  const rate = side === 'sell' ? taxRateOf(cat, date) : 0;
  for (const [n, isOdd] of [[lots, false], [odd, true]]) {
    if (n <= 0) continue;
    const part = round(n * px, 2);
    fee += feeOf(part, isOdd, cfg);
    if (rate) tax += Math.floor(part * rate + 1e-9);
  }
  const net = round(side === 'buy' ? amount + fee : amount - fee - tax, 2);
  return { amount, fee, tax, net };
}

// ------------------------------------------------------------------ 分割
/** 把分割前的交易換算成目前的股數與價格基準（例如 1 拆 4：股數 ×4、價格 ÷4）。
 *  沒填日期的交易視為已經是目前基準（照著券商 App 現在顯示的股數輸入）。 */
export function normLot(lot, splits) {
  let sh = lot.sh;
  let px = lot.px;
  if (lot.d) {
    for (const [sd, f] of splits || []) {
      if (lot.d < sd) { sh *= f; px /= f; }
    }
  }
  return { ...lot, nsh: sh, npx: px };
}
function factorAfter(d, splits) {
  let f = 1;
  for (const [sd, k] of splits || []) if (sd > d) f *= k;
  return f;
}

// ------------------------------------------------------------------ 單一持股：移動平均成本
export function sortLots(lots) {
  // 沒填日期的買進排最前（當作很早以前買的），沒填日期的賣出排最後，這樣賣出才有股票可賣
  const key = (l) => l.d || (l.side === 'sell' ? 99999999 : 0);
  return lots.slice().sort((a, b) => key(a) - key(b) || String(a.at || '').localeCompare(String(b.at || '')));
}

/**
 * 依交易紀錄算出目前持股。賣出用移動平均成本計算已實現損益（和多數券商 App 相同）。
 * 回傳：sh 股數、cost 剩餘成本（含買進手續費）、avg 平均成本、realized 已實現損益、warnings。
 */
export function holdingFromLots(lots, splits) {
  let sh = 0;
  let cost = 0;
  let realized = 0;
  let undated = 0;
  let firstD = null;
  const warnings = [];
  for (const raw of sortLots(lots)) {
    const l = normLot(raw, splits);
    if (!l.d) undated++;
    else if (firstD == null || l.d < firstD) firstD = l.d;
    const fee = isNum(raw.fee) ? raw.fee : 0;
    if (raw.side === 'sell') {
      let n = l.nsh;
      if (n > sh + 1e-9) {
        warnings.push(`${raw.d ? raw.d : '未填日期'} 賣出 ${raw.sh} 股，超過當時持股，已用當時持股計算`);
        n = sh;
      }
      if (n <= 0) continue;
      const avg = sh > 0 ? cost / sh : 0;
      const tax = isNum(raw.tax) ? raw.tax : 0;
      realized += n * l.npx - fee - tax - avg * n;
      cost -= avg * n;
      sh -= n;
      if (sh < 1e-6) { sh = 0; cost = 0; }
    } else {
      sh += l.nsh;
      cost += l.nsh * l.npx + fee;
    }
  }
  sh = Math.round(sh * 1000) / 1000;
  return { sh, cost, avg: sh > 0 ? cost / sh : null, realized, undated, firstD, warnings };
}

// ------------------------------------------------------------------ 配息
/** 已經除息、可以領到的配息（只算有填買進日期的交易）。
 *  台灣規則：除息日前一天（含）以前買進、而且除息日前沒有賣出，才領得到。 */
export function dividendsReceived(lots, divs, splits, today) {
  const dated = sortLots(lots).filter((l) => l.d).map((l) => normLot(l, splits));
  const undated = lots.filter((l) => !l.d).length;
  const items = [];
  let total = 0;
  for (const [ex, cash] of divs || []) {
    if (!(ex <= today) || !(cash > 0)) continue;
    let held = 0;
    for (const l of dated) {
      if (l.d >= ex) break;
      held += l.side === 'sell' ? -l.nsh : l.nsh;
    }
    if (held <= 1e-9) continue;
    const shAtEx = held / factorAfter(ex, splits);     // 換回當時的股數基準
    const amt = Math.floor(shAtEx * cash + 1e-9);
    items.push({ d: ex, cash, sh: round(shAtEx, 3), amt });
    total += amt;
  }
  return { total, items, undated };
}

/** 近 12 個月每單位配息（換算成目前股數基準），與依除息月份的分布。 */
export function trailingDividends(divs, splits, today) {
  const from = addDays(today, -365);
  const months = new Array(12).fill(0);
  let ttm = 0;
  for (const [ex, cash] of divs || []) {
    if (ex <= from || ex > today || !(cash > 0)) continue;
    const per = cash / factorAfter(ex, splits);
    ttm += per;
    months[Math.floor(ex / 100) % 100 - 1] += per;
  }
  return { ttm, months };
}

// ------------------------------------------------------------------ 損益
export function sellValue(sh, px, cat, date, cfg) {
  if (!(sh > 0) || !(px > 0)) return { amount: 0, fee: 0, tax: 0, net: 0 };
  return tradeCost('sell', sh, px, cat, date, cfg);
}

/** 損益兩平的賣出價：賣掉之後（扣手續費、交易稅）剛好拿回成本，往上取到跳動單位。 */
export function breakEven(sh, cost, cat, date, cfg) {
  if (!(sh > 0) || !(cost > 0)) return null;
  let lo = (cost / sh) * 0.9;
  let hi = (cost / sh) * 1.2 + 1;
  for (let k = 0; k < 30 && sellValue(sh, hi, cat, date, cfg).net < cost; k++) hi *= 2;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (sellValue(sh, mid, cat, date, cfg).net >= cost) hi = mid; else lo = mid;
  }
  let p = tickUp(hi);
  // 跳動單位換檔（50 元上下）時再確認一次
  while (sellValue(sh, p, cat, date, cfg).net < cost) p = round(p + tick(p), 2);
  return p;
}

// ------------------------------------------------------------------ 整個投資組合
/**
 * @param pf      { cash, lots:[...], colors:{code:slot} }
 * @param rows    Map(code → summary row)
 * @param quoteOf (row) → { px, ch, pc, prem, date, live }
 * @param divsData { code: { d: [[ex, cash]], s: [[date, factor]] } }
 * @param cfg     手續費設定
 * @param today   yyyymmdd
 */
export function buildPortfolio(pf, rows, quoteOf, divsData, cfg, today) {
  const byCode = new Map();
  for (const l of pf.lots || []) {
    if (!byCode.has(l.c)) byCode.set(l.c, []);
    byCode.get(l.c).push(l);
  }
  const holdings = [];
  const closed = [];
  let realizedAll = 0;
  let divAll = 0;
  let undatedAll = 0;
  for (const [code, lots] of byCode) {
    const row = rows.get(code) || null;
    const dv = (divsData && divsData[code]) || { d: [], s: [] };
    const splits = dv.s || [];
    const h = holdingFromLots(lots, splits);
    const rec = dividendsReceived(lots, dv.d, splits, today);
    realizedAll += h.realized;
    divAll += rec.total;
    undatedAll += rec.undated;
    const cat = row ? row.k : null;
    const q = row ? quoteOf(row) : null;
    const px = q && isNum(q.px) ? q.px : null;
    if (!(h.sh > 0)) {
      let dayC = null;
      if (q && isNum(q.ch) && px != null) {
        const qd = q.date || today;
        let before = 0;
        let tp = 0;
        for (const l of sortLots(lots).map((x) => normLot(x, splits))) {
          if (l.d && l.d >= qd) tp += (l.side === 'sell' ? l.npx - px : px - l.npx) * l.nsh;
          else before += (l.side === 'sell' ? -1 : 1) * l.nsh;
        }
        dayC = Math.max(0, before) * q.ch + tp;
        if (!(Math.abs(dayC) > 1e-9) || !lots.some((l) => l.d && l.d >= qd)) dayC = null;   // 只算今天清掉的
      }
      closed.push({ code, row, name: row ? row.n : code, h, divRecv: rec.total, day: dayC });
      continue;
    }
    const mv = px != null ? h.sh * px : null;
    const sv = px != null ? sellValue(h.sh, px, cat, today, cfg) : null;
    const pnl = sv ? sv.net - h.cost : null;
    // 今日損益：今天以前就持有的股數 × 今日漲跌；今天買的用買進價計算
    // 今日損益：報價日以前就持有的股數 × 今日漲跌；報價日當天的買賣，用成交價和現價的差計算
    let day = null;
    if (q && isNum(q.ch) && px != null) {
      const qd = q.date || today;
      let before = 0;
      let todayPart = 0;
      for (const l of sortLots(lots).map((x) => normLot(x, splits))) {
        if (l.d && l.d >= qd) todayPart += (l.side === 'sell' ? l.npx - px : px - l.npx) * l.nsh;
        else before += (l.side === 'sell' ? -1 : 1) * l.nsh;
      }
      day = Math.max(0, before) * q.ch + todayPart;
    }
    const tr = trailingDividends(dv.d, splits, today);
    const nd = row && row.dv && row.dv.d >= today ? row.dv : null;
    holdings.push({
      code, row, name: row ? row.n : code, cat, q, px, h, mv, pnl,
      pct: pnl != null && h.cost > 0 ? pnl / h.cost : null,
      day, divRecv: rec.total, divItems: rec.items, undated: rec.undated,
      ttm: tr.ttm, months: tr.months.map((x) => x * h.sh), annual: tr.ttm * h.sh,
      nextDiv: nd ? { ...nd, amt: nd.cash ? Math.floor(nd.cash * h.sh + 1e-9) : null } : null,
      be: breakEven(h.sh, h.cost, cat, today, cfg), sell: sv,
    });
  }
  const cash = isNum(pf.cash) && pf.cash > 0 ? pf.cash : 0;
  const mvAll = holdings.reduce((a, x) => a + (x.mv || 0), 0);
  const costAll = holdings.reduce((a, x) => a + x.h.cost, 0);
  const pnlAll = holdings.reduce((a, x) => a + (x.pnl || 0), 0);
  const dayAll = holdings.reduce((a, x) => a + (x.day || 0), 0) + closed.reduce((a, x) => a + (x.day || 0), 0);
  const T = mvAll + cash;
  for (const x of holdings) x.w = T > 0 && x.mv != null ? x.mv / T : null;
  holdings.sort((a, b) => (b.mv || 0) - (a.mv || 0));
  const prevMv = mvAll - dayAll;
  return {
    holdings, closed,
    totals: {
      mv: mvAll, cost: costAll, pnl: pnlAll, pct: costAll > 0 ? pnlAll / costAll : null,
      day: dayAll, dayPct: prevMv > 0 ? dayAll / prevMv : null,
      cash, T, realized: realizedAll, divRecv: divAll, undated: undatedAll,
      annual: holdings.reduce((a, x) => a + (x.annual || 0), 0),
      months: holdings.reduce((acc, x) => acc.map((v, i) => v + (x.months[i] || 0)), new Array(12).fill(0)),
      total: pnlAll + realizedAll + divAll,
    },
  };
}

/** 依加入順序給每檔固定顏色（1–5 號），賣光後釋出；超過 5 檔歸為「其他」。 */
export function assignColors(pf, codesHeld) {
  const colors = { ...(pf.colors || {}) };
  for (const c of Object.keys(colors)) if (!codesHeld.includes(c)) delete colors[c];
  const used = new Set(Object.values(colors));
  for (const c of codesHeld) {
    if (colors[c] != null) continue;
    for (let k = 0; k < 5; k++) {
      if (!used.has(k)) { colors[c] = k; used.add(k); break; }
    }
  }
  return colors;
}

// ------------------------------------------------------------------ 建議
export function premBand(row) {
  if (!row) return [0.5, 1];
  return ['overseas', 'bond', 'fut'].includes(row.k) || row.fx ? [1, 2] : [0.5, 1];
}
export function capOf(profile, cat) {
  const p = PROFILES[profile] || PROFILES.mid;
  return p.caps[cat] ?? DEFAULT_CAP;
}

const pctS = (x, d = 1) => (isNum(x) ? (x * 100).toFixed(d) + '%' : '—');
const pxS = (x) => (isNum(x) ? x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');
const ntS = (x) => (isNum(x) ? Math.round(x).toLocaleString('en-US') : '—');

/** 把股數寫成「3 張 500 股」 */
export function sharesText(sh) {
  if (!isNum(sh)) return '—';
  const n = Math.round(sh);
  const lots = Math.floor(n / 1000);
  const odd = n % 1000;
  if (!n) return '0 股';
  return (lots ? `${lots.toLocaleString('en-US')} 張` : '') + (lots && odd ? ' ' : '') + (odd ? `${odd} 股` : '');
}

/** 回測統計：這一類 ETF 的某個部位訊號，和同類任何一天比。 */
export function signalEvidence(stats, key, catName) {
  if (!stats || !stats[key] || !stats.all || !(stats[key].n >= 60)) return null;
  const s = stats[key];
  const a = stats.all;
  return {
    n: s.n, up: s.up, base: a.up, avg: s.avg, baseAvg: a.avg, p10: s.p10, baseP10: a.p10,
    delta: s.up - a.up, catName,
  };
}

/**
 * 單一持股（或還沒持有、準備買進）的建議。全部依固定順序判斷，先符合先決定：
 *  1 資料不足 → none
 *  2 注意／處置中 → pause
 *  3 部位訊號「減碼」（觀點偏空且跌破移動防守線）→ trim
 *  4 比重超過上限 2 個百分點 → rebalance
 *  5 部位訊號「先不加碼」→ hold_off
 *  6 再買 1 股就超過上限 → full
 *  7 部位訊號「可加碼」或「漲多分批」→ add
 *  8 其他（中性）→ hold
 */
export function advise(H, ctx) {
  const r = H.row;
  const held = H.sh > 0;
  const out = { key: 'none', label: '', held, lines: [], plan: null, sell: null, ev: null };
  const fl = (r && r.fl) || [];
  const cat = r ? r.k : null;
  const catName = CAT_NAMES[cat] || '同類';
  const px = H.px;
  const T = ctx.T || 0;
  const prof = PROFILES[ctx.profile] || PROFILES.mid;
  const cap = capOf(ctx.profile, cat);
  const mv = held && px ? H.sh * px : 0;
  const w = T > 0 ? mv / T : 0;
  const [warn] = premBand(r);
  const prem = H.prem;
  const stats = ctx.stats || null;
  const add = (kind, text) => out.lines.push({ kind, text });

  if (!r || r.st == null || !isNum(px)) {
    out.key = 'none';
    out.label = '資料不足';
    add('info', r && r.young ? `上市只有 ${r.young} 個交易日，規則至少要 70 個交易日的資料才會給建議。` : '暫時沒有這檔的價格資料。');
    if (held && T > 0 && w > cap + OVER_TOL) add('con', `占總資產 ${pctS(w)}，超過你設定的上限 ${pctS(cap, 0)}。`);
    return out;
  }

  const restricted = fl.includes('disposal') || fl.includes('notice');
  const room = Math.max(0, cap * T - mv);
  let key;
  if (restricted) key = 'pause';
  else if (r.ps === 'trim' && held) key = 'trim';
  else if (held && T > 0 && w > cap + OVER_TOL) key = 'rebalance';
  else if (r.ps === 'trim' || r.ps === 'caution') key = 'hold_off';
  else if (T > 0 && room < px) key = held ? 'full' : 'hold_off';
  else if (r.ps === 'add' || r.ps === 'wait') key = 'add';
  else key = 'hold';
  out.key = key;
  const LABEL = held
    ? { pause: '暫停加碼', trim: '減碼', rebalance: '調節比重', hold_off: '先不加碼', full: '續抱', add: '可加碼', hold: '續抱' }
    : { pause: '暫停買進', trim: '先不買', rebalance: '先不買', hold_off: '先不買', full: '先不買', add: '可分批買進', hold: '觀望' };
  out.label = LABEL[key];

  // ---- 理由
  const st = r.st;
  if (st > 0) add('pro', `規則觀點偏多（分數 ${r.sc >= 0 ? '+' : ''}${r.sc.toFixed(2)}${r.cf != null ? `，信心 ${r.cf}` : ''}）。`);
  else if (st < 0) add('con', `規則觀點偏空（分數 ${r.sc.toFixed(2)}）。`);
  else add('info', `規則觀點中性（分數 ${r.sc >= 0 ? '+' : ''}${r.sc.toFixed(2)}）${isNum(r.r1) ? `：收盤站上 ${pxS(r.r1)} 轉偏多` : ''}${isNum(r.s1) ? `、跌破 ${pxS(r.s1)} 轉偏空` : ''}。`);
  if (isNum(r.dl)) {
    if (px >= r.dl) add('pro', `還在移動防守線 ${pxS(r.dl)} 之上，近期沒有明顯轉弱。`);
    else add('con', `已跌破移動防守線 ${pxS(r.dl)}，前一段上漲已經中斷。`);
  }
  if (isNum(prem)) {
    if (prem > warn) add('con', `溢價 ${prem.toFixed(2)}%，現在買等於比淨值多付 ${prem.toFixed(2)}%。`);
    else if (prem < -warn) add('pro', `折價 ${Math.abs(prem).toFixed(2)}%，買進價格比淨值便宜（也要留意折價的原因）。`);
    else add('pro', `市價接近淨值（${prem >= 0 ? '溢價' : '折價'} ${Math.abs(prem).toFixed(2)}%）。`);
  }
  if (r.hot && (key === 'add' || key === 'hold')) {
    const ev = signalEvidence(stats, 'wait', catName);
    add('warn', `短線漲多（${hotWhy(r, px)}）。${ev ? `回測中${catName}「漲多」之後 20 日上漲比例 ${pctS(ev.up, 0)}，同類任何一天 ${pctS(ev.base, 0)}——漲多不代表會跌，` : ''}怕買在高點就分批。`);
  }
  if (restricted) add('con', `目前被證交所／櫃買中心列為${fl.includes('disposal') ? '處置' : '注意'}標的，交易受限。`);
  if (T > 0) {
    if (held) {
      if (w > cap + OVER_TOL) add('con', `占總資產 ${pctS(w)}，超過你設定的上限 ${pctS(cap, 0)}（${prof.name}型、${catName}）。`);
      else add('pro', `占總資產 ${pctS(w)}，上限 ${pctS(cap, 0)}（${prof.name}型、${catName}）。`);
    }
  }
  if (cat === 'lev' || cat === 'inv') add('warn', '槓桿／反向型每天重新平衡，長期持有會偏離指數，只適合短線。');
  if (key === 'full') add('info', '比重已經到你設定的上限，續抱、不再加碼。');

  // ---- 回測證據
  const evKey = { add: r.ps === 'wait' ? 'wait' : 'add', hold: 'hold', hold_off: r.ps === 'trim' ? 'trim' : 'caution', trim: 'trim' }[key];
  const ev = evKey ? signalEvidence(stats, evKey, catName) : null;
  if (ev) {
    out.ev = { ...ev, key: evKey };
    if (evKey === 'trim') {
      add('stat', `回測（${catName}）：出現「減碼」訊號後 20 日上漲比例 ${pctS(ev.up, 0)}，同類任何一天 ${pctS(ev.base, 0)}；最差 10% 的情況 ${pctS(ev.p10)}，同類 ${pctS(ev.baseP10)}。減碼的用處是避開大跌，不是預測一定會跌。`);
    } else if (evKey === 'add' || evKey === 'wait') {
      const good = ev.delta >= 0.02;
      add('stat', `回測（${catName}）：「${evKey === 'wait' ? '漲多分批' : '可加碼'}」之後 20 日上漲比例 ${pctS(ev.up, 0)}，同類任何一天 ${pctS(ev.base, 0)}。${good ? '比任意時點好一些，可以當參考。' : '時機沒有明顯優勢，紀律與分批比挑時機重要。'}`);
    } else {
      add('stat', `回測（${catName}）：這個狀態之後 20 日上漲比例 ${pctS(ev.up, 0)}，同類任何一天 ${pctS(ev.base, 0)}。`);
    }
  }

  // ---- 加碼／買進計畫（觀點中性、或信心不到 70，股數再減半）
  if (key === 'add' || key === 'hold') {
    const weak = key === 'add' && !(isNum(r.cf) && r.cf >= CONF_FULL);
    out.plan = planAdd(H, ctx, { small: key === 'hold' || weak, why: key === 'hold' ? 'neutral' : weak ? 'conf' : null });
    if (weak) out.label = held ? '可小額加碼' : '可小額分批買進';
  }
  // ---- 減碼計畫
  if (held && (key === 'trim' || key === 'rebalance')) {
    let n = 0;
    const why = [];
    if (key === 'trim') {
      const f = TRIM_FRAC[cat] ?? TRIM_DEFAULT;
      n = Math.ceil(H.sh * f - 1e-9);
      why.push(f >= 1 ? '槓桿／反向型全部出場' : `依紀律先減${f === 0.5 ? '一半' : '三分之一'}`);
    }
    if (T > 0 && w > cap + OVER_TOL) {
      const over = Math.ceil((mv - cap * T) / px - 1e-9);
      if (over > n) { n = over; why.push(`減到上限 ${pctS(cap, 0)} 以內`); }
    }
    n = Math.min(H.sh, Math.max(0, n));
    if (n > 0) out.sell = simulateSell(H, n, px, ctx, why.join('，'));
  }

  // ---- 成本相關提醒（不讓成本影響方向判斷）
  if (held && isNum(H.avg)) {
    const pnlPct = px / H.avg - 1;
    if (pnlPct < 0 && ['hold_off', 'trim', 'pause'].includes(key)) {
      add('warn', `目前帳面虧損 ${pctS(-pnlPct)}。成本高低不會影響之後的漲跌，不要為了攤平而加碼。`);
    }
    if (isNum(r.dl) && r.dl < px) {
      const at = sellValue(H.sh, r.dl, cat, ctx.today, ctx.fee).net - H.cost;
      if (at > 0) add('pro', `就算跌到防守線 ${pxS(r.dl)} 出場，仍保有約 ${ntS(at)} 元獲利。`);
      else add('info', `如果跌到防守線 ${pxS(r.dl)} 出場，約虧 ${ntS(-at)} 元${T > 0 ? `（總資產 ${pctS(-at / T)}）` : ''}。`);
    }
    if (out.plan && out.plan.n > 0 && pnlPct < 0) {
      add('info', `照計畫買齊後，平均成本從 ${pxS(H.avg)} 變成 ${pxS(out.plan.newAvg)}；但加碼的理由是訊號與紀律，不是攤平。`);
    }
  }

  // ---- 除息
  const nd = r.dv;
  if (held && nd && nd.d >= ctx.today && daysBetween(ctx.today, nd.d) <= DIV_SOON_DAYS) {
    const amt = nd.cash ? Math.floor(nd.cash * H.sh + 1e-9) : null;
    add('info', `${Math.floor(nd.d / 100) % 100}/${nd.d % 100} 除息${nd.cash ? `，每單位 ${nd.cash} 元，預估可領 ${ntS(amt)} 元` : '，金額待公告'}。除息當天股價會扣掉配息，總報酬不變${amt >= NHI_THRESHOLD ? '；單次 2 萬元以上，股利所得部分會先扣 2.11% 二代健保補充保費' : ''}。`);
  }
  if (T <= 0) add('info', '在「部位」輸入可投入的現金或持股，才能依你的資金算出建議股數。');
  return out;
}

/** 「漲多」是哪個條件造成的 */
export function hotWhy(r, px) {
  const out = [];
  if (isNum(r.rsi) && r.rsi >= 75) out.push(`RSI ${Math.round(r.rsi)}`);
  if ((r.fl || []).includes('volume_spike')) out.push('爆量上漲');
  if (isNum(r.m20) && isNum(r.atr) && px > r.m20 + 2 * r.atr) out.push(`比月線高 ${((px / r.m20 - 1) * 100).toFixed(1)}%，超過 2 倍 ATR`);
  return out.join('、') || '技術指標偏熱';
}

/** 加碼計畫：依「單筆最多虧多少」「單檔上限」「分到的可用現金」三個條件取最小，分三批。 */
export function planAdd(H, ctx, opt = {}) {
  const r = H.row;
  const px = H.px;
  const cat = r.k;
  const T = ctx.T || 0;
  const prof = PROFILES[ctx.profile] || PROFILES.mid;
  const cap = capOf(ctx.profile, cat);
  const atr = isNum(r.atr) && r.atr > 0 ? r.atr : px * 0.015;
  let stop;
  let stopName;
  if (r.st > 0 && isNum(r.iv) && r.iv < px) { stop = r.iv; stopName = '作廢線'; }
  else if (isNum(r.dl) && r.dl < px) { stop = r.dl; stopName = '移動防守線'; }
  else { stop = tickDown(px - 2 * atr); stopName = '2 倍 ATR'; }
  const mv = H.sh > 0 ? H.sh * px : 0;
  const budget = T * prof.loss;
  const feeDisc = (ctx.fee && ctx.fee.disc) ?? 1;
  // 每股最壞虧損 = 價差 + 買賣手續費 + 賣出證交稅（保守用 0.1%）
  const perRisk = Math.max(px - stop, tick(px)) + px * FEE_RATE * feeDisc + stop * (FEE_RATE * feeDisc + 0.001);
  const byRisk = Math.floor(budget / perRisk);
  const byCap = Math.floor(Math.max(0, cap * T - mv) / px);
  const cash = ctx.cash || 0;
  const cashShare = isNum(ctx.cashShare) ? ctx.cashShare : cash / CASH_SLICES;
  const disc = (ctx.fee && ctx.fee.disc) ?? 1;
  const byCash = Math.floor(cashShare / (px * (1 + FEE_RATE * disc)));
  const ideal = Math.max(0, Math.min(byRisk, byCap));
  let n = Math.min(ideal, byCash);
  const limit = n === byCash && byCash < ideal ? 'cash' : byCap <= byRisk ? 'cap' : 'risk';
  if (opt.small) n = Math.floor(n / 2);
  n = Math.max(0, n);
  // 分三批：第一批現價附近；第二、三批等拉回價，沒等到就照時間買（回測顯示挑時機沒有明顯優勢，避免一直追不到）
  const p1 = tickRound(px);
  let p2 = isNum(r.pb) && r.pb < px - 0.3 * atr ? r.pb : tickDown(px - 0.5 * atr);
  if (!(p2 > stop + 0.2 * atr)) p2 = null;
  let p3 = p2 != null ? tickDown(Math.max(stop + 0.4 * atr, p2 - 0.5 * atr)) : null;
  if (p3 != null && !(p2 - p3 >= 0.3 * atr)) p3 = null;
  const base = Math.floor(n / 3);
  const rest = n - base * 3;   // 除不盡的零頭放在第 1 批
  const slots = [
    { px: p1, lim: null, when: '現價附近' },
    { px: p2 ?? p1, lim: p2, when: p2 != null ? '拉回到這個價位，或一週後' : '一週後' },
    { px: p3 ?? p2 ?? p1, lim: p3, when: p3 != null ? '拉回到這個價位，或兩週後' : '兩週後' },
  ];
  const parts = slots.map((x, i) => ({ ...x, sh: i === 0 ? base + rest : base })).filter((x) => x.sh > 0);
  let spend = 0;
  let fees = 0;
  let lossAtStop = 0;
  for (const t of parts) {
    // 沒等到拉回、照時間買的批次，用現價估算（最保守）
    const c = tradeCost('buy', t.sh, p1, cat, ctx.today, ctx.fee);
    spend += c.net;
    fees += c.fee;
    lossAtStop += t.sh * (p1 - stop) + c.fee;
  }
  if (n > 0) {
    const out = tradeCost('sell', n, stop, cat, ctx.today, ctx.fee);
    lossAtStop += out.fee + out.tax;
  }
  const newSh = H.sh + n;
  const newCost = (H.cost || 0) + spend;
  return {
    n, parts, stop, stopName, spend, fees, lossAtStop, budget, cap, limit, small: !!opt.small, smallWhy: opt.why || null,
    byRisk, byCap, byCash, cash, cashShare, ideal: opt.small ? Math.floor(ideal / 2) : ideal,
    newAvg: newSh > 0 ? newCost / newSh : null,
    newW: T > 0 ? (mv + n * px) / T : null,
  };
}

/** 加碼試算：使用者自己輸入股數與價格，逐條檢查紀律。 */
export function simulateAdd(H, sh, px, ctx) {
  const r = H.row;
  const cat = r ? r.k : null;
  const c = tradeCost('buy', sh, px, cat, ctx.today, ctx.fee);
  const T0 = ctx.T || 0;
  const mvAfter = (H.sh + sh) * (H.px || px);
  // 買進後總資產：現金轉成股票不變；現金不夠的部分是新投入的錢
  const T = T0 > 0 ? T0 + Math.max(0, c.net - (ctx.cash || 0)) : 0;
  const prof = PROFILES[ctx.profile] || PROFILES.mid;
  const cap = capOf(ctx.profile, cat);
  const newSh = H.sh + sh;
  const newCost = (H.cost || 0) + c.net;
  const newAvg = newSh > 0 ? newCost / newSh : null;
  const newW = T > 0 ? mvAfter / T : null;
  const checks = [];
  const chk = (ok, text) => checks.push({ ok, text });
  if (r && r.st != null) {
    if (r.st > 0) chk(true, '規則觀點偏多');
    else if (r.st === 0) chk(null, '規則觀點中性：不是買進訊號，只適合小額分批');
    else chk(false, '規則觀點偏空：新資金先不進場');
    if (isNum(r.dl)) chk(px >= r.dl, px >= r.dl ? `價格在移動防守線 ${pxS(r.dl)} 之上` : `價格低於移動防守線 ${pxS(r.dl)}：前一段上漲已中斷`);
    const [warn] = premBand(r);
    if (isNum(H.prem)) chk(H.prem <= warn, H.prem <= warn ? `溢價 ${H.prem.toFixed(2)}%，在 ${warn}% 以內` : `溢價 ${H.prem.toFixed(2)}%，超過 ${warn}%：等於多付錢`);
    if ((r.fl || []).some((f) => f === 'disposal' || f === 'notice')) chk(false, '注意／處置中，交易受限');
    if (r.hot) chk(null, '短線漲多：可以買，但建議分批');
  }
  if (newW != null) chk(newW <= cap + 1e-9, `買進後占總資產 ${pctS(newW)}，你的上限 ${pctS(cap, 0)}`);
  else chk(null, '還沒輸入現金或持股，無法檢查比重與單筆風險');
  let stop = null;
  if (r) {
    if (r.st > 0 && isNum(r.iv) && r.iv < px) stop = r.iv;
    else if (isNum(r.dl) && r.dl < px) stop = r.dl;
  }
  let risk = null;
  if (stop != null) {
    const out = tradeCost('sell', sh, stop, cat, ctx.today, ctx.fee);
    risk = sh * (px - stop) + c.fee + out.fee + out.tax;
    if (T > 0) {
      const budget = T * prof.loss;
      chk(risk <= budget + 1e-9, `跌到出場線 ${pxS(stop)} 約虧 ${ntS(risk)} 元，你的單筆上限 ${ntS(budget)} 元（總資產 ${pctS(prof.loss)}）`);
    }
  }
  if (ctx.cash > 0) chk(c.net <= ctx.cash + 1e-9, c.net <= ctx.cash ? `需要 ${ntS(c.net)} 元，可用現金 ${ntS(ctx.cash)} 元` : `需要 ${ntS(c.net)} 元，超過可用現金 ${ntS(ctx.cash)} 元`);
  else chk(null, '還沒設定可投入現金，無法檢查資金是否足夠');
  if (H.sh > 0 && isNum(H.avg) && px < H.avg && r && r.st < 0) chk(false, '偏空時往下買是攤平，不是加碼');
  if (cat === 'lev' || cat === 'inv') chk(null, '槓桿／反向型只適合短線');
  const fails = checks.filter((x) => x.ok === false).length;
  return {
    amount: c.amount, fee: c.fee, net: c.net, newSh, newAvg, newW, stop, risk, checks, fails,
    be: breakEven(newSh, newCost, cat, ctx.today, ctx.fee),
  };
}

/** 賣出試算：手續費、交易稅、已實現損益、剩下的比重。 */
export function simulateSell(H, sh, px, ctx, why = '') {
  const r = H.row;
  const cat = r ? r.k : null;
  const n = Math.min(sh, H.sh);
  const c = tradeCost('sell', n, px, cat, ctx.today, ctx.fee);
  const avg = H.avg || 0;
  const realized = c.net - avg * n;
  const restSh = H.sh - n;
  const T = ctx.T || 0;
  return {
    n, px, amount: c.amount, fee: c.fee, tax: c.tax, net: c.net, realized, why,
    restSh, restW: T > 0 ? (restSh * (H.px || px)) / T : null,
    taxFree: c.tax === 0 && n > 0,
  };
}

/** 風險地圖：如果每一檔都跌到出場線（偏多用作廢線、其他用移動防守線），整體會虧多少。 */
export function stressToStops(holdings, ctx) {
  let loss = 0;
  const items = [];
  for (const x of holdings) {
    const r = x.row;
    if (!r || !isNum(x.px) || !(x.h.sh > 0)) continue;
    let stop = null;
    if (r.st > 0 && isNum(r.iv) && r.iv < x.px) stop = r.iv;
    else if (isNum(r.dl) && r.dl < x.px) stop = r.dl;
    if (stop == null) continue;
    const drop = (stop - x.px) * x.h.sh;
    loss += drop;
    items.push({ code: x.code, name: x.name, stop, drop, pct: stop / x.px - 1 });
  }
  return { loss, pct: ctx.T > 0 ? loss / ctx.T : null, items: items.sort((a, b) => a.drop - b.drop) };
}

// ------------------------------------------------------------------ 備份
export function makeBackup(data) {
  return { app: 'coldeye', v: 1, at: new Date().toISOString(), ...data };
}
export function readBackup(obj) {
  if (!obj || obj.app !== 'coldeye' || !obj.pf || !Array.isArray(obj.pf.lots)) throw new Error('不是冷眼的備份資料');
  const okNum = (x) => typeof x === 'number' && Number.isFinite(x);
  const ids = new Set();
  for (const l of obj.pf.lots) {
    const okD = l.d == null || l.d === 0 || (Number.isInteger(l.d) && l.d >= 19000101 && l.d <= 21001231);
    const okOpt = (x) => x == null || (okNum(x) && x >= 0);
    if (typeof l.c !== 'string' || !okNum(l.sh) || !(l.sh > 0) || !okNum(l.px) || !(l.px > 0) || !['buy', 'sell'].includes(l.side)
      || !okD || !okOpt(l.fee) || !okOpt(l.tax) || typeof l.id !== 'string' || !l.id || ids.has(l.id)) {
      throw new Error('備份裡有格式不正確的交易紀錄');
    }
    ids.add(l.id);
  }
  if (obj.pf.cash != null && !okNum(obj.pf.cash)) throw new Error('備份裡的現金格式不正確');
  return obj;
}
