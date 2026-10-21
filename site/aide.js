/* 冷眼 — 副官（PZ 的投資小秘書）的純計算：
   反方檢查、部位巡檢、決策日記對答案與統計、帶去問 Claude 的文字、Claude 結論的解析。
   全部是純函式，不碰畫面、不連網；同樣的輸入永遠得到同樣的結果（tests/aide_test.mjs 會檢查）。
   副官只檢查、只記錄，不替你決定買賣。所有門檻都在這個檔案的常數裡，設定頁「副官怎麼檢查」照抄這裡。 */
import {
  daysBetween, addDays, tradeCost, taxCat, taxRateOf, premBand, PROFILES, capOf, sharesText, CAT_NAMES, signalEvidence,
  hotWhy, BOND_TAX_FREE_UNTIL, OVER_TOL,
} from './pf.js';

const isNum = (x) => typeof x === 'number' && isFinite(x);

// ------------------------------------------------------------------ 常數（門檻）
export const HORIZON = 20;   // 對答案：決定之後第 20 個交易日（和規則觀點、回測同一個尺度，約一個月）
export const AIDE = {
  bigMarket: 2,      // 大盤單日漲跌 2% 以上算「大波動日」
  bigMove: 3,        // 這一檔單日漲跌 3% 以上
  divSoon: 10,       // 10 天內除息就提醒
  thinVal: 3e7,      // 最近一天成交值低於 3,000 萬元算「成交清淡」
  smallAum: 0.1,     // 規模在全部 ETF 裡最小的 10%
  chase: 0.15,       // 換股：換過去的那檔近一年報酬多 15 個百分點以上，提醒「追逐過去報酬」
  cashHigh: 0.5,     // 觀望時現金超過總資產 50%
  smallPos: 0.02,    // 巡檢：單檔不到總資產 2% 算零碎部位
  manyPos: 10,       // 巡檢：持有超過 10 檔
  warnCool: 3,       // 有 3 個以上要注意的地方，建議冷靜一下（定案前再確認）
  confHigh: 4,       // 信心 4 以上、又和規則相反，建議冷靜一下
  minN: 20,          // 對答案累積 20 筆以上，戰績才有參考價值
  naDays: 60,        // 下市的 ETF：定案後超過 60 天還對不到答案，就標示無法對答案（還在交易的冷門 ETF 會一直等）
  openHM: 900,       // 開盤 09:00：在這之前記的，算當天那一盤；之後記的，算下一個交易日那一盤
  lockHM: 1325,      // 定案 13:25（收盤前、集合競價開始）：從那天的收盤開始對答案，所以那天盤中看到的走勢都已經算在起點裡
};
export const STANCE = {
  bull: { t: '想買／加碼', s: '看多' },
  bear: { t: '想賣／減碼', s: '看空' },
  wait: { t: '先觀望', s: '觀望' },
  swap: { t: '想換股', s: '換股' },
};
export const TAGS = {
  trend: '趨勢／技術', cheap: '跌深便宜', yield: '配息', news: '新聞事件', rule: '冷眼訊號', dca: '長期紀律',
  rebal: '調整比重', need: '要用錢', tip: '聽別人說', gut: '直覺', fomo: '怕錯過', fear: '怕再跌',
};
export const EMO_TAGS = ['tip', 'gut', 'fomo', 'fear'];    // 情緒型的理由：建議冷靜一下
export const NONVIEW_TAGS = ['dca', 'rebal', 'need'];       // 不是在猜漲跌的決定：照樣對答案，但不算進命中率
export const CONF = ['', '有點想', '偏向這樣', '有把握', '很有把握', '非常確定'];
const PS_T = { add: '可加碼', wait: '漲多分批', hold: '續抱', caution: '先不加碼', trim: '減碼' };
const ST_T = { 1: '偏多', 0: '中性', '-1': '偏空' };

// ------------------------------------------------------------------ 格式（和介面無關的小工具）
const pctS = (x, d = 1) => (isNum(x) ? `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(d)}%` : '—');   // 0.12 → +12.0%
const pctU = (x, d = 0) => (isNum(x) ? `${(x * 100).toFixed(d)}%` : '—');                                               // 0.12 → 12%
const pcS = (x, d = 2) => (isNum(x) ? `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(d)}%` : '—');            // 已經是 % 的數字
const pxS = (x) => (isNum(x) ? x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');
const ntS = (x) => (isNum(x) ? Math.round(x).toLocaleString('en-US') : '—');
const bigS = (x) => {
  if (!isNum(x)) return '—';
  const a = Math.abs(x);
  if (a >= 1e12) return `${(x / 1e12).toFixed(2)} 兆`;
  if (a >= 1e8) return `${(x / 1e8).toFixed(a >= 1e10 ? 0 : 1)} 億`;
  if (a >= 1e4) return `${(x / 1e4).toFixed(0)} 萬`;
  return x.toFixed(0);
};
const md = (d) => (d ? `${Math.floor(d / 100) % 100}/${d % 100}` : '—');
const dy = (d) => (d ? `${Math.floor(d / 10000)}/${String(Math.floor(d / 100) % 100).padStart(2, '0')}/${String(d % 100).padStart(2, '0')}` : '—');
const catN = (k) => CAT_NAMES[k] || '同類';
const sign = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);
const uniq = (xs) => [...new Set(xs)];

// ------------------------------------------------------------------ 日期
/** 星期一到五算交易日（不知道颱風假、連假），用來估「大概第幾天」與「大約哪天對答案」；真正對答案用歷史資料數。 */
export function weekdaysBetween(a, b) {
  if (!a || !b || b <= a) return 0;
  let n = 0;
  let d = a;
  for (let k = 0; k < 400 && d < b; k++) {
    d = addDays(d, 1);
    const t = new Date(Date.UTC(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100)).getUTCDay();
    if (t >= 1 && t <= 5) n++;
  }
  return n;
}
export function addWeekdays(d, n) {
  let x = d;
  let k = 0;
  while (k < n) {
    x = addDays(x, 1);
    const t = new Date(Date.UTC(Math.floor(x / 10000), Math.floor(x / 100) % 100 - 1, x % 100)).getUTCDay();
    if (t >= 1 && t <= 5) k++;
  }
  return x;
}
// ------------------------------------------------------------------ 定案：記下之後的下一個交易日 13:25
const twClock = (ms) => { const d = new Date(ms + 8 * 3600e3); return { d: d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate(), hm: d.getUTCHours() * 100 + d.getUTCMinutes(), wd: d.getUTCDay() }; };
/**
 * 一筆決定在「記下之後的下一個交易日、收盤前 13:25」定案（台灣時間）：開盤前（09:00 以前）記的是當天，
 * 盤中、收盤後、週末記的是下一個星期一到五。定案前可以刪除、冷靜後改變主意、貼回和 Claude 討論後的結論；定案後就不能改。
 * 對答案從「定案那天的收盤價」開始算（那天沒開市就是之後第一個交易日），所以定案前看到的任何走勢
 * （記下那天剩下的盤、晚上的國際行情、定案那天的盤中）都已經算在起點裡，改主意也佔不到便宜
 * （用真實歷史資料量過：只在走勢對自己有利時才留下，命中率只會多 1 個百分點左右）。
 * 平日放假那天照樣在 13:25 定案，從之後第一個交易日的收盤起算。
 */
export function lockDayAt(ms) {
  if (!isFinite(ms)) return null;
  const c = twClock(ms);
  return c.wd >= 1 && c.wd <= 5 && c.hm < AIDE.openHM ? c.d : addWeekdays(c.d, 1);
}
/** 記下的時間壞掉（不該發生，只有手機資料損壞）：用價格日期的下一個交易日，至少還能對答案 */
export const lockDay = (e) => (e ? lockDayAt(Date.parse(e.at || '')) || (e.snap && e.snap.d ? addWeekdays(e.snap.d, 1) : null) : null);
/** 定案的時刻（毫秒）：定案那天 13:25 台灣時間 */
export function lockAt(e) {
  const d = lockDay(e);
  return d ? Date.UTC(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100, Math.floor(AIDE.lockHM / 100) - 8, AIDE.lockHM % 100) : 0;
}
export const isLocked = (e, now = Date.now()) => !lockAt(e) || now >= lockAt(e);
/** 這個時間點在定案以前嗎（貼回結論、冷靜期回覆要在定案前才算數） */
const beforeLock = (e, iso) => { const t = Date.parse(iso || ''); return isFinite(t) && t < lockAt(e); };
/** 冷靜期：定案前（下一個交易日 13:25 前）再確認一次；回傳那天的日期 */
export const coolDue = (ms = Date.now()) => lockDayAt(ms);

// ------------------------------------------------------------------ 反方檢查（固定規則）
const ok = (k, t) => ({ k, lvl: 'ok', t });
const info = (k, t) => ({ k, lvl: 'info', t });
const warn = (k, t) => ({ k, lvl: 'warn', t });
const stop = (k, t) => ({ k, lvl: 'stop', t });
/** 有金額或股數的檢查，另外附一份「只寫比例」的說法（tp），打包給 Claude 而且沒勾「附上金額」時用 */
const withTp = (it, tp) => ({ ...it, tp });
/** 只寫比例：拿掉文字裡的金額與股數（沒有 tp 的舊紀錄用） */
export function redactAmt(t) {
  return String(t || '')
    .replace(/（約\s*[\d,.]+\s*元）/g, '')
    .replace(/約\s*[\d,.]+\s*元、?/g, '')
    .replace(/[\d,]+\s*張(\s*[\d,]+\s*股)?|[\d,]+\s*股/g, '若干股');
}

