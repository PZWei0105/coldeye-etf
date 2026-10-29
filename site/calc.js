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
// 國泰官方說明（https://istockapp.cathaysec.com.tw/Marketing/DCA/）：
// - 每月 1～31 號任選、可以選好幾天；那個月沒有的日期（例如 2/30）那一期不買；遇到市場假日順延到下一個交易日。
// - 扣款日當天盤中、盤後分批買零股，不用設價格；每筆金額已含手續費（2026/12/31 前每筆 1 元），以百元為單位、最低 100 元。
// - 申請、變更、終止都是 1 個交易日後生效，最晚要在扣款日前 2 天送出；前 1 天才送，隔天照原本的設定扣。
// - 扣款失敗（餘額不足）不補扣。股票停止交易（例如 0050 在 2025/6/11～6/17 分割停止買賣）那幾天券商不扣、也不補：
//   國泰台股說明沒寫，根據是 0050 分割時的報導（https://technews.tw/?p=1409883）與國泰美股說明「資產分割等公司活動當次不扣款」。
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const isWeekday = (d) => { const t = new Date(Date.UTC(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100)).getUTCDay(); return t >= 1 && t <= 5; };
const firstAtOrAfter = (D, d) => { let lo = 0, hi = D.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (D[m] >= d) { ans = m; hi = m - 1; } else lo = m + 1; } return ans; };
const lastAtOrBefore = (D, d) => { let lo = 0, hi = D.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (D[m] <= d) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; };
const indexIn = (D, d) => { const k = firstAtOrAfter(D, d); return k >= 0 && D[k] === d ? k : -1; };
const okDay8 = (d) => Number.isInteger(d) && d >= 20000101 && d <= 21001231 && Math.floor(d / 100) % 100 >= 1 && Math.floor(d / 100) % 100 <= 12 && d % 100 >= 1 && d % 100 <= 31;
export const CODE_RE = /^[0-9A-Z]{4,8}$/;
export const PLAN_V = 3;

/** 計畫的扣款日（1～31，去掉重複、排好） */
export const planDays = (plan) => [...new Set((plan && plan.days) || [])].filter((d) => Number.isInteger(d) && d >= 1 && d <= 31).sort((a, b) => a - b);
/**
 * 定期定額計畫的格式（新增、編輯、還原備份、舊版轉換都經過這裡）；格式不對回傳 null。
 * { id, c: 代號, days: [1..31], amt: 每期金額（含手續費）, fee: 每筆手續費,
 *   start: 這天（含）以後「成交」的那幾期才算, end: 這天（含）以前成交的才算（停扣；null＝還在扣）, stop: 在國泰按停扣的那天,
 *   prev: 國泰改設定時從哪個計畫分出來, v: 3 }
 * 開始、停扣看的是實際成交的交易日（國泰的生效規則看的也是那個交易日）。
 * 舊版的 { day }、v2 的 back／skip 不再放在計畫裡：刪掉的那幾期改存在設定的 dcaSkip（見 planSkipKeys）。
 * 舊版（{ day }、v2）的開始、停扣是照「原本的扣款日」算的：轉過來的計畫帶 sb: true 照舊算，免得多出或少掉邊上那一期；在表單裡改過就是新的算法。
 */
