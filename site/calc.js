/* 冷眼 — 純計算：大盤之瞳、冷眼晨報、存股時光機、模擬倉基準、ETF 對決、熱力圖版面。
   全部是純函式，不碰畫面、不連網；同樣的輸入永遠得到同樣的結果（tests/calc_test.mjs 會檢查）。 */
import { FEE_RATE, tradeCost, daysBetween, addDays } from './pf.js';

const isNum = (x) => typeof x === 'number' && isFinite(x);
const round = (x, n = 0) => { const k = 10 ** n; return Math.round(x * k) / k; };

// ------------------------------------------------------------------ 大盤之瞳：全市場規則判讀的分布
/** 反向型的觀點方向和大盤相反，不算進去；上市太短、沒有觀點的也不算。 */
export function breadth(rows) {
  const xs = (rows || []).filter((r) => r && r.st != null && r.k !== 'inv');
  const n = xs.length;
  const bull = xs.filter((r) => r.st > 0).length;
  const bear = xs.filter((r) => r.st < 0).length;
  const neu = n - bull - bear;
  const pos = {};
  for (const r of xs) if (r.ps) pos[r.ps] = (pos[r.ps] || 0) + 1;
  const below = xs.filter((r) => r.blw).length;
  return {
    n, bull, neu, bear, pos, below,
    pBull: n ? bull / n : null, pNeu: n ? neu / n : null, pBear: n ? bear / n : null, pBelow: n ? below / n : null,
  };
}

// ------------------------------------------------------------------ 冷眼晨報：三句固定規則產生的重點
/**
 * in: { market:{px,pc,ma60,insti}, br: breadth(), watch:[row], held:Set<code>, adv:Map<code,{key,label}>,
 *       changes:[{c,from:[st,ps],to:[st,ps]}], q:(row)=>quote, today, names:{st,ps}, premWarn:(row)=>number }
 * 回傳 [{k:'market'|'watch'|'cal', t:'文字，**粗體**', code?}]，介面負責跳脫與上色。
 */