function ruleWord(row) {
  return `規則觀點「${ST_T[String(row.st)]}」${row.ps ? `、部位訊號「${PS_T[row.ps]}」` : ''}`;
}
/** 部位訊號「先不加碼」是哪個條件造成的 */
function cautionWhy(row, q) {
  const out = [];
  if (row.st < 0) out.push('觀點偏空');
  if (isNum(row.dl) && isNum(q.px) && q.px < row.dl) out.push('跌破移動防守線');
  const [w] = premBand(row);
  if (isNum(q.prem) && q.prem > w) out.push('溢價太高');
  if ((row.fl || []).some((f) => f === 'notice' || f === 'disposal')) out.push('注意／處置中');
  return out.join('、') || '條件不夠好';
}
function ruleCheck(row, q, want) {
  if (!row || row.st == null) return info('rule', '這檔上市還不到 70 個交易日，冷眼沒有規則觀點可以對照。');
  const w = ruleWord(row);
  if (want > 0) {
    if (row.st > 0 && (row.ps === 'add' || row.ps === 'wait')) return ok('rule', `${w}：和你的方向一致。`);
    if (row.st > 0) return info('rule', `${w}：方向偏多，但部位訊號提醒先不要加碼（${cautionWhy(row, q)}）。`);
    if (row.st === 0) return info('rule', `${w}：中性不是買進訊號，要買就小額分批。`);
    return warn('rule', `${w}：和你的想法相反。相反不代表你錯，但要說得出規則沒看到的理由。`);
  }
  if (row.st < 0 || row.ps === 'trim') return ok('rule', `${w}：和你的方向一致。`);
  if (row.ps === 'caution') return info('rule', `${w}：規則也建議先不加碼，但還沒到減碼。`);
  if (row.st > 0) return warn('rule', `${w}：規則偏多，和你想賣的方向相反。`);
  return info('rule', `${w}：中性，規則沒有給賣出訊號。`);
}
function evidence(row, stats) {
  if (!row || !row.ps || !stats) return null;
  const ev = signalEvidence(stats, row.ps, catN(row.k));
  if (!ev) return null;
  const tail = row.ps === 'trim' ? `；最差 10% 的情況 ${pctS(ev.p10)}，同類 ${pctS(ev.baseP10)}` : '';
  return info('ev', `回測（${ev.catName}）：「${PS_T[row.ps]}」之後 20 個交易日上漲的比例 ${pctU(ev.up)}，同類任何一天 ${pctU(ev.base)}（${ntS(ev.n)} 次）${tail}。`);
}
function restricted(row) {
  const fl = (row && row.fl) || [];
  if (fl.includes('disposal')) return stop('restrict', '被列為處置標的：交易受限（要先付款、分盤撮合），先不要動作，等處置結束。');
  if (fl.includes('notice')) return stop('restrict', '被列為注意標的：成交異常，交易所正在盯著，先不要急著動作。');
  return null;
}
function premCheck(row, q, sell, name = '') {
  if (!isNum(q.prem)) return null;
  const [w] = premBand(row);
  const p = q.prem;
  const pre = name ? `${name} ` : '';
  if (sell) {
    if (p > w) return info('prem', `${pre}溢價 ${p.toFixed(2)}%：賣在溢價對你有利。`);
    if (p < -w) return info('prem', `${pre}折價 ${Math.abs(p).toFixed(2)}%：賣在折價等於比淨值少拿。`);
    return null;
  }
  if (p > w) return warn('prem', `${pre}溢價 ${p.toFixed(2)}%（警戒 ${w}%）：現在買等於比淨值多付錢。`);
  if (p < -w) return info('prem', `${pre}折價 ${Math.abs(p).toFixed(2)}%：比淨值便宜，也要想想為什麼沒人要。`);
  return ok('prem', `${pre}市價接近淨值（${p >= 0 ? '溢價' : '折價'} ${Math.abs(p).toFixed(2)}%）。`);
}
function thinCheck(row, name = '') {
  if (!row || !isNum(row.val) || row.val >= AIDE.thinVal) return null;
  return warn('thin', `${name ? name + ' ' : ''}成交清淡（最近一天成交值約 ${bigS(row.val)}元）：買賣價差可能比較大，下單用限價，不要用市價。`);
}
function aumCheck(row, rank, name = '') {
  if (!isNum(rank) || rank >= AIDE.smallAum || !isNum(row.aum)) return null;
  return info('aum', `${name ? name + ' ' : ''}規模約 ${bigS(row.aum)}元，在全部 ETF 裡屬於最小的 10%：規模一直縮水的 ETF 有可能被清算下市。`);
}
function divCheck(row, today, sell, held) {
  const nd = row && row.dv;
  if (!nd || !(nd.d >= today) || daysBetween(today, nd.d) > AIDE.divSoon) return null;
  const cash = isNum(nd.cash) ? `，每單位 ${+nd.cash.toFixed(3)} 元` : '，金額待公告';
  if (sell) {
    if (!held) return null;
    return info('div', `${md(nd.d)} 除息${cash}：除息日前賣出就領不到這次配息（股價也還沒扣息，總報酬差不多）；想領就等除息後再賣。`);
  }
  return info('div', `${md(nd.d)} 除息${cash}：除息前一天收盤前買進才領得到；但除息當天股價會扣掉配息，配息還要併入所得、單次 2 萬元以上先扣 2.11% 二代健保——不是白拿。`);
}
function levCheck(row) {
  if (!row || !['lev', 'inv'].includes(row.k)) return null;
  return warn('lev', `${row.k === 'lev' ? '槓桿' : '反向'}型每天重新平衡，長期持有會偏離指數，只適合短線。`);
}
function marketCheck(m) {
  if (!m || !isNum(m.pc) || Math.abs(m.pc) < AIDE.bigMarket) return null;
  return warn('market', `今天大盤${m.pc > 0 ? '大漲' : '大跌'} ${pcS(m.pc)}：大波動的日子最容易衝動做決定。`);
}
function emoCheck(tags) {
  const emo = (tags || []).filter((t) => EMO_TAGS.includes(t));
  if (!emo.length) return null;
  return warn('emo', `你的理由裡有「${emo.map((t) => TAGS[t]).join('、')}」：這類理由最容易事後後悔，建議冷靜一下、定案前再確認一次。`);
}

/**
 * 副官檢查：把你的想法拿去對照冷眼的資料與你的紀律，逐條列出「一致／要注意／要停」。
 * x: { stance, conf, tags, row, q, row2, q2, hold, hold2, adv, stats, stats2, market, ctx:{T,cash,profile,fee,today},
 *      aumRank, aumRank2, privacy, bookName }
 *   hold：{ sh, avg, cost, w, pnlPct }（沒有持股給 null）；q：{ px, pc, prem, date, live }
 * 回傳 { items:[{k,lvl,t}], warn, stop, ok, cool, coolWhy:[], verdict }
 */
