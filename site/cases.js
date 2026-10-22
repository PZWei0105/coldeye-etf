/* 冷眼 — 案例教室：用官方歷史資料（data/hist，證交所、櫃買的收盤價＋除息、分割）講一段真實的行情：
   發生了什麼、當時該看什麼、哪裡是陷阱、冷眼的規則當時怎麼說。數字全部在手機上由歷史資料算出來，不是寫死的。
   開在全螢幕的 #sheet（網址 #cases）。新增案例：加進 CASES（id 不要改），窗口內的 ETF 要有歷史檔。 */
import { $, $$, esc, isNum, S, fmt, ICON, ensureHist, toast } from './core.js';
import { trIndex } from './aide.js';
import { linesSVG, bindLines } from './viz.js';
import { closeDetail } from './sheet.js';
import { openLesson, lessonById } from './lessons.js';   // 和 lessons.js 互相引用，只在函式裡用，不在載入時用
import * as FX from './fx.js';

const SRC = {
  index: { n: '證交所：市場成交資訊（加權指數）', u: 'https://www.twse.com.tw/zh/trading/historical/fmtqik.html' },
  daily: { n: '證交所：每日收盤行情', u: 'https://www.twse.com.tw/zh/trading/historical/mi-index.html' },
  trading: { n: '證交所：集中市場交易制度介紹', u: 'https://www.twse.com.tw/zh/products/system/trading.html' },
  etf: { n: '證交所：ETF 總覽與一般投資風險', u: 'https://www.twse.com.tw/zh/products/securities/etf/overview/introduction.html' },
  li: { n: '證交所：槓桿型及反向型 ETF', u: 'https://www.twse.com.tw/zh/ETF/li' },
  nav: { n: '證交所：ETF 盤中預估淨值與折溢價', u: 'https://mis.twse.com.tw/stock/etf_nav.jsp?ex=tse' },
  div: { n: '證交所：除權除息計算結果表', u: 'https://www.twse.com.tw/zh/announced/exright/twt49u.html' },
  ust: { n: '美國財政部：公債殖利率', u: 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve' },
};
const COL = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];
const pct = (x, d = 1) => (isNum(x) ? `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(d)}%` : '—');
const px = (x) => (isNum(x) ? x.toFixed(2) : '—');
const dd = (x) => (isNum(x) ? `${Math.abs(x * 100).toFixed(1)}%` : '—');   // 「跌了 33.9%」用這個，不帶負號

// ------------------------------------------------------------------ 純計算（tests/cases_test.mjs 有測）
const lastIdx = (D, d) => { let lo = 0, hi = D.length - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (D[m] <= d) { a = m; lo = m + 1; } else hi = m - 1; } return a; };
const firstIdx = (D, d) => { let lo = 0, hi = D.length - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (D[m] >= d) { a = m; hi = m - 1; } else lo = m + 1; } return a; };
/** 一段期間的含息走勢：起點換成 100。回傳 { dates, idx, ret, mdd, peakD, lowD, p0, p1 }；期間沒有資料回傳 null */
export function windowStats(h, from, to) {
  if (!h || !h.d || !h.d.length) return null;
  const D = h.d, T = trIndex(h);
  const i0 = firstIdx(D, from), i1 = lastIdx(D, to);
  if (i0 < 0 || i1 < i0) return null;
  const base = T[i0];
  const dates = D.slice(i0, i1 + 1), idx = [];
  let peak = -Infinity, peakD = dates[0], mdd = 0, lowD = dates[0], peakAtLow = peakD;
  for (let k = i0; k <= i1; k++) {
    const v = T[k] / base * 100;
    idx.push(v);
    if (v > peak) { peak = v; peakD = D[k]; }
    const dd = v / peak - 1;
    if (dd < mdd) { mdd = dd; lowD = D[k]; peakAtLow = peakD; }
  }
  return { dates, idx, ret: idx[idx.length - 1] / 100 - 1, mdd, peakD: peakAtLow, lowD, p0: h.p[i0], p1: h.p[i1], n: dates.length };
}
/** 大跌那天之後多久回到前一天的水準（含息），以及之後 lowN 個交易日內的最低點（不管有沒有先回來過）。
 *  回傳 { preD, preP, crashD, crashP, drop, lowD, low, backD, backN } */
