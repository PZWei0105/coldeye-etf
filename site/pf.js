/* 冷眼 — 我的部位：成本、損益、配息、建議的計算核心。
   全部是純函式，不碰畫面、不連網，同樣的輸入永遠得到同樣的結果。
   所有門檻都寫在這個檔案的常數裡，App 的「規則說明」照抄這裡。 */

// ------------------------------------------------------------------ 交易成本
export const FEE_RATE = 0.001425;          // 券商手續費率（法定上限），實際依折扣
export const ETF_TAX = 0.001;              // ETF 賣出證交稅 0.1%
export const BOND_TAX_FREE_UNTIL = 20261231; // 被動式債券 ETF 停徵證交稅到 2026/12/31
// 主動式債券 ETF（代號尾碼 D）目前不在停徵範圍，賣出照課 0.1%。行政院 2026/10 已提案：被動式延長到 2036/12/31、
// 主動式從 2027/1/1 起納入。立法院三讀後，把上一行改成 20361231、下一行改成 20270101，並同步更新設定頁與看懂模式的說明。
export const ACTIVE_BOND_FREE_FROM = null;
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

// ------------------------------------------------------------------ 加碼計畫：可動用的錢、單一公司、同類型、溢價（allocAdds）
// 單一公司：把每檔 ETF 拆開（投信投顧公會基金投資明細）加總，你透過 ETF 間接押在同一家公司的錢，最多占總資產多少。
// 透視頁 20% 的琥珀提醒照舊（XR.oneCo），這裡是加碼時的上限：保守 20%、穩健 30%、積極 40%。
export const CO_CAP = { cons: 0.2, mid: 0.3, aggr: 0.4 };
export const CO_MIN = 0.005;               // 在這檔 ETF 裡占不到 0.5% 的公司不檢查（影響太小）
export const DCA_RESERVE_DAYS = 31;        // 定期定額接下來 31 天要扣的錢先保留，不拿去加碼（扣款失敗連 3 次國泰會全部終止）
export const PREM_CUT = [1, 2];            // 盤中溢價超過警戒線的 1 倍：股數減半；2 倍：先不買（警戒線見 premBand）
export const coCapOf = (profile) => CO_CAP[profile] ?? CO_CAP.mid;

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
/** 算證交稅用的類別：主動式債券 ETF（代號尾碼 D）和被動式的停徵範圍不同，要分開。 */
export function taxCat(row) {
  if (!row) return null;
  return row.k === 'bond' && /D$/i.test(row.c || '') ? 'abond' : row.k;
}
export function taxRateOf(cat, date) {
  if (cat === 'bond' && (!date || date <= BOND_TAX_FREE_UNTIL)) return 0;
  if (cat === 'abond' && ACTIVE_BOND_FREE_FROM && date && date >= ACTIVE_BOND_FREE_FROM && date <= BOND_TAX_FREE_UNTIL) return 0;
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

/** 交易紀錄的現金流（模擬倉算現金用）：買進付出成交金額＋手續費，賣出拿回成交金額－手續費－證交稅。
 *  和 holdingFromLots 一樣照時間重播：賣出超過當時持股的部分不算錢（不然刪掉買進後，賣出的錢還留著）。 */
export function lotsCashFlow(lots, splitsOf = () => []) {
  const held = new Map();
  let flow = 0;
  for (const raw of sortLots(lots)) {
    const l = normLot(raw, splitsOf(raw.c));
    const fee = isNum(raw.fee) ? raw.fee : 0;
    const tax = isNum(raw.tax) ? raw.tax : 0;
    const h = held.get(raw.c) || 0;
    if (raw.side === 'sell') {
      const n = Math.min(l.nsh, h);
      if (!(n > 1e-9) || !(l.nsh > 0)) continue;
      flow += (n / l.nsh) * (raw.sh * raw.px - fee - tax);
      held.set(raw.c, h - n);
    } else {
      flow -= raw.sh * raw.px + fee;
      held.set(raw.c, h + l.nsh);
    }
  }
  return flow;
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
      // 賣出最多賣到手上有記日期的股數：多賣的是「不記得日期」的舊股，不能讓之後新買的股數變成負的
      held = l.side === 'sell' ? Math.max(0, held - l.nsh) : held + l.nsh;
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
  const quotes = new Map();
  for (const code of byCode.keys()) { const row = rows.get(code) || null; quotes.set(code, row ? quoteOf(row) : null); }
  // 最新的交易日（各檔報價日期裡最新的）。某一檔在那天沒有新的成交價（冷門、還沒成交），它那天的漲跌是 0：
  // 不能把它前一個交易日的漲跌算進「今日損益」（不然一部分是今天、一部分是昨天）
  const mkt = Math.max(0, ...[...quotes.values()].map((q) => (q && q.date) || 0));
  for (const [code, lots] of byCode) {
    const row = rows.get(code) || null;
    const dv = (divsData && divsData[code]) || { d: [], s: [] };
    const splits = dv.s || [];
    const h = holdingFromLots(lots, splits);
    const cat = row ? row.k : null;
    const tcat = taxCat(row);
    const q = quotes.get(code);
    const stale = !!(q && q.date && mkt && q.date < mkt);
    // 配息只算到「畫面上價格的日期」為止：除息日開盤前（價格還是昨收）、或除息後還沒有新成交的冷門 ETF，
    // 價格裡還含著那次配息，這時候先不算，不然股息會被算兩次（價格裡一次、已領配息一次）
    const divAsOf = q && q.date ? Math.min(q.date, today) : today;
    const rec = dividendsReceived(lots, dv.d, splits, divAsOf);
    realizedAll += h.realized;
    divAll += rec.total;
    undatedAll += rec.undated;
    const px = q && isNum(q.px) ? q.px : null;
    if (!(h.sh > 0)) {
      let dayC = null;
      if (q && isNum(q.ch) && px != null) {
        const qd = stale ? mkt : q.date || today;
        let before = 0;
        let tp = 0;
        for (const l of sortLots(lots).map((x) => normLot(x, splits))) {
          if (l.d && l.d >= qd) tp += (l.side === 'sell' ? l.npx - px : px - l.npx) * l.nsh;
          else before += (l.side === 'sell' ? -1 : 1) * l.nsh;
        }
        dayC = (stale ? 0 : Math.max(0, before) * q.ch) + tp;
        if (!(Math.abs(dayC) > 1e-9) || !lots.some((l) => l.d && l.d >= qd)) dayC = null;   // 只算今天清掉的
      }
      closed.push({ code, row, name: row ? row.n : code, h, divRecv: rec.total, day: dayC });
      continue;
    }
    const mv = px != null ? h.sh * px : null;
    const sv = px != null ? sellValue(h.sh, px, tcat, today, cfg) : null;
    const pnl = sv ? sv.net - h.cost : null;
    // 今日損益：今天以前就持有的股數 × 今日漲跌；今天買的用買進價計算
    // 今日損益：報價日以前就持有的股數 × 今日漲跌；報價日當天的買賣，用成交價和現價的差計算
    let day = null;
    if (q && isNum(q.ch) && px != null) {
      const qd = stale ? mkt : q.date || today;
      let before = 0;
      let todayPart = 0;
      for (const l of sortLots(lots).map((x) => normLot(x, splits))) {
        if (l.d && l.d >= qd) todayPart += (l.side === 'sell' ? l.npx - px : px - l.npx) * l.nsh;
        else before += (l.side === 'sell' ? -1 : 1) * l.nsh;
      }
      day = (stale ? 0 : Math.max(0, before) * q.ch) + todayPart;
    }
    const tr = trailingDividends(dv.d, splits, today);
    const nd = row && row.dv && row.dv.d >= today ? row.dv : null;
    holdings.push({
      code, row, name: row ? row.n : code, cat, q, px, h, mv, pnl,
      pct: pnl != null && h.cost > 0 ? pnl / h.cost : null,
      day, divRecv: rec.total, divItems: rec.items, undated: rec.undated,
      ttm: tr.ttm, months: tr.months.map((x) => x * h.sh), annual: tr.ttm * h.sh,
      nextDiv: nd ? { ...nd, amt: nd.cash ? Math.floor(nd.cash * h.sh + 1e-9) : null } : null,
      be: breakEven(h.sh, h.cost, tcat, today, cfg), sell: sv,
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

  // ---- 加碼／買進計畫（觀點中性、或信心不到 70，股數再減半；盤中溢價太高再減半或先不買）
  if (key === 'add' || key === 'hold') {
    const weak = key === 'add' && !(isNum(r.cf) && r.cf >= CONF_FULL);
    const p = planAdd(H, ctx, { small: key === 'hold' || weak, why: key === 'hold' ? 'neutral' : weak ? 'conf' : null });
    out.plan = p;
    if (key === 'add' && (weak || p.cuts.includes('prem'))) out.label = held ? '可小額加碼' : '可小額分批買進';
    if (!(p.n > 0) && (p.limit === 'cat' || p.limit === 'co') && T > 0) {
      // 同類型合計、或透過 ETF 間接持有的某一家公司已經到上限：這一檔再好也不加
      if (key === 'add') { out.key = 'full'; out.label = held ? '續抱' : '先不買'; }
      add('info', planWhy(p, { catName }) + '。');
    } else if (p.cuts.includes('prem0')) {
      if (key === 'add') { out.key = 'hold_off'; out.label = held ? '先不加碼' : '先不買'; }
      add('con', `盤中溢價 ${p.prem.toFixed(2)}%，超過警戒線 ${warn}% 的 ${PREM_CUT[1]} 倍：先不買，等溢價回到 ${warn}% 以內再說。`);
    } else if (p.cuts.includes('prem') && p.n > 0) {
      add('warn', `盤中溢價 ${p.prem.toFixed(2)}%，超過警戒線 ${warn}%：股數先減半。`);
    }
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
      const at = sellValue(H.sh, r.dl, taxCat(r), ctx.today, ctx.fee).net - H.cost;
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
    add('info', `${Math.floor(nd.d / 100) % 100}/${nd.d % 100} 除息${nd.cash ? `，每單位 ${nd.cash} 元，預估可領 ${ntS(amt)} 元` : '，金額待公告'}。除息當天股價會扣掉配息，總報酬不變${amt >= NHI_THRESHOLD ? '；單次 2 萬元以上，股利與利息所得的部分會先扣 2.11% 二代健保補充保費' : ''}。`);
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

/** 加碼計畫的減半原因（白話） */
export const CUT_TEXT = { conf: '信心不到 70，減半', neutral: '觀點中性，減半', prem: '溢價超過警戒線，減半' };
/** 加碼計畫的現金分成幾份（同時超過 CASH_SLICES 檔拿到計畫時平均分） */
export const planSlices = (p) => (p && p.cash > 0 && p.cashShare > 0 ? Math.max(CASH_SLICES, Math.round(p.cash / p.cashShare)) : CASH_SLICES);
/** 有股數時「受限於什麼」（不含減半原因） */
export function planLimitText(p, o = {}) {
  if (!p) return '';
  const catName = o.catName || CAT_NAMES[o.cat] || '同類型';
  const pc = (x) => `${Math.round(x * 100)}%`;
  return {
    cash: `分到的現金（可動用的錢分 ${planSlices(p)} 份，每檔最多 1 份）`,
    cap: `這一檔的比重上限 ${pc(p.cap)}`,
    cat: `${catName}合計的上限 ${pc(p.cap)}`,
    co: `單一公司的上限（${p.coName || '同一家公司'}）`,
    risk: '單筆最多虧損的金額',
  }[p.limit] || '';
}
/**
 * 加碼計畫的股數是被哪一個條件卡住的（白話；冷眼建議、加碼計畫卡、今日行動、副官共用）。
 * 0 股時說「為什麼是 0」，有股數時說「受限於什麼」＋減半的原因。o.catName／o.cat：這一類的名稱或代號。
 */
export function planWhy(p, o = {}) {
  if (!p) return '';
  const catName = o.catName || CAT_NAMES[o.cat] || '同類型';
  const pc = (x) => `${Math.round(x * 100)}%`;
  if (!(p.n > 0)) {
    if (p.cuts && p.cuts.includes('prem0')) return `溢價超過警戒線 ${PREM_CUT[1]} 倍，先不買`;
    switch (p.limit) {
      case 'cash':
        if (!(p.cashAll > 0)) return '還沒設定可投入現金';
        if (!(p.cash > 0)) return '現金扣掉緊急預備金、定期定額接下來要扣的錢，沒有可以動用的';
        return '分到的可動用現金不夠買 1 股';
      case 'cap': return `這一檔已經到比重上限 ${pc(p.cap)}`;
      case 'cat': return `${catName}合計已經到上限 ${pc(p.cap)}`;
      case 'co': return `透過 ETF 間接持有的${p.coName || '同一家公司'}已經到單一公司上限 ${pc(p.coCap ?? CO_CAP.mid)}`;
      default: return '單筆最多虧損的預算太小（離出場線太遠）';
    }
  }
  return `受限於${planLimitText(p, o)}${(p.cuts || []).filter((c) => CUT_TEXT[c]).map((c) => '；' + CUT_TEXT[c]).join('')}`;
}

/**
 * 加碼計畫（一檔）：股數取這幾個的最小值，再分三批——
 *  risk 單筆最多虧多少（總資產 × 風險屬性）÷ 每股跌到出場線的最壞虧損（含來回手續費、證交稅）
 *  cap  這一檔的比重上限還剩多少
 *  cat  同類型合計上限還剩多少（ctx.room.cat；加碼計畫裡排在前面的已經扣掉）
 *  co   單一公司（穿透）上限還剩多少（ctx.room.co：這檔裡每一家公司的比例與剩下的空間）
 *  cash 分到的可動用現金（ctx.cash 已經扣掉緊急預備金、定期定額保留款；分 3 份、同時超過 3 檔平均分）
 * 之後：觀點中性、信心不到 70 再減半；盤中溢價超過警戒線減半、超過 2 倍先不買。
 * 市場溫度不改股數：拿溫度去打折加碼金額，2020/4～2026/10 的回測沒有變好（pipeline/addsim.py），溫度只用來提醒風險。
 */
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
  const room = ctx.room || {};
  const byCat = isNum(room.cat) ? Math.floor(Math.max(0, room.cat) / px) : Infinity;
  let byCo = Infinity;
  let coName = null;
  let coW = null;
  for (const c of room.co || []) {
    if (!(c.w >= CO_MIN)) continue;
    const k = Math.floor(Math.max(0, c.room) / (c.w * px));
    if (k < byCo) { byCo = k; coName = c.name; coW = c.w; }
  }
  const cash = ctx.cash || 0;
  const cashShare = isNum(ctx.cashShare) ? ctx.cashShare : cash / CASH_SLICES;
  const byCash = Math.floor(Math.max(0, cashShare) / (px * (1 + FEE_RATE * feeDisc)));
  // 先看紀律（比重、同類型、單一公司、虧損預算）最多幾股，再看分到的現金夠不夠
  const lims = [['cap', byCap], ['cat', byCat], ['co', byCo], ['risk', byRisk]];
  let ideal = Math.max(0, Math.min(...lims.map((x) => x[1])));
  let limit = lims.find((x) => x[1] <= ideal)[0];
  let n = Math.min(ideal, byCash);
  if (byCash < ideal) limit = 'cash';
  const cuts = [];
  const cut = (f, why) => { n = Math.floor(n * f); ideal = Math.floor(ideal * f); cuts.push(why); };
  if (opt.small) cut(0.5, opt.why === 'conf' ? 'conf' : 'neutral');
  const [warn] = premBand(r);
  const prem = 'prem' in opt ? opt.prem : H.prem;
  if (isNum(prem) && prem > warn * PREM_CUT[1]) cut(0, 'prem0');
  else if (isNum(prem) && prem > warn * PREM_CUT[0]) cut(0.5, 'prem');
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
    const c = tradeCost('buy', t.sh, p1, taxCat(r), ctx.today, ctx.fee);
    spend += c.net;
    fees += c.fee;
    lossAtStop += t.sh * (p1 - stop) + c.fee;
  }
  if (n > 0) {
    const out = tradeCost('sell', n, stop, taxCat(r), ctx.today, ctx.fee);
    lossAtStop += out.fee + out.tax;
  }
  const newSh = H.sh + n;
  const newCost = (H.cost || 0) + spend;
  return {
    n, parts, stop, stopName, spend, fees, lossAtStop, budget, cap, limit, small: !!opt.small, smallWhy: opt.why || null,
    cuts, prem: isNum(prem) ? prem : null, warn,
    byRisk, byCap, byCat: isFinite(byCat) ? byCat : null, byCo: isFinite(byCo) ? byCo : null, coName, coW,
    coNote: room.coNote || null, coCap: coCapOf(ctx.profile), byCash, cash, cashAll: isNum(ctx.cashAll) ? ctx.cashAll : cash, cashShare, ideal,
    newAvg: newSh > 0 ? newCost / newSh : null,
    newW: T > 0 ? (mv + n * px) / T : null,
  };
}

/** 成分股明細選哪一份：每季 1% 以上的明細不比每月前十大舊 staleQ 個月以上就用每季（比較完整），和透視一樣 */
export function holdList(obj, staleQ = 2) {
  if (!obj) return null;
  const m = obj.m, q = obj.q;
  const months = (a, b) => (+String(a).slice(0, 4) - +String(b).slice(0, 4)) * 12 + (+String(a).slice(4) - +String(b).slice(4));
  if (q && (!m || months(m.p, q.p) <= staleQ)) return { ...q, k: 'q' };
  return m ? { ...m, k: 'm' } : null;
}
const isCompany = (kind) => kind === 'tse' || kind === 'otc' || kind === 'f';

/**
 * 你現在透過 ETF 間接持有每一家公司多少錢（金額，不是比例）。
 * holdings：[{ code, mv }]；lists：{ 代號: holdList 的結果 | null | undefined }
 * 回傳 { amt: { 公司 key: { name, amt } }, pending: [還沒載入明細的代號] }
 */
export function companyExposure(holdings, lists) {
  const amt = {};
  const pending = [];
  for (const x of holdings || []) {
    if (!(x.mv > 0)) continue;
    const L = lists[x.code];
    if (L === undefined) { pending.push(x.code); continue; }
    for (const it of (L && L.h) || []) {
      if (!isCompany(it[2]) || !isNum(it[3])) continue;
      const key = it[0] || it[1];
      if (!amt[key]) amt[key] = { name: it[1], amt: 0 };
      amt[key].amt += x.mv * it[3] / 100;
    }
  }
  return { amt, pending };
}

/**
 * 加碼計畫（全部）：把可動用的錢分給候選的 ETF（你持有的＋關注的），一檔一檔排；
 * 排在前面的用掉的同類型、同一家公司的空間，後面就少了（不會兩檔各算一次，加起來超過上限）。
 * cands：[{ code, H }]（H 是 advise 的輸入）
 * base：advise 的 ctx（T、cash＝可動用的錢、cashAll＝全部現金、reserve＝deployOf 的拆解、profile、fee、today）＋
 *   stats(code)：這一檔類別的回測統計；catMV：{ 類型: 目前市值 }；coAmt：companyExposure(...).amt；
 *   lists：{ 代號: holdList 的結果 | null（確定沒有明細）| undefined（還沒載入）}
 * 順序：可加碼的（信心高的先）→ 續抱裡「想加碼的話」那種（分數高的先）→ 其他；同分照代號。
 * 回傳 { adv: Map(代號 → advise 結果), order, share（每檔分到的現金上限）, n（拿到計畫的檔數）, rooms(row) }
 */
export function allocAdds(cands, base) {
  const T = base.T || 0;
  // 成分股明細：候選的在 base.lists；不在候選裡的（從雷達打開的）用 base.listOf 去找
  const listOf = (code) => (base.lists && code in base.lists ? base.lists[code] : typeof base.listOf === 'function' ? base.listOf(code) : undefined);
  const coCap = coCapOf(base.profile);
  const statsOf = (code) => (typeof base.stats === 'function' ? base.stats(code) : null);
  const mkRooms = () => {
    const cat = {};
    const co = new Map();
    return {
      cat, co,
      of(row, code) {
        const k = row ? row.k : null;
        if (cat[k] == null) cat[k] = capOf(base.profile, k) * T - ((base.catMV || {})[k] || 0);
        const L = listOf(code);
        const list = [];
        for (const it of (L && L.h) || []) {
          if (!isCompany(it[2]) || !isNum(it[3])) continue;
          const key = it[0] || it[1];
          if (!co.has(key)) co.set(key, coCap * T - (((base.coAmt || {})[key] || {}).amt || 0));
          list.push({ key, name: it[1], w: it[3] / 100, room: co.get(key) });
        }
        return { cat: cat[k], co: L ? list : null, coNote: L === undefined ? 'pending' : L === null ? 'none' : null };
      },
      use(row, code, plan) {
        if (!plan || !(plan.n > 0)) return;
        const amt = plan.n * (plan.parts[0] ? plan.parts[0].px : 0);
        const k = row ? row.k : null;
        cat[k] -= amt;
        const L = listOf(code);
        for (const it of (L && L.h) || []) {
          if (!isCompany(it[2]) || !isNum(it[3])) continue;
          const key = it[0] || it[1];
          if (co.has(key)) co.set(key, co.get(key) - amt * it[3] / 100);
        }
      },
    };
  };
  const ctxOf = (code, room, share) => ({ ...base, stats: statsOf(code), room, cashShare: share });
  // 第一輪：有幾檔會拿到加碼計畫（決定現金分幾份）
  const r0 = mkRooms();
  const first = cands.map((c) => ({ c, a: advise(c.H, ctxOf(c.code, r0.of(c.H.row, c.code), (base.cash || 0) / CASH_SLICES)) }));
  const n = first.filter((x) => x.a.plan && x.a.plan.n > 0).length;
  const share = (base.cash || 0) / Math.max(CASH_SLICES, n);
  // 第二輪：照順序分，用掉的空間扣掉
  const rank = (x) => (x.a.key === 'add' ? 0 : x.a.key === 'hold' ? 1 : 2);
  const sorted = first.slice().sort((x, y) => rank(x) - rank(y)
    || (rank(x) === 0 ? ((y.c.H.row && y.c.H.row.cf) || 0) - ((x.c.H.row && x.c.H.row.cf) || 0) : 0)
    || (((y.c.H.row && y.c.H.row.sc) || 0) - ((x.c.H.row && x.c.H.row.sc) || 0))
    || (x.c.code < y.c.code ? -1 : x.c.code > y.c.code ? 1 : 0));
  const R = mkRooms();
  const adv = new Map();
  for (const { c } of sorted) {
    const a = advise(c.H, ctxOf(c.code, R.of(c.H.row, c.code), share));
    adv.set(c.code, a);
    R.use(c.H.row, c.code, a.plan);
  }
  return {
    adv, order: sorted.map((x) => x.c.code), share, n,
    /** 不在候選裡的一檔（例如從雷達打開的）：用加碼計畫分完之後剩下的空間算「如果另外買這檔」 */
    adviseOther(H, code) { return advise(H, ctxOf(code, R.of(H.row, code), share)); },
  };
}

/** 加碼試算：使用者自己輸入股數與價格，逐條檢查紀律。 */
export function simulateAdd(H, sh, px, ctx) {
  const r = H.row;
  const cat = r ? r.k : null;
  const tcat = taxCat(r);
  const c = tradeCost('buy', sh, px, tcat, ctx.today, ctx.fee);
  const T0 = ctx.T || 0;
  const mvAfter = (H.sh + sh) * (H.px || px);
  // 買進後總資產：現金轉成股票不變；現金（全部，含緊急預備金）不夠的部分是新投入的錢
  const cashAll = isNum(ctx.cashAll) ? ctx.cashAll : (ctx.cash || 0);
  const T = T0 > 0 ? T0 + Math.max(0, c.net - cashAll) : 0;
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
  // 同類型合計（例如 0050 和 006208 都是市值型，合起來也不能超過上限）：同一類還有別檔時才另外列
  if (T > 0 && ctx.catMV && cat) {
    const others = (ctx.catMV[cat] || 0) - H.sh * (H.px || px);
    if (others > 1) {
      const catW = (others + mvAfter) / T;
      chk(catW <= cap + 1e-9, `買進後${CAT_NAMES[cat] || '同類型'}合計占總資產 ${pctS(catW)}，同類型上限 ${pctS(cap, 0)}`);
    }
  }
  // 單一公司（穿透）：這檔 ETF 裡的每一家公司，加上你透過其他 ETF 已經間接持有的
  if (T > 0 && r && (ctx.lists || ctx.listOf)) {
    const L = ctx.lists && r.c in ctx.lists ? ctx.lists[r.c] : typeof ctx.listOf === 'function' ? ctx.listOf(r.c) : undefined;
    if (L === undefined) chk(null, '成分股明細還在載入：單一公司的上限這次沒有檢查');
    else if (L && L.h) {
      const coCap = coCapOf(ctx.profile);
      let worst = null;
      for (const it of L.h) {
        if (!isCompany(it[2]) || !isNum(it[3]) || it[3] / 100 < CO_MIN) continue;
        const key = it[0] || it[1];
        const had = ((ctx.coAmt || {})[key] || {}).amt || 0;
        const w = (had + c.amount * it[3] / 100) / T;
        if (!worst || w > worst.w) worst = { name: it[1], w };
      }
      if (worst) chk(worst.w <= coCap + 1e-9, `買進後透過 ETF 間接持有的${worst.name}占總資產 ${pctS(worst.w)}，單一公司上限 ${pctS(coCap, 0)}`);
    }
  }
  let stop = null;
  if (r) {
    if (r.st > 0 && isNum(r.iv) && r.iv < px) stop = r.iv;
    else if (isNum(r.dl) && r.dl < px) stop = r.dl;
  }
  let risk = null;
  if (stop != null) {
    const out = tradeCost('sell', sh, stop, tcat, ctx.today, ctx.fee);
    risk = sh * (px - stop) + c.fee + out.fee + out.tax;
    if (T > 0) {
      const budget = T * prof.loss;
      chk(risk <= budget + 1e-9, `跌到出場線 ${pxS(stop)} 約虧 ${ntS(risk)} 元，你的單筆上限 ${ntS(budget)} 元（總資產 ${pctS(prof.loss)}）`);
    }
  }
  // 可動用的錢＝現金扣掉緊急預備金、定期定額接下來要扣的（ctx.reserve 是 core.js 的 deployOf）
  const rs = ctx.reserve || null;
  const held = rs ? (rs.emergency || 0) + ((rs.dca && rs.dca.total) || 0) : 0;
  if (cashAll > 0) {
    const usable = isNum(ctx.cash) ? ctx.cash : cashAll;
    const tail = held > 0 ? `（現金 ${ntS(cashAll)} 元，扣掉${rs.emergency > 0 ? `緊急預備金 ${ntS(rs.emergency)} 元` : ''}${rs.emergency > 0 && rs.dca && rs.dca.total > 0 ? '、' : ''}${rs.dca && rs.dca.total > 0 ? `定期定額接下來要扣的 ${ntS(rs.dca.total)} 元` : ''}）` : '';
    if (c.net <= usable + 1e-9) chk(true, `需要 ${ntS(c.net)} 元，可動用 ${ntS(usable)} 元${tail}`);
    else if (c.net <= cashAll + 1e-9) chk(false, `需要 ${ntS(c.net)} 元，超過可動用的 ${ntS(usable)} 元：會用到${rs && rs.emergency > 0 ? '緊急預備金' : ''}${rs && rs.emergency > 0 && rs.dca && rs.dca.total > 0 ? '或' : ''}${rs && rs.dca && rs.dca.total > 0 ? '定期定額要扣的錢（扣款失敗不補扣，連續 3 次會被終止）' : ''}`);
    else chk(false, `需要 ${ntS(c.net)} 元，超過現金 ${ntS(cashAll)} 元`);
  } else chk(null, '還沒設定可投入現金，無法檢查資金是否足夠');
  if (H.sh > 0 && isNum(H.avg) && px < H.avg && r && r.st < 0) chk(false, '偏空時往下買是攤平，不是加碼');
  if (cat === 'lev' || cat === 'inv') chk(null, '槓桿／反向型只適合短線');
  const fails = checks.filter((x) => x.ok === false).length;
  return {
    amount: c.amount, fee: c.fee, net: c.net, newSh, newAvg, newW, stop, risk, checks, fails,
    be: breakEven(newSh, newCost, tcat, ctx.today, ctx.fee),
  };
}

/** 賣出試算：手續費、交易稅、已實現損益、剩下的比重。 */
export function simulateSell(H, sh, px, ctx, why = '') {
  const r = H.row;
  const tcat = taxCat(r);
  const n = Math.min(sh, H.sh);
  const c = tradeCost('sell', n, px, tcat, ctx.today, ctx.fee);
  const avg = H.avg || 0;
  const realized = c.net - avg * n;
  const restSh = H.sh - n;
  const T = ctx.T || 0;
  return {
    n, px, amount: c.amount, fee: c.fee, tax: c.tax, net: c.net, realized, why,
    restSh, restW: T > 0 ? (restSh * (H.px || px)) / T : null,
    taxFree: n > 0 && taxRateOf(tcat, ctx.today) === 0,
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
/**
 * 讀備份（還原前檢查）：格式不對就丟出錯誤；能修的逐欄重建（代號、id、定期定額欄位、提醒、偏好設定），
 * 免得一份動過手腳的備份碼在畫面上變成可以執行的程式。回傳整理過的 obj。
 */
export function readBackup(obj) {
  if (!obj || obj.app !== 'coldeye' || !obj.pf || !Array.isArray(obj.pf.lots)) throw new Error('不是冷眼的備份資料');
  const okNum = (x) => typeof x === 'number' && Number.isFinite(x);
  const okDate = (d) => Number.isInteger(d) && d >= 19000101 && d <= 21001231;
  const CODE = /^[0-9A-Z]{4,8}$/;
  const ID = /^[0-9A-Za-z_.:-]{1,64}$/;
  const cleanDca = (x) => {
    if (!x || typeof x !== 'object' || typeof x.plan !== 'string' || !/^[0-9a-z_-]{1,40}$/i.test(x.plan) || !okDate(x.s)) return null;
    const o = { plan: x.plan, s: x.s, est: x.est === true };
    if (okDate(x.cal)) o.cal = x.cal;
    if (okDate(x.pd)) o.pd = x.pd;
    if (x.link === true) o.link = true;
    return o;
  };
  const cleanColors = (c) => Object.fromEntries(Object.entries(c && typeof c === 'object' ? c : {}).filter(([k, v]) => CODE.test(k) && Number.isInteger(v) && v >= 0 && v < 32));
  const checkLots = (lots) => {
    const ids = new Set();
    for (const l of lots) {
      if (l && typeof l.c === 'string') l.c = l.c.toUpperCase();
      const okD = l && (l.d == null || l.d === 0 || okDate(l.d));
      const okOpt = (x) => x == null || (okNum(x) && x >= 0);
      if (!l || typeof l.c !== 'string' || !CODE.test(l.c) || !okNum(l.sh) || !(l.sh > 0) || !okNum(l.px) || !(l.px > 0) || !['buy', 'sell'].includes(l.side)
        || !okD || !okOpt(l.fee) || !okOpt(l.tax) || typeof l.id !== 'string' || !ID.test(l.id) || ids.has(l.id)) {
        throw new Error('備份裡有格式不正確的交易紀錄');
      }
      ids.add(l.id);
      if (l.dca != null) { const x = cleanDca(l.dca); if (x) l.dca = x; else delete l.dca; }
      if (l.snap != null && !(l.snap && typeof l.snap === 'object' && [1, 0, -1].includes(l.snap.st))) delete l.snap;
      if (l.note != null) { if (typeof l.note === 'string') l.note = l.note.slice(0, 200); else delete l.note; }
    }
  };
  checkLots(obj.pf.lots);
  obj.pf.colors = cleanColors(obj.pf.colors);
  if (obj.pf.cash != null && !okNum(obj.pf.cash)) throw new Error('備份裡的現金格式不正確');
  if (obj.paper != null) {
    const p = obj.paper;
    const st = p && p.start;
    if (!p || !Array.isArray(p.lots) || !st || !okNum(st.cash0) || !(st.cash0 > 0) || !okNum(st.px0) || !(st.px0 > 0) || !Number.isInteger(st.d)) {
      throw new Error('備份裡的模擬倉格式不正確');
    }
    checkLots(p.lots);
    p.colors = cleanColors(p.colors);
    if (st.code != null && !(typeof st.code === 'string' && CODE.test(st.code))) st.code = '0050';
  }
  // 到價提醒：逐欄重建
  if (obj.alerts != null) {
    if (!Array.isArray(obj.alerts)) throw new Error('備份裡的提醒格式不正確');
    const seen = new Set();
    obj.alerts = obj.alerts.filter((a) => a && typeof a === 'object' && typeof a.c === 'string' && CODE.test(a.c.toUpperCase()) && okNum(a.px) && a.px > 0).slice(0, 300).map((a, i) => {
      let id = typeof a.id === 'string' && ID.test(a.id) && !seen.has(a.id) ? a.id : `r${i}${Date.now().toString(36)}`;
      while (seen.has(id)) id += 'x';
      seen.add(id);
      return { id, c: a.c.toUpperCase(), op: a.op === 'le' ? 'le' : 'ge', px: a.px, at: typeof a.at === 'string' ? a.at.slice(0, 40) : null, hit: okDate(a.hit) ? a.hit : null };
    });
  }
  // 偏好設定：只留認得的欄位（定期定額的計畫之後還會經過 calc.js 的 normPlan 逐欄檢查）
  if (obj.prefs != null) {
    const p = obj.prefs;
    if (!p || typeof p !== 'object') throw new Error('備份裡的設定格式不正確');
    const out = {};
    if (Array.isArray(p.watch)) out.watch = [...new Set(p.watch.filter((c) => typeof c === 'string').map((c) => c.toUpperCase()).filter((c) => CODE.test(c)))].slice(0, 60);
    if (typeof p.risk === 'string' && Object.prototype.hasOwnProperty.call(PROFILES, p.risk)) out.risk = p.risk;
    if (p.fee && typeof p.fee === 'object') {
      const f = { ...DEFAULT_FEE };
      if (okNum(p.fee.disc) && p.fee.disc > 0 && p.fee.disc <= 1) f.disc = p.fee.disc;
      if (okNum(p.fee.min) && p.fee.min >= 0 && p.fee.min <= 100) f.min = p.fee.min;
      if (okNum(p.fee.minOdd) && p.fee.minOdd >= 0 && p.fee.minOdd <= 100) f.minOdd = p.fee.minOdd;
      out.fee = f;
    }
    if (typeof p.name === 'string') out.name = p.name.replace(/[<>&"'`]/g, '').trim().slice(0, 8) || 'PZ';
    if (Array.isArray(p.rules)) out.rules = p.rules.filter((r) => typeof r === 'string' && r.trim()).map((r) => r.trim().slice(0, 60)).slice(0, 20);
    for (const k of ['plans', 'dcaSkip', 'dcaNoAsk']) if (Array.isArray(p[k])) out[k] = p[k].slice(0, 3000);
    if (okNum(p.reserve) && p.reserve >= 0) out.reserve = Math.min(Math.round(p.reserve), 1e10);
    obj.prefs = out;
  }
  return obj;
}