export function aideCheck(x) {
  const items = [];
  const push = (it) => { if (it) items.push(it); };
  const { stance, row, q = {}, ctx = {} } = x;
  const today = ctx.today;
  const conf = x.conf || 0;
  const tags = x.tags || [];
  if (!row) return { items, warn: 0, stop: 0, ok: 0, cool: false, coolWhy: [], verdict: '先選一檔 ETF' };
  const want = stance === 'bull' ? 1 : stance === 'bear' ? -1 : 0;
  const hold = x.hold && x.hold.sh > 0 ? x.hold : null;

  if (stance === 'bull' || stance === 'bear') {
    const sell = stance === 'bear';
    push(restricted(row));
    push(ruleCheck(row, q, want));
    push(evidence(row, x.stats));
    if (!sell && row.hot) push(warn('hot', `短線漲多（${hotWhy(row, q.px)}）：想買就分批，別一次買滿。`));
    if (!sell && isNum(q.pc) && q.pc >= AIDE.bigMove) push(warn('move', `今天已經漲 ${pcS(q.pc)}：追價前先想好，如果明天跌回來你會怎麼做。`));
    if (sell && isNum(q.pc) && q.pc <= -AIDE.bigMove) push(warn('move', `今天跌 ${pcS(q.pc)}：大跌當天賣出，常常賣在最低點附近。`));
    push(premCheck(row, q, sell));
    if (isNum(row.dl) && isNum(q.px)) {
      const below = q.px < row.dl;
      if (!sell) push(below ? warn('dl', `已跌破移動防守線 ${pxS(row.dl)}：前一段上漲已經中斷。逢低買之前，先想好跌到哪裡認錯。`) : ok('dl', `在移動防守線 ${pxS(row.dl)} 之上（還有 ${pctS(row.dl / q.px - 1)} 的空間），趨勢還沒被破壞。`));
      else push(below ? ok('dl', `已跌破移動防守線 ${pxS(row.dl)}：減碼有規則上的依據。`) : info('dl', `還在移動防守線 ${pxS(row.dl)} 之上：趨勢還沒有被破壞。`));
    }
    push(divCheck(row, today, sell, !!hold));
    if (!sell) {
      const a = x.adv;
      if (!(ctx.T > 0)) push(info('plan', `還沒有輸入現金或持股（${x.bookName || '部位'}），副官沒辦法幫你算可以買多少。`));
      else if (a && (a.key === 'full' || a.key === 'rebalance')) push(warn('plan', `比重已經到你設定的上限（${catN(row.k)}單檔 ${pctU(capOf(ctx.profile, row.k))}）：照紀律不再加碼。`));
      else if (a && a.plan && a.plan.n > 0) {
        const amt = a.plan.parts.reduce((s, t) => s + t.sh * t.px, 0);
        push(withTp(ok('plan', `依你的紀律（${x.bookName || '部位'}），這次最多 ${sharesText(a.plan.n)}${x.privacy ? '' : `（約 ${ntS(amt)} 元）`}、分三批；出場線 ${pxS(a.plan.stop)}。`),
          `依你的紀律（${x.bookName || '部位'}），這次最多買到約占總資產 ${pctU(amt / ctx.T, 1)}、分三批；出場線 ${pxS(a.plan.stop)}。`));
      } else if (a && a.plan) push(info('plan', `依你的紀律（${x.bookName || '部位'}），目前建議 0 股（${a.plan.limit === 'cash' ? '分到的現金不夠' : a.plan.limit === 'cap' ? '比重已到上限' : '單筆風險預算太小'}）。`));
      if (hold && isNum(hold.pnlPct) && hold.pnlPct < 0 && row.st < 0) push(warn('avgdown', `帳面虧損 ${pctS(hold.pnlPct)}，而且規則偏空：往下買是攤平，不是加碼。`));
    } else if (hold) {
      if (isNum(q.px)) {
        const c = tradeCost('sell', hold.sh, q.px, taxCat(row), today, ctx.fee);
        const free = taxRateOf(taxCat(row), today) === 0;
        const realized = c.net - hold.cost;
        const gross = hold.sh * q.px;
        const rp = pctS(hold.cost > 0 ? realized / hold.cost : null);
        push(withTp(info('cost', `全部賣出：手續費${x.privacy ? '' : `約 ${ntS(c.fee)} 元`}、證交稅${free ? '免' : x.privacy ? '0.1%' : `約 ${ntS(c.tax)} 元`}，已實現損益約 ${rp}。`),
          `全部賣出：手續費${free ? '（證交稅免）' : '加證交稅'}約占賣出金額的 ${gross > 0 ? ((c.fee + c.tax) / gross * 100).toFixed(2) : '—'}%，已實現損益約 ${rp}。`));
      }
      if (isNum(hold.pnlPct) && hold.pnlPct < 0) push(info('sunk', `帳面虧損 ${pctS(hold.pnlPct)}：成本高低不會影響之後的漲跌。問自己：「如果現在手上是現金，我會買這檔嗎？」不會，賣出才有道理。`));
      else if (isNum(hold.pnlPct) && hold.pnlPct > 0) push(info('gain', `帳面獲利 ${pctS(hold.pnlPct)}：可以分批賣，不用一次賣光。`));
      if (['broad', 'div'].includes(row.k)) push(info('long', '市值型、高股息常是長期存股的部位：短期偏空不一定要全賣，可以只減一部分。'));
      if (taxCat(row) === 'bond' && today <= BOND_TAX_FREE_UNTIL) push(info('tax', `被動式債券 ETF 賣出免證交稅到 ${dy(BOND_TAX_FREE_UNTIL)}。`));
    } else {
      push(info('nohold', '你目前沒有這檔的紀錄：這會記成「看空」的想法（台股 ETF 不能賣自己沒有的股票）。'));
    }
    push(thinCheck(row));
    push(aumCheck(row, x.aumRank));
    push(levCheck(row));
  } else if (stance === 'wait') {
    push(restricted(row));
    if (row.st == null) push(info('rule', '這檔上市還不到 70 個交易日，冷眼沒有規則觀點可以對照。'));
    else if (row.st > 0 && row.ps === 'add') push(info('rule', `${ruleWord(row)}：觀望也是一種決定，記下來，20 個交易日後看看結果。`));
    else if (row.st < 0) push(ok('rule', `${ruleWord(row)}：先觀望和規則一致。`));
    else push(info('rule', `${ruleWord(row)}：規則沒有明確的買賣訊號。`));
    push(evidence(row, x.stats));
    if (ctx.T > 0 && isNum(ctx.cash) && ctx.cash / ctx.T > AIDE.cashHigh) push(info('cash', `現金占總資產 ${pctU(ctx.cash / ctx.T)}：觀望可以，但長期抱太多現金也是一種風險（通膨會吃掉購買力）。`));
    push(divCheck(row, today, !!hold, !!hold));
  } else if (stance === 'swap') {
    const r2 = x.row2;
    const q2 = x.q2 || {};
    if (!r2) return { items, warn: 0, stop: 0, ok: 0, cool: false, coolWhy: [], verdict: '再選一檔要換過去的 ETF' };
    push(restricted(row));
    const rs = restricted(r2);
    if (rs) push({ ...rs, t: `${r2.n}：${rs.t}` });
    const d1 = row.st == null ? null : sign(row.st), d2 = r2.st == null ? null : sign(r2.st);
    const lbl = `規則觀點：${row.n}「${row.st == null ? '資料不足' : ST_T[String(row.st)]}」、${r2.n}「${r2.st == null ? '資料不足' : ST_T[String(r2.st)]}」`;
    if (d1 == null || d2 == null) push(info('rule', `${lbl}。`));
    else if (d2 > d1) push(ok('rule', `${lbl}：換過去的那檔，規則觀點比較好。`));
    else if (d2 < d1) push(warn('rule', `${lbl}：換過去的那檔，規則觀點反而比較差。`));
    else push(info('rule', `${lbl}：兩檔一樣。`));
    if (isNum(row.r1y) && isNum(r2.r1y)) {
      push(info('cmp', `近一年含息報酬 ${row.n} ${pctS(row.r1y)}、${r2.n} ${pctS(r2.r1y)}；年化波動 ${pctU(row.vol, 1)} 對 ${pctU(r2.vol, 1)}；最大回檔 ${pctU(row.mdd, 1)} 對 ${pctU(r2.mdd, 1)}。`));
      if (r2.r1y - row.r1y > AIDE.chase) push(warn('chase', `${r2.n} 近一年比 ${row.n} 多賺 ${((r2.r1y - row.r1y) * 100).toFixed(0)} 個百分點：小心「追逐過去的報酬」，過去贏的不代表接下來也會贏。`));
    }
    if (row.k !== r2.k) push(info('cat', `類別不同（${catN(row.k)} → ${catN(r2.k)}）：風險、配息、和大盤的連動都會不一樣。`));
    if (hold && isNum(q.px) && isNum(q2.px) && q.px > 0 && q2.px > 0) {
      const s = tradeCost('sell', hold.sh, q.px, taxCat(row), today, ctx.fee);
      const nB = Math.floor(s.net / q2.px);
      const b = nB > 0 ? tradeCost('buy', nB, q2.px, taxCat(r2), today, ctx.fee) : { fee: 0 };
      const gross = hold.sh * q.px;
      const cost = s.fee + s.tax + b.fee;
      const share = gross > 0 ? (cost / gross * 100).toFixed(2) : '—';
      push(withTp(info('cost', `換股成本：賣出的手續費＋證交稅、加上買進的手續費，${x.privacy ? '' : `約 ${ntS(cost)} 元、`}約占這筆錢的 ${share}%。`),
        `換股成本：賣出的手續費＋證交稅、加上買進的手續費，約占這筆錢的 ${share}%。`));
    } else if (!hold) {
      push(info('nohold', `你目前沒有 ${row.n} 的紀錄：這會記成「${r2.n} 接下來會贏過 ${row.n}」的想法。`));
    }
    push(premCheck(r2, q2, false, r2.n));
    push(thinCheck(r2, r2.n));
    push(aumCheck(r2, x.aumRank2, r2.n));
    push(levCheck(r2));
    push(divCheck(row, today, true, !!hold));
  }
  push(marketCheck(x.market));
  push(emoCheck(tags));
  const opp = want !== 0 && row.st != null && sign(row.st) === -want;
  if (conf >= AIDE.confHigh && opp) push(warn('conf', `你「${CONF[conf]}」，但規則和你相反：確定的感覺不等於勝率，先把反方理由寫下來。`));

  const nWarn = items.filter((i) => i.lvl === 'warn').length;
  const nStop = items.filter((i) => i.lvl === 'stop').length;
  const nOk = items.filter((i) => i.lvl === 'ok').length;
  const coolWhy = [];
  if (nStop) coolWhy.push('交易受限');
  if (tags.some((t) => EMO_TAGS.includes(t))) coolWhy.push('理由偏情緒');
  if (x.market && isNum(x.market.pc) && Math.abs(x.market.pc) >= AIDE.bigMarket) coolWhy.push('大盤大波動');
  if (isNum(q.pc) && Math.abs(q.pc) >= AIDE.bigMove && stance !== 'wait') coolWhy.push('這檔今天大漲大跌');
  if (conf >= AIDE.confHigh && opp) coolWhy.push('很有把握但和規則相反');
  if (nWarn >= AIDE.warnCool) coolWhy.push(`有 ${nWarn} 個地方要注意`);
  const cool = stance !== 'wait' && coolWhy.length > 0;
  const verdict = nStop ? '有交易限制，先不要動作'
    : nWarn === 0 ? '沒有明顯的紅旗'
      : nWarn < AIDE.warnCool ? `有 ${nWarn} 個地方要想清楚` : `紅旗不少（${nWarn} 個），建議冷靜一下`;
  return { items, warn: nWarn, stop: nStop, ok: nOk, cool, coolWhy, verdict };
}

// ------------------------------------------------------------------ 部位巡檢
/**
 * P：buildPortfolio() 的結果（holdings 要有 row、w、px；totals 要有 T、cash）；profile：風險屬性；stress：stressToStops()
 * 回傳和 aideCheck 一樣格式的 items。
 */
export function auditPf(P, profile, today, stress) {
  const items = [];
  if (!P || !(P.totals.T > 0)) return items;
  const t = P.totals;
  const hs = P.holdings.filter((x) => x.mv > 0);
  const cashW = t.cash / t.T;
  if (!hs.length) {
    items.push(info('cash', '目前只有現金，還沒有持股。'));
    return items;
  }
  const prof = PROFILES[profile] || PROFILES.mid;
  items.push(info('cash', `現金占總資產 ${pctU(cashW)}${t.cash > 0 ? '' : '：遇到可加碼的時機時沒有子彈'}${cashW > AIDE.cashHigh ? '：比例偏高，長期抱現金會被通膨吃掉購買力' : ''}。`));
  const over = hs.filter((x) => x.w > capOf(profile, x.cat) + OVER_TOL);
  const top = hs.slice().sort((a, b) => b.w - a.w)[0];
  if (over.length) for (const x of over) items.push(warn('cap', `${x.name} 占 ${pctU(x.w, 1)}，超過你設定的上限 ${pctU(capOf(profile, x.cat))}（${prof.name}型、${catN(x.cat)}）。`));
  else items.push(ok('cap', `每一檔都在你設定的上限內（最大是 ${top.name} ${pctU(top.w, 1)}）。`));
  const cats = {};
  for (const x of hs) cats[x.cat] = (cats[x.cat] || 0) + x.w;
  const cs = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  items.push(info('mix', `類別：${cs.map(([k, w]) => `${catN(k)} ${pctU(w)}`).join('、')}${t.cash > 0 ? `、現金 ${pctU(cashW)}` : ''}。`));
  const levW = (cats.lev || 0) + (cats.inv || 0);
  if (levW > 0 && levW > prof.caps.lev) items.push(warn('lev', `槓桿與反向型合計 ${pctU(levW, 1)}，超過你單檔上限 ${pctU(prof.caps.lev)}：這類 ETF 只適合短線。`));
  const below = hs.filter((x) => x.row && isNum(x.row.dl) && isNum(x.px) && x.px < x.row.dl);
  if (below.length) items.push(warn('dl', `${below.length} 檔在移動防守線之下：${below.map((x) => x.name).join('、')}。`));
  else items.push(ok('dl', '每一檔都還在移動防守線之上。'));
  const rs = hs.filter((x) => x.row && (x.row.fl || []).some((f) => f === 'notice' || f === 'disposal'));
  if (rs.length) items.push(stop('restrict', `${rs.map((x) => x.name).join('、')} 被列入注意或處置，交易受限。`));
  const soon = hs.filter((x) => x.nextDiv && x.nextDiv.d >= today && daysBetween(today, x.nextDiv.d) <= AIDE.divSoon);
  if (soon.length) items.push(info('div', `${AIDE.divSoon} 天內除息：${soon.map((x) => `${x.name} ${md(x.nextDiv.d)}`).join('、')}。`));
  const tiny = hs.filter((x) => x.w < AIDE.smallPos);
  if (tiny.length) items.push(info('tiny', `${tiny.map((x) => x.name).join('、')} 各不到總資產 ${pctU(AIDE.smallPos)}：對整體影響很小，值得想想留著的理由。`));
  if (hs.length > AIDE.manyPos) items.push(info('many', `持有 ${hs.length} 檔：檔數多不一定比較分散，很多 ETF 的成分股是重疊的。`));
  if (stress && stress.items && stress.items.length && isNum(stress.pct)) items.push(info('stress', `如果每一檔都跌到出場線，總資產約 ${pctS(stress.pct)}（${prof.name}型的單筆上限是 ${(prof.loss * 100).toFixed(1)}%／筆）。`));
  return items;
}

// ------------------------------------------------------------------ 決策日記：對答案
/** 含息報酬指數：除息日把配息用收盤價買回、分割照倍數換算；tr[k] / tr[j] − 1 就是第 j 天收盤到第 k 天收盤的含息報酬。
 *  除息、分割那天剛好沒有成交，就算在下一個有成交的交易日。 */