export function normPlan(p, today) {
  if (!p || typeof p !== 'object' || typeof p.c !== 'string' || !CODE_RE.test(p.c.toUpperCase())) return null;
  const days = planDays({ days: Array.isArray(p.days) ? p.days : [p.day] });
  const amt = Math.round(Number(p.amt));
  if (!days.length || !(amt >= 100 && amt <= 10000000)) return null;
  const start = okDay8(p.start) ? p.start : today;
  const fee = isNum(p.fee) && p.fee >= 0 && p.fee <= 1000 ? round(p.fee, 2) : 1;
  const c = p.c.toUpperCase();
  const end = okDay8(p.end) && p.end >= start ? p.end : null;
  const sb = p.sb === true || p.v === 2 || (p.v == null && p.day != null && !Array.isArray(p.days));
  return {
    id: typeof p.id === 'string' && /^[0-9a-z_-]{1,40}$/i.test(p.id) ? p.id : `${c.toLowerCase()}-${start}-${days.join('_')}`,
    c, days, amt, fee, start, end,
    stop: end && okDay8(p.stop) && p.stop <= end ? p.stop : null,    // 在國泰按停扣的那天（只是給畫面顯示用）
    ...(sb ? { sb: true } : {}),
    // 國泰那邊改了設定時，新設定是從哪一個計畫分出來的（核對過的舊紀錄只會算在自己這一串的計畫）
    ...(typeof p.prev === 'string' && /^[0-9a-z_-]{1,40}$/i.test(p.prev) ? { prev: p.prev } : {}),
    v: PLAN_V,
  };
}
/** 舊版（v2）計畫裡記的「刪掉的那幾期」，轉成 `代號|原本扣款日` 存進設定的 dcaSkip */
export function planSkipKeys(p) {
  if (!p || typeof p !== 'object' || typeof p.c !== 'string' || !Array.isArray(p.skip)) return [];
  const c = p.c.toUpperCase();
  if (!CODE_RE.test(c)) return [];
  return p.skip.filter(okDay8).map((s) => `${c}|${s}`);
}
/** 刪掉的那幾期（`代號|原本扣款日`）：去掉怪資料與重複，最多留最近的 3000 筆 */
export function normSkips(xs) {
  if (!Array.isArray(xs)) return [];
  return [...new Set(xs.filter((k) => typeof k === 'string' && /^[0-9A-Z]{4,8}\|\d{8}$/.test(k) && okDay8(+k.split('|')[1])))].slice(-3000);
}
/** 說過「不是同一筆」的：`代號|原本扣款日`（整期不再問，舊版）或 `代號|原本扣款日|那一筆的 id`（只是那一筆不再問） */
export function normNoAsk(xs) {
  if (!Array.isArray(xs)) return [];
  return [...new Set(xs.filter((k) => typeof k === 'string' && /^[0-9A-Z]{4,8}\|\d{8}(\|[0-9A-Za-z_.:-]{1,64})?$/.test(k) && okDay8(+k.split('|')[1])))].slice(-3000);
}
/** 兩個計畫是不是會在同一天扣同一檔（同一檔、扣款日有重疊、期間有重疊）：國泰一張申購單就能選好幾天，重疊多半是重複設定 */
export function plansOverlap(a, b) {
  if (!a || !b || a.c !== b.c) return false;
  const da = planDays(a), db = new Set(planDays(b));
  if (!da.some((x) => db.has(x))) return false;
  return (a.start || 0) <= (b.end || 99991231) && (b.start || 0) <= (a.end || 99991231);
}
/** 市場的交易日：幾檔大型 ETF 有成交的日子聯集（單看一檔會漏掉它自己停止交易的那幾天，例如 0050 分割） */
export function marketCal(lists) {
  const set = new Set();
  for (const ds of lists || []) for (const d of ds || []) if (okDay8(d)) set.add(d);
  return [...set].sort((a, b) => a - b);
}
function nextTradingDay(d, cal) {
  const nx = addDays(d, 1);
  if (cal && cal.length && nx <= cal[cal.length - 1]) return cal[firstAtOrAfter(cal, nx)];
  let x = nx;
  while (!isWeekday(x)) x = addDays(x, 1);
  return x;
}
/** d 之後第 n 個交易日：已知的用官方資料的交易日，之後的日子先當作星期一到五都開市 */
export function addTradingDays(d, n, cal) {
  let x = d;
  for (let i = 0; i < n; i++) x = nextTradingDay(x, cal);
  return x;
}
/**
 * 在國泰送出申請、變更或停扣的那天 → 新設定從哪個交易日開始算（含）：1 個交易日後生效，再下一個交易日才扣得到。
 * 例：4 號送出、5 號生效、6 號扣款（國泰的例子）；前 1 天才送出，隔天照原本的設定扣。
 */
export const dcaCutover = (sent, cal) => addTradingDays(sent, 2, cal);

/**
 * 一個計畫從開始到 upto（含）之間的每一期，以及實際成交的交易日。
 * plan：{ days, start, end, sb }；cal：市場交易日（官方資料，遞增）；開始、停扣看成交日（舊版轉過來的 sb 看原本的扣款日），upto 看成交日。
 * 最後一個已知交易日之後才會成交的期數還不知道在哪天，不列出（等資料進來再算）。
 * 回傳 [{ s: 原本的扣款日, d: 實際成交日 }]，依 s 排序。
 */