export function recoverAfter(h, crashD, maxN = 400, lowN = 60) {
  if (!h || !h.d) return null;
  const D = h.d, T = trIndex(h);
  const i = firstIdx(D, crashD);
  if (i <= 0) return null;
  const pre = T[i - 1];
  let backD = null, backN = null, low = 0, lowD = D[i];
  for (let k = i; k < D.length && k < i + maxN; k++) {
    if (T[k] >= pre) { backD = D[k]; backN = k - i; break; }
  }
  for (let k = i; k < D.length && k < i + lowN; k++) {
    const dd = T[k] / pre - 1;
    if (dd < low) { low = dd; lowD = D[k]; }
  }
  return { preD: D[i - 1], preP: h.p[i - 1], crashD: D[i], crashP: h.p[i], drop: T[i] / pre - 1, lowD, low, backD, backN };
}
/** 一次除息：除息前一天收盤、除息日收盤、跌了多少、幾個交易日後填息（原始價格回到除息前一天的收盤） */
export function divFill(h, exD, maxN = 500) {
  if (!h || !h.d) return null;
  const D = h.d, P = h.p;
  const i = firstIdx(D, exD);
  if (i <= 0) return null;
  const cash = (h.divs || []).filter(([d]) => d === exD).reduce((s, [, c]) => s + c, 0);
  const pre = P[i - 1];
  let fillD = null, fillN = null;
  for (let k = i; k < D.length && k < i + maxN; k++) if (P[k] >= pre) { fillD = D[k]; fillN = k - i; break; }
  return { preD: D[i - 1], pre, exD: D[i], ex: P[i], cash, drop: P[i] - pre, yieldPct: pre > 0 ? cash / pre * 100 : null, fillD, fillN };
}
/** 規則訊號在這段期間的變化（每次換訊號記一筆） */
export function sigChanges(h, from, to) {
  const out = [];
  let last = null;
  for (const [d, s] of h && h.sig ? h.sig : []) {
    if (d < from || d > to) continue;
    if (s !== last) out.push([d, s]);
    last = s;
  }
  return out;
}
const SIG_T = { add: '可加碼', wait: '漲多分批', hold: '續抱', caution: '先不加碼', trim: '減碼' };

// ------------------------------------------------------------------ 案例
/* 欄位：codes（第一檔是主角，圖的日期照它）、from/to（to 可以是 null＝到最新）、marks（固定日期的標記）、
   raw（true＝畫原始價格而不是含息指數；分割、除息的案例用）、tell／judge／trap（字串或 (st) => 字串；st＝每檔的統計，st.rec／st.div 是另外算的）、
   extra（(st) => [[標籤, 數值], …] 的事實表）、src、lessons（相關課程 id） */