export function trIndex(h) {
  const D = h.d, P = h.p;
  const n = D.length;
  const tr = new Array(n).fill(null);
  if (!n) return tr;
  const ev = [];
  for (const [d, f] of h.splits || []) if (f > 0) ev.push([d, 's', f]);
  for (const [d, c] of h.divs || []) if (c > 0) ev.push([d, 'd', c]);
  ev.sort((a, b) => a[0] - b[0] || (a[1] === 's' ? -1 : 1));
  let e = 0;
  while (e < ev.length && ev[e][0] <= D[0]) e++;
  tr[0] = 1;
  for (let k = 1; k < n; k++) {
    let f = 1, c = 0;
    while (e < ev.length && ev[e][0] <= D[k]) {
      const [, kind, v] = ev[e++];
      if (kind === 's') f *= v; else c += v;
    }
    tr[k] = P[k - 1] > 0 && P[k] > 0 ? tr[k - 1] * f * (P[k] + c) / P[k - 1] : tr[k - 1];
  }
  return tr;
}
const lastIdx = (D, d) => { let lo = 0, hi = D.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (D[m] <= d) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; };
const firstIdx = (D, d) => { let lo = 0, hi = D.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (D[m] >= d) { ans = m; hi = m - 1; } else lo = m + 1; } return ans; };

/**
 * 一筆決定的對答案狀態。h、h2：歷史資料 { d, p, splits, divs }（只有這檔有成交的日子）。
 * 起點是定案那天（lockDay）的收盤；那天這檔沒成交，就是之後第一個有成交的日子。數這檔自己的 20 個交易日（和回測一樣）。
 * 換股：換過去那檔用同一天（沒成交就用之前最後一次成交）。
 * 回傳 { state:'wait', n, d0, px0 } 或 { state:'done', d0, px0, d: 對答案那天, px, ret, ret2 } 或 { state:'na', why }
 */
export function evalEntry(e, h, h2 = null) {
  const L = lockDay(e);
  if (!L || !e.snap) return { state: 'na', why: '這筆紀錄沒有時間或當時的價格' };
  if (!h || !h.d || !h.d.length) return { state: 'wait', n: 0 };
  const D = h.d;
  const k0 = firstIdx(D, L);
  if (k0 < 0) return { state: 'wait', n: 0 };           // 定案那天的收盤還沒進歷史資料
  const a = { d0: D[k0], px0: h.p[k0] };
  // 換過去那檔：從起點那天（或之後第一個有成交的日子）的收盤算，和換出的那檔一樣不吃定案前的走勢
  if (h2 && h2.d && h2.d.length) { const j = firstIdx(h2.d, D[k0]); if (j >= 0) a.px02 = h2.p[j]; }
  const n = D.length - 1 - k0;
  if (n < HORIZON) return { state: 'wait', n, ...a };
  const kT = k0 + HORIZON;
  const tr = trIndex(h);
  const out = { state: 'done', ...a, d: D[kT], px: h.p[kT], ret: tr[kT] / tr[k0] - 1 };
  if (e.stance === 'swap' || e.c2) {
    if (!h2 || !h2.d || !h2.d.length) return { state: 'na', why: '換過去的那檔缺少價格' };
    const j0 = firstIdx(h2.d, D[k0]);
    if (j0 < 0) return { state: 'wait', n, ...a };                       // 換過去那檔從起點之後還沒成交過
    const jT = lastIdx(h2.d, D[kT]);
    if (jT < j0) return { state: 'na', why: '換過去的那檔在這 20 個交易日裡沒有成交，沒辦法比較' };
    const tr2 = trIndex(h2);
    out.ret2 = tr2[jT] / tr2[j0] - 1;
  }
  return out;
}
/** 還沒到期時「到目前為止」的含息報酬（不用歷史檔：用目前報價與除息紀錄） */
export function interimRet(snap, pxNow, dNow, divs = [], splits = []) {
  if (!snap || !(snap.px > 0) || !isNum(pxNow)) return null;
  let units = 1, cash = 0;
  const ev = [];
  for (const [d, k] of splits || []) if (d > snap.d && d <= dNow) ev.push([d, 's', k]);
  for (const [d, c] of divs || []) if (d > snap.d && d <= dNow && c > 0) ev.push([d, 'd', c]);
  ev.sort((a, b) => a[0] - b[0] || (a[1] === 's' ? -1 : 1));
  for (const [, kind, v] of ev) { if (kind === 's') units *= v; else cash += units * v; }
  return (units * pxNow + cash) / snap.px - 1;
}
/** 換股的基準：歷史上「任何一天」換過去，20 個交易日後換入的那檔贏過換出的機率與平均差距 */
export function pairBase(hA, hB, horizon = HORIZON) {
  if (!hA || !hB || !hA.d || !hB.d) return null;
  const trA = trIndex(hA), trB = trIndex(hB);
  const iB = new Map(hB.d.map((d, k) => [d, k]));
  let win = 0, n = 0, sum = 0;
  for (let k = 0; k + horizon < hA.d.length; k++) {
    const j = iB.get(hA.d[k]);
    const jT = iB.get(hA.d[k + horizon]);
    if (j == null || jT == null) continue;
    const ra = trA[k + horizon] / trA[k] - 1, rb = trB[jT] / trB[j] - 1;
    if (!isFinite(ra) || !isFinite(rb)) continue;
    n++;
    sum += rb - ra;
    if (rb > ra) win++;
  }
  return n >= 60 ? { up: win / n, avg: sum / n, n } : null;
}

/** 貼回的【冷眼結論】算不算數：定案（下一個交易日 13:25）以前貼回的才算 */
export const afterCounts = (e) => !!(e.after && e.after.stance && beforeLock(e, e.after.at));
/** 冷靜後改變主意：定案以前回覆的才算 */
export const coolDropped = (e) => !!(e.cool && e.cool.res === 'changed' && beforeLock(e, e.cool.at));
/** 最後算分用的立場：定案前貼回「討論後的決定」就用它；換股紀錄只認「換股」或「觀望」，單檔紀錄的「換股」等於賣掉這檔 */
export function finalStance(e) {
  const a = afterCounts(e) && e.after.stance;
  if (!a) return e.stance;
  if (e.stance === 'swap') return a === 'wait' ? 'wait' : 'swap';
  return a === 'swap' ? 'bear' : a;
}
export const nonView = (e) => (e.tags || []).some((t) => NONVIEW_TAGS.includes(t));
/** 依立場判斷對錯：看多 → 20 日含息報酬 > 0；看空 → < 0；換股 → 換入的贏過換出的；觀望不算 */
export function hitOf(stance, res) {
  if (!res || res.state === 'na') return null;
  if (stance === 'bull') return isNum(res.ret) ? res.ret > 0 : null;
  if (stance === 'bear') return isNum(res.ret) ? res.ret < 0 : null;
  if (stance === 'swap') return isNum(res.ret) && isNum(res.ret2) ? res.ret2 > res.ret : null;
  return null;
}
/** 同樣的方向、同類 ETF「任何一天」會對的機率（res 裡存了當時的同類基準） */
export function baseOf(stance, res) {
  if (!res) return null;
  if (stance === 'bull') return isNum(res.bu) ? res.bu : null;
  if (stance === 'bear') return isNum(res.bu) ? 1 - res.bu : null;
  if (stance === 'swap') return isNum(res.pb) ? res.pb : null;
  return null;
}
/** 依立場換算的報酬（看多＝報酬、看空＝負的報酬、換股＝換入減換出），和同類任何一天的平均 */
export function edgeOf(stance, res) {
  if (!res) return null;
  if (stance === 'bull') return res.ret;
  if (stance === 'bear') return isNum(res.ret) ? -res.ret : null;
  if (stance === 'swap') return isNum(res.ret) && isNum(res.ret2) ? res.ret2 - res.ret : null;
  return null;
}
export function baseEdgeOf(stance, res) {
  if (!res) return null;
  if (stance === 'bull') return isNum(res.ba) ? res.ba : null;
  if (stance === 'bear') return isNum(res.ba) ? -res.ba : null;
  if (stance === 'swap') return isNum(res.pa) ? res.pa : null;
  return null;
}

/**
 * 一筆已經對答案的紀錄怎麼算。counted＝算進命中率：在猜漲跌、有對錯、有同類基準、冷靜後沒有放棄（定案前回覆的才算）。
 * why：nonview（長期紀律之類，不算）、dropped（冷靜後改變主意、沒照做）、wait（觀望不算對錯）、nobase（沒有同類基準可比）
 * 畫面上的「對了／錯了」一律照這裡，和戰績的算法一致。
 */