export function dcaSchedule(plan, cal, upto) {
  const out = [];
  const days = planDays(plan);
  if (!days.length || !cal || !cal.length || !okDay8(plan.start)) return out;
  const hi = plan.end || 99991231;
  const top = Math.min(hi, upto || 99991231);
  const sb = plan.sb === true;
  // 原本的扣款日在開始日之前、遇到假日順延到開始日以後才成交的，也算（春節最長順延 9 天左右）
  const from = addDays(plan.start, -20);
  let y = Math.floor(from / 10000), m = Math.floor(from / 100) % 100;
  for (let guard = 0; guard < 1300; guard++) {
    if (y * 10000 + m * 100 + 1 > top) break;
    const dim = daysIn(y, m);
    for (const day of days) {
      if (day > dim) continue;                         // 那個月沒有這一天：國泰那一期不買
      const s = y * 10000 + m * 100 + day;
      if (s > top || s < cal[0]) continue;             // 比官方資料還早的日子不知道有沒有開市
      if (sb && (s < plan.start || s > hi)) continue;
      const k = firstAtOrAfter(cal, s);                // 遇到假日順延到下一個交易日
      if (k < 0) continue;                             // 還不知道哪天成交：等資料
      const d = cal[k];
      if (d > (upto || 99991231)) continue;
      if (!sb && (d < plan.start || d > hi)) continue;
      out.push({ s, d });
    }
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}
/** 預估一期買到的股數：每期金額（含手續費）扣掉手續費，用收盤價買零股、無條件捨去；連 1 股都買不起回傳 null */
export function dcaEstimate(amt, fee, px) {
  const f = isNum(fee) && fee >= 0 ? fee : 0;
  if (!(px > 0) || !(amt > f)) return null;
  const sh = Math.floor((amt - f) / px + 1e-9);
  return sh >= 1 ? { sh, px, fee: f, spent: round(sh * px + f, 2) } : null;
}
/**
 * 一期在成交日 d 用的官方收盤價（自動入帳用，不拿更早的價格硬湊）。
 * o：{ h: 這一檔的歷史檔 { d, p, splits }（沒有就 null）, hist404: 確定沒有歷史檔（上市太短）, row: 最新收盤資料裡的這一檔（下市就沒有）, cal: 市場交易日 }
 * 回傳 { st: 'ok', px, pd: 價格是哪一天的 }
 *    、{ st: 'none', why: 'halt'（分割等停止交易：國泰不扣也不補）|'gone'（已經不在交易）|'thin'（太久沒有成交） }
 *    、{ st: 'wait' }（還不知道：等之後的資料）、{ st: 'unknown' }（這次沒拿到資料，什麼都不動）
 */
export function dcaPrice(o, d) {
  const { h, hist404, row, cal } = o || {};
  const rowOk = !!(row && row.d === d && row.p > 0);
  if (h && Array.isArray(h.d) && h.d.length && Array.isArray(h.p)) {
    const i = indexIn(h.d, d);
    if (i >= 0 && h.p[i] > 0) return { st: 'ok', px: h.p[i], pd: d };
    const k = firstAtOrAfter(h.d, addDays(d, 1));
    const nb = k >= 0 ? h.d[k] : (row && row.d > d ? row.d : null);
    if (nb) {
      // 這一檔之後有成交、偏偏那天沒有：下一次成交就是分割（或合併）生效日 → 那幾天是停止交易，國泰不扣
      if ((h.splits || []).some((x) => Array.isArray(x) && x[0] > d && x[0] <= nb)) return { st: 'none', why: 'halt' };
      // 冷門 ETF 那天整股沒有成交：用前一次的收盤估（最多往前 10 個交易日）
      const j = lastAtOrBefore(h.d, d);
      if (j >= 0 && h.p[j] > 0 && cal && cal.length && lastAtOrBefore(cal, d) - lastAtOrBefore(cal, h.d[j]) <= 10) return { st: 'ok', px: h.p[j], pd: h.d[j] };
      return { st: 'none', why: 'thin' };
    }
    if (rowOk) return { st: 'ok', px: row.p, pd: d };
    if (!row) return { st: 'none', why: 'gone' };
    return { st: 'wait' };
  }
  if (hist404) {
    if (rowOk) return { st: 'ok', px: row.p, pd: d };
    // 不在最新收盤資料、也沒有歷史檔（下市、合併、很久沒成交）：以前的價格查不到，已經記的先留著、也不新增
    if (!row) return { st: 'unknown' };
    return { st: 'wait' };
  }
  return { st: 'unknown' };
}
/** 這筆交易是定期定額記的（自動入帳、核對過、或你說「就是這筆」連起來的） */
export const isDcaLot = (l) => !!(l && l.dca && typeof l.dca === 'object' && typeof l.dca.plan === 'string' && Number.isInteger(l.dca.s));
const sameEst = (l, e) => l.d === e.d && l.sh === e.sh && Math.abs(l.px - e.px) < 1e-6 && Math.abs((l.fee || 0) - e.fee) < 1e-6;
/**
 * 自動入帳的核心（純函式）：照計畫「應該記成什麼樣子」，和真實部位現在的交易比對，算出要新增、要刪掉、要問你的。
 * 只動還沒核對的「預估」（dca.est === true）：核對過的、你自己記的交易一律不動。
 * - 同一檔同一期只記一次（兩個計畫重疊時，先開始的那個算；重複的預估刪掉）。
 * - 計畫改了（扣款日、開始、停扣、代號、金額）：不在新計畫裡、或和新計畫算出來的不一樣的預估刪掉，再照新計畫補。
 * - 核對過、但改了計畫之後不在新計畫裡的那一筆（例如扣款日 6 號改成 7 號、國泰那邊改了設定）：它就是那幾天真的扣到的那一筆，
 *   算在自己這一串計畫（同一個計畫，或從它分出來的 prev）同一個月（不然 15 天內）最接近的那一期，那一期不再另外補（不然一改扣款日就重複記）。
 * - 國泰不會扣的（停止交易、金額連 1 股都買不到）：不記，已經記的預估刪掉。
 * - 你刪掉的那幾期（skip）不再補；那一期剩下的預估也刪掉。
 * - 那幾天你也自己記了一筆同一檔的買進（扣款日到成交後 2 個交易日內，挑股數最接近的那一筆）：放進 ask 問你是不是同一筆，問完之前不新增
 *   （已經有預估的也問：是就留你記的、刪預估；已經核對過的問是不是重複記了 dup）。同一天成交的好幾期，你記的那筆比較像加起來時一起問（more、gsh）。
 *   noAsk 是你說過「不是」的（`代號|扣款日|那一筆 id`；舊版整期的 `代號|扣款日` 也認）。
 * in：{ plans, lots, cal, upto, skip: Set, noAsk: Set, priceOf(c, d) → dcaPrice 的結果 }
 * 回傳 { add: [新的預估交易（沒有 id）], del: [要刪的預估 id], ask: [{ key, plan, c, s, d, sh, px, fee, pd, cand, est?, dup?, more?, gsh? }],
 *        wait: 還不能記的期數, waits: [等之後官方資料的期數（例如還在停止交易、上市太短還沒有歷史資料）], none: [國泰不會扣的期數],
 *        moved: 核對過、照改過的計畫算在別的那一期的筆數, extras: [核對過、在計畫期間內、但照現在的設定那段時間沒有扣款的那幾筆（問你是不是多記了）] }
 */
export function dcaReconcile({ plans, lots, cal, upto, skip, noAsk, priceOf }) {
  const SK = skip || new Set();
  const NA = noAsk || new Set();
  const list = (plans || []).filter((p) => p && planDays(p).length && okDay8(p.start))
    .slice().sort((a, b) => a.start - b.start || String(a.id).localeCompare(String(b.id)));
  const ids = new Set(list.map((p) => p.id));
  // 1. 每一期應該是什麼
  const want = new Map();
  for (const p of list) {
    for (const x of dcaSchedule(p, cal, upto)) {
      const key = `${p.c}|${x.s}`;
      if (want.has(key)) continue;
      const e = { key, plan: p.id, c: p.c, s: x.s, d: x.d, amt: p.amt, fee: p.fee };
      if (SK.has(key)) e.st = 'skip';
      else {
        const q = priceOf(p.c, x.d) || { st: 'unknown' };
        const est = q.st === 'ok' ? dcaEstimate(p.amt, p.fee, q.px) : null;
        if (q.st === 'ok' && est) Object.assign(e, { st: 'ok', sh: est.sh, px: q.px, pd: q.pd });
        else if (q.st === 'ok') Object.assign(e, { st: 'none', why: 'small' });
        else Object.assign(e, { st: q.st, why: q.why });
      }
      want.set(key, e);
    }
  }
  // 2. 現在記了什麼
  const byKey = new Map();
  for (const l of lots || []) {
    if (!isDcaLot(l)) continue;
    const key = `${l.c}|${l.dca.s}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(l);
  }
  const confirmed = new Set([...byKey].filter(([, ls]) => ls.some((l) => l.dca.est !== true)).map(([k]) => k));
  // 2a. 核對過、但不在現在的計畫裡的（改了扣款日、國泰那邊改了設定）：算在「自己這一串計畫」（同一個計畫，或國泰改設定時從它分出來的 prev）
  //     的那一期——同一個月（看成交日）優先，再來是 15 天內最接近的；那一期不另外補。別的計畫、開始日往後移或提早停扣後落在期間外的，不算。
  const succ = new Map();
  const link = (from, to) => { if (!succ.has(from)) succ.set(from, []); succ.get(from).push(to); };
  for (const q of list) {
    if (q.prev) link(q.prev, q.id);
    // 舊資料（還沒有 prev 的時候分出來的）：同一檔、在另一個計畫停扣後 10 天內開始的，當作接在它後面
    else for (const p of list) if (p !== q && p.c === q.c && p.end && q.start > p.end && q.start <= addDays(p.end, 10)) link(p.id, q.id);
  }
  const lineage = (id) => { const out = new Set([id]); const q = [id]; while (q.length) { const x = q.pop(); for (const y of succ.get(x) || []) if (!out.has(y)) { out.add(y); q.push(y); } } return out; };
  const planById = new Map(list.map((p) => [p.id, p]));
  const covered = new Map();
  const extras = [];            // 核對過、在計畫期間內，但照現在的設定那段時間沒有這一期：問你是不是多記了
  const displaced = [];
  for (const [key, ls] of byKey) {
    if (want.has(key)) continue;
    for (const l of ls) if (l.dca.est !== true && Number.isInteger(l.d)) displaced.push(l);
  }
  displaced.sort((a, b) => a.d - b.d || String(a.id).localeCompare(String(b.id)));
  for (const l of displaced) {
    const fam = lineage(l.dca.plan);
    const ok = [...fam].some((id) => { const p = planById.get(id); return p && p.c === l.c && l.d >= p.start && l.d <= (p.end || 99991231); });
    if (!ok) continue;
    let best = null, bs = Infinity;
    for (const e of want.values()) {
      if (!fam.has(e.plan) || e.c !== l.c || covered.has(e.key) || confirmed.has(e.key) || e.st === 'none' || e.st === 'skip') continue;
      const dd = Math.abs(daysBetween(e.d, l.d));
      const same = Math.floor(e.d / 100) === Math.floor(l.d / 100);
      const score = same ? dd : 1000 + dd;
      if ((same || dd <= 15) && score < bs) { best = e; bs = score; }
    }
    if (best) covered.set(best.key, l.id);
    else if (!NA.has(`${l.c}|${l.dca.s}|${l.id}`)) extras.push({ id: l.id, plan: l.dca.plan, c: l.c, s: l.dca.s, d: l.d, sh: l.sh, px: l.px });
  }
  const del = [];
  const have = new Set(covered.keys());
  const estOnly = new Map();     // 這一期只有預估（還沒核對）：key → 那一筆的 id
  const confLot = new Map();     // 這一期核對過的那一筆：key → 那一筆
  const oldestFirst = (a, b) => String(a.at || '').localeCompare(String(b.at || '')) || String(a.id).localeCompare(String(b.id));
  for (const [key, ls] of byKey) {
    const est = ls.filter((l) => l.dca.est === true).sort(oldestFirst);
    const e = want.get(key);
    // 這一期已經核對過（或核對過的另一筆算在這一期）：重複的預估刪掉
    if (confirmed.has(key) || covered.has(key)) {
      est.forEach((l) => del.push(l.id));
      have.add(key);
      const c = ls.find((l) => l.dca.est !== true);
      if (c) confLot.set(key, c);
      continue;
    }
    if (SK.has(key)) { est.forEach((l) => del.push(l.id)); continue; }
    if (!e) {
      // 計畫裡沒有這一期：計畫還在（改過設定）→ 刪；計畫已經刪掉、你選擇留著 → 留一筆（重複的刪掉）
      const orphan = est.filter((l) => !ids.has(l.dca.plan));
      est.filter((l) => ids.has(l.dca.plan)).forEach((l) => del.push(l.id));
      orphan.slice(1).forEach((l) => del.push(l.id));
      if (orphan.length) have.add(key);
      continue;
    }
    if (e.st === 'ok') {
      const keep = est.find((l) => sameEst(l, e));
      est.filter((l) => l !== keep).forEach((l) => del.push(l.id));
      if (keep) { have.add(key); estOnly.set(key, keep.id); }
      continue;
    }
    if (e.st === 'none' || e.st === 'skip') { est.forEach((l) => del.push(l.id)); continue; }
    // 等資料、這次沒拿到資料：不知道對不對，先留著（重複的照樣刪）
    est.slice(1).forEach((l) => del.push(l.id));
    if (est.length) have.add(key);
  }
  // 3. 要補的、要問你的
  const add = [];
  const ask = [];
  const none = [];
  const waits = [];
  let unknown = 0;
  const used = new Set();
  const asked = new Set();
  const manual = (lots || []).filter((l) => l && !isDcaLot(l) && l.side === 'buy' && Number.isInteger(l.d) && l.sh > 0);
  const said = (key, id) => NA.has(key) || NA.has(`${key}|${id}`);
  /** 扣款日到成交後 2 個交易日內，你自己記的同一檔買進：挑股數最接近（再來是日期最接近）的那一筆 */
  const candFor = (e, ref) => {
    const hi = addTradingDays(e.d, 2, cal);
    let best = null, bs = Infinity;
    for (const l of manual) {
      if (used.has(l.id) || l.c !== e.c || l.d < e.s || l.d > hi || said(e.key, l.id)) continue;
      const score = (ref > 0 ? Math.abs(l.sh - ref) / ref : 0) + Math.abs(daysBetween(l.d, e.d)) / 100;
      if (score < bs) { best = l; bs = score; }
    }
    return best;
  };
  const item = (e, cand) => ({ key: e.key, plan: e.plan, c: e.c, s: e.s, d: e.d, sh: e.sh, px: e.px, fee: e.fee, pd: e.pd, cand: { id: cand.id, d: cand.d, sh: cand.sh, px: cand.px } });
  const sorted = [...want.values()].sort((a, b) => a.d - b.d || a.s - b.s);
  for (const e of sorted) {
    if (asked.has(e.key)) continue;
    if (have.has(e.key)) {
      if (e.st !== 'ok') continue;
      const cl = confLot.get(e.key);
      if (cl) {
        // 這一期已經核對過，你在那幾天又自己記了一筆：問是不是重複記了（是就刪掉你記的那筆）
        const cand = candFor(e, cl.sh);
        if (cand) { used.add(cand.id); asked.add(e.key); ask.push({ ...item(e, cand), dup: { id: cl.id, sh: cl.sh, px: cl.px } }); }
      } else if (estOnly.has(e.key)) {
        // 只有預估、你在那幾天又自己記了一筆：問是不是同一筆（是就留你記的、刪預估）
        const cand = candFor(e, e.sh);
        if (cand) { used.add(cand.id); asked.add(e.key); ask.push({ ...item(e, cand), est: estOnly.get(e.key) }); }
      }
      continue;
    }
    if (e.st === 'none') { none.push(e); continue; }
    if (e.st === 'wait') { waits.push(e); continue; }
    if (e.st === 'unknown') { unknown++; continue; }
    if (e.st !== 'ok') continue;
    const cand = candFor(e, e.sh);
    if (cand) {
      used.add(cand.id);
      asked.add(e.key);
      // 同一天成交的其他幾期（例如連假後好幾期順延到同一天）：你記的那一筆比較像這幾期加起來，才一起問
      const others = sorted.filter((x) => x !== e && x.c === e.c && x.d === e.d && x.st === 'ok' && !have.has(x.key) && !asked.has(x.key) && !said(x.key, cand.id));
      const gsh = e.sh + others.reduce((t, x) => t + x.sh, 0);
      if (others.length && Math.abs(cand.sh - gsh) < Math.abs(cand.sh - e.sh)) {
        for (const x of others) asked.add(x.key);
        ask.push({ ...item(e, cand), more: others.map((x) => ({ key: x.key, plan: x.plan, s: x.s, sh: x.sh })), gsh });
      } else ask.push(item(e, cand));
      continue;
    }
    add.push({ c: e.c, side: 'buy', d: e.d, sh: e.sh, px: e.px, fee: e.fee, tax: 0, dca: { plan: e.plan, s: e.s, est: true, ...(e.pd !== e.d ? { pd: e.pd } : {}) } });
  }
  return { add, del, ask, extras, wait: waits.length + unknown, waits, none, moved: covered.size };
}

/** 和國泰庫存對齊時，預估的股數最多只能照這個比例調整：台股一天最多漲跌 10%，國泰分批買的均價和收盤價差不了更多 */
export const CAL_RANGE = [0.8, 1.25];
/** 差這麼多以內，是國泰分批買、均價和收盤價差一點點的正常範圍 */
export const CAL_OK = 0.05;
/**
 * 和券商的庫存對齊：只調整「預估」的那幾筆，照同一個比例改股數，讓這一檔的總股數等於券商 App 的庫存；
 * 每一筆花的錢不變（股數變多＝那一筆的均價變低），所以總投入不會亂掉。比例超出 CAL_RANGE 不能對齊（一定是計畫或紀錄有問題）。
 * lots：這一檔的全部交易；estIds：要調整的那幾筆；splits：這一檔的分割紀錄；target：券商顯示的股數（目前的股數基準）。
 * 回傳 { ok, kind, why, changes:[{ id, sh, px }], before, after, est, other, want, k, miss }
 */
export function dcaCalibrate(lots, estIds, splits, target, holdingOf) {
  const ids = new Set(estIds || []);
  const est = (lots || []).filter((l) => ids.has(l.id) && l.side !== 'sell' && l.sh > 0 && l.px > 0);
  if (!est.length) return { ok: false, kind: 'none', why: '這一檔沒有「預估」的定期定額紀錄可以調整' };
  if (!(isNum(target) && target > 0 && Number.isInteger(target))) return { ok: false, kind: 'input', why: '請輸入券商 App 上的庫存股數（整數）' };
  const fac = (l) => { let f = 1; for (const [sd, k] of splits || []) if (l.d && l.d < sd) f *= k; return f; };
  const before = holdingOf(lots).sh;
  const estNow = est.reduce((a, l) => a + l.sh * fac(l), 0);
  const other = before - estNow;
  const want = target - other;
  const base = { before, est: estNow, other, want, target };
  const pct = (x) => `${Math.round(Math.abs(x - 1) * 100)}%`;
  if (want <= 0) {
    return { ...base, ok: false, kind: 'low', why: `國泰的庫存（${target} 股）比冷眼裡其他紀錄加起來（${other} 股）還少：可能有交易重複記了，或有賣出沒有記。先到「交易紀錄」檢查，再回來對齊。` };
  }
  const k = want / estNow;
  if (k < CAL_RANGE[0]) {
    return { ...base, k, ok: false, kind: 'low', why: `國泰的庫存比冷眼算的少很多（預估的 ${estNow} 股要變成 ${want} 股，少了 ${pct(k)}）。國泰分批買的均價和收盤價差不了這麼多，比較可能是：開始的日期太早、扣款日或金額設錯了、有幾期其實沒扣到（餘額不足不會補扣），或有交易重複記了。先檢查計畫和交易紀錄。` };
  }
  if (k > CAL_RANGE[1]) {
    return { ...base, k, ok: false, kind: 'high', why: `國泰的庫存比冷眼算的多很多（預估的 ${estNow} 股要變成 ${want} 股，多了 ${pct(k)}）。比較可能是：開始的日期太晚、少選了扣款日、金額設太小、有開「智慧加減碼」，或你另外有買但沒有記。先檢查計畫和交易紀錄。` };
  }
  // 每一筆照同一個比例，四捨五入；零頭補給最接近的那幾筆（分割前的一股等於好幾股，只能整份調）
  const xs = est.map((l) => { const f = fac(l), x = l.sh * k; return { l, f, x, sh: Math.max(1, Math.round(x)) }; });
  let rem = want - xs.reduce((a, z) => a + z.sh * z.f, 0);
  for (let guard = 0; rem !== 0 && guard < xs.length * 8 + 8; guard++) {
    if (rem > 0) {
      const z = xs.filter((y) => y.f <= rem).sort((a, b) => (b.x - b.sh) - (a.x - a.sh) || a.f - b.f)[0];
      if (!z) break;
      z.sh += 1; rem -= z.f;
    } else {
      const z = xs.filter((y) => y.sh > 1 && y.f <= -rem).sort((a, b) => (a.x - a.sh) - (b.x - b.sh) || a.f - b.f)[0];
      if (!z) break;
      z.sh -= 1; rem += z.f;
    }
  }
  const changes = xs.map((z) => ({ id: z.l.id, sh: z.sh, px: round((z.l.sh * z.l.px) / z.sh, 4) }));
  const map = new Map(changes.map((c) => [c.id, c]));
  const next = (lots || []).map((l) => { const c = map.get(l.id); return c ? { ...l, sh: c.sh, px: c.px } : l; });
  return { ...base, k, ok: true, changes, after: holdingOf(next).sh, miss: rem, preSplit: xs.some((z) => z.f > 1) };
}
/** 今天是不是某個計畫的扣款日（提醒用：週末順延；平日放假要等官方資料才知道，自動入帳會照實際交易日處理） */
export function dcaDueToday(plan, td) {
  const days = planDays(plan);
  if (!days.length || !isWeekday(td)) return false;
  const sb = plan.sb === true;
  if (!sb && plan.start && td < plan.start) return false;
  if (!sb && plan.end && td > plan.end) return false;
  const y = Math.floor(td / 10000), m = Math.floor(td / 100) % 100;
  for (const [yy, mm] of [[y, m], [m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1]]) {
    for (const day of days) {
      if (day > daysIn(yy, mm)) continue;
      let d = yy * 10000 + mm * 100 + day;
      if (sb && ((plan.start && d < plan.start) || (plan.end && d > plan.end))) continue;
      for (let k = 0; k < 3 && !isWeekday(d); k++) d = addDays(d, 1);
      if (d === td) return true;
    }
  }
  return false;
}
/**
 * 今天有開市、上一個交易日是 lastTd：中間（不含兩端）原本有扣款日的，國泰順延到今天扣（例如平日的國定假日、連假）。
 * 只有確定今天有開市（有今天的盤中資料）時才用。
 */
export function dcaRolledToday(plan, td, lastTd) {
  const days = new Set(planDays(plan));
  if (!days.size || !okDay8(td) || !okDay8(lastTd) || lastTd >= td) return false;
  const sb = plan.sb === true;
  if (!sb && plan.start && td < plan.start) return false;
  if (!sb && plan.end && td > plan.end) return false;
  for (let x = addDays(lastTd, 1), g = 0; x < td && g < 40; x = addDays(x, 1), g++) {
    if (sb && ((plan.start && x < plan.start) || (plan.end && x > plan.end))) continue;
    if (days.has(x % 100)) return true;
  }
  return false;
}
/**
 * 上一個交易日 asof 之後、今天 td 之前，有一個原本的扣款日，而且從那天到昨天的每一個平日都「確定休市」（isClosed），
 * 國泰才會順延到今天扣。確定休市＝證交所的開休市日期表（cal.json）或這支手機親眼看到過；資料只是晚到的時候不亂說。
 */
export function rolledKnownBy(plan, td, asof, isClosed) {
  const days = new Set(planDays(plan));
  if (!days.size || !okDay8(td) || !okDay8(asof) || asof >= td) return false;
  for (let x = addDays(asof, 1), g = 0; x < td && g < 40; x = addDays(x, 1), g++) {
    if (!days.has(x % 100)) continue;
    let ok = true;
    for (let y = x; y < td; y = addDays(y, 1)) { if (isWeekday(y) && !isClosed(y)) { ok = false; break; } }
    if (ok) return true;
  }
  return false;
}
/** 證交所開休市日期表（後台的 cal.json：休市日、只辦交割日、用實際成交推出來的颱風假）：這一天確定不交易 */
export function calClosed(cal, d) {
  if (!cal || !Number.isInteger(d)) return false;
  return (Array.isArray(cal.holidays) && cal.holidays.includes(d)) || (Array.isArray(cal.closed) && cal.closed.includes(d));
}

/**
 * 定期定額接下來要扣的錢（加碼計畫先保留，不拿去加碼：扣款失敗不補扣，連續 3 次失敗國泰會終止全部台股定期定額）。
 * 從今天（含）到 days 天後，每個還在扣的計畫的每一期：原本的扣款日遇到週末、休市日（cal：證交所開休市日期表）順延，
 * 還沒記進交易紀錄（自動入帳或你核對、連結過的那一期）、也不是你刪掉的那幾期（skip：`代號|原本扣款日`）。
 * plans：normPlan 過的計畫；lots：真實部位的交易。回傳 { total, items: [{ c, plan, s: 原本扣款日, d: 預計扣款日, amt }] }（照 d 排序）
 */
export function dcaReserve(plans, lots, today, days, cal = null, skip = []) {
  const items = [];
  if (!okDay8(today)) return { total: 0, items };
  const hi = addDays(today, days);
  const done = new Set((lots || []).filter(isDcaLot).map((l) => `${l.dca.plan}|${l.dca.s}`));
  const sk = new Set(skip || []);
  const open = (d) => isWeekday(d) && !calClosed(cal, d);
  for (const p of plans || []) {
    if (!p || (p.end && p.end < today)) continue;
    const pd = planDays(p);
    if (!pd.length) continue;
    // 從上個月開始看：上個月底的扣款日遇到連假，可能順延到今天以後
    let y = Math.floor(today / 10000), m = Math.floor(today / 100) % 100 - 1;
    if (m < 1) { m = 12; y -= 1; }
    for (let g = 0; g < 4; g++) {
      if (y * 10000 + m * 100 + 1 > hi) break;
      for (const day of pd) {
        if (day > daysIn(y, m)) continue;                 // 那個月沒有這一天：國泰那一期不買
        const s = y * 10000 + m * 100 + day;
        let d = s;
        for (let k = 0; k < 15 && !open(d); k++) d = addDays(d, 1);
        if (d < today || d > hi) continue;
        if (p.sb === true ? (s < p.start || (p.end && s > p.end)) : (d < p.start || (p.end && d > p.end))) continue;
        if (done.has(`${p.id}|${s}`) || sk.has(`${p.c}|${s}`)) continue;
        items.push({ c: p.c, plan: p.id, s, d, amt: p.amt });
      }
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
  }
  items.sort((a, b) => a.d - b.d || a.s - b.s);
  return { total: items.reduce((t, x) => t + x.amt, 0), items };
}