export const CASES = [
  {
    id: 'covid2020', t: '2020 年 3 月：一個月跌三成，四個月漲回來', k: 'market',
    sub: '疫情恐慌。0050 從 1 月的高點跌到 3/19 的低點，7 月就回到原來的水準。',
    codes: ['0050', '0056', '00679B'], from: 20200102, to: 20200731,
    marks: [{ d: 20200114, t: '1/14 高點' }, { d: 20200319, t: '3/19 低點' }],
    tell: [
      (st) => `2020 年初台股還在創高，2 月底疫情擴散到全球，3 月全球股市同步崩跌。0050 從 1/14 的高點到 3/19 的低點，含息跌了 ${dd(st['0050'].mdd)}；0056 跌了 ${dd(st['0056'].mdd)}。`,
      (st) => `然後是很少人料到的 V 型反彈：0050 在 ${fmt.dy(st.back['0050'])} 就回到 1/14 的水準，距離低點只有幾個月。整個上半年算下來，0050 含息 ${pct(st['0050'].ret)}。`,
      (st) => `債券 ETF（00679B）這一次真的有避到險：3 月初先漲到高點，恐慌最高峰時也跟著跌了 ${dd(st['00679B'].mdd)}，但整段期間是 ${pct(st['00679B'].ret)}。`,
    ],
    judge: [
      '全市場同步跌，不是單一檔出事：這種時候看的是「我的比重、我的出場線」，不是「這檔還好不好」。',
      '跌得快、量很大、每天都有新低——這是恐慌的樣子。恐慌不會告訴你哪天是底，但它會告訴你：現在用市價單賣，是賣在最糟的價格。',
      '當時沒有冷眼的規則（回測從 2020/7 開始），但移動防守線在 2 月底就會跌破，部位訊號會是「先不加碼」或「減碼」。它不會幫你抓到 3/19 的底，只會讓你在 2 月底減一些。',
    ],
    trap: [
      '在 3/19 那幾天把全部賣掉的人，四個月後要用更高的價格買回來。「跌很多」不等於「還會再跌」。',
      '反過來，在 3 月「抄底」的人也可能連續接了好幾刀：低點出現前，每一天看起來都像底。分批、設比重上限，比猜底重要。',
    ],
    src: [SRC.index, SRC.daily], lessons: ['r-crash', 'r-dl'],
  },
  {
    id: 'bear2022', t: '2022 年：升息年的全面下跌，高股息真的比較抗跌？', k: 'market',
    sub: '聯準會一年升息七次。市值型、高股息、債券 ETF 全部下跌，只是跌的幅度不同。',
    codes: ['0050', '0056', '00878', '00679B'], from: 20220103, to: 20230630,
    marks: [{ d: 20221025, t: '10/25 0050 低點' }],
    tell: [
      (st) => `2022 年美國為了壓通膨一年升息七次，全球股債一起跌。0050 從 1 月高點到 10/25 的低點含息跌了 ${dd(st['0050'].mdd)}，全年 ${pct(st.y2022['0050'])}；0056 全年 ${pct(st.y2022['0056'])}、00878 ${pct(st.y2022['00878'])}。`,
      (st) => `高股息 ETF 確實跌得少（00878 最大回檔 ${pct(st['00878'].mdd)}，0050 是 ${pct(st['0050'].mdd)}），但「跌得少」不是「不跌」。而且 2023 年反彈時，0050 也漲得比較快。`,
      (st) => `最讓人意外的是債券 ETF：00679B 全年 ${pct(st.y2022['00679B'])}，和 0050 差不多。利率升、債券價格跌，「債券比較安全」在升息年不成立。`,
    ],
    judge: [
      (st) => `冷眼的規則當時怎麼說（0050）：${st.sig['0050'].length ? st.sig['0050'].slice(0, 8).map(([d, s]) => `${fmt.d(d)} ${SIG_T[s]}`).join(' → ') : '—'}${st.sig['0050'].length > 8 ? ' →…' : ''}。2 月底就轉成「減碼」，之後大半年都在減碼／先不加碼之間，第一次「可加碼」出現在 12 月——低點之後。`,
      '這就是規則的本質：它不抓底、不抓頂，它只在趨勢壞掉時叫你少一點、趨勢回來時叫你回來。它的價值在 2 月底到 10 月那段少賠的部分。',
      '看大盤之瞳的偏多比例：2022 年大部分時間偏多比例都很低，這是「全市場的事」，分散到不同的台股 ETF 幫不了太多。',
    ],
    trap: [
      '「高股息比較抗跌，所以全部換成高股息」：跌的時候少跌幾個百分點，漲的時候也少漲。看的是你要什麼，不是哪個「比較好」。',
      '「債券 ETF 是保險箱」：長天期債券 ETF 對利率很敏感，升息年會跟股票一起跌。',
      '一年都在減碼訊號裡，很多人會「受不了」在 10 月賣光——那正好是低點。訊號是提醒，比重和紀律才是決定。',
    ],
    src: [SRC.index, SRC.ust, SRC.etf], lessons: ['b-bond', 'r-crash', 'b-types'],
  },
  {
    id: 'crash20240805', t: '2024/8/5：單日跌 8.35%，四個交易日回來', k: 'market',
    sub: '史上最大單日跌點。0050 那天跌 9%，一週內回到大跌前的價格；正 2 跌了近兩成。',
    codes: ['0050', '00878', '00631L'], from: 20240701, to: 20240930,
    marks: [{ d: 20240711, t: '7/11 高點' }, { d: 20240805, t: '8/5 大跌' }],
    tell: [
      (st) => `2024/8/5（星期一），美國衰退疑慮加上日圓套利平倉，加權指數跌 1,807 點（−8.35%），當時史上最大跌點，台積電跌 9.75%。0050 當天含息 ${pct(st.rec['0050'].drop)}、00878 ${pct(st.rec['00878'].drop)}、00631L ${pct(st.rec['00631L'].drop)}。`,
      (st) => `然後很快就回來了：0050 在 ${st.rec['0050'].backN} 個交易日後（${fmt.dy(st.rec['0050'].backD)}）回到 8/2 的水準，00878 ${st.rec['00878'].backN} 個交易日、00631L ${st.rec['00631L'].backN} 個交易日。`,
      (st) => `但從 7/11 的高點算，這一波 0050 的最大回檔是 ${pct(st['0050'].mdd)}，不只是 8/5 那一天的事。`,
    ],
    judge: [
      (st) => `冷眼的規則（0050）：${st.sig['0050'].map(([d, s]) => `${fmt.d(d)} ${SIG_T[s]}`).join(' → ')}。注意 7/12 是「可加碼」——就在 7/11 的高點旁邊；8/6（大跌隔天）才變成「減碼」。規則是落後的，它看的是收盤資料。`,
      '大跌當天該看：偏多比例掉多少（全市場都跌）、指數離季線多遠（8/5 跌破了季線）、法人賣了多少。然後——看，不動。',
      '這就是為什麼冷眼每次都把「可加碼」和同類基準並列：單看一次訊號，7/12 那次是錯的；要看幾千次的統計。',
    ],
    trap: [
      '當天用市價單賣：8/5 開盤很多 ETF 直接跌停、五檔空的，市價單會成交在最差的價格，而且四天後就回來了。',
      '正 2 不是「跌兩倍再漲兩倍回來」：00631L 跌得更深，回來的路也更長；而且它的最大回檔是 0050 的將近兩倍。',
      '「這次大跌後很快回來，所以以後大跌都要接」：2022 年那次花了兩年。單一案例不能變成規則。',
    ],
    src: [SRC.index, SRC.li], lessons: ['r-crash', 't-lev', 't-market'],
  },
  {
    id: 'tariff2025', t: '2025/4/7：關稅震撼，跌停之後', k: 'market',
    sub: '美國宣布對等關稅，清明連假後第一個交易日跌 9.7%，一千七百多檔跌停。0050 一個多月後回來。',
    codes: ['0050', '00878', '00679B', '00631L'], from: 20250303, to: 20250630,
    marks: [{ d: 20250407, t: '4/7 跌停' }, { d: 20250409, t: '4/9 低點' }],
    tell: [
      (st) => `2025/4/2 美國宣布對等關稅，台股連假期間不能交易，4/7 一開盤就是跌停：加權指數跌 2,065 點（−9.7%），上市櫃 1,702 檔跌停。0050 當天 ${pct(st.rec['0050'].drop)}（跌停），低點在 4/9（${pct(st.rec['0050'].low)}）。`,
      (st) => `回來的速度比 2024/8 慢：0050 ${st.rec['0050'].backN} 個交易日（${fmt.dy(st.rec['0050'].backD)}）回到 4/2 的水準，00878 要 ${st.rec['00878'].backN} 個交易日。`,
      (st) => `債券 ETF 這次一開始有避到險：00679B 4/7 當天是 ${pct(st.rec['00679B'].drop)}，但之後一個多月反而跌到 ${pct(st.rec['00679B'].low)}（${fmt.dy(st.rec['00679B'].lowD)}，比 4/2 的水準）。避險工具也有自己的風險。`,
    ],
    judge: [
      (st) => `冷眼的規則（0050）：${st.sig['0050'].map(([d, s]) => `${fmt.d(d)} ${SIG_T[s]}`).join(' → ')}。這一次規則在 3 月初就是「減碼」（3 月已經跌破防守線），一路到 4 月底才轉「先不加碼」，5 月底「續抱」。`,
      '跌停那天的重點是流動性：跌停時只有賣單排隊、沒有成交，你的賣單排在幾萬張後面，掛了也賣不掉。這時候做什麼都沒用，等。',
      '4/7 到 4/9 三天，每天都有人說「底到了」或「還有一半要跌」。沒有人知道；冷眼的規則要等收盤資料，而且它只會在趨勢回來時慢慢轉。',
    ],
    trap: [
      '連假前看到消息想「先賣再說」：連假期間不能交易，4/7 一開盤直接跌停，想賣也賣不掉。「有消息就動」在台股常常做不到。',
      '00631L 當天 −20%、低點 −37%：槓桿 ETF 在跌停日的損失是真的兩倍，而且回來要更久。',
      '「債券 ETF 漲了，趕快換成債券」：一個多月後它反而跌得比 0050 深。',
    ],
    src: [SRC.index, SRC.trading, SRC.ust], lessons: ['r-crash', 'b-limit', 'b-bond'],
  },
  {
    id: 'split0050', t: '0050 分割：一拆四，價格變 1/4，你沒有變窮', k: 'rule',
    sub: '2025/6/11～6/17 停止交易，6/18 用新價格恢復。原始價格圖上出現一根「跌 75%」的假懸崖。',
    codes: ['0050'], from: 20250501, to: 20250731, raw: true,
    marks: [{ d: 20250610, t: '6/10 分割前最後一天' }, { d: 20250618, t: '6/18 恢復交易' }],
    tell: [
      (st) => `0050 在 2025 年 6 月一拆四：6/10 收 ${px(st.split.before)} 元，停止交易四個交易日（6/11～6/17），6/18 以 ${px(st.split.after)} 元恢復交易。你原本 1 張變 4 張，總值不變（${px(st.split.before)} ≈ ${px(st.split.after)} × 4）。`,
      '圖上的兩條線：原始價格在 6/18 掉下去一截，那不是下跌；還原價把分割前的價格除以 4，才是真正的走勢。冷眼的歷史資料、時光機、對答案全部用還原價。',
      '停止交易那幾天，定期定額不扣也不補（各券商都一樣），冷眼也不會記那幾期。你的部位在冷眼裡會自動把股數乘 4、成本除以 4。',
    ],
    judge: [
      '看到走勢圖上一根 75% 的懸崖，先想「是不是分割」：證交所的公告會寫停止交易期間和恢復交易日。',
      '分割不改變任何基本面：淨值、規模、成分股都一樣；只是門檻變低，之後零股的人變多、受益人數會增加。',
    ],
    trap: [
      '「0050 變便宜了，趕快買」：47 元的 0050 和 188 元的 0050 是同一個東西。',
      '自己做的試算表、券商 App 的損益如果沒處理分割，會顯示 −75%。看到這種數字先查分割。',
    ],
    src: [SRC.trading, SRC.etf], lessons: ['b-split', 'b-tr', 'r-halt'],
  },
  {
    id: 'ipo00940', t: '00940：史上最熱的募集，掛牌之後', k: 'trap',
    sub: '五天募到 1,752 億、70 萬人申購，掛牌第一天就跌破 10 元；一年後還是落後 0050。',
    codes: ['00940', '0050', '00878'], from: 20240401, to: 20250331,
    marks: [{ d: 20240401, t: '4/1 掛牌' }, { d: 20240805, t: '8/5 大跌' }],
    tell: [
      (st) => `2024 年 3 月，00940 開賣五天募到 1,752 億元，台灣 ETF 募集的紀錄，約 70 萬人申購。4/1 掛牌，收 ${px(st['00940'].p0)} 元，低於 10 元的申購價。`,
      (st) => `掛牌後一年（到 2025/3/31），00940 含息 ${pct(st['00940'].ret)}，同期 0050 ${pct(st['0050'].ret)}、00878 ${pct(st['00878'].ret)}。中間還經過 2024/8/5 的大跌。`,
      '募到的錢越多，投信就得在短時間內買進幾百億、上千億的成分股；募集時沒有淨值、折溢價、成交量可以看，熱度全靠話題。',
    ],
    judge: [
      '掛牌之後資訊才完整：有淨值可以看折溢價、有成交量可以看流動性、過一陣子有配息紀錄和冷眼的規則判讀。想買，掛牌後隨時買得到。',
      '「很多人買」是熱度，「值得買」要看含息報酬和它跟同類的差距。對決頁可以把它和 0056、00878 放在一起比。',
    ],
    trap: [
      '新 ETF 上市未滿一年，近一年報酬、波動、最大回檔都是空的，對決時六角形會缺角——那不是它比較好，是沒資料。',
      '「申購價 10 元很便宜」：10 元只是一個切法，跟便不便宜無關。',
    ],
    src: [SRC.etf, SRC.nav], lessons: ['t-ipo', 't-prem', 't-hot'],
  },
  {
    id: 'divfill', t: '除息不是白賺：0056 配 2.1 元那一次', k: 'rule',
    sub: '2022/10/19 除息，股價先扣掉 1.89 元，33 個交易日後才填息。',
    codes: ['0056'], from: 20220901, to: 20230131, raw: true,
    marks: [{ d: 20221019, t: '10/19 除息' }, { d: 20221205, t: '12/5 填息' }],
    tell: [
      (st) => `0056 在 2022/10/19 除息 ${st.div.cash} 元，當時的殖利率約 ${st.div.yieldPct.toFixed(1)}%。除息前一天收 ${px(st.div.pre)}，除息日收 ${px(st.div.ex)}：股價先扣掉配息，你的總資產那一刻沒有變。`,
      (st) => `之後花了 ${st.div.fillN} 個交易日（${fmt.dy(st.div.fillD)}）股價才回到 ${px(st.div.pre)}，這筆配息才算真的賺到。圖上原始價格那條線在 10/19 掉了一截，還原價那條線沒有。`,
      (st) => `同一檔 2024/10/17 配 1.07 元那次，花了 ${st.div2.fillN} 個交易日（${fmt.dy(st.div2.fillD)}）才填息——超過一年。`,
    ],
    judge: [
      '要不要買這檔，看規則觀點、折溢價、它和同類的含息報酬；除息日只決定「誰領這一次」，不決定值不值得買。',
      '單檔頁的配息紀錄看得到每一次填息花了多久。常常填不回來的，代表配的是本金。',
    ],
    trap: [
      '除息前一天搶進「賺配息」：配息從股價裡扣出來，單次達 2 萬元還要扣 2.11% 補充保費；你多付的是成本，不是多賺。',
      '殖利率 8% 那一年的 0056，全年含息是負的（2022 年 −17%）。殖利率和報酬是兩件事。',
    ],
    src: [SRC.div, SRC.daily], lessons: ['b-exdiv', 't-divchase', 'b-yield'],
  },
  {
    id: 'lev2x', t: '正 2 不是 2 倍：00631L 和 0050 的一整年', k: 'trap',
    sub: '2022 年 0050 含息 −22%，00631L −37%，不是 −44%；每天重設的磨損和複利同時在發生。',
    codes: ['0050', '00631L'], from: 20220103, to: 20221230,
    marks: [{ d: 20221025, t: '10/25 低點' }],
    tell: [
      (st) => `2022 年 0050 含息 ${pct(st['0050'].ret)}，00631L ${pct(st['00631L'].ret)}：是 0050 的 ${(st['00631L'].ret / st['0050'].ret).toFixed(2)} 倍，不是 2 倍。最大回檔 0050 ${pct(st['0050'].mdd)}、00631L ${pct(st['00631L'].mdd)}。`,
      (st) => `反過來看 2020 上半年（先跌三成再漲回來）：0050 ${pct(st.h2020['0050'])}，00631L ${pct(st.h2020['00631L'])}——也不是 2 倍。`,
      '原因是正 2 追蹤的是「每一天」報酬的 2 倍，每天收盤重新平衡。指數 100 → 110 → 100，正 2 是 100 → 120 → 98.2；來回越多次、幅度越大，磨損越多；一路單邊上漲時反而會超過 2 倍。',
    ],
    judge: [
      '用槓桿 ETF 之前先決定持有多久：它是短期放大趨勢的工具。證交所的說明明白寫著不適合長期持有。',
      '冷眼給槓桿型的單檔上限比其他類別低很多（設定頁的表），溢價警戒也放寬到 1%，因為它的淨值用期貨估。',
    ],
    trap: [
      '「長期看 00631L 漲得比 0050 多，所以長抱正 2 更好」：那是單邊大多頭的結果，中間 2022 年的回檔是 −51%，很少人抱得住。',
      '「跌了 37%，漲 37% 就回來」：跌 37% 要漲 59% 才回到原點。',
    ],
    src: [SRC.li, SRC.daily], lessons: ['t-lev', 'b-types'],
  },
  {
    id: 'bondrate', t: '債券 ETF 不是保險箱：00679B 的五年', k: 'market',
    sub: '從 2020 年的高點到 2025 年的低點，20 年期美債 ETF 含息跌了四成多。利率升，債券價格跌。',
    codes: ['00679B', '0050'], from: 20200720, to: null,
    marks: [{ d: 20200807, t: '8/7 2020 高點' }, { d: 20220316, t: '聯準會開始升息' }, { d: 20250526, t: '5/26 2025 低點' }],
    tell: [
      (st) => `00679B（元大美債 20 年）從 2020/7 到現在含息 ${pct(st['00679B'].ret)}，最大回檔 ${pct(st['00679B'].mdd)}（${fmt.dy(st['00679B'].peakD)} 高點 → ${fmt.dy(st['00679B'].lowD)} 低點）；同期 0050 ${pct(st['0050'].ret)}。`,
      '2020 年利率在底部，債券價格在高點；2022 年起美國一年升息七次，長天期債券的價格一路跌。配息照領，但價格跌掉的比領到的多。',
      '它每個月都配息、每一期配息看起來都很穩，這就是陷阱所在：穩定的是配息，不是總報酬。',
    ],
    judge: [
      '債券 ETF 要看美國長天期公債殖利率的方向：殖利率往上，20 年期的價格往下，每動 1 個百分點價格可能動十幾個百分點。冷眼的「大環境」面向就是看它。',
      '要配息穩又不想價格波動，年期短的債券 ETF 波動小很多；要賭降息，才是長天期的用途。',
    ],
    trap: [
      '「殖利率 5%，比定存好」：定存本金不會跌四成。',
      '「債券和股票反著走，所以一定能避險」：2022 年它們一起跌；2025/4 它先漲後跌。避險不是保證。',
    ],
    src: [SRC.ust, SRC.etf], lessons: ['b-bond', 'r-cbc', 'b-types'],
  },
  {
    id: 'hidiv', t: '高股息 vs 市值型：五年含息報酬', k: 'market',
    sub: '0050、0056、00878 從 2020/7 到現在。殖利率高的，含息報酬不一定高；但回檔確實比較小。',
    codes: ['0050', '0056', '00878'], from: 20200720, to: null,
    marks: [{ d: 20221025, t: '2022 低點' }, { d: 20250409, t: '2025/4 低點' }],
    tell: [
      (st) => `2020/7 到現在的含息報酬：0050 ${pct(st['0050'].ret, 0)}、0056 ${pct(st['0056'].ret, 0)}、00878 ${pct(st['00878'].ret, 0)}。最大回檔：0050 ${pct(st['0050'].mdd)}、0056 ${pct(st['0056'].mdd)}、00878 ${pct(st['00878'].mdd)}。`,
      (st) => `殖利率現在：${['0050', '0056', '00878'].map((c) => { const r = S.rows.get(c); return r && isNum(r.y) ? `${r.n} ${r.y.toFixed(1)}%` : null; }).filter(Boolean).join('、')}。配得多的，這五年賺得比較少；但跌的時候也跌得比較少。`,
      '市值型買的是最大的那群公司，漲跌跟大盤；高股息用殖利率挑股票，成分股偏向成熟、配息多的公司，大漲時常常跟不上。',
    ],
    judge: [
      '先問自己要什麼：要總資產長得快，市值型；要每季有現金進來、睡得著，高股息。兩個都要，就兩個都買，比重自己定。',
      '比較的時候一定用含息報酬，殖利率只是「怎麼拿到」，不是「拿到多少」。對決頁可以看六個面向。',
    ],
    trap: [
      '只看殖利率排行買 ETF：殖利率最高的那幾檔，含息報酬常常墊底。',
      '只看近五年報酬就說市值型一定贏：這五年是台股大多頭，下一個五年不一定。回檔小本身就是一種價值。',
    ],
    src: [SRC.daily, SRC.div, SRC.etf], lessons: ['b-yield', 't-yield', 'b-tr'],
  },
];
(() => { const seen = new Set(); for (const C of CASES) { if (seen.has(C.id)) throw new Error(`case id 重複：${C.id}`); seen.add(C.id); } })();
export const caseById = (id) => CASES.find((c) => c.id === id) || null;