export function scoreOf(e) {
  if (!e || !e.res || e.res.state !== 'done') return null;
  const st = finalStance(e);
  const hit = hitOf(st, e.res);
  const base = baseOf(st, e.res);
  const why = nonView(e) ? 'nonview' : coolDropped(e) ? 'dropped' : hit == null ? 'wait' : !isNum(base) ? 'nobase' : null;
  return { e, st, hit, base, counted: !why, why, edge: edgeOf(st, e.res), bedge: baseEdgeOf(st, e.res) };
}
const avgOf = (xs) => { const v = xs.filter(isNum); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

/**
 * 決策日記的戰績：只算已經對答案、而且是在猜漲跌的決定（理由是長期紀律、調整比重、要用錢的不算）。
 * 一定和「同類 ETF 任何一天照同樣方向做」的基準並列（依你決定的組成加權）。
 */
export function journalStats(items) {
  const done = items.filter((e) => e.res && e.res.state === 'done');
  const scored = done.map(scoreOf).filter((z) => z && z.counted);
  const agg = (xs) => {
    const n = xs.length;
    if (!n) return { n: 0, hits: 0, rate: null, base: null, edge: null, bedge: null };
    const hits = xs.filter((z) => z.hit).length;
    const avg = (f) => { const v = xs.map(f).filter(isNum); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    return { n, hits, rate: hits / n, base: avg((z) => z.base), edge: avg((z) => z.edge), bedge: avg((z) => z.bedge) };
  };
  const all = agg(scored);
  // 你和冷眼規則：同方向、唱反調、規則中性
  const dirOf = (z) => (z.st === 'bull' ? 1 : z.st === 'bear' ? -1 : 0);
  const withRule = scored.filter((z) => dirOf(z) !== 0 && z.e.snap && z.e.snap.st != null);
  const same = withRule.filter((z) => sign(z.e.snap.st) === dirOf(z));
  const opp = withRule.filter((z) => sign(z.e.snap.st) === -dirOf(z));
  const neu = withRule.filter((z) => z.e.snap.st === 0);
  const vsRule = { same: agg(same), opp: { ...agg(opp), ruleHits: opp.filter((z) => !z.hit && z.e.res.ret !== 0).length }, neu: agg(neu) };
  const byConf = { hi: agg(scored.filter((z) => (z.e.conf || 0) >= AIDE.confHigh)), lo: agg(scored.filter((z) => z.e.conf && z.e.conf < AIDE.confHigh)) };
  const byTag = {};
  for (const k of Object.keys(TAGS)) {
    const xs = scored.filter((z) => (z.e.tags || []).includes(k));
    if (xs.length) byTag[k] = agg(xs);
  }
  const bySrc = { idea: agg(scored.filter((z) => z.e.src !== 'trade')), real: agg(scored.filter((z) => z.e.src === 'trade' && z.e.book !== 'paper')), paper: agg(scored.filter((z) => z.e.src === 'trade' && z.e.book === 'paper')) };
  // 冷靜期之後改變主意：原本的想法如果照做，對不對
  const changed = done.filter((e) => coolDropped(e) && hitOf(e.stance, e.res) != null && isNum(baseOf(e.stance, e.res)) && !nonView(e));
  const cooled = { n: changed.length, origRight: changed.filter((e) => hitOf(e.stance, e.res)).length, base: avgOf(changed.map((e) => baseOf(e.stance, e.res))) };
  // 和 Claude 討論後改變主意：討論前、討論後各對幾次（各自和同類基準並列；觀望那一邊不算對錯）
  const moved = done.filter((e) => afterCounts(e) && finalStance(e) !== e.stance && !nonView(e) && !coolDropped(e));
  const side = (f) => {
    const xs = moved.filter((e) => hitOf(f(e), e.res) != null && isNum(baseOf(f(e), e.res)));
    return { n: xs.length, right: xs.filter((e) => hitOf(f(e), e.res)).length, base: avgOf(xs.map((e) => baseOf(f(e), e.res))) };
  };
  const disc = { n: moved.length, before: side((e) => e.stance), after: side(finalStance) };
  const waits = done.filter((e) => finalStance(e) === 'wait' && isNum(e.res.ret) && isNum(e.res.ba));
  const waited = { n: waits.length, avg: avgOf(waits.map((e) => e.res.ret)), base: avgOf(waits.map((e) => e.res.ba)) };
  return { all, vsRule, byConf, byTag, bySrc, cooled, disc, waited, scored: scored.length, done: done.length, enough: scored.length >= AIDE.minN };
}

// ------------------------------------------------------------------ Claude 的【冷眼結論】
const FIELDS = { 立場: 'stance', 信心: 'conf', 理由: 'why', 風險: 'risk', 復盤條件: 'exit', 復盤: 'exit' };
const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5 };
/** 「想買／加碼」→ bull…；看不出來（例如把四個選項整串貼回來）回傳 null */
// 「不買、先不加碼、別急著賣、暫不換股」是不動作（觀望），不能讀成買或賣
const NEG_ACT = /(?:先|暫時?|目前|現在|還|也)?(?:不要|不宜|不必|不用|不建議|不打算|不想|不會|不急著?|沒有要|沒要|沒必要|別|勿|不)(?:急著|馬上|立刻|再|要|去|想|考慮|打算)?(?:買進?|加碼|進場|布局|佈局|賣出?|減碼|出場|停損|停利|換股|換成|換到|換掉|轉換|換)/g;
// 「跌破 105 再減碼」「站上 111 再加碼」是條件，不是現在的立場
const COND = /跌破|站上|站回|突破|跌到|漲到|跌至|漲至|低於|高於|如果|假如|萬一|一旦|除非|等到/;
// 「原本想賣」「一開始想加碼」是之前的想法，不是結論
const PAST = /原本|本來|原先|原想|一開始|起初|之前想|先前想/;
// 「改為先觀望」「討論後決定先觀望」：以標記後面的為準
const TURN = /改為|改成|轉為|轉成|決定|最後|結論是/g;
// 「但先觀望」「不過還是續抱」：轉折之後明說要觀望，就是觀望
const CONTRA = /^\s*(但是?|不過|可是|然而|只是|還是)/;
const WAIT_W = /觀望|不動|別動|不要動|續抱|持有|等待|暫停/;
const PART = /一半|部分|分批|小額|少量|一些|[一二三四五]成|\d+\s*[%％]/;
export function stanceOf(t) {
  const s = String(t || '').replace(/[（(][^）)]*[）)]/g, '');
  const acts = new Set();
  let wait = false, said = false, part = false, turnWait = false;
  for (const raw of s.split(/[，,；;。！!？?\n]/)) {
    if (!raw.trim() || COND.test(raw) || PAST.test(raw)) continue;
    let c = raw;
    const m = [...c.matchAll(TURN)].pop();
    if (m) c = c.slice(m.index + m[0].length);
    const contra = CONTRA.test(c);
    NEG_ACT.lastIndex = 0;
    if (NEG_ACT.test(c)) { wait = true; c = c.replace(NEG_ACT, ''); }
    NEG_ACT.lastIndex = 0;
    const a = [];
    if (/買|加碼|看多|進場|布局|佈局/.test(c)) a.push('bull');
    if (/賣|減碼|看空|出場|停損|停利/.test(c)) a.push('bear');
    if (/換股|換成|轉換|換到|換掉/.test(c)) a.push('swap');
    if (WAIT_W.test(c)) { wait = true; said = true; if ((contra || m) && !a.length) turnWait = true; }
    if (a.length && PART.test(c)) part = true;
    a.forEach((x) => acts.add(x));
  }
  if (turnWait) return 'wait';                       // 「想買，但先觀望」「由想買改為先觀望」
  if (acts.size === 1) {
    const [a] = acts;
    // 只有否定（「減碼一半，不換股」）或動作是部分的（「續抱，但減碼一半」）→ 動作；動作和觀望並存 → 看不出來
    return !said || part ? a : null;
  }
  if (!acts.size) return wait ? 'wait' : null;
  if (acts.has('swap') && !wait) return 'swap';      // 換股本來就同時有賣和買
  return null;                                       // 看不出來：讓你自己選
}
export function parseConclusion(txt) {
  if (!txt) return null;
  let s = String(txt).replace(/\r/g, '');
  const i = s.lastIndexOf('冷眼結論');
  if (i >= 0) s = s.slice(i + 4);
  const out = {};
  let cur = null;
  for (const raw of s.split('\n')) {
    const line = raw.replace(/\*\*/g, '').replace(/^\s*(?:[-*•‧・]|\d+[.、)])\s*/, '').trim();
    if (!line) continue;
    const m = line.match(/^(立場|信心|理由|風險|復盤條件|復盤)\s*[:：]\s*(.*)$/);
    if (m) { cur = FIELDS[m[1]]; out[cur] = (out[cur] ? out[cur] + ' ' : '') + m[2].trim(); continue; }
    if (/^[【\[]/.test(line)) { cur = null; continue; }
    if (cur && cur !== 'stance' && cur !== 'conf') out[cur] = (out[cur] ? out[cur] + ' ' : '') + line;
  }
  const res = {};
  if (out.stance) res.stance = stanceOf(out.stance);
  if (out.conf) {
    const m = out.conf.match(/[1-5]/) || out.conf.match(/[一二三四五]/);
    if (m) res.conf = CN_NUM[m[0]] || +m[0];
  }
  for (const k of ['why', 'risk', 'exit']) if (out[k]) res[k] = out[k].slice(0, 300);
  if (out.stance && !res.stance) res.stanceRaw = out.stance.slice(0, 40);
  return Object.keys(res).length ? res : null;
}
/** 復盤條件裡的價位：「收盤跌破 105.2」→ { op:'le', px:105.2 }。和現價差超過一半的數字不算（多半不是價格）。 */
export function parseExit(text, pxNow) {
  const out = [];
  const s = String(text || '');
  const re = /(跌破|跌到|跌回|低於|小於|站上|突破|漲到|高於|大於|超過)\s*([0-9]{1,5}(?:\.[0-9]{1,3})?)/g;
  let m;
  while ((m = re.exec(s))) {
    const px = +m[2];
    if (!(px > 0)) continue;
    if (isNum(pxNow) && pxNow > 0 && (px < pxNow * 0.5 || px > pxNow * 1.5)) continue;
    const op = /跌破|跌到|跌回|低於|小於/.test(m[1]) ? 'le' : 'ge';
    if (!out.some((z) => z.op === op && z.px === px)) out.push({ op, px, word: m[1] });
  }
  return out;
}

// ------------------------------------------------------------------ 帶去問 Claude：打包的文字
const RULES_BASE = [
  '只根據下面的「冷眼資料」，以及官方一手來源（證交所、櫃買中心、集保結算所、金管會、中央銀行、美國財政部）判斷；不要引用社群、論壇、名人或投顧的看法。資料不夠時，告訴我要去官方網站查什麼。',
  '冷眼的規則觀點時間尺度約 1 個月；回測顯示它只比「同類 ETF 任何一天」好一點點，請不要把它當成預測，也不要把過去的報酬當成未來。',
  '用繁體中文、白話回答，我沒有金融背景；專有名詞第一次出現時順便解釋。',
];
const ASKS = {
  idea: ['不要直接叫我買或賣。請幫我檢查我的想法：', '① 我的想法和冷眼的規則一致還是相反？規則可能沒看到什麼、我可能沒看到什麼？', '② 支持與反對各 3 點，反方要認真寫。', '③ 我可能漏掉的風險與成本（手續費、證交稅、二代健保、折溢價、流動性、追高殺低）。', '④ 如果我錯了，最壞會怎樣？用什麼具體條件（價位或事件）判斷我錯了？', '⑤ 問我 1～3 個問題，幫我把想法想清楚。'],
  etf: ['不要直接叫我買或賣。請幫我看懂這檔 ETF 現在的狀況：', '① 用白話說明冷眼的規則為什麼這樣判斷，哪個面向最關鍵。', '② 現在買進或加碼，支持與反對各 3 點。', '③ 需要注意的風險與成本（手續費、證交稅、二代健保、折溢價、流動性）。', '④ 接下來看哪些條件（價位或事件）會改變判斷。', '⑤ 問我 1～3 個問題，幫我想清楚自己要什麼。'],
  pf: ['不要叫我買賣特定 ETF。請幫我檢查整體配置：', '① 風險集中在哪裡？和我的風險屬性相不相符？', '② 現金比例合不合理？', '③ 如果大盤跌 20%，我的部位大概會怎樣？', '④ 長期要注意的事（配息、費用、二代健保、再平衡）。', '⑤ 問我 1～3 個問題，了解我的目標與需要用錢的時間。'],
  market: ['不要叫我買或賣。請幫我讀懂今天的市場：', '① 用白話整理今天的重點，哪些值得注意、哪些是雜訊。', '② 我關注的 ETF 裡，規則訊號有什麼變化、代表什麼。', '③ 這種盤勢下，散戶最常犯的錯是什麼？', '④ 問我 1～2 個問題，幫我想清楚今天需不需要做任何事。'],
  review: ['請陪我復盤這一筆決定：', '① 結果好不代表決策好，結果差也不代表決策差。請分開評估「當時的理由合不合理」和「結果」。', '② 當時有沒有應該注意卻沒注意的訊號？', '③ 這次是判斷還是運氣？用「同類 ETF 任何一天」的基準幫我看。', '④ 下次遇到類似的情況，我可以用什麼固定規則提醒自己？'],
  duel: ['不要直接叫我選哪一檔。請幫我比較這幾檔 ETF：', '① 它們本質上的差別（追蹤的東西、配息方式、風險）。', '② 各自適合什麼樣的人、什麼樣的目標。', '③ 過去一年的數字裡，哪些是運氣、哪些是本質？', '④ 問我 1～3 個問題，幫我想清楚哪個比較符合我的需要。'],
  week: ['請陪我做這週的復盤：', '① 這週的決定裡，哪些理由站得住、哪些偏情緒？', '② 已經對答案的決定，是判斷還是運氣？用基準幫我看。', '③ 下週我需要注意什麼（除息、訊號變化、冷靜期）？', '④ 給我一個下週可以練習的小紀律。'],
};
const CONCLUDE = ['最後，用下面的格式總結我們討論後「我自己的決定」（我會貼回冷眼的決策日記，20 個交易日後自動對答案）：', '【冷眼結論】', '立場：想買／加碼、想賣／減碼、先觀望、想換股（四選一）', '信心：1～5', '理由：', '風險：', '復盤條件：（具體的價位或事件，例如：收盤跌破 105.2 就重新評估）'];