export function brief(inp) {
  const out = [];
  const m = inp.market;
  const br = inp.br;
  const pct = (x, d = 0) => `${(x * 100).toFixed(d)}%`;
  const sgn = (x, d = 2) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(d)}`;
  if (m && isNum(m.px)) {
    let t = `加權 **${m.px.toLocaleString('en-US', { maximumFractionDigits: 0 })}**${isNum(m.pc) ? `（${sgn(m.pc)}%）` : ''}`;
    if (isNum(m.ma60)) t += m.px >= m.ma60 ? '，站在季線之上' : '，跌破季線';
    if (br && br.n) t += `；全市場 ${br.n} 檔 ETF 有 **${pct(br.pBull)} 偏多**、${pct(br.pBear)} 偏空`;
    if (m.insti && isNum(m.insti.f)) {
      const yi = (v) => `${v > 0 ? '買超' : '賣超'} ${Math.abs(v / 1e8).toFixed(0)} 億`;
      t += `。外資${yi(m.insti.f)}${isNum(m.insti.t) ? `、投信${yi(m.insti.t)}` : ''}`;
    }
    out.push({ k: 'market', t: t + '。' });
  }
  // 第二句：先講你的持股要動作的，再講訊號變化，再講溢價，最後才是「沒事」
  const names = inp.names;
  const lbl = (z) => `${names.st[String(z[0])] || '—'}${z[1] && names.ps[z[1]] ? '／' + names.ps[z[1]] : ''}`;
  const watchRows = (inp.watch || []).filter(Boolean);
  const urgent = [...(inp.adv || new Map()).entries()].filter(([, a]) => a && ['trim', 'rebalance', 'pause'].includes(a.key));
  if (urgent.length) {
    const [code, a] = urgent[0];
    const r = watchRows.find((x) => x.c === code) || (inp.rowOf ? inp.rowOf(code) : null);
    out.push({ k: 'watch', code, t: `你持有的 **${r ? r.n : code}** 目前建議「**${a.label}**」${urgent.length > 1 ? `，另外還有 ${urgent.length - 1} 檔也要處理` : ''}。` });
  } else if ((inp.changes || []).length) {
    const c = inp.changes[0];
    const r = watchRows.find((x) => x.c === c.c) || (inp.rowOf ? inp.rowOf(c.c) : null);
    out.push({ k: 'watch', code: c.c, t: `**${r ? r.n : c.c}** 的規則訊號由「${lbl(c.from)}」轉為「**${lbl(c.to)}**」${inp.changes.length > 1 ? `，關注名單共 ${inp.changes.length} 檔有變化` : ''}。` });
  } else {
    const hot = watchRows.find((r) => { const q = inp.q(r); return isNum(q.prem) && q.prem > inp.premWarn(r); });
    if (hot) {
      out.push({ k: 'watch', code: hot.c, t: `**${hot.n}** 溢價 **${inp.q(hot).prem.toFixed(2)}%**，超過警戒，現在買等於多付錢。` });
    } else if (watchRows.length) {
      const b = watchRows.filter((r) => r.st > 0).length;
      const s = watchRows.filter((r) => r.st < 0).length;
      out.push({ k: 'watch', t: `關注的 ${watchRows.length} 檔：${b} 檔偏多、${watchRows.length - b - s} 檔中性、${s} 檔偏空，沒有新的訊號變化。` });
    }
  }
  // 第三句：行事曆（除息）與風險名單
  const today = inp.today;
  const soon = watchRows
    .filter((r) => r.dv && r.dv.d >= today && daysBetween(today, r.dv.d) <= 10)
    .sort((a, b) => a.dv.d - b.dv.d);
  const risky = watchRows.filter((r) => (r.fl || []).some((f) => f === 'disposal' || f === 'notice'));
  if (soon.length) {
    const r = soon[0];
    const md = `${Math.floor(r.dv.d / 100) % 100}/${r.dv.d % 100}`;
    out.push({ k: 'cal', code: r.c, t: `**${r.n}** ${md} 除息${r.dv.cash ? `，每單位 ${+r.dv.cash.toFixed(3)} 元` : '，金額待公告'}${inp.held && inp.held.has(r.c) ? '，你有持股' : ''}${soon.length > 1 ? `；10 天內還有 ${soon.length - 1} 檔` : ''}。` });
  } else if (risky.length) {
    out.push({ k: 'cal', code: risky[0].c, t: `**${risky[0].n}** 被列入注意或處置名單，交易受限。` });
  } else {
    out.push({ k: 'cal', t: '未來 10 天你關注的 ETF 沒有除息，也沒有被列入注意或處置。' });
  }
  return out;
}

// ------------------------------------------------------------------ 存股時光機
const lowerBound = (arr, x) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; } return lo; };
/** 某一天「之前」最近的一筆部位訊號（不含當天：當天收盤才算得出的訊號，不能拿來在當天收盤買）；還沒有訊號回傳 null */
export function signalOn(sig, d) {
  let lo = 0, hi = (sig || []).length - 1, ans = null;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (sig[m][0] < d) { ans = sig[m][1]; lo = m + 1; } else hi = m - 1; }
  return ans;
}
/** 第一個有訊號之後的下一個月（時光機最早只能從這裡開始，三種買法才公平） */
export function firstMonth(hist) {
  const s = hist && hist.sig && hist.sig.length ? hist.sig[0][0] : (hist && hist.d ? hist.d[0] : null);
  if (!s) return null;
  let y = Math.floor(s / 10000), m = Math.floor(s / 100) % 100 + 1;
  if (m > 12) { y++; m = 1; }
  return y * 100 + m;
}
/** 每月扣款日：當月的 day 號，遇到休市就順延到下一個交易日；還沒到的月份不算 */
export function deductionDays(dates, startYm, day) {
  const out = [];
  if (!dates || !dates.length) return out;
  const last = dates[dates.length - 1];
  let y = Math.floor(startYm / 100), m = startYm % 100;
  for (;;) {
    const target = y * 10000 + m * 100 + day;
    if (target > last) break;
    const k = lowerBound(dates, target);
    if (k >= dates.length) break;
    if (!out.length || dates[k] > out[out.length - 1]) out.push(dates[k]);   // 連假順延撞到同一天就不重複扣
    m++;
    if (m > 12) { y++; m = 1; }
  }
  return out;
}
/** 用固定金額買到最多股數（含手續費不超過預算） */
export function sharesFor(budget, px, cat, d, fee) {
  if (!(budget > 0) || !(px > 0)) return 0;
  let n = Math.floor(budget / (px * (1 + FEE_RATE * ((fee && fee.disc) ?? 1))));
  while (n > 0 && tradeCost('buy', n, px, cat, d, fee).net > budget + 1e-9) n--;
  return n;
}
/** 內部報酬率（年化）。flows：[[yyyymmdd, 金額]]，投入為負、最後市值為正。 */
export function xirr(flows) {
  if (!flows || flows.length < 2) return null;
  const d0 = flows[0][0];
  const ts = flows.map(([d, v]) => [daysBetween(d0, d) / 365, v]);
  const f = (r) => ts.reduce((a, [t, v]) => a + v / Math.pow(1 + r, t), 0);
  let lo = -0.95, hi = 10;
  let flo = f(lo), fhi = f(hi);
  if (!isFinite(flo) || !isFinite(fhi) || flo * fhi > 0) return null;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (Math.abs(fm) < 1e-7) return mid;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}
export const TM_STRATS = {
  dca: { name: '定期定額', desc: '每月扣款日照買，不看訊號（基準）' },
  add: { name: '只在可加碼時買', desc: '扣款日前最近一次規則是「可加碼」或「漲多分批」（App 會建議買進的兩種）才買；沒買的錢留著，下次一起買' },
  pause: { name: '遇到警示就暫停', desc: '扣款日前最近一次規則是「先不加碼」或「減碼」就先不買，錢留著下次一起買' },
};
/**
 * 定期定額回推。hist：{d:[日期], p:[實際收盤價], sig:[[日期, 部位訊號]], splits:[[日期, 倍數]], divs:[[除息日, 每單位現金]]}
 * opt：{ start: yyyymm, amount: 每月金額, day: 扣款日 1–28, reinvest: 股息加進下次扣款, fee: 手續費設定, cat }
 * 簡化（介面會寫出來）：以扣款日收盤價成交；股息在除息日入帳；不計二代健保補充保費。
 */
export function timeMachine(hist, opt) {
  const D = hist.d, P = hist.p;
  const days = deductionDays(D, opt.start, opt.day);
  if (!days.length) return null;
  const isDed = new Set(days);
  // 分割與除息依日期排好；除息日剛好沒有成交（颱風休市、冷門 ETF）時，在下一個有成交的交易日入帳
  const evs = [];
  for (const [d, k] of hist.splits || []) if (k > 0) evs.push([d, 0, k]);
  for (const [d, c] of hist.divs || []) if (c > 0) evs.push([d, 1, c]);
  evs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const keys = Object.keys(TM_STRATS);
  const st = Object.fromEntries(keys.map((k) => [k, { sh: 0, pool: 0, keep: 0, div: 0, fee: 0, buys: 0, waits: 0, worst: 0, worstD: null, flows: [] }]));
  const series = [];
  let invested = 0;
  const k0 = lowerBound(D, days[0]);
  let e = 0;
  while (e < evs.length && evs[e][0] <= D[k0]) e++;   // 第一次扣款（含）以前的分割、除息和這筆錢無關
  for (let i = k0; i < D.length; i++) {
    const d = D[i], px = P[i];
    while (i > k0 && e < evs.length && evs[e][0] <= d) {
      const [, kind, v] = evs[e++];
      for (const s of Object.values(st)) {
        if (kind === 0) { s.sh *= v; continue; }
        const amt = Math.floor(s.sh * v + 1e-9);
        s.div += amt;
        if (opt.reinvest) s.pool += amt; else s.keep += amt;
      }
    }
    if (!(px > 0)) continue;
    if (isDed.has(d)) {
      invested += opt.amount;
      const sig = signalOn(hist.sig, d);
      for (const key of keys) {
        const s = st[key];
        s.pool += opt.amount;
        s.flows.push([d, -opt.amount]);
        const go = key === 'dca' ? true : key === 'add' ? sig === 'add' || sig === 'wait' : !(sig === 'caution' || sig === 'trim');
        if (!go) { s.waits++; continue; }
        const n = sharesFor(s.pool, px, opt.cat, d, opt.fee);
        if (n > 0) {
          const c = tradeCost('buy', n, px, opt.cat, d, opt.fee);
          s.sh += n; s.pool -= c.net; s.fee += c.fee; s.buys++;
        }
      }
    }
    const v = {};
    for (const key of keys) {
      const s = st[key];
      v[key] = s.sh * px + s.pool + s.keep;
      if (invested > 0) {
        const r = v[key] / invested - 1;
        if (r < s.worst) { s.worst = r; s.worstD = d; }
      }
    }
    series.push({ d, inv: invested, v, px });
  }
  const last = series[series.length - 1];
  const res = {};
  for (const key of keys) {
    const s = st[key];
    const value = last.v[key];
    res[key] = {
      ...TM_STRATS[key], value: round(value), invested, gain: round(value - invested), ret: invested ? value / invested - 1 : null,
      irr: xirr([...s.flows, [last.d, value]]), div: s.div, fee: s.fee, buys: s.buys, waits: s.waits,
      sh: round(s.sh, 3), cash: round(s.pool + s.keep), worst: s.worst, worstD: s.worstD,
    };
  }
  return { strats: res, series, days, start: days[0], end: last.d, months: days.length, px: last.px, hasSig: !!(hist.sig && hist.sig.length) };
}

// ------------------------------------------------------------------ 模擬倉的基準：同一天把起始資金全買 0050
/** start：{ d, cash0, px0 }；divs/splits 是這檔基準 ETF 的配息與分割；pxNow：現價 */
export function benchValue(start, divs, splits, pxNow, today) {
  if (!start || !(start.px0 > 0) || !(start.cash0 > 0) || !isNum(pxNow)) return null;
  let units = start.cash0 / start.px0;
  const ev = [];
  // 起始價格那天（pxd）之後的分割與除息才算：開倉時拿的是開盤前的昨收，當天的除息也要算進去
  const from = start.pxd || start.d;
  for (const [d, k] of splits || []) if (d > from && d <= today) ev.push([d, 's', k]);
  for (const [d, c] of divs || []) if (d > from && d <= today && c > 0) ev.push([d, 'd', c]);
  ev.sort((a, b) => a[0] - b[0] || (a[1] === 's' ? -1 : 1));
  let cash = 0;
  for (const [, kind, v] of ev) {
    if (kind === 's') units *= v; else cash += units * v;
  }
  const value = units * pxNow + cash;
  return { value, ret: value / start.cash0 - 1, div: cash };
}

// ------------------------------------------------------------------ 部位走勢：用交易紀錄＋官方收盤價，重算每一天的部位
/**
 * lots：交易紀錄（沒有日期的不算）；hists：{代號: {d, p, splits, divs}}；opt：{ cash0：模擬倉起始資金, from：從哪天開始畫 }
 * 每一天依序：先處理當天生效的分割與除息（前一天收盤時持有的股數才領得到配息），再處理當天的買賣，最後用當天收盤價算市值。
 * 某檔當天沒有成交（冷門 ETF、還沒上市），用它之前最後一次的收盤價。
 * 回傳 { d:[日期], mv:[持股市值], inv:[淨投入＝買進花的錢－賣出拿回的錢], div:[累積已領配息], cash:[模擬倉現金] , missing:[沒有歷史資料的代號] }
 */
export function equityCurve(lots, hists, opt = {}) {
  const dated = (lots || []).filter((l) => l && l.d && l.sh > 0 && l.px > 0)
    .slice().sort((a, b) => a.d - b.d || String(a.at || '').localeCompare(String(b.at || '')));
  const codes = [...new Set(dated.map((l) => l.c))];
  const missing = codes.filter((c) => !hists[c] || !hists[c].d || !hists[c].d.length);
  const ok = codes.filter((c) => !missing.includes(c));
  const use = dated.filter((l) => ok.includes(l.c));
  const out = { d: [], mv: [], inv: [], div: [], cash: [], missing };
  if (!use.length) return out;
  const start = Math.max(use[0].d, opt.from || 0);
  const days = new Set();
  for (const c of ok) for (const d of hists[c].d) if (d >= start) days.add(d);
  const cal = [...days].sort((a, b) => a - b);
  if (!cal.length) return out;
  // 每一檔：日期 → 收盤；分割、除息依日期排好
  const px = {}, ev = {}, ptr = {}, last = {}, lastD = {}, held = {};
  for (const c of ok) {
    const h = hists[c];
    px[c] = new Map(h.d.map((d, i) => [d, h.p[i]]));
    const e = [];
    for (const [d, k] of h.splits || []) if (k > 0) e.push([d, 's', k]);
    for (const [d, v] of h.divs || []) if (v > 0) e.push([d, 'd', v]);
    ev[c] = e.sort((a, b) => a[0] - b[0] || (a[1] === 's' ? -1 : 1));
    ptr[c] = 0;
    held[c] = 0;
    // 開始那天以前最後一次的收盤（第一天就要有價格）
    let lp = null, ld = 0;
    for (let i = 0; i < h.d.length && h.d[i] < start; i++) { lp = h.p[i]; ld = h.d[i]; }
    last[c] = lp;
    lastD[c] = ld;
  }
  let inv = 0, div = 0, cash = isFinite(opt.cash0) ? opt.cash0 : 0;
  let li = 0;
  const applyLot = (l) => {
    const fee = isFinite(l.fee) ? l.fee : 0;
    const tax = isFinite(l.tax) ? l.tax : 0;
    if (l.side === 'sell') {
      const n = Math.min(l.sh, held[l.c]);
      if (!(n > 1e-9)) return;
      const back = (n / l.sh) * (l.sh * l.px - fee - tax);
      held[l.c] -= n;
      inv -= back;
      cash += back;
    } else {
      held[l.c] += l.sh;
      inv += l.sh * l.px + fee;
      cash -= l.sh * l.px + fee;
    }
  };
  // 一次分割或除息。冷門 ETF 在那天（或到今天為止）沒有成交：參考價先照除權息調整
  // （除息＝前一次收盤減掉配息、分割＝除以倍數），不然配息已經入帳、市值卻還是除息前的價格，會重複算
  const applyEvent = (c, d) => {
    const [x, kind, v] = ev[c][ptr[c]++];
    const noPx = x > lastD[c] && !(px[c].get(d) > 0);   // 參考價是這次除權息之前的價格，而且今天還沒有新的成交
    if (kind === 's') { held[c] *= v; if (noPx && last[c] > 0) last[c] /= v; return; }
    if (held[c] > 1e-9) { const amt = Math.floor(held[c] * v + 1e-9); div += amt; cash += amt; }
    if (noPx && last[c] > 0) last[c] = Math.max(last[c] - v, 0);
  };
  // 依日期先後處理到 upto 為止的交易與分割、除息（同一天先除權息、再交易：除息當天才買領不到）。
  // 第一筆交易比歷史資料早（例如 2018 年買的）也一樣照時間順序，之前的配息才不會漏掉
  const step = (upto) => {
    for (;;) {
      const nl = li < use.length && use[li].d <= upto ? use[li].d : Infinity;
      let ne = Infinity, ec = null;
      for (const c of ok) { const e = ev[c][ptr[c]]; if (e && e[0] <= upto && e[0] < ne) { ne = e[0]; ec = c; } }
      if (ne === Infinity && nl === Infinity) return;
      if (ne <= nl) applyEvent(ec, upto); else applyLot(use[li++]);
    }
  };
  for (const d of cal) {
    step(d);
    let mv = 0;
    for (const c of ok) {
      const p = px[c].get(d);
      if (p > 0) { last[c] = p; lastD[c] = d; }
      if (held[c] > 1e-9 && last[c] > 0) mv += held[c] * last[c];
    }
    out.d.push(d);
    out.mv.push(round(mv, 2));
    out.inv.push(round(inv, 2));
    out.div.push(div);
    out.cash.push(round(cash, 2));
  }
  return out;
}

// ------------------------------------------------------------------ ETF 對決
export const DUEL_AXES = [
  { k: 'ret', t: '報酬', f: 'r1y', hi: true, note: '近一年含息報酬' },
  { k: 'calm', t: '穩定', f: 'vol', hi: false, note: '年化波動' },
  { k: 'guard', t: '抗跌', f: 'mdd', hi: false, note: '近一年最大回檔' },
  { k: 'yield', t: '配息', f: 'y', hi: true, note: '近 12 個月殖利率' },
  { k: 'crowd', t: '人氣', f: 'hd', hi: true, note: '受益人數' },
  { k: 'rule', t: '規則', f: 'sc', hi: true, note: '今天的規則分數' },
];
/** 百分位（0–1）：在所有有資料的 ETF 裡，比它差的比例。hi=false 代表數字越小越好。 */
export function percentile(values, v, hi = true) {
  const xs = values.filter(isNum);
  if (!xs.length || !isNum(v)) return null;
  const below = xs.filter((x) => (hi ? x < v : x > v)).length;
  const same = xs.filter((x) => x === v).length;
  return (below + (same - 1) / 2) / Math.max(1, xs.length - 1);
}
export function duelStats(rows, picks) {
  const cols = {};
  for (const a of DUEL_AXES) cols[a.k] = rows.map((r) => (a.f === 'y' ? (isNum(r.y) ? r.y : (r.st != null ? 0 : null)) : r[a.f]));
  return picks.map((r) => ({
    code: r.c,
    axes: DUEL_AXES.map((a) => {
      const v = a.f === 'y' ? (isNum(r.y) ? r.y : 0) : r[a.f];
      return { ...a, v: isNum(v) ? v : null, p: percentile(cols[a.k], v, a.hi) };
    }),
  }));
}
/** 把幾條價格線換成同一個起點 100，方便比較 */
export function indexTo100(series) {
  const first = series.find(isNum);
  return series.map((x) => (isNum(x) && first ? (x / first) * 100 : null));
}

// ------------------------------------------------------------------ 熱力圖：squarified treemap
function worst(row, w) {
  const s = row.reduce((a, r) => a + r.a, 0);
  if (!s) return Infinity;
  let mx = -Infinity, mn = Infinity;
  for (const r of row) { mx = Math.max(mx, r.a); mn = Math.min(mn, r.a); }
  return Math.max((w * w * mx) / (s * s), (s * s) / (w * w * mn));
}
/** items：[{v, ...}]（v > 0）；回傳每個項目的 x, y, w, h（像素），面積和 v 成正比 */
export function squarify(items, x, y, w, h) {
  const tot = items.reduce((a, it) => a + (it.v > 0 ? it.v : 0), 0);
  if (!(tot > 0) || !(w > 0) || !(h > 0)) return [];
  const scale = (w * h) / tot;
  const list = items.filter((it) => it.v > 0).sort((a, b) => b.v - a.v).map((it) => ({ it, a: it.v * scale }));
  const out = [];
  let rx = x, ry = y, rw = w, rh = h;
  let row = [];
  const layRow = (rowItems) => {
    const s = rowItems.reduce((a, r) => a + r.a, 0);
    if (rw >= rh) {
      const cw = s / rh;
      let cy = ry;
      for (const r of rowItems) { const ch = r.a / cw; out.push({ ...r.it, x: rx, y: cy, w: cw, h: ch }); cy += ch; }
      rx += cw; rw -= cw;
    } else {
      const ch = s / rw;
      let cx = rx;
      for (const r of rowItems) { const cw = r.a / ch; out.push({ ...r.it, x: cx, y: ry, w: cw, h: ch }); cx += cw; }
      ry += ch; rh -= ch;
    }
  };
  for (const r of list) {
    const side = Math.min(rw, rh);
    if (!row.length || worst([...row, r], side) <= worst(row, side)) row.push(r);
    else { layRow(row); row = [r]; }
  }
  if (row.length) layRow(row);
  return out;
}

// ------------------------------------------------------------------ 定期定額（照國泰證券的規則）
// 國泰：每月 1～31 號任選、可以選好幾天；那個月沒有的日期（例如 2/30）那一期不買；遇到休市順延到下一個交易日；
// 不用設價格，扣款日當天盤中、盤後分批買零股；每筆金額已含手續費（2026/12/31 前每筆 1 元）。
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const isWeekday = (d) => { const t = new Date(Date.UTC(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100)).getUTCDay(); return t >= 1 && t <= 5; };
const firstAtOrAfter = (D, d) => { let lo = 0, hi = D.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (D[m] >= d) { ans = m; hi = m - 1; } else lo = m + 1; } return ans; };
const lastAtOrBefore = (D, d) => { let lo = 0, hi = D.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (D[m] <= d) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; };
/**
 * 定期定額計畫的格式（新增、還原備份都經過這裡）：舊版 { day, amt } 自動轉成新版；格式不對回傳 null。
 * { id, c: 代號, days: [1..31], amt: 每期金額（含手續費）, fee: 每筆手續費, start: 從哪天開始（yyyymmdd）,
 *   end: 停扣（yyyymmdd，沒有就是還在扣）, back: 有沒有補齊以前的, skip: [刪掉的那幾期的原本扣款日，之後不再自動補], v: 2 }
 */
export function normPlan(p, today) {
  if (!p || typeof p !== 'object' || typeof p.c !== 'string' || !/^[0-9A-Z]{4,8}$/i.test(p.c)) return null;
  const days = planDays({ days: Array.isArray(p.days) ? p.days : [p.day] });
  const amt = Math.round(Number(p.amt));
  if (!days.length || !(amt >= 100 && amt <= 10000000)) return null;
  const okD = (d) => Number.isInteger(d) && d >= 20000101 && d <= 21001231;
  const start = okD(p.start) ? p.start : today;
  const fee = isNum(p.fee) && p.fee >= 0 && p.fee <= 1000 ? round(p.fee, 2) : 1;
  return {
    id: typeof p.id === 'string' && /^[0-9a-z_-]{1,40}$/i.test(p.id) ? p.id : `${p.c.toLowerCase()}-${start}-${days.join('_')}`,
    c: p.c.toUpperCase(), days, amt, fee, start,
    end: okD(p.end) && p.end >= start ? p.end : null,
    back: p.back === true,
    skip: Array.isArray(p.skip) ? [...new Set(p.skip.filter(okD))].slice(-600) : [],
    v: 2,
  };
}
/** 計畫的扣款日（1～31，去掉重複、排好） */
export const planDays = (plan) => [...new Set((plan && plan.days) || [])].filter((d) => Number.isInteger(d) && d >= 1 && d <= 31).sort((a, b) => a - b);

/**
 * 一個計畫從 start 到 upto（含）之間的每一期，以及實際成交的交易日。
 * plan：{ days:[1..31], start: yyyymmdd, end: yyyymmdd|null }；cal：有開市的日子（官方資料，遞增）。
 * 最後一個已知交易日之後才會成交的期數還不知道在哪天，不列出（等資料進來再算）。
 * 回傳 [{ s: 原本的扣款日, d: 實際成交日 }]，依 s 排序。
 */
export function dcaSchedule(plan, cal, upto) {
  const out = [];
  const days = planDays(plan);
  if (!days.length || !cal || !cal.length || !plan.start) return out;
  const to = Math.min(plan.end || 99991231, upto || 99991231);
  let y = Math.floor(plan.start / 10000), m = Math.floor(plan.start / 100) % 100;
  for (let guard = 0; guard < 1200; guard++) {
    if (y * 10000 + m * 100 + 1 > to) break;
    const dim = daysIn(y, m);
    for (const day of days) {
      if (day > dim) continue;                         // 那個月沒有這一天：國泰那一期不買
      const s = y * 10000 + m * 100 + day;
      if (s < plan.start || s > to) continue;
      const k = firstAtOrAfter(cal, s);                // 休市順延到下一個交易日
      if (k >= 0) out.push({ s, d: cal[k] });
    }
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}
/** 成交日那天的官方收盤價（冷門 ETF 那天沒成交，就用之前最後一次成交）；h：hist 檔 { d, p } */
export function closeOn(h, d) {
  if (!h || !h.d || !h.d.length) return null;
  const k = lastAtOrBefore(h.d, d);
  return k >= 0 && h.p[k] > 0 ? { d: h.d[k], px: h.p[k] } : null;
}
/** 預估一期買到的股數：每期金額（含手續費）扣掉手續費，用收盤價買零股、無條件捨去；連 1 股都買不起回傳 null */
export function dcaEstimate(amt, fee, px) {
  const f = isNum(fee) && fee >= 0 ? fee : 0;
  if (!(px > 0) || !(amt > f)) return null;
  const sh = Math.floor((amt - f) / px + 1e-9);
  return sh >= 1 ? { sh, px, fee: f, spent: round(sh * px + f, 2) } : null;
}
/**
 * 和券商的庫存對齊：只調整「預估」的那幾筆，照比例改股數，讓這一檔的總股數等於券商 App 顯示的；
 * 每一筆花的錢不變（股數變多＝那一筆的均價變低），所以總成本不會亂掉。
 * lots：這一檔的全部交易；est：要調整的那幾筆的 id；splits：這一檔的分割紀錄；target：券商顯示的股數（目前的股數基準）。
 * 回傳 { ok, why, changes:[{ id, sh, px }], before, after }。
 */
export function dcaCalibrate(lots, estIds, splits, target, holdingOf) {
  const ids = new Set(estIds || []);
  const est = (lots || []).filter((l) => ids.has(l.id) && l.side !== 'sell' && l.sh > 0 && l.px > 0);
  if (!est.length) return { ok: false, why: '這一檔沒有「預估」的定期定額紀錄可以調整' };
  if (!(isNum(target) && target > 0)) return { ok: false, why: '請輸入券商 App 上的庫存股數' };
  const fac = (l) => { let f = 1; for (const [sd, k] of splits || []) if (l.d && l.d < sd) f *= k; return f; };
  const before = holdingOf(lots).sh;
  const estNow = est.reduce((a, l) => a + l.sh * fac(l), 0);
  const want = estNow + (target - before);
  if (!(want >= est.length)) return { ok: false, why: '差太多了：券商的股數比冷眼裡其他紀錄加起來還少，請先檢查有沒有記錯的交易', before };
  const f = want / estNow;
  const changes = est.map((l) => ({ id: l.id, sh: Math.max(1, Math.round(l.sh * f)), spent: l.sh * l.px, fac: fac(l), d: l.d || 0 }));
  // 四捨五入剩下的零頭，放在最後一筆、而且之後沒有分割的那一筆
  const now = changes.reduce((a, c) => a + c.sh * c.fac, 0);
  const tail = changes.filter((c) => c.fac === 1).sort((a, b) => b.d - a.d)[0];
  if (tail && Math.round(want - now) !== 0) tail.sh = Math.max(1, tail.sh + Math.round(want - now));
  const out = changes.map((c) => ({ id: c.id, sh: c.sh, px: round(c.spent / c.sh, 4) }));
  const next = (lots || []).map((l) => { const c = out.find((x) => x.id === l.id); return c ? { ...l, sh: c.sh, px: c.px } : l; });
  return { ok: true, changes: out, before, after: holdingOf(next).sh };
}
/** 今天是不是某個計畫的扣款日（提醒用：週末順延；平日放假要等官方資料才知道，自動入帳會照實際交易日處理） */
export function dcaDueToday(plan, td) {
  const days = planDays(plan);
  if (!days.length || !isWeekday(td)) return false;
  if (plan.start && td < plan.start) return false;
  const y = Math.floor(td / 10000), m = Math.floor(td / 100) % 100;
  for (const [yy, mm] of [[y, m], [m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1]]) {
    for (const day of days) {
      if (day > daysIn(yy, mm)) continue;
      let d = yy * 10000 + mm * 100 + day;
      if (plan.end && d > plan.end) continue;
      if (plan.start && d < plan.start) continue;
      for (let k = 0; k < 3 && !isWeekday(d); k++) d = addDays(d, 1);
      if (d === td) return true;
    }
  }
  return false;
}