/** 每一個案例要用到的統計（純函式：給歷史檔，回傳 st）。tests 會對每個案例跑一次，確認文字不會算出 undefined */
export function caseStats(C, hists) {
  const to = C.to || 99999999;
  const st = { sig: {}, rec: {}, back: {} };
  for (const c of C.codes) {
    const h = hists[c];
    st[c] = windowStats(h, C.from, to) || { ret: null, mdd: null, p0: null, p1: null, peakD: null, lowD: null, dates: [], idx: [] };
    st.sig[c] = h ? sigChanges(h, C.from, to) : [];
  }
  // 各案例額外要的數字
  if (C.id === 'covid2020') for (const c of C.codes) { const h = hists[c]; const T = h ? trIndex(h) : []; const i = h ? h.d.indexOf(20200114) : -1; st.back[c] = null; if (i >= 0) for (let k = i + 5; k < h.d.length; k++) if (T[k] >= T[i]) { st.back[c] = h.d[k]; break; } }
  if (C.id === 'bear2022') { st.y2022 = {}; for (const c of C.codes) { const w = windowStats(hists[c], 20220103, 20221231); st.y2022[c] = w ? w.ret : null; } }
  if (C.id === 'crash20240805') for (const c of C.codes) st.rec[c] = recoverAfter(hists[c], 20240805) || { drop: null, backN: null, backD: null, low: null, lowD: null };
  if (C.id === 'tariff2025') for (const c of C.codes) st.rec[c] = recoverAfter(hists[c], 20250407) || { drop: null, backN: null, backD: null, low: null, lowD: null };
  if (C.id === 'split0050') { const h = hists['0050']; const i = h ? lastIdx(h.d, 20250617) : -1; st.split = { before: i >= 0 ? h.p[i] : null, after: i >= 0 && h.p[i + 1] != null ? h.p[i + 1] : null }; }
  if (C.id === 'divfill') { st.div = divFill(hists['0056'], 20221019) || {}; st.div2 = divFill(hists['0056'], 20241017) || {}; }
  if (C.id === 'lev2x') { st.h2020 = {}; for (const c of C.codes) { const w = windowStats(hists[c], 20200102, 20200731); st.h2020[c] = w ? w.ret : null; } }
  return st;
}
const line = (x, st) => (typeof x === 'function' ? x(st) : x);