/** 給 Claude 的規則段。short：已經在 Claude 專案裡設好指示，只留一行提醒 */
export function askHeader(kind, short = false) {
  const asks = ASKS[kind] || ASKS.etf;
  const conclude = kind === 'idea' || kind === 'etf' || kind === 'duel';
  if (short) return `【冷眼參謀・${{ idea: '檢查我的想法', etf: '單檔討論', pf: '配置健檢', market: '今日市場', review: '決策復盤', duel: 'ETF 比較', week: '每週復盤' }[kind] || '討論'}】照專案指示回答。${conclude ? '最後請給【冷眼結論】。' : ''}`;
  const lines = ['【冷眼參謀】你是我的投資討論夥伴，請遵守：'];
  RULES_BASE.forEach((r, i) => lines.push(`${i + 1}. ${r}`));
  lines.push(`${RULES_BASE.length + 1}. ${asks[0]}`);
  for (const a of asks.slice(1)) lines.push(`   ${a}`);
  if (conclude) { lines.push(`${RULES_BASE.length + 2}. ${CONCLUDE[0]}`); for (const c of CONCLUDE.slice(1)) lines.push(`   ${c}`); }
  return lines.join('\n');
}
/** 給 Claude 專案的固定指示（貼一次就好；之後打包可以省略規則段） */
export function projectInstructions() {
  return ['這個專案是「冷眼參謀」：我會從我自己的 App「冷眼」貼上台股 ETF 的官方資料與規則判讀，和你討論投資想法。請一律遵守：',
    ...RULES_BASE.map((r, i) => `${i + 1}. ${r}`),
    `${RULES_BASE.length + 1}. 不要直接叫我買或賣。幫我檢查想法：和冷眼規則一致還是相反、支持與反對各 3 點（反方要認真寫）、我可能漏掉的風險與成本、如果錯了最壞會怎樣與怎麼判斷自己錯了，最後問我 1～3 個問題。`,
    `${RULES_BASE.length + 2}. 當我請你給【冷眼結論】時，用這個格式總結「我自己的決定」：`,
    ...CONCLUDE.slice(1).map((c) => `   ${c}`),
    `${RULES_BASE.length + 3}. 復盤時，請分開評估「當時的理由合不合理」和「結果」，並用「同類 ETF 任何一天」的基準判斷是判斷還是運氣。`,
  ].join('\n');
}

const SEP = (t) => `━━ ${t} ━━`;
function etfLines(r, q, det, stats, today) {
  const L = [];
  L.push(`ETF：${r.n}（${r.c}）｜${catN(r.k)}｜${r.m === 'otc' ? '上櫃' : '上市'}`);
  L.push(`價格：${pxS(q.px)}（${q.live ? `盤中 ${String(q.time || '').slice(0, 5)}` : `${md(q.date)} 收盤`}，今日 ${pcS(q.pc)}）${isNum(q.prem) ? `｜相對淨值${q.prem >= 0 ? '溢價' : '折價'} ${Math.abs(q.prem).toFixed(2)}%（警戒 ${premBand(r)[0]}%）` : ''}`);
  const perf = [];
  if (isNum(r.r1y)) perf.push(`含息報酬 ${pctS(r.r1y)}`);
  if (isNum(r.vol)) perf.push(`年化波動 ${pctU(r.vol, 1)}`);
  if (isNum(r.mdd)) perf.push(`最大回檔 −${pctU(r.mdd, 1)}`);
  if (isNum(r.y)) perf.push(`殖利率 ${r.y.toFixed(2)}%（近 12 個月配息）`);
  if (perf.length) L.push(`近一年：${perf.join('、')}`);
  const sz = [];
  if (isNum(r.aum)) sz.push(`規模約 ${bigS(r.aum)}元`);
  if (isNum(r.hd)) sz.push(`受益人數 ${ntS(r.hd)} 人`);
  if (isNum(r.val)) sz.push(`最近一天成交值約 ${bigS(r.val)}元`);
  if (sz.length) L.push(sz.join('｜'));
  if (r.st == null) L.push('冷眼規則：上市未滿 70 個交易日，還沒有觀點');
  else {
    L.push(`冷眼規則觀點：${ST_T[String(r.st)]}（分數 ${r.sc >= 0 ? '+' : ''}${r.sc.toFixed(2)}，-2 到 +2${r.cf != null ? `，信心 ${r.cf}／100` : ''}）｜部位訊號：${PS_T[r.ps] || '—'}${r.ps === 'caution' ? `（${cautionWhy(r, q)}）` : ''}`);
    const lv = [];
    if (isNum(r.s1)) lv.push(`支撐 ${pxS(r.s1)}`);
    if (isNum(r.r1)) lv.push(`壓力 ${pxS(r.r1)}`);
    if (isNum(r.dl)) lv.push(`移動防守線 ${pxS(r.dl)}`);
    if (isNum(r.iv)) lv.push(`作廢線 ${pxS(r.iv)}`);
    if (isNum(r.pb)) lv.push(`拉回價 ${pxS(r.pb)}`);
    if (lv.length) L.push(`關鍵價位：${lv.join('、')}`);
    const v = det && det.view;
    if (v && v.components) {
      L.push('各面向（-2 偏空 到 +2 偏多）：');
      for (const c of v.components) L.push(`・${c.name} ${c.score > 0 ? '+' : ''}${c.score.toFixed(1)}（權重 ${Math.round(c.weight * 100)}%）：${c.text}`);
    }
    if (v && v.summary) L.push(`冷眼摘要：${v.summary}`);
    const ev = stats && r.ps ? signalEvidence(stats, r.ps, catN(r.k)) : null;
    if (ev) L.push(`回測（${ev.catName}，${ntS(ev.n)} 次）：「${PS_T[r.ps]}」之後 20 個交易日上漲比例 ${pctU(ev.up)}，同類任何一天 ${pctU(ev.base)}；最差 10% ${pctS(ev.p10)}，同類 ${pctS(ev.baseP10)}`);
  }
  const fl = (r.fl || []).filter((f) => f === 'notice' || f === 'disposal');
  L.push(`注意／處置：${fl.length ? (fl.includes('disposal') ? '處置中' : '注意中') : '無'}｜下次除息：${r.dv && r.dv.d >= today ? `${dy(r.dv.d)}${isNum(r.dv.cash) ? `，每單位 ${+r.dv.cash.toFixed(3)} 元` : '，金額待公告'}` : '目前沒有預告'}`);
  return L;
}
function marketLines(m) {
  if (!m || !isNum(m.px)) return [];
  const L = [];
  let t = `大盤：加權指數 ${ntS(m.px)}（${pcS(m.pc)}）`;
  if (isNum(m.ma60)) t += m.px >= m.ma60 ? '，站在季線之上' : '，在季線之下';
  if (m.br && m.br.n) t += `｜全市場 ${m.br.n} 檔 ETF：偏多 ${pctU(m.br.pBull)}、偏空 ${pctU(m.br.pBear)}`;
  L.push(t);
  if (m.insti && isNum(m.insti.f)) {
    const yi = (v) => (isNum(v) ? `${v > 0 ? '買超' : '賣超'} ${Math.abs(v / 1e8).toFixed(0)} 億元` : '—');
    L.push(`三大法人（上市，${md(m.insti.date)}）：外資${yi(m.insti.f)}、投信${yi(m.insti.t)}、自營商${yi(m.insti.d)}`);
  }
  return L;
}
function holdLine(h, showAmt) {
  if (!h || !(h.sh > 0)) return '持有：沒有（還沒買）';
  const parts = [`占總資產 ${pctU(h.w, 1)}`];
  if (isNum(h.cap)) parts.push(`我的上限 ${pctU(h.cap)}`);
  if (isNum(h.pnlPct)) parts.push(`未實現損益 ${pctS(h.pnlPct)}`);
  if (showAmt) {
    parts.push(`${sharesText(h.sh)}`);
    if (isNum(h.avg)) parts.push(`平均成本 ${pxS(h.avg)}`);
    if (isNum(h.mv)) parts.push(`市值約 ${ntS(h.mv)} 元`);
  }
  return `持有：${parts.join('｜')}`;
}
function checkLines(ck, showAmt) {
  if (!ck || !ck.items.length) return [];
  const mark = { ok: '✓', info: '・', warn: '⚠', stop: '⛔' };
  return [SEP(`副官檢查（固定規則）：${ck.verdict}`), ...ck.items.map((i) => `${mark[i.lvl]} ${showAmt ? i.t : i.tp || redactAmt(i.t)}`)];
}
function ideaLines(idea) {
  if (!idea) return [];
  const L = [SEP('我的想法')];
  L.push(`立場：${STANCE[idea.stance] ? STANCE[idea.stance].t : '—'}${idea.stance === 'swap' && idea.to ? `（${idea.from} → ${idea.to}）` : ''}｜信心：${idea.conf ? `${idea.conf}／5（${CONF[idea.conf]}）` : '沒填'}`);
  if (idea.tags && idea.tags.length) L.push(`理由：${idea.tags.map((t) => TAGS[t] || t).join('、')}`);
  if (idea.text) L.push(`「${idea.text}」`);
  return L;
}

/**
 * 單檔（或一個想法）的打包。p：{ kind:'idea'|'etf', when, row, q, det, stats, today, market, hold, profileName, showAmt,
 *   checks, idea, row2, q2, det2, stats2, question, short }
 */
export function packEtf(p) {
  const L = [askHeader(p.kind || 'etf', p.short), ''];
  L.push(SEP(`冷眼資料（${p.when}；來源：證交所、櫃買中心、集保結算所、美國財政部）`));
  L.push(...etfLines(p.row, p.q, p.det, p.stats, p.today));
  if (p.row2) { L.push('', `要換過去的：`); L.push(...etfLines(p.row2, p.q2 || {}, p.det2, p.stats2, p.today)); }
  L.push(...marketLines(p.market));
  L.push('', SEP(`我的部位（${p.bookName || '真實部位'}${p.showAmt ? '' : '，只寫比例'}）`));
  L.push(`風險屬性：${p.profileName || '穩健'}`);
  L.push(holdLine(p.hold, p.showAmt));
  if (p.row2) L.push(holdLine(p.hold2, p.showAmt).replace('持有：', `持有 ${p.row2.n}：`));
  if (p.adv && p.adv.label) L.push(`冷眼依我的紀律給的建議：${p.adv.label}`);
  if (p.checks) { L.push(''); L.push(...checkLines(p.checks, p.showAmt)); }
  if (p.idea) { L.push(''); L.push(...ideaLines(p.idea)); }
  if (p.question) { L.push('', SEP('我想問'), p.question); }
  return L.join('\n');
}
/** 整體配置。p：{ when, profileName, profileLoss, P (buildPortfolio), holdings:[{name,code,cat,w,cap,pnlPct,label,st,ps}], stress, audit, showAmt, question, short, bookName, bench } */
export function packPf(p) {
  const L = [askHeader('pf', p.short), ''];
  L.push(SEP(`我的配置（${p.when}；${p.bookName || '真實部位'}${p.showAmt ? '' : '，只寫比例'}）`));
  const t = p.totals;
  L.push(`風險屬性：${p.profileName}（單筆最多虧總資產 ${(p.profileLoss * 100).toFixed(1)}%）`);
  if (p.showAmt) L.push(`總資產約 ${ntS(t.T)} 元（持股 ${ntS(t.mv)}、現金 ${ntS(t.cash)}）`);
  L.push(`組成：持股 ${pctU(t.T > 0 ? t.mv / t.T : null, 1)}、現金 ${pctU(t.T > 0 ? t.cash / t.T : null, 1)}｜未實現損益 ${pctS(t.pct)}｜預估一年配息約總資產的 ${t.T > 0 ? (t.annual / t.T * 100).toFixed(2) : '—'}%`);
  if (p.bench) L.push(`模擬倉成績：${pctS(p.bench.ret, 2)}；同期全買 0050 ${pctS(p.bench.b, 2)}（第 ${p.bench.days} 天）`);
  L.push('持股（比重｜類別與我的上限｜未實現｜冷眼依紀律的建議｜規則觀點）：');
  for (const h of p.holdings) L.push(`・${h.name}（${h.code}）｜${pctU(h.w, 1)}｜${catN(h.cat)}，上限 ${pctU(h.cap)}｜${pctS(h.pnlPct)}｜${h.label || '—'}｜${h.st == null ? '資料不足' : `${ST_T[String(h.st)]}／${PS_T[h.ps] || '—'}`}${p.showAmt && isNum(h.sh) ? `｜${sharesText(h.sh)}，平均成本 ${pxS(h.avg)}，市值約 ${ntS(h.mv)} 元` : ''}`);
  if (p.audit && p.audit.length) { L.push('', SEP('副官巡檢（固定規則）')); const mark = { ok: '✓', info: '・', warn: '⚠', stop: '⛔' }; for (const i of p.audit) L.push(`${mark[i.lvl]} ${i.t}`); }
  if (p.market) { L.push(''); L.push(...marketLines(p.market)); }
  if (p.question) L.push('', SEP('我想問'), p.question);
  return L.join('\n');
}
/** 今日市場。p：{ when, market, watch:[{row,q,held}], actions:[文字], question, short } */
export function packMarket(p) {
  const L = [askHeader('market', p.short), ''];
  L.push(SEP(`冷眼資料（${p.when}）`));
  L.push(...marketLines(p.market));
  if (p.brief && p.brief.length) { L.push('冷眼晨報：'); for (const b of p.brief) L.push(`・${b}`); }
  if (p.watch && p.watch.length) {
    L.push('我關注的 ETF（現價｜今日｜規則觀點／部位訊號｜溢價）：');
    for (const w of p.watch) {
      const r = w.row, q = w.q;
      L.push(`・${r.n}（${r.c}）${w.held ? '［我有持股］' : ''}｜${pxS(q.px)}｜${pcS(q.pc)}｜${r.st == null ? '資料不足' : `${ST_T[String(r.st)]}／${PS_T[r.ps] || '—'}`}｜${isNum(q.prem) ? `${q.prem >= 0 ? '溢價' : '折價'} ${Math.abs(q.prem).toFixed(2)}%` : '—'}`);
    }
  }
  if (p.changes && p.changes.length) L.push(`最近一次更新的規則訊號變化：${p.changes.join('；')}`);
  if (p.actions && p.actions.length) { L.push('冷眼列出的今日行動：'); for (const a of p.actions) L.push(`・${a}`); }
  if (p.question) L.push('', SEP('我想問'), p.question);
  return L.join('\n');
}
/** ETF 比較。p：{ when, rows:[{row,q}], market, question, short } */
export function packDuel(p) {
  const L = [askHeader('duel', p.short), ''];
  L.push(SEP(`冷眼資料（${p.when}）`));
  for (const { row: r, q } of p.rows) {
    L.push(`・${r.n}（${r.c}）｜${catN(r.k)}｜現價 ${pxS(q.px)}｜近一年含息 ${pctS(r.r1y)}｜年化波動 ${pctU(r.vol, 1)}｜最大回檔 ${isNum(r.mdd) ? `−${pctU(r.mdd, 1)}` : '—'}｜殖利率 ${isNum(r.y) ? r.y.toFixed(2) + '%' : '—'}｜規模 ${bigS(r.aum)}元｜受益人 ${ntS(r.hd)} 人｜規則 ${r.st == null ? '資料不足' : `${ST_T[String(r.st)]}／${PS_T[r.ps] || '—'}`}｜${isNum(q.prem) ? `${q.prem >= 0 ? '溢價' : '折價'} ${Math.abs(q.prem).toFixed(2)}%` : ''}`);
  }
  L.push(...marketLines(p.market));
  if (p.question) L.push('', SEP('我想問'), p.question);
  return L.join('\n');
}
/** 復盤一筆決定。p：{ entry, name, name2, res, base, now:{ret, n}, question, short } */
export function packReview(p) {
  const e = p.entry;
  const L = [askHeader('review', p.short), ''];
  const st = finalStance(e);
  const rec = Date.parse(e.at || '');
  L.push(SEP(`我的決定（${dy(isFinite(rec) ? twClock(rec).d : e.snap && e.snap.d)}）`));
  L.push(`ETF：${p.name}${e.c2 ? ` → ${p.name2}` : ''}｜${e.src === 'trade' ? `實際${e.book === 'paper' ? '模擬' : ''}交易` : '想法'}｜立場：${STANCE[e.stance] ? STANCE[e.stance].t : '—'}${e.after && e.after.stance && finalStance(e) !== e.stance ? `（和 Claude 討論後改成：${STANCE[st].t}）` : ''}`);
  L.push(`當時價格 ${pxS(e.snap.px)}${e.snap2 ? `／${pxS(e.snap2.px)}` : ''}｜當時冷眼規則：${e.snap.st == null ? '資料不足' : `${ST_T[String(e.snap.st)]}／${PS_T[e.snap.ps] || '—'}`}`);
  if (e.conf) L.push(`信心：${e.conf}／5（${CONF[e.conf]}）`);
  if (e.tags && e.tags.length) L.push(`理由：${e.tags.map((t) => TAGS[t] || t).join('、')}`);
  if (e.text) L.push(`當時寫下的想法：「${e.text}」`);
  if (e.checks) L.push(`副官當時的檢查：${e.checks.verdict}（要注意 ${e.checks.warn} 項${e.checks.stop ? `、交易受限 ${e.checks.stop} 項` : ''}）`);
  if (e.cool) L.push(`冷靜期：${e.cool.res === 'kept' ? '隔天還是這麼想' : e.cool.res === 'changed' ? '隔天改變主意' : '還沒確認'}`);
  if (e.after) L.push(`討論後的結論：${[e.after.why && `理由 ${e.after.why}`, e.after.risk && `風險 ${e.after.risk}`, e.after.exit && `復盤條件 ${e.after.exit}`].filter(Boolean).join('；')}`);
  L.push('', SEP('結果'));
  const r = e.res;
  if (r && r.state === 'done') {
    const z = scoreOf(e);
    L.push(`${HORIZON} 個交易日後（${dy(r.d)}）含息報酬：${p.name} ${pctS(r.ret)}${isNum(r.ret2) ? `、${p.name2} ${pctS(r.ret2)}` : ''}${r.d0 ? `（從定案那天 ${dy(r.d0)} 的收盤${isNum(r.px0) ? ` ${pxS(r.px0)}` : ''} 起算）` : ''}`);
    if (z.counted) L.push(`照我的立場算：${z.hit ? '對了' : '錯了'}｜同類 ETF 任何一天照同樣方向做，會對的機率約 ${pctU(z.base)}`);
    else if (z.why === 'dropped') {
      const h0 = hitOf(e.stance, r), b0 = baseOf(e.stance, r);
      L.push(`冷靜後我改變主意、沒有照做（不算進命中率）${h0 == null ? '' : `；原本的想法如果照做會${h0 ? '對' : '錯'}${isNum(b0) ? `，同類 ETF 任何一天照同樣方向做約 ${pctU(b0)}` : ''}`}`);
    } else if (z.why === 'nobase') L.push('這筆沒有同類 ETF 的基準可以比，不算對錯。');
    else L.push('這筆是觀望（或不是在猜漲跌），不算對錯。');
  } else if (p.now) {
    L.push(!p.now.locked ? `還沒定案（${dy(p.now.lock)} 13:25 定案），記下後到現在 ${pctS(p.now.ret)}（還沒開始計分）`
      : p.now.fromAnchor ? `還沒到 ${HORIZON} 個交易日（大約第 ${p.now.n} 天），從定案那天收盤到現在含息報酬 ${pctS(p.now.ret)}`
        : `已經定案，從 ${dy(p.now.lock)} 的收盤開始計分（收盤資料還沒進來）`);
  }
  if (e.note) L.push(`我的復盤筆記：「${e.note}」`);
  if (p.question) L.push('', SEP('我想問'), p.question);
  return L.join('\n');
}
/** 每週復盤。p：{ when, from, made:[{name,stance,src,tags}], done:[{name,stance,hit,ret,base}], stats, pending, cool, question, short } */
export function packWeek(p) {
  const L = [askHeader('week', p.short), ''];
  L.push(SEP(`這週（${dy(p.from)} 起）`));
  if (p.made.length) {
    L.push(`新增的決定 ${p.made.length} 筆：`);
    for (const m of p.made) L.push(`・${m.name}｜${STANCE[m.stance] ? STANCE[m.stance].t : '—'}｜${m.src === 'trade' ? '交易' : '想法'}${m.tags && m.tags.length ? `｜理由：${m.tags.map((t) => TAGS[t] || t).join('、')}` : ''}${m.verdict ? `｜副官：${m.verdict}` : ''}`);
  } else L.push('這週沒有新增決定。');
  if (p.done.length) {
    L.push(`這週對答案 ${p.done.length} 筆：`);
    for (const d of p.done) L.push(`・${d.name}｜${STANCE[d.stance] ? STANCE[d.stance].t : '—'}｜20 日含息 ${pctS(d.ret)}｜${d.hit == null ? (d.why === 'dropped' ? '冷靜後沒照做，不算對錯' : '不算對錯') : `${d.hit ? '對' : '錯'}（同類 ETF 任何一天照同樣方向做約 ${pctU(d.base)}）`}`);
  }
  const s = p.stats;
  if (s && s.all.n) L.push(`累積戰績：${s.all.hits}／${s.all.n} 對（${pctU(s.all.rate)}），同類任何一天照同樣方向做約 ${pctU(s.all.base)}${s.enough ? '' : `；樣本還少（不到 ${AIDE.minN} 筆），先看看就好`}`);
  if (p.pending) L.push(`還在等對答案：${p.pending} 筆`);
  if (p.cool) L.push(`冷靜期待確認：${p.cool} 筆`);
  if (p.question) L.push('', SEP('我想問'), p.question);
  return L.join('\n');
}