// ------------------------------------------------------------------ 畫面
export function openCase(id = null, push = true) {
  if (S.openCode !== '__cases') FX.cue('open');
  S.openCode = '__cases';
  S.caseId = id && caseById(id) ? id : null;
  if (push && location.hash !== '#cases') history.pushState({ tool: 'cases' }, '', '#cases');
  const sh = $('#sheet');
  sh.hidden = false;
  document.body.classList.add('locked');
  sh.scrollTop = 0;
  if (S.caseId) drawCase(S.caseId); else drawList();
}
const KIND = { market: '行情', rule: '規則', trap: '陷阱' };
function topBar(title, sub, backToList) {
  return `<div class="sheet-top${backToList ? ' wrap' : ''}"><button class="icon-btn" id="back" aria-label="${backToList ? '回案例清單' : '返回'}">${ICON.back}</button><span class="ttl"><b class="ttl-b">${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</span></div>`;
}
function drawList() {
  const sh = $('#sheet');
  sh.innerHTML = topBar('案例教室', '真實的行情，當時該怎麼看') + `<div class="sheet-body tool cases">
    <p class="disclaim">每個案例的數字都由手機上的官方歷史資料（證交所、櫃買的收盤價與除息、分割紀錄）即時算出，走勢用還原權息價。過去的結果不代表未來。</p>
    <section class="panel list case-list">${CASES.map((C) => `<button class="case-row" data-case="${C.id}"><span class="chip ghost">${KIND[C.k] || ''}</span><span class="cr-body"><b>${esc(C.t)}</b><span>${esc(C.sub)}</span></span><span class="chev">${ICON.chev}</span></button>`).join('')}</section>
  </div>`;
  $('#back', sh).addEventListener('click', () => closeDetail());
  $$('[data-case]', sh).forEach((b) => b.addEventListener('click', () => { S.caseId = b.dataset.case; sh.scrollTop = 0; drawCase(S.caseId); }));
}
let caseSeq = 0;
async function drawCase(id) {
  const C = caseById(id);
  if (!C) { drawList(); return; }
  const my = ++caseSeq;
  const sh = $('#sheet');
  sh.innerHTML = topBar(C.t, KIND[C.k], true) + '<div class="sheet-body tool cases"><div class="skeleton" style="height:230px"></div><div class="skeleton" style="height:200px"></div></div>';
  $('#back', sh).addEventListener('click', () => { S.caseId = null; sh.scrollTop = 0; drawList(); });
  const hists = {};
  await Promise.all(C.codes.map(async (c) => { hists[c] = await ensureHist(c); }));
  if (S.openCode !== '__cases' || my !== caseSeq) return;
  const body = $('.sheet-body', sh);
  if (!hists[C.codes[0]] || !hists[C.codes[0]].d) {
    body.innerHTML = '<section class="panel pad calm"><b>這個案例的歷史資料暫時載入失敗。</b><span class="muted">連上網路後再試一次。</span></section>';
    return;
  }
  let st;
  try { st = caseStats(C, hists); } catch { body.innerHTML = '<section class="panel pad calm"><b>這個案例的數字算不出來。</b><span class="muted">歷史資料可能還在回補。</span></section>'; return; }
  const to = C.to || 99999999;
  const main = st[C.codes[0]];
  const dates = main.dates;
  const di = new Map(dates.map((d, i) => [d, i]));
  const series = [];
  if (C.raw) {
    // 原始價格 vs 還原價（分割、除息的案例：看得到那一根懸崖）
    const h = hists[C.codes[0]];
    const i0 = h.d.indexOf(dates[0]);
    const P = h.p.slice(i0, i0 + dates.length);
    const last = P[P.length - 1];
    const adj = main.idx.map((v) => v / main.idx[main.idx.length - 1] * last);   // 把還原價換算成「現在的價格」尺度
    series.push({ name: `${nameOf(C.codes[0])} 原始價格`, col: COL[0], vals: P });
    series.push({ name: '還原權息價', col: COL[1], vals: adj, dash: '4 4' });
  } else {
    C.codes.forEach((c, k) => {
      const w = st[c];
      const m = new Map((w.dates || []).map((d, i) => [d, w.idx[i]]));
      series.push({ name: nameOf(c), col: COL[k], vals: dates.map((d) => m.get(d) ?? null) });
    });
  }
  const marks = (C.marks || []).map((m) => ({ i: nearestIdx(dates, di, m.d), t: m.t })).filter((m) => m.i >= 0);
  // 規則訊號的標記（主角那檔）：第一次減碼、第一次可加碼
  const sg = st.sig[C.codes[0]] || [];
  const firstOf = (s) => { const x = sg.find((z) => z[1] === s); return x ? x[0] : null; };
  const t1 = firstOf('trim'), a1 = firstOf('add');
  if (t1 && !C.raw) marks.push({ i: nearestIdx(dates, di, t1), t: '規則：減碼' });
  if (a1 && !C.raw && a1 > (t1 || 0)) marks.push({ i: nearestIdx(dates, di, a1), t: '規則：可加碼' });
  const facts = C.raw ? [] : C.codes.map((c, k) => { const w = st[c]; return { c, col: COL[k], ret: w.ret, mdd: w.mdd, lowD: w.lowD, p0: w.p0, p1: w.p1 }; });
  const fmtY = C.raw ? (v) => v.toFixed(v < 50 ? 1 : 0) : (v) => v.toFixed(0);
  body.innerHTML = `
    <section class="panel chart-card"><div class="chart-head"><h3>${C.raw ? '價格' : '含息走勢'}</h3><span class="small muted">${C.raw ? '原始價格 vs 還原權息價' : `${fmt.dy(dates[0])} 起點＝100`}</span></div><div class="chart" id="cchart"></div>
      <div class="legend">${series.map((s) => `<span><i class="${s.dash ? 'dash' : ''}" style="border-color:${s.col}"></i>${esc(s.name)}</span>`).join('')}</div></section>
    ${facts.length ? `<section class="panel tbl-wrap"><table class="t case-t"><thead><tr><th>ETF</th><th class="r">含息報酬</th><th class="r">最大回檔</th><th class="r">低點</th></tr></thead><tbody>${facts.map((f) => `<tr><td><span class="th-c" style="--c:${f.col}"><i></i>${esc(nameOf(f.c))}</span><br><small class="muted num">${f.c}</small></td><td class="r num ${f.ret > 0 ? 'up' : f.ret < 0 ? 'down' : ''}">${pct(f.ret)}</td><td class="r num">${pct(f.mdd)}</td><td class="r num muted">${f.lowD ? fmt.dy(f.lowD) : '—'}</td></tr>`).join('')}</tbody></table>
      <p class="note">${fmt.dy(dates[0])}～${fmt.dy(dates[dates.length - 1])}，用還原權息價計算（配息當天買回、分割照倍數換算）。</p></section>` : ''}
    <div class="sec-h"><h2>發生了什麼</h2></div><section class="panel pad prose">${C.tell.map((x) => `<p>${esc(line(x, st))}</p>`).join('')}</section>
    <div class="sec-h"><h2>當時該怎麼看</h2></div><section class="panel pad prose">${C.judge.map((x) => `<p>${esc(line(x, st))}</p>`).join('')}</section>
    <div class="sec-h"><h2>陷阱</h2></div><section class="panel pad prose trap">${C.trap.map((x) => `<p>${esc(line(x, st))}</p>`).join('')}</section>
    ${sg.length && !C.raw ? `<section class="panel pad"><div class="cs-sig"><span class="k">冷眼的規則當時怎麼說（${esc(nameOf(C.codes[0]))}，每次換訊號記一筆）</span><div class="cs-sigs">${sg.map(([d, s]) => `<span class="sg sg-${s}"><small class="num">${fmt.d(d)}</small>${SIG_T[s]}</span>`).join('')}</div><p class="small muted">訊號每 5 個交易日取一次，只用當天以前的收盤資料；和戰績頁的回測是同一套。</p></div></section>` : ''}
    <div class="ls-src"><span>出處</span>${C.src.map((s) => `<a href="${esc(s.u)}" target="_blank" rel="noopener">${ICON.ext}${esc(s.n)}</a>`).join('')}</div>
    ${(C.lessons || []).length ? `<div class="ls-rels">${C.lessons.map((l) => `<button type="button" class="ls-rel" data-lesson-open="${l}">課：${esc(lessonTitle(l))}</button>`).join('')}</div>` : ''}
    <div class="row-btns" style="margin-top:4px"><button class="btn ghost small" id="case-prev">上一個案例</button><button class="btn ghost small" id="case-next">下一個案例</button></div>
    <p class="disclaim">案例是為了看懂行情怎麼發生、規則怎麼反應，不是買賣建議；過去的結果不代表未來。</p>`;
  const box = $('#cchart', body);
  box.innerHTML = linesSVG({ dates, series, fmtY, h: 230, marks, ref: C.raw ? null : 100, w: box.clientWidth });
  bindLines(box, { dates, series, fmtV: (v) => (C.raw ? v.toFixed(2) : `${v.toFixed(1)}（${v >= 100 ? '+' : '−'}${Math.abs(v - 100).toFixed(1)}%）`) });
  $$('[data-lesson-open]', body).forEach((b) => b.addEventListener('click', () => openLesson(b.dataset.lessonOpen)));
  const k = CASES.findIndex((c) => c.id === id);
  const go = (j) => { if (CASES[j]) { S.caseId = CASES[j].id; sh.scrollTop = 0; drawCase(S.caseId); } };
  $('#case-prev', body).addEventListener('click', () => (k > 0 ? go(k - 1) : toast('已經是第一個案例')));
  $('#case-next', body).addEventListener('click', () => (k < CASES.length - 1 ? go(k + 1) : toast('已經是最後一個案例')));
}
function nearestIdx(dates, di, d) {
  if (di.has(d)) return di.get(d);
  const i = firstIdx(dates, d);
  return i;
}
const nameOf = (c) => { const r = S.rows.get(c); return r ? r.n : c; };
function lessonTitle(id) { const L = lessonById(id); return L ? L.t : id; }
/** 給戰績頁的工具卡 */
export function casesCardHTML() {
  return `<button class="panel tool-card" id="to-cases"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18.5 9 11l4 4 7-9" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 21h16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg><span><b>案例教室</b><span>2020 疫情、2022 升息、2024/8/5、2025 關稅、0050 分割、00940…用真實的歷史走勢講當時該怎麼看、哪裡是陷阱。</span></span><span class="chev">${ICON.chev}</span></button>`;
}