// ------------------------------------------------------------------ 備份還原：只收格式正確的日記（一欄一欄重建，不收多餘的東西）
const okD = (d) => Number.isInteger(d) && d >= 19900101 && d <= 21001231;
const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);   // 不收 constructor、__proto__ 這類名字
const okIso = (s) => typeof s === 'string' && s.length <= 40 && isFinite(Date.parse(s));
const okStr = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '');
const okInt = (x, lo, hi) => (Number.isInteger(x) && x >= lo && x <= hi ? x : null);
const PS_KEYS = ['add', 'wait', 'hold', 'caution', 'trim'];
function cleanSnap(s) {
  if (!s || !isNum(s.px) || !(s.px > 0) || !okD(s.d)) return null;
  return {
    n: okStr(s.n, 40), k: own(CAT_NAMES, s.k) ? s.k : null, d: s.d, px: s.px, live: !!s.live, t: okStr(s.t, 12) || null,
    st: [1, 0, -1].includes(s.st) ? s.st : null, ps: PS_KEYS.includes(s.ps) ? s.ps : null,
    sc: isNum(s.sc) ? s.sc : null, cf: okInt(s.cf, 0, 100), prem: isNum(s.prem) ? s.prem : null, dl: isNum(s.dl) ? s.dl : null, pc: isNum(s.pc) ? s.pc : null,
  };
}
export function sanitizeJournal(items) {
  if (!Array.isArray(items)) return [];
  const out = [];
  const ids = new Set();
  const STS = Object.keys(STANCE);
  for (const e of items.slice(0, 5000)) {
    if (!e || typeof e !== 'object') continue;
    if (typeof e.id !== 'string' || !/^[0-9a-z_-]{2,40}$/i.test(e.id) || ids.has(e.id)) continue;
    if (typeof e.c !== 'string' || !/^[0-9A-Z]{4,8}$/i.test(e.c) || !STS.includes(e.stance) || !okIso(e.at)) continue;
    const snap = cleanSnap(e.snap);
    if (!snap) continue;
    const x = {
      id: e.id, at: e.at, src: e.src === 'trade' ? 'trade' : 'idea', book: e.book === 'paper' ? 'paper' : 'real', c: e.c.toUpperCase(),
      stance: e.stance, conf: okInt(e.conf, 1, 5), tags: Array.isArray(e.tags) ? uniq(e.tags.filter((t) => own(TAGS, t))).slice(0, 12) : [],
      text: okStr(e.text, 500), snap,
    };
    if (typeof e.lot === 'string' && e.lot.length <= 40) x.lot = e.lot;
    if (e.c2 != null) {
      const s2 = cleanSnap(e.snap2);
      if (typeof e.c2 !== 'string' || !/^[0-9A-Z]{4,8}$/i.test(e.c2) || !s2) continue;
      x.c2 = e.c2.toUpperCase();
      x.snap2 = s2;
    }
    if (e.checks && typeof e.checks === 'object') {
      x.checks = {
        verdict: okStr(e.checks.verdict, 60), ok: okInt(e.checks.ok, 0, 99) || 0, warn: okInt(e.checks.warn, 0, 99) || 0, stop: okInt(e.checks.stop, 0, 99) || 0, cool: !!e.checks.cool,
        items: Array.isArray(e.checks.items) ? e.checks.items.filter((i) => i && ['ok', 'info', 'warn', 'stop'].includes(i.lvl)).slice(0, 16).map((i) => ({ lvl: i.lvl, t: okStr(i.t, 300), ...(typeof i.tp === 'string' && i.tp ? { tp: okStr(i.tp, 300) } : {}) })) : [],
      };
    }
    if (e.cool && okD(e.cool.due)) x.cool = { due: e.cool.due, res: ['kept', 'changed'].includes(e.cool.res) ? e.cool.res : null, ...(okIso(e.cool.at) ? { at: e.cool.at } : {}) };
    if (e.after && typeof e.after === 'object') {
      const a = { stance: STS.includes(e.after.stance) ? e.after.stance : null, conf: okInt(e.after.conf, 1, 5), why: okStr(e.after.why, 300), risk: okStr(e.after.risk, 300), exit: okStr(e.after.exit, 300) };
      if (okIso(e.after.at)) a.at = e.after.at;
      for (const k of Object.keys(a)) if (a[k] == null || a[k] === '') delete a[k];
      if (Object.keys(a).length) x.after = a;
    }
    if (okIso(e.asked)) x.asked = e.asked;
    if (e.anchor && okD(e.anchor.d) && isNum(e.anchor.px) && e.anchor.px > 0) x.anchor = { d: e.anchor.d, px: e.anchor.px, ...(isNum(e.anchor.px2) && e.anchor.px2 > 0 ? { px2: e.anchor.px2 } : {}) };
    if (e.note) x.note = okStr(e.note, 400);
    const r = e.res;
    if (r && r.state === 'done' && isNum(r.ret) && okD(r.d)) {
      x.res = { state: 'done', d: r.d, px: isNum(r.px) ? r.px : null, ret: r.ret };
      if (okD(r.d0)) x.res.d0 = r.d0;
      for (const k of ['ret2', 'bu', 'ba', 'pb', 'pa', 'px0', 'px02']) if (isNum(r[k])) x.res[k] = r[k];
      if (okIso(r.at)) x.res.at = r.at;
      if (e.seen === true) x.seen = true;
    }
    ids.add(x.id);
    out.push(x);
  }
  return out;
}

// ------------------------------------------------------------------ 設定頁的說明（照抄上面的常數）
export function aideRulesHTML() {
  return `<p><b>副官只檢查、只記錄，不替你決定。</b>所有檢查都是固定規則，同樣的資料永遠得到同樣的結果。</p>
    <p><b>想買／加碼</b>依序看：注意／處置（交易受限）、冷眼規則和你同方向或相反、這個部位訊號的回測（和同類任何一天比）、短線漲多、今天已漲 ${AIDE.bigMove}% 以上、折溢價、是否跌破移動防守線、${AIDE.divSoon} 天內除息、依你的紀律最多買多少、帳面虧損又偏空時往下買（攤平）、成交值低於 ${bigS(AIDE.thinVal)}元、規模在全部 ETF 最小的 ${pctU(AIDE.smallAum)}、槓桿與反向型。</p>
    <p><b>想賣／減碼</b>另外看：今天跌 ${AIDE.bigMove}% 以上（恐慌賣出）、全部賣出的手續費與證交稅、帳面損益（成本不影響之後的漲跌）、除息前賣出領不到配息、債券 ETF 免證交稅期限。</p>
    <p><b>想換股</b>看兩檔的規則觀點、近一年報酬與波動、換過去那檔近一年多賺 ${pctU(AIDE.chase)} 以上時提醒「追逐過去的報酬」、類別不同、換股的來回成本。</p>
    <p><b>都會看</b>大盤單日漲跌 ${AIDE.bigMarket}% 以上、理由裡有「${EMO_TAGS.map((t) => TAGS[t]).join('、')}」、信心 ${AIDE.confHigh} 以上卻和規則相反。符合任何一項、或要注意的地方有 ${AIDE.warnCool} 個以上，副官會建議<b>冷靜一下</b>：先記下來，定案（下一個交易日 13:25）前再確認一次。</p>
    <p><b>什麼時候定案</b>每一筆決定在記下之後的<b>下一個交易日收盤前（13:25）</b>定案：早上 9 點開盤前記的是當天 13:25，盤中、收盤後、週末記的是下一個星期一到五的 13:25。定案前你可以刪除（記錯了）、冷靜後改變主意、或貼回和 Claude 討論後的結論；定案後就不能刪、不能改，改交易紀錄也不會改到它。</p>
    <p><b>對答案</b>從<b>定案那天的收盤價</b>開始算，到第 ${HORIZON} 個交易日（約一個月，和規則同一個尺度）的含息報酬：看多＞0、看空＜0、換股是換入的贏過換出的才算對；觀望不算對錯。因為起點是定案那天的收盤，定案前看到的任何走勢（記下那天剩下的盤、晚上的國際行情、定案那天的盤中）都已經算在起點裡，改主意也佔不到便宜。理由是「${NONVIEW_TAGS.map((t) => TAGS[t]).join('、')}」的決定不是在猜漲跌，照樣對答案、但不算進命中率；冷靜後改變主意、沒有照做的也不算，另外統計「如果照做會不會對」。</p>
    <p><b>基準</b>你的命中率一定和「同類 ETF 任何一天照同樣方向做」並列：看多用該類 ETF 回測期間 20 日後上漲的比例、看空用下跌的比例，依你每筆決定的類別加權；換股用兩檔歷史上任何一天換過去、20 日後贏的比例。至少 ${AIDE.minN} 筆以後才有參考價值。</p>
    <p><b>部位巡檢</b>現金比例、單檔是否超過你的上限、類別組成、槓桿與反向型合計、跌破移動防守線、注意／處置、${AIDE.divSoon} 天內除息、不到總資產 ${pctU(AIDE.smallPos)} 的零碎部位、持有超過 ${AIDE.manyPos} 檔、全部跌到出場線的最壞情況。</p>`;
}

export const _test = { lastIdx, firstIdx, cautionWhy };
