/* 冷眼 — 判斷教練：遇到某種狀況（大盤大跌、想追漲、看到新聞、除息、熱門新 ETF、部位在虧），
   用固定規則一步一步帶你看「該看什麼、怎麼讀、哪裡是陷阱」，最後把想法交給副官檢查、記進決策日記。
   不連 AI、不替你決定買賣；每一步的數字都來自 App 裡的官方資料，歷史統計一律和「任何一天」的基準並列。
   和副官的分工：副官檢查「你已經有的想法」；教練帶你「還沒有想法、或想法還很模糊的時候」怎麼看。
   門檻全部在 COACH；改了要同步設定頁「判斷教練怎麼判斷」（coachRulesHTML 照常數產生）。
   開在全螢幕的 #sheet（網址 #coach）。 */
import { $, $$, esc, isNum, S, settings, book, fmt, quote, premBand, today, ICON, ensureHist, getJSON, taiexNow, adviceFor, PF, catName, money, sharesOf, ensureNews, dayTag, plainText } from './core.js';
import { trIndex, AIDE } from './aide.js';
import { divFill } from './cases.js';
import { closeDetail } from './sheet.js';
import * as FX from './fx.js';

// ------------------------------------------------------------------ 門檻（固定規則）
export const COACH = {
  dropBins: [-4, -3, -2],   // 大跌的級距（%）：今天跌多少，就拿歷史上「至少跌這麼多」的日子比（不到 2% 也用 2% 那一組）
  gainBins: [15, 10, 5],    // 漲多的級距（近 20 個交易日 %）
  horizon: 20,              // 之後看 20 個交易日（和規則觀點、副官對答案同一個尺度）
  lowCash: 0.05,            // 現金低於總資產 5%：沒有子彈
  lagMkt: 5,                // 這檔比大盤（0050 含息）多跌 5 個百分點以上，算「它自己的問題」
  newDays: 365,             // 上市未滿一年
  hotHolders: 2,            // 受益人數一年內變成 2 倍以上：人潮湧入
  fillShow: 4,              // 填息紀錄看最近 4 次
};
const SRC = {
  index: { n: '證交所：市場成交資訊（加權指數）', u: 'https://www.twse.com.tw/zh/trading/historical/fmtqik.html' },
  flows: { n: '證交所：三大法人買賣金額統計', u: 'https://www.twse.com.tw/zh/trading/foreign/bfi82u.html' },
  daily: { n: '證交所：每日收盤行情', u: 'https://www.twse.com.tw/zh/trading/historical/mi-index.html' },
  news: { n: '證交所：最新消息', u: 'https://www.twse.com.tw/zh/about/news/news/list.html' },
  fsc: { n: '金管會：新聞稿', u: 'https://www.fsc.gov.tw/ch/home.jsp?id=96&parentpath=0,2' },
  cbc: { n: '中央銀行：新聞稿', u: 'https://www.cbc.gov.tw/tw/lp-302-1.html' },
  nav: { n: '證交所：ETF 盤中預估淨值與折溢價', u: 'https://mis.twse.com.tw/stock/etf_nav.jsp?ex=tse' },
  divPre: { n: '證交所：除權除息預告表', u: 'https://www.twse.com.tw/zh/announced/exright/twt48u.html' },
  nhiDiv: { n: '健保署：股利所得補充保險費實例', u: 'https://www.nhi.gov.tw/ch/cp-2512-4c478-3151-1.html' },
  tdcc: { n: '集保結算所：集保戶股權分散表', u: 'https://www.tdcc.com.tw/portal/zh/smWeb/qryStock' },
  etf: { n: '證交所：ETF 總覽與一般投資風險', u: 'https://www.twse.com.tw/zh/products/securities/etf/overview/introduction.html' },
  guide: { n: '證交所：臺灣投資指南（交易成本）', u: 'https://www.twse.com.tw/zh/about/company/guide.html' },
};

// ------------------------------------------------------------------ 小工具
const pc = (x, d = 1) => (isNum(x) ? `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(d)}%` : '—');       // 已經是 % 的數字
const pr = (x, d = 1) => (isNum(x) ? `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(d)}%` : '—');   // 比例
const pu = (x, d = 0) => (isNum(x) ? `${(x * 100).toFixed(d)}%` : '—');
const n2 = (x) => (isNum(x) ? x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');
const big = (x) => (isNum(x) ? fmt.big(x) : '—');
const md = (d) => (d ? `${Math.floor(d / 100) % 100}/${d % 100}` : '—');
const yi = (x) => (isNum(x) ? `${x > 0 ? '買超' : x < 0 ? '賣超' : '持平'} ${Math.abs(x / 1e8).toFixed(0)} 億` : '—');

/** 含息報酬的分布：cond(i) 為真的那幾天，之後 n 個交易日的報酬。回傳 { n, up, med, p10, p90 }（n=0 回傳 null） */
export function fwdDist(T, cond, n = COACH.horizon) {
  const xs = [];
  for (let i = 1; i + n < T.length; i++) if (T[i] && T[i + n] && cond(i)) xs.push(T[i + n] / T[i] - 1);
  if (!xs.length) return null;
  xs.sort((a, b) => a - b);
  const q = (p) => xs[Math.min(xs.length - 1, Math.max(0, Math.floor(p * (xs.length - 1))))];
  return { n: xs.length, up: xs.filter((x) => x > 0).length / xs.length, med: q(0.5), p10: q(0.1), p90: q(0.9) };
}
/** 單日跌幅（含息）至少 th%（負數）的日子之後 vs 任何一天；perYear：平均每年幾天 */
export function dropStats(h, th) {
  if (!h || !h.d || h.d.length < 60) return null;
  const T = trIndex(h);
  const r1 = (i) => (T[i - 1] ? (T[i] / T[i - 1] - 1) * 100 : 0);
  const hit = fwdDist(T, (i) => r1(i) <= th);
  const base = fwdDist(T, () => true);
  let days = 0;
  for (let i = 1; i < T.length; i++) if (T[i - 1] && r1(i) <= th) days++;
  const years = (T.length - 1) / 245;
  return hit && base ? { th, hit, base, days, perYear: days / years, from: h.d[0] } : null;
}
/** 近 20 個交易日漲了至少 th%（含息）的日子之後 vs 任何一天 */
export function gainStats(h, th) {
  if (!h || !h.d || h.d.length < 80) return null;
  const T = trIndex(h);
  const g = (i) => (i >= 20 && T[i - 20] ? (T[i] / T[i - 20] - 1) * 100 : -Infinity);
  const hit = fwdDist(T, (i) => g(i) >= th);
  const base = fwdDist(T, () => true);
  return hit && base ? { th, hit, base, from: h.d[0] } : null;
}
/** 近 20 個交易日的含息報酬（%） */
export function ret20(h) {
  if (!h || !h.d || h.d.length < 21) return null;
  const T = trIndex(h);
  const n = T.length - 1;
  return T[n - 20] ? (T[n] / T[n - 20] - 1) * 100 : null;
}
/** 某一天以來的含息報酬（%） */
export function retSince(h, d0) {
  if (!h || !h.d || !h.d.length) return null;
  const T = trIndex(h);
  let i = h.d.findIndex((d) => d >= d0);
  if (i < 0) return null;
  const n = T.length - 1;
  return T[i] ? (T[n] / T[i] - 1) * 100 : null;
}
export const dropBin = (pct) => COACH.dropBins.find((b) => isNum(pct) && pct <= b) ?? COACH.dropBins[COACH.dropBins.length - 1];
export const gainBin = (pct) => COACH.gainBins.find((b) => isNum(pct) && pct >= b) ?? COACH.gainBins[COACH.gainBins.length - 1];

// 新聞標題的固定規則：偏預測／評論的字、偏事實的字；以及跟哪一類 ETF 有關
const FORECAST = ['預估', '預期', '可能', '恐', '傳出', '傳', '料將', '料', '估', '看好', '看壞', '看旺', '有望', '憂', '疑', '擬', '研議', '考慮', '或將', '將'];
const FACTUAL = ['公告', '宣布', '核准', '通過', '發布', '決議', '調升', '調降', '維持', '收盤', '收漲', '收跌', '上漲', '下跌', '創新高', '創新低', '公布', '修正', '實施', '生效'];
export const NEWS_CATS = [
  { k: ['利率', '升息', '降息', '殖利率', '公債', '債券', 'Fed', '聯準會', '央行', '通膨', 'CPI'], c: ['bond', 'broad', 'div', 'overseas'], why: '利率影響債券價格，也影響股票的評價' },
  { k: ['半導體', '晶片', 'AI', '台積電', '輝達', '伺服器', '科技', '電子', '晶圓'], c: ['broad', 'theme', 'active', 'lev'], why: '台股市值型、科技主題 ETF 裡最重的是半導體' },
  { k: ['配息', '高股息', '股利', '除息', '殖利率'], c: ['div'], why: '和高股息 ETF 的配息直接相關' },
  { k: ['美股', '那斯達克', '標普', '道瓊', '日股', '陸股', '港股', '歐股', '日經', '美元', '匯率'], c: ['overseas', 'bond'], why: '海外股票、債券 ETF 有匯率與國外行情的影響' },
  { k: ['油價', '黃金', '原油', '原物料', '期貨'], c: ['fut'], why: '期貨／商品 ETF 追蹤的是這些價格' },
  { k: ['台股', '加權', '大盤', '外資', '投信', '法人'], c: ['broad', 'div', 'theme', 'lev', 'inv', 'active'], why: '台股 ETF 都會受大盤影響' },
];
export function newsRead(title) {
  const t = String(title || '');
  const fc = FORECAST.filter((w) => t.includes(w));
  const fa = FACTUAL.filter((w) => t.includes(w));
  const cats = new Set();
  const why = [];
  for (const g of NEWS_CATS) if (g.k.some((w) => t.toLowerCase().includes(w.toLowerCase()))) { g.c.forEach((c) => cats.add(c)); why.push(g.why); }
  return { forecast: fc.slice(0, 3), factual: fa.slice(0, 3), cats: [...cats], why: [...new Set(why)] };
}

// ------------------------------------------------------------------ 情境（每一步：{ t, v, lvl, how, trap, links }）
/* links：{ lesson, case, term, src:[SRC] }；lvl：ok 綠、info 藍、warn 琥珀、stop 紅（教練幾乎不用 stop） */
export const PLAYS = [
  { id: 'crash', t: '大盤大跌', sub: '今天跌很多，要逃還是要撿？', icon: 'down' },
  { id: 'rally', t: '大漲想追', sub: '一直漲，怕錯過？', icon: 'up', pick: 'etf' },
  { id: 'news', t: '看到一則新聞', sub: '這則新聞跟我有關嗎？', icon: 'news', pick: 'news' },
  { id: 'div', t: '除息快到了', sub: '要為了配息買嗎？', icon: 'cal', pick: 'div' },
  { id: 'hot', t: '熱門新 ETF', sub: '大家都在搶，要跟嗎？', icon: 'fire', pick: 'hot' },
  { id: 'loss', t: '我的部位在虧', sub: '停損、攤平，還是放著？', icon: 'loss', pick: 'loss' },
];
export const playById = (id) => PLAYS.find((p) => p.id === id) || null;

const step = (t, v, lvl, how, trap, links = {}) => ({ t, v, lvl, how, trap, links });
/** 「今天」只在資料真的是今天的時候說；休市、週末、開盤前說那個交易日（例如「10/22」） */
const dayWord = (d) => (dayTag(d) === '今日' ? '今天' : `${dayTag(d)}`);
/** 股數：隱藏金額時不寫（帶去問 Claude 沒打開「附上金額」、或隱私模式） */
const shTxt = (ctx, n) => (ctx.privacy ? '' : sharesOf(n));
const rowsArr = (ctx) => (ctx.rows ? [...ctx.rows.values()] : []);
const heldList = (ctx) => (ctx.P && ctx.P.holdings ? ctx.P.holdings : []);
const nameOfC = (ctx, c) => { const r = ctx.rows && ctx.rows.get(c); return r ? r.n : c; };
const distLine = (s) => `上漲的比例 <b class="num">${pu(s.up)}</b>、中位數 <b class="num">${pr(s.med)}</b>、最差 10% <b class="num">${pr(s.p10)}</b>、最好 10% <b class="num">${pr(s.p90)}</b>`;

/** 大盤大跌 */
function crash(ctx) {
  const m = ctx.mkt;
  const S1 = [];
  if (!m) return [step('資料還沒到', '大盤資料還沒載入，等一下再試。', 'info', '', '')];
  const below = isNum(m.ma60) && m.px < m.ma60;
  const th = dropBin(m.pc);
  const ds = ctx.h0050 ? dropStats(ctx.h0050, th) : null;
  S1.push(step('先用數字看跌了多少',
    `加權指數 <b class="num">${n2(m.px)}</b>（<b class="num ${m.pc < 0 ? 'down' : m.pc > 0 ? 'up' : ''}">${pc(m.pc, 2)}</b>，${esc(m.when)}）；季線 <b class="num">${n2(m.ma60)}</b>，${below ? '在季線之下' : '還在季線之上'}。${ds ? `2020 年以來，0050 單日（含息）跌 ${Math.abs(th)}% 以上，平均每年約 <b class="num">${ds.perYear.toFixed(1)}</b> 天。` : ''}`,
    m.pc <= -3 ? 'warn' : m.pc <= -1.5 ? 'info' : 'ok',
    m.pc > -1.5 ? `${dayTag(m.d) === '今日' ? '今天' : `${dayTag(m.d)} 那天`}其實沒有大跌。教練照樣帶你走一遍，下次真的大跌時就知道要看什麼。` : '先把「好像崩了」換成數字：跌幾 %、在不在季線之下，比新聞標題準。',
    '標題的「重挫」「崩跌」每年都會出現好幾次；先看數字，再看形容詞。',
    { lesson: 'r-crash', term: 'ma', src: [SRC.index] }));
  S1.push(ds
    ? step(`歷史上，單日跌 ${Math.abs(th)}% 以上之後`,
      `0050 從 ${fmt.dy(ds.from)} 起，單日（含息）跌 ${Math.abs(th)}% 以上的 <b class="num">${ds.hit.n}</b> 天，之後 ${COACH.horizon} 個交易日：${distLine(ds.hit)}。<br><span class="muted">任何一天：${distLine(ds.base)}。</span>`,
      'info',
      `這是 ${fmt.dy(ds.from).slice(0, 4)} 年以來的真實分布，不是預測。這段期間台股大多是多頭，大跌之後多半漲回來；但樣本不多，而且很多擠在同一波大跌裡（不是獨立的樣本），換成一路下跌的年份，結果可能完全不同。上漲比例、中位數、最差 10% 都要看。`,
      '看到「大跌之後通常會漲」就一次押滿；像 2022 年那種一路下跌的年份，跌了之後還會再跌。',
      { case: 'bear2022', term: 'p10' })
    : step('歷史上，大跌之後', '0050 的歷史資料還在載入（或載入失敗），先跳過這一步。', 'info', '', '「跌深一定反彈」和「一定還會再跌」，都只看了分布的一半。', { case: 'crash20240805' }));
  const H = heldList(ctx).filter((x) => x.mv > 0);
  if (H.length) {
    const t = ctx.P.totals;
    const worst = H.filter((x) => x.q && isNum(x.q.pc)).sort((a, b) => a.q.pc - b.q.pc).slice(0, 3);
    const brk = H.filter((x) => x.row && isNum(x.row.dl) && isNum(x.px) && x.px < x.row.dl);
    const trim = H.filter((x) => x.row && x.row.ps === 'trim');
    S1.push(step('你的部位怎麼了',
      `總資產 ${ctx.privacy ? '' : `<b class="num ${t.day < 0 ? 'down' : t.day > 0 ? 'up' : ''}">${money(t.day, true)}</b> `}（<b class="num">${pr(t.dayPct, 2)}</b>）。跌最多：${worst.map((x) => `${esc(x.name)} <b class="num down">${pc(x.q.pc, 2)}</b>`).join('、') || '—'}。${brk.length ? `<br>跌破移動防守線：${brk.map((x) => `${esc(x.name)}（${n2(x.row.dl)}）`).join('、')}。` : '<br>沒有一檔跌破移動防守線。'}${trim.length ? `<br>規則轉成「減碼」：${trim.map((x) => esc(x.name)).join('、')}。` : ''}`,
      brk.length || trim.length ? 'warn' : 'ok',
      '真正該行動的理由，是跌破你事先設好的出場線、或規則轉成減碼；不是「今天跌很多」。',
      '恐慌時一次全部賣掉，等於把短期的波動變成永久的損失。',
      { lesson: 'r-dl', term: 'dl' }));
  } else {
    S1.push(step('你的部位怎麼了', '你還沒有記持股。記下持股之後，這一步會算出你今天的損益、哪幾檔跌破出場線。', 'info',
      '真正該行動的理由，是跌破你事先設好的出場線；不是「今天跌很多」。', '恐慌時一次全部賣掉，等於把短期的波動變成永久的損失。', { term: 'dl' }));
  }
  const I = m.insti;
  S1.push(step('錢往哪裡跑',
    I ? `${md(I.date)} 集中市場：外資 <b class="num ${I.f < 0 ? 'down' : 'up'}">${yi(I.f)}</b>、投信 <b class="num ${I.t < 0 ? 'down' : 'up'}">${yi(I.t)}</b>、自營商 <b class="num ${I.d < 0 ? 'down' : 'up'}">${yi(I.d)}</b>。` : '三大法人資料還沒出來（每天約 15:00 公布）。',
    I && I.f < 0 && m.pc < 0 ? 'info' : 'ok',
    '外資賣超常和大跌出現在同一天。它是今天發生了什麼的一部分，不是明天的預告。',
    '「外資在逃，所以我也要逃」——你和外資的資金、期限、避險工具都不一樣。',
    { lesson: 'r-insti', term: 'insti', src: [SRC.flows] }));
  const since = m.d || ctx.today;   // 最近一個交易日（休市日看的是上一個交易日以來）
  const off = (ctx.news || []).filter((x) => x.kind === 'official' && x.d >= since).slice(0, 3);
  S1.push(step('官方有沒有發布大事',
    off.length ? off.map((x) => `<a class="co-news" href="${esc(x.url)}" target="_blank" rel="noopener">${ICON.ext}<span>${esc(srcName(x.src))} ${md(x.d)}：${esc(x.t)}</span></a>`).join('') : `${md(since)} 以來，證交所、金管會、央行沒有新的公告。`,
    'info',
    '先找制度、政策有沒有變（看官方原文），再看評論。沒有新的官方消息，多半是市場情緒或國際行情。',
    '大跌時群組、論壇的「內線消息」最多，也最常是錯的。',
    { src: [SRC.news, SRC.fsc, SRC.cbc] }));
  if (ctx.P && ctx.P.totals.T > 0) {
    const t = ctx.P.totals;
    const cs = t.cash / t.T;
    const adds = rowsArr(ctx).filter((r) => r.ps === 'add' && (heldList(ctx).some((x) => x.code === r.c) || (ctx.watch || []).includes(r.c)));
    S1.push(step('你的子彈和紀律',
      `現金約占總資產 <b class="num">${pu(cs)}</b>。${adds.length ? `你持有或關注的 ETF 裡，現在「可加碼」的有：${adds.slice(0, 4).map((r) => esc(r.n)).join('、')}${adds.length > 4 ? ` 等 ${adds.length} 檔` : ''}。` : '你持有或關注的 ETF，現在沒有一檔是「可加碼」。'}`,
      cs < COACH.lowCash ? 'warn' : 'ok',
      '想撿便宜：先決定總共用多少錢、分幾批、每批隔多久，用你設定的比重上限當煞車。副官會依你的紀律算出這次最多買多少。',
      cs < COACH.lowCash ? '幾乎沒有現金：不要借錢、不要動用短期要用的錢去撿便宜。' : '一次全部押進去想抄到最低點；最低點只有事後才知道。',
      { term: 'ps' }));
  }
  return S1;
}

/** 大漲想追 */
function rally(ctx) {
  const r = ctx.row;
  if (!r) return [];
  const q = ctx.quote(r);
  const out = [];
  const g20 = ctx.h ? ret20(ctx.h) : null;
  const hot = !!r.hot;
  out.push(step('漲了多少、熱不熱',
    `${dayWord(q.date)} <b class="num ${q.pc > 0 ? 'up' : q.pc < 0 ? 'down' : ''}">${pc(q.pc, 2)}</b>${isNum(g20) ? `、近 20 個交易日（含息）<b class="num ${g20 > 0 ? 'up' : 'down'}">${pc(g20)}</b>` : ''}${isNum(r.rsi) ? `、RSI <b class="num">${Math.round(r.rsi)}</b>` : ''}。${hot ? `冷眼標記為「短線漲多」（${esc(PF.hotWhy(r, q.px))}）。` : '冷眼沒有標記短線漲多。'}`,
    hot || (isNum(g20) && g20 >= COACH.gainBins[1]) ? 'warn' : 'ok',
    '漲多不是不能買，而是要知道自己買在什麼位置：越熱的時候，回檔也越深。',
    '看到別人賺錢才想進場（怕錯過），通常已經漲一大段了。',
    { term: 'rsi', lesson: 't-recent' }));
  const th = gainBin(g20);
  const gs = ctx.h ? gainStats(ctx.h, th) : null;
  out.push(gs
    ? step(`歷史上，20 天漲 ${th}% 以上之後`,
      `${esc(r.n)} 從 ${fmt.dy(gs.from)} 起，近 20 個交易日漲 ${th}% 以上的 <b class="num">${gs.hit.n}</b> 天，之後 ${COACH.horizon} 個交易日：${distLine(gs.hit)}。<br><span class="muted">任何一天：${distLine(gs.base)}。</span>`,
      'info', '這是這一檔自己過去的真實分布：漲多之後不一定會跌，也不一定會繼續漲。看上漲比例和中位數，也把最差 10% 想成你可能遇到的情況。', '只看到「漲多還會再漲」的那一半。', { term: 'p10' })
    : step('歷史上，漲多之後', '這檔的歷史資料不夠長（或還在載入），沒辦法算。', 'info', '', '只看到「漲多還會再漲」的那一半。'));
  const [w] = premBand(r);
  const prem = q.prem;
  out.push(step('價格貴不貴',
    `${isNum(prem) ? `${prem >= 0 ? '溢價' : '折價'} <b class="num">${Math.abs(prem).toFixed(2)}%</b>（這一類的警戒 ${w}%）` : '目前沒有折溢價資料'}${isNum(r.yp) && ['div', 'broad'].includes(r.k) ? `；配息殖利率在近兩年的位置 <b class="num">${pu(r.yp)}</b>（越低代表價格相對越貴）` : ''}。`,
    isNum(prem) && prem > w ? 'warn' : 'ok',
    '溢價是比淨值多付的錢；殖利率在近兩年偏低的位置，代表價格相對高。',
    '溢價追高：溢價 3% 買進，等於先虧 3%。',
    { lesson: 't-prem', term: 'prem', src: [SRC.nav] }));
  const x = heldList(ctx).find((h) => h.code === r.c);
  const cap = PF.capOf(ctx.risk, r.k);
  out.push(step('你已經有多少',
    `${x ? `已經占總資產 <b class="num">${pu(x.w, 1)}</b>（${esc(catName(r.k))}單檔上限 ${pu(cap)}）` : '你還沒有這一檔'}。${ctx.overlap ? ctx.overlap : ''}`,
    x && isNum(x.w) && x.w >= cap ? 'warn' : 'ok',
    '越漲越想買，比重也會越來越大；上限是讓你在最熱的時候踩煞車。',
    '同一群股票用不同的 ETF 重複買，以為分散了，其實更集中。',
    { term: 'risk' }));
  const a = ctx.adv ? ctx.adv(r.c) : null;
  out.push(step('要買，就先寫好計畫',
    a && a.plan && a.plan.n > 0 ? `依你的紀律，這次${ctx.privacy ? '買到你設定的比重上限為止' : `最多 <b class="num">${shTxt(ctx, a.plan.n)}</b>`}、分三批；出場線 <b class="num">${n2(a.plan.stop)}</b>。` : '先寫下三件事：這次用多少錢、分幾批、跌到哪裡認錯。',
    'info',
    '分批讓你不用猜最高點；出場線讓你在看錯的時候有明確的動作。',
    '「先買一點試試看」，結果越買越多、沒有出場線。',
    { term: 'stop' }));
  return out;
}

/** 看到一則新聞 */
function news(ctx) {
  const it = ctx.item;
  const out = [];
  if (!it) return out;
  const ext = it.ext;
  const kindT = ['twse', 'twse_news', 'fsc', 'cbc'].includes(it.src) ? `${srcName(it.src)}的官方原文` : it.src === 'cna' ? '中央社（國家通訊社）的事實報導' : srcName(it.src);
  out.push(step('這是誰說的',
    ext ? '這則新聞不在冷眼的清單裡（冷眼只收證交所、金管會、央行與中央社）。' : `${esc(kindT)}，${md(it.d)}。<br><a class="co-news" href="${esc(it.url)}" target="_blank" rel="noopener">${ICON.ext}<span>${esc(it.t)}</span></a>`,
    ext ? 'warn' : 'ok',
    '同一件事，先找最原始的來源：政策看主管機關的新聞稿，公司的事看公開資訊觀測站，交易制度看證交所。',
    '轉貼的截圖、群組訊息、標題黨，最常斷章取義。',
    { lesson: 't-news', src: [SRC.news, SRC.fsc, SRC.cbc] }));
  const rd = ext ? null : newsRead(it.t);
  out.push(step('是事實，還是預測和評論',
    ext ? '自己看一下內文：有沒有具體的數字、日期、誰宣布的？還是「預估、可能、恐、傳出」？' : rd.forecast.length && !rd.factual.length ? `標題裡有「${rd.forecast.map(esc).join('」「')}」：偏向預測或評論。` : rd.factual.length && !rd.forecast.length ? `標題裡有「${rd.factual.map(esc).join('」「')}」：偏向已經發生的事實。` : rd.factual.length ? `標題同時有事實（「${rd.factual.map(esc).join('」「')}」）和預測（「${rd.forecast.map(esc).join('」「')}」）的字。` : '標題看不太出來，點開內文看：有沒有具體的數字、日期、誰宣布的。',
    !ext && rd.forecast.length && !rd.factual.length ? 'warn' : 'info',
    '事實會改變現況；預測只是某個人的看法，準不準要事後才知道。',
    '把評論當事實：「法人看好」不等於會漲。',
    {}));
  const cats = rd ? rd.cats : [];
  const H = heldList(ctx).filter((x) => x.mv > 0);
  const rel = H.filter((x) => cats.includes(x.cat || (x.row && x.row.k)));
  const coHit = !ext && ctx.xrayNames ? ctx.xrayNames(it.t) : [];
  out.push(step('跟你有沒有關係',
    ext ? '想一想新聞講的是哪一類：利率（債券）、科技半導體（市值型、科技主題）、配息（高股息）、海外市場（海外股票）？再對照你的持股。'
      : cats.length ? `相關的類別：${cats.map((c) => esc(catName(c))).join('、')}（${rd.why.map(esc).join('；')}）。${rel.length ? `<br>你持有的相關 ETF：${rel.map((x) => `${esc(x.name)}（占 ${pu(x.w, 1)}）`).join('、')}。` : '<br>你持有的 ETF 裡，沒有直接相關的類別。'}${coHit.length ? `<br>${coHit.join('<br>')}` : ''}`
        : `看不出和哪一類 ETF 直接相關。${coHit.length ? `<br>${coHit.join('<br>')}` : ''}`,
    rel.length || coHit.length ? 'info' : 'ok',
    '新聞跟你有關，是因為它影響你持有的東西；先確定有關，再想要不要動作。',
    '每一則新聞都覺得要做點什麼，交易越多、成本越高。',
    {}));
  const tx = ctx.mkt;
  out.push(step('價格已經反映了嗎',
    `${tx ? `加權指數 <b class="num ${tx.pc < 0 ? 'down' : tx.pc > 0 ? 'up' : ''}">${pc(tx.pc, 2)}</b>（${esc(tx.when)}）` : ''}${rel.length ? `；${rel.map((x) => `${esc(x.name)} <b class="num ${x.q && x.q.pc < 0 ? 'down' : 'up'}">${x.q ? pc(x.q.pc, 2) : '—'}</b>`).join('、')}` : ''}。`,
    'info',
    '新聞出來的時候，價格往往已經先動了；你看到的是市場已經知道的事。',
    '看到新聞才追進去，常常買在消息最熱的那一刻。',
    { src: [SRC.daily] }));
  if (rel.length) {
    out.push(step('規則有沒有變',
      rel.map((x) => `${esc(x.name)}：${x.row ? `${({ 1: '偏多', 0: '中性', '-1': '偏空' })[String(x.row.st)] || '資料不足'}、${PS_T[x.row.ps] || '—'}` : '—'}`).join('<br>'),
      'info',
      '冷眼的規則看的是價格與資金。重要的新聞，通常會在之後幾天反映到規則上；規則沒變，就不急。',
      '因為一則新聞推翻自己原本的計畫。',
      { term: 'ps' }));
  }
  return out;
}
const PS_T = { add: '可加碼', wait: '漲多分批', hold: '續抱', caution: '先不加碼', trim: '減碼' };
function srcName(s) { return { twse: '證交所', twse_news: '證交所', fsc: '金管會', cbc: '中央銀行', cna: '中央社' }[s] || '官方來源'; }

/** 除息快到了 */
function div(ctx) {
  const r = ctx.row;
  if (!r) return [];
  const q = ctx.quote(r);
  const nd = ctx.dv || r.dv;
  const out = [];
  const x = heldList(ctx).find((h) => h.code === r.c);
  const cash = nd && isNum(nd.cash) ? nd.cash : null;
  out.push(step('這次配多少、哪天除息',
    nd ? `${md(nd.d)} 除息，${cash != null ? `每單位 <b class="num">${+cash.toFixed(4)}</b> 元，約是現價的 <b class="num">${isNum(q.px) && q.px > 0 ? (cash / q.px * 100).toFixed(2) : '—'}%</b>` : '金額還沒公告'}。要在除息日前一天收盤前持有，才領得到。` : '這檔最近沒有除息公告。',
    nd ? 'info' : 'ok',
    '一次配息占股價的比例，乘上一年配幾次，大約就是殖利率；但殖利率高不等於報酬高。',
    '只看「這次配多少」，不看「股價會扣掉多少」。',
    { lesson: 'r-divnotice', term: 'div', src: [SRC.divPre] }));
  out.push(step('除息當天，股價會扣掉配息',
    cash != null && isNum(q.px) ? `以現價 ${n2(q.px)} 算，除息參考價約 <b class="num">${n2(q.px - cash)}</b>。${x ? (ctx.privacy ? '你持有的部分：配息會入帳，股票市值同時少掉差不多的金額。' : `你的 ${shTxt(ctx, x.h.sh)}：配息約 ${money(Math.floor(cash * x.h.sh))} 元，股票市值同時少掉差不多的金額。`) : ''}` : '除息當天，參考價＝前一天收盤價－每單位配息。',
    'info',
    '配息是從 ETF 的資產拿出來給你的：左手換右手，總值不變；之後漲回去（填息）才是真的賺。',
    '「買在除息前、白賺配息」：配息本來就在股價裡。',
    { lesson: 't-divchase', case: 'divfill' }));
  const fills = ctx.h ? (ctx.h.divs || []).slice(-COACH.fillShow).map(([d]) => divFill(ctx.h, d)).filter(Boolean) : [];
  out.push(step('以前多久填息',
    fills.length ? fills.map((f) => `${fmt.dy(f.exD)} 配 ${+f.cash.toFixed(4)} 元：${f.fillN != null ? `<b class="num">${f.fillN}</b> 個交易日填息` : '<b>還沒填息</b>'}`).join('<br>') : '這檔的歷史資料還沒載入，或之前沒有配息紀錄。',
    fills.some((f) => f.fillN == null) ? 'warn' : 'info',
    '填息快不快，看的是之後的行情，不是配息本身；沒填息，等於配息只是把你的錢還給你。',
    '用「每次都很快填息」推論這次也會。',
    { case: 'divfill' }));
  const sh = x ? x.h.sh : null;
  const amt = cash != null && sh ? cash * sh : null;
  out.push(step('稅與二代健保',
    amt != null && !ctx.privacy ? `你這次約可領 <b class="num">${money(Math.floor(amt))}</b> 元：${amt >= PF.NHI_THRESHOLD ? `單次 2 萬元以上，股利與利息所得的部分會先扣 <b class="num">2.11%</b> 二代健保補充保費` : '單次未滿 2 萬元，不扣二代健保補充保費'}；配息還要併入當年度所得申報。` : `單次領 2 萬元以上，股利與利息所得的部分先扣 2.11% 二代健保補充保費；配息還要併入當年度所得申報。`,
    amt != null && !ctx.privacy && amt >= PF.NHI_THRESHOLD ? 'warn' : 'info',
    '配息不是白拿：先扣健保補充保費，報稅時還要算進所得。',
    '為了領息買一大筆，結果多付了健保費和稅。',
    { lesson: 't-divchase', src: [SRC.nhiDiv] }));
  out.push(step('要不要為了配息買',
    `如果本來就打算長期持有，除息前或除息後買，差別不大；專程為了這次配息才買，要多付買賣的手續費${r.k === 'bond' ? '' : '、賣出的證交稅'}，還可能多扣二代健保。`,
    'info',
    '想清楚你要的是「長期的含息報酬」，還是「這一次的配息」。',
    '配息高的 ETF，配息來源可能包含收益平準金（等於拿你的本金配給你）。',
    { lesson: 't-yield', term: 'y' }));
  return out;
}

/** 熱門新 ETF */
function hot(ctx) {
  const r = ctx.row;
  if (!r) return [];
  const q = ctx.quote(r);
  const out = [];
  const [w] = premBand(r);
  const prem = q.prem;
  out.push(step('溢價多少',
    isNum(prem) ? `${prem >= 0 ? '溢價' : '折價'} <b class="num">${Math.abs(prem).toFixed(2)}%</b>（這一類的警戒 ${w}%）。` : '目前沒有折溢價資料。',
    isNum(prem) && prem > w ? 'warn' : 'ok',
    '人一多，市價常常比淨值貴；溢價買進，等於一開始就多付錢。',
    '排隊搶到「掛牌價」，但掛牌後溢價收斂，馬上帳面虧損。',
    { lesson: 't-prem', term: 'prem', src: [SRC.nav] }));
  const since = r.since;
  const young = since && dayDiff(since, ctx.today) < COACH.newDays;
  out.push(step('上市多久、經歷過什麼',
    since ? `${fmt.dy(since)} 起有交易資料${young ? '，<b>還不到一年</b>：沒有經歷過完整的多空循環' : ''}。${r.st == null ? '上市未滿 70 個交易日，冷眼還沒有規則觀點。' : ''}` : '沒有上市日期資料。',
    young ? 'warn' : 'ok',
    '新 ETF 的「回測績效」是用指數算的，不是這檔真的跑出來的成績。',
    '用募集時的廣告（年化報酬、殖利率）當成未來會拿到的報酬。',
    { lesson: 't-ipo', case: 'ipo00940' }));
  const hd = ctx.holders || null;
  out.push(step('多少人在搶',
    `受益人數 <b class="num">${isNum(r.hd) ? Math.round(r.hd).toLocaleString('en-US') : '—'}</b> 人${hd && isNum(hd.x) ? `（一年前約 ${Math.round(hd.prev).toLocaleString('en-US')} 人，變成 <b class="num">${hd.x.toFixed(1)}</b> 倍）` : ''}、規模約 <b class="num">${big(r.aum)}</b> 元、最近一天成交值 <b class="num">${big(r.val)}</b> 元。`,
    hd && hd.x >= COACH.hotHolders ? 'warn' : 'info',
    '人多代表流動性好、不容易被清算，但也常伴隨溢價和過高的期待。',
    '人多就安全？受益人數暴增，常是在價格最熱的時候。',
    { lesson: 't-hot', term: 'hd', src: [SRC.tdcc] }));
  out.push(step('裡面裝什麼、和你重疊多少',
    ctx.overlap || '投信投顧公會還沒有這檔的成分股資料（新 ETF 要等第一次月報），或成分股資料還在載入。',
    ctx.overlapWarn ? 'warn' : 'info',
    '名字不同的 ETF，裡面可能是同一群股票；先看成分股，再決定是不是真的需要多一檔。',
    '收集 ETF：每檔都買一點，以為分散，其實重複。',
    { term: 'xray' }));
  out.push(step('配息率不是報酬率',
    `${isNum(r.y) ? `近一年配息殖利率約 <b class="num">${r.y.toFixed(2)}%</b>。` : '還沒有一整年的配息紀錄。'}廣告上的「年化配息率」是用最近一次配息乘上次數算的，不保證之後也配這麼多。`,
    'info',
    '真正的報酬＝配息＋價格的漲跌（含息總報酬）。',
    '殖利率越高越好：股價跌了，殖利率也會「變高」。',
    { lesson: 't-yield', term: 'total' }));
  return out;
}
function dayDiff(a, b) {
  const t = (d) => Date.UTC(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100);
  return Math.round((t(b) - t(a)) / 864e5);
}

/** 我的部位在虧 */
function loss(ctx) {
  const x = ctx.held;
  if (!x) return [];
  const r = x.row;
  const out = [];
  const first = (x.h && x.h.first) || ctx.firstBuy || null;
  out.push(step('虧多少、占多少',
    `${esc(x.name)}：帳面 <b class="num down">${pr(x.pct)}</b>${ctx.privacy ? '' : `（${money(x.pnl, true)} 元）`}，占總資產 <b class="num">${pu(x.w, 1)}</b>${first ? `；第一筆買在 ${fmt.dy(first)}` : ''}。`,
    isNum(x.pct) && x.pct <= -0.2 ? 'warn' : 'info',
    '先看清楚虧損占你全部資產的多少：占 3% 的部位虧 20%，總資產只少 0.6%。',
    '只盯著虧損的百分比，忘了它在整體裡占多少。',
    { term: 'upnl' }));
  const mine = ctx.h && first ? retSince(ctx.h, first) : null;
  const twEq = r && ['broad', 'div', 'theme', 'active'].includes(r.k);   // 台股股票型才拿 0050 比
  if (twEq) {
    const mkt = ctx.h0050 && first ? retSince(ctx.h0050, first) : null;
    const lag = isNum(mine) && isNum(mkt) ? mine - mkt : null;
    out.push(step('是大盤拖累，還是它自己',
      isNum(mine) && isNum(mkt) ? `從你第一筆買進到現在（含息）：這檔 <b class="num ${mine < 0 ? 'down' : 'up'}">${pc(mine)}</b>、0050 <b class="num ${mkt < 0 ? 'down' : 'up'}">${pc(mkt)}</b>，差 <b class="num">${pc(lag)}</b>。${lag <= -COACH.lagMkt ? '比大盤差很多：主要是這檔（或這一類）自己的問題。' : lag >= COACH.lagMkt ? '比大盤好：虧損主要來自大盤。' : '和大盤差不多：主要是整個市場的波動。'}` : '歷史資料還沒載入，或沒有買進日期，沒辦法比。',
      isNum(lag) && lag <= -COACH.lagMkt ? 'warn' : 'info',
      '大盤一起跌，通常是整個市場的事；它自己跌得特別多，才要回頭看你當初買它的理由還在不在。',
      '把「整個市場在跌」當成「我選錯了」，或反過來。',
      { term: 'r1y' }));
  } else {
    const what = r && r.k === 'bond' ? '美國公債的殖利率（利率升，債券價格就跌）' : r && r.k === 'overseas' ? '國外股市和匯率' : '它追蹤的指數或商品';
    out.push(step('它跟著什麼在跌',
      `${r ? `${esc(x.name)} 是${esc(catName(r.k))}，` : ''}漲跌主要跟著${what}，不是台股大盤，拿 0050 比沒有意義。${isNum(mine) ? `從你第一筆買進到現在（含息）<b class="num ${mine < 0 ? 'down' : 'up'}">${pc(mine)}</b>。` : ''}`,
      'info',
      '先弄清楚它在追蹤什麼，再看是不是那個東西本身在跌；這比看帳面數字重要。',
      '把債券 ETF、海外 ETF 當成台股在看，用台股的新聞判斷它。',
      { lesson: r && r.k === 'bond' ? 'b-bond' : null, case: r && r.k === 'bond' ? 'bondrate' : null, term: r && r.k === 'bond' ? 'bond' : 'r1y' }));
  }
  out.push(step('規則怎麼說',
    r ? `規則觀點「${({ 1: '偏多', 0: '中性', '-1': '偏空' })[String(r.st)] || '資料不足'}」、部位訊號「${PS_T[r.ps] || '—'}」${isNum(r.dl) ? `；移動防守線 <b class="num">${n2(r.dl)}</b>，現價 <b class="num">${n2(x.px)}</b>（${x.px < r.dl ? '已經跌破' : '還在上面'}）` : ''}。` : '這檔沒有規則資料。',
    r && (r.ps === 'trim' || (isNum(r.dl) && x.px < r.dl)) ? 'warn' : 'ok',
    '防守線和規則，是事先決定好的認錯點；有沒有跌破，比你現在的感覺可靠。',
    '一直把出場線往下移，最後就沒有出場線了。',
    { lesson: 'r-dl', term: 'dl' }));
  let costTxt = '';
  if (r && isNum(x.px) && x.h && x.h.sh > 0) {
    const c = PF.tradeCost('sell', x.h.sh, x.px, PF.taxCat(r), ctx.today, ctx.fee);
    costTxt = `停損：全部賣出約付手續費＋證交稅 ${ctx.privacy ? `（約占 ${((c.fee + c.tax) / (x.h.sh * x.px) * 100).toFixed(2)}%）` : `<b class="num">${money(c.fee + c.tax)}</b> 元`}，把虧損變成已實現。`;
  }
  const cap = r ? PF.capOf(ctx.risk, r.k) : null;
  out.push(step('三種做法的代價',
    `${costTxt}<br>攤平：再買會讓這檔的比重變更大（現在 ${pu(x.w, 1)}，上限 ${pu(cap)}）。<br>續抱：現在沒有成本，但要先寫好出場線。`,
    'info',
    '三種都可以是對的，關鍵是理由：停損是因為理由不在了；攤平是因為理由還在、比重還沒到上限；續抱要有出場線。',
    '「等回本再賣」：你的成本是多少，不會影響它之後的漲跌。',
    { term: 'be' }));
  out.push(step('最後一個問題',
    '如果現在手上是現金、沒有這檔，你會用現在的價格買它嗎？',
    'info',
    '會：虧損是過去的事，續抱或加碼照你的紀律走。不會：代表當初買它的理由可能已經不在了——接下來怎麼做，交給副官用你的出場線和比重上限檢查，不要因為「已經虧了」就一直拖著不決定。',
    '因為已經虧了而捨不得賣（沉沒成本）。',
    {}));
  return out;
}

const BUILD = { crash, rally, news, div, hot, loss };
/** 某一個情境的全部步驟（純函式：給同樣的 ctx，算出同樣的結果） */
export function buildPlay(id, ctx) {
  const f = BUILD[id];
  if (!f) return [];
  try { return f(ctx).filter(Boolean); } catch (e) { return [step('這一步算不出來', '資料不完整，先跳過。', 'info', '', '')]; }
}
/** 小結：幾個綠燈、幾個要小心 */
export function summarize(steps) {
  const n = (l) => steps.filter((s) => s.lvl === l).length;
  return { ok: n('ok'), info: n('info'), warn: n('warn'), stop: n('stop'), total: steps.length };
}

// ------------------------------------------------------------------ 設定頁：教練怎麼判斷（照常數產生）
export function coachRulesHTML() {
  return `<ul class="rules-list">
    <li>大跌的比較：今天加權指數跌幾 %，就拿 0050 歷史上「單日至少跌 ${COACH.dropBins.map((b) => Math.abs(b)).join('／')}%」裡最接近的那一組，看之後 ${COACH.horizon} 個交易日的含息報酬分布，和「任何一天」並列。</li>
    <li>漲多的比較：近 20 個交易日（含息）漲 ${COACH.gainBins.join('／')}% 以上，一樣看之後 ${COACH.horizon} 個交易日、和任何一天並列。</li>
    <li>現金低於總資產 ${pu(COACH.lowCash)} 算「沒有子彈」；比大盤（0050 含息）多跌 ${COACH.lagMkt} 個百分點以上，算「它自己的問題」。</li>
    <li>上市未滿 ${COACH.newDays} 天算新 ETF；受益人數一年內變成 ${COACH.hotHolders} 倍以上算人潮湧入。</li>
    <li>新聞：標題有「預估、可能、恐、傳出…」偏預測，有「公告、宣布、通過、收盤…」偏事實；關鍵字對應到相關的 ETF 類別（利率→債券，半導體→市值型與科技，配息→高股息，海外市場→海外股票，原物料→期貨）。</li>
    <li>教練不替你決定買賣；看完可以把想法交給副官檢查、記進決策日記，${AIDE.lockHM ? '照樣在定案後' : ''} 20 個交易日後對答案。</li>
  </ul>`;
}

// ================================================================== 畫面
let seq = 0;
const IC = {
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5l6 7 4-4 8 9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 17h6v-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 19l6-7 4 4 8-9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 7h6v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  news: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h11l5 5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 11h8M8 15h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="15" r="2" fill="currentColor"/></svg>',
  fire: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.4 1.2-3.9 2.4-5 .2 1.6 1 2.6 2 3 0-2.8.1-5.4.6-8z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  loss: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 12h8" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
};
const LV = { ok: '穩', info: '看', warn: '慎', stop: '停' };

/** 副官分頁的入口：六種狀況（大盤大波動的日子，對應的那一格會亮） */
export function coachStripHTML() {
  const m = taiexNow();
  const bigDay = m && isNum(m.pc) && Math.abs(m.pc) >= AIDE.bigMarket;
  return `<div class="sec-h"><h2>判斷教練</h2><span class="aside">還沒有想法？選一種狀況</span></div>
    <section class="panel coach-strip" aria-label="判斷教練">${PLAYS.map((p) => {
      const now = bigDay && ((p.id === 'crash' && m.pc < 0) || (p.id === 'rally' && m.pc > 0));
      return `<button class="cs-b${now ? ' now' : ''}" data-coach="${p.id}"><span class="co-ic">${IC[p.icon]}</span><span><b>${esc(p.t)}</b><small>${now ? `${esc(dayWord(m.d))} ${pc(m.pc, 2)}` : esc(p.sub)}</small></span></button>`;
    }).join('')}</section>`;
}
export function bindCoachStrip(root) {
  $$('[data-coach]', root).forEach((b) => b.addEventListener('click', () => openCoach(b.dataset.coach)));
}
export function openCoach(id = null, push = true, o = {}) {
  if (S.openCode !== '__coach') FX.cue('open');
  S.openCode = '__coach';
  S.coachId = id && playById(id) ? id : null;
  if (push && location.hash !== '#coach') history.pushState({ tool: 'coach' }, '', '#coach');
  const sh = $('#sheet');
  sh.hidden = false;
  document.body.classList.add('locked');
  sh.scrollTop = 0;
  if (S.coachId) drawPlay(S.coachId, o); else drawList();
}
function topBar(title, sub, back) {
  return `<div class="sheet-top${back ? ' wrap' : ''}"><button class="icon-btn" id="back" aria-label="${back ? '回情境清單' : '返回'}">${ICON.back}</button><span class="ttl"><b class="ttl-b">${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</span></div>`;
}
function drawList() {
  const sh = $('#sheet');
  const m = taiexNow();
  const bigDay = m && isNum(m.pc) && Math.abs(m.pc) >= AIDE.bigMarket;
  sh.innerHTML = topBar('判斷教練', '遇到狀況，一步一步看') + `<div class="sheet-body tool coach">
    <section class="co-hero">
      <div class="co-ring" aria-hidden="true"><i></i><i></i><i></i><b>教練</b></div>
      <div><h2>還沒有想法？選一種狀況。</h2><p>教練用固定規則帶你看該看什麼、怎麼讀、哪裡是陷阱；每一步的數字都是 App 裡的官方資料。看完再把想法交給副官檢查、記進決策日記。</p></div>
    </section>
    <div class="co-grid">${PLAYS.map((p) => `<button class="co-pb${bigDay && ((p.id === 'crash' && m.pc < 0) || (p.id === 'rally' && m.pc > 0)) ? ' now' : ''}" data-play="${p.id}"><span class="co-ic">${IC[p.icon]}</span><b>${esc(p.t)}</b><span>${esc(p.sub)}</span>${bigDay && ((p.id === 'crash' && m.pc < 0) || (p.id === 'rally' && m.pc > 0)) ? `<em class="num">${esc(dayWord(m.d))} ${pc(m.pc, 2)}</em>` : ''}</button>`).join('')}</div>
    <p class="disclaim">教練不連 AI、不替你決定買賣；歷史統計一律和「任何一天」並列，過去的結果不代表未來。判斷門檻在設定頁「判斷教練怎麼判斷」。</p>
  </div>`;
  $('#back', sh).addEventListener('click', () => closeDetail());
  $$('[data-play]', sh).forEach((b) => b.addEventListener('click', () => { FX.sfx('tap'); S.coachId = b.dataset.play; sh.scrollTop = 0; drawPlay(S.coachId); }));
}

/** 這個情境要先選什麼：ETF、新聞、除息、熱門、虧損的那一檔 */
function candidates(P0, kind) {
  const rows = S.summary ? S.summary.etfs : [];
  const held = S.P ? S.P.holdings.filter((x) => x.mv > 0) : [];
  const watch = (settings.watch || []).map((c) => S.rows.get(c)).filter(Boolean);
  const uniq = (xs) => { const seen = new Set(); return xs.filter((r) => r && !seen.has(r.c) && seen.add(r.c)); };
  if (kind === 'etf') {
    const gain = rows.filter((r) => isNum(quote(r).pc)).sort((a, b) => quote(b).pc - quote(a).pc).slice(0, 4);
    return uniq([...held.map((x) => x.row), ...watch, ...gain]).slice(0, 12).map((r) => ({ c: r.c, t: r.n, s: `${pc(quote(r).pc, 2)}` }));
  }
  if (kind === 'div') {
    const td = today();
    const up = ((S.news && S.news.divs) || []).filter((x) => x.d >= td);
    const mineD = held.filter((x) => x.row && x.row.dv && x.row.dv.d >= td).map((x) => ({ c: x.code, n: x.name, d: x.row.dv.d, cash: x.row.dv.cash }));
    const seen = new Set();
    return [...mineD, ...up].filter((x) => !seen.has(x.c) && seen.add(x.c)).slice(0, 14).map((x) => ({ c: x.c, t: x.n, s: `${md(x.d)}${isNum(x.cash) ? `・${+x.cash.toFixed(3)} 元` : '・待公告'}`, dv: { d: x.d, cash: isNum(x.cash) ? x.cash : null } }));
  }
  if (kind === 'hot') {
    const td = today();
    const young = rows.filter((r) => r.since && dayDiff(r.since, td) < COACH.newDays && isNum(r.aum)).sort((a, b) => b.aum - a.aum).slice(0, 6);
    const premHi = rows.filter((r) => { const q = quote(r); return isNum(q.prem) && q.prem > premBand(r)[0] && isNum(r.val) && r.val > 1e8; }).sort((a, b) => quote(b).prem - quote(a).prem).slice(0, 4);
    return uniq([...young, ...premHi]).slice(0, 10).map((r) => ({ c: r.c, t: r.n, s: r.since && dayDiff(r.since, td) < COACH.newDays ? `${fmt.dy(r.since)} 上市` : `溢價 ${quote(r).prem.toFixed(2)}%` }));
  }
  if (kind === 'loss') {
    return held.filter((x) => isNum(x.pct) && x.pct < 0).sort((a, b) => a.pct - b.pct).map((x) => ({ c: x.code, t: x.name, s: pr(x.pct) }));
  }
  return [];
}
/** 持股的受益人數，一年前 vs 現在（etf/{代號}.json 的 hd 歷史；沒有就 null） */
async function holdersTrend(code) {
  try {
    const d = await getJSON(`etf/${code}.json`);
    const H = d && (d.holders || d.hdh);
    if (!Array.isArray(H) || H.length < 2) return null;
    const last = H[H.length - 1];
    const cut = last[0] - 10000;   // 一年前（同一天）
    // 要有一年前或更早的紀錄才比；紀錄還不到一年就不比（不然會把「上週」當成「一年前」）
    const old = H.filter((x) => x[0] <= cut).pop();
    return old && old[1] > 0 ? { prev: old[1], now: last[1], x: last[1] / old[1] } : null;
  } catch { return null; }
}
export const hooks = { idea: null, xray: null, lesson: null, kase: null, term: null, ask: null };

async function drawPlay(id, o = {}) {
  const Pb = playById(id);
  if (!Pb) { drawList(); return; }
  const my = ++seq;
  const sh = $('#sheet');
  const pickKind = Pb.pick;
  let pick = o.pick || null;
  sh.innerHTML = topBar(Pb.t, '判斷教練', true) + `<div class="sheet-body tool coach play"><div class="skeleton" style="height:120px"></div><div class="skeleton" style="height:260px"></div></div>`;
  $('#back', sh).addEventListener('click', () => { seq++; S.coachId = null; sh.scrollTop = 0; drawList(); });
  await ensureNews();   // 大跌要看官方公告、新聞與除息要選項目（5 分鐘內抓過就不再抓；沒有新聞也能用）
  if (S.openCode !== '__coach' || my !== seq) return;
  const body = $('.sheet-body', sh);
  if (pickKind && !pick) {
    let opts = [];
    if (pickKind === 'news') opts = ((S.news && S.news.items) || []).filter((x) => x.kind === 'official' || x.kind === 'fact').slice(0, 10).map((x, i) => ({ c: 'n' + i, t: x.t, s: `${srcName(x.src)}・${md(x.d)}`, item: x }));
    else opts = candidates(S.P, pickKind);
    const extra = pickKind === 'news' ? '<button class="co-opt ext" data-opt="ext"><b>在別的地方看到的</b><span>不在冷眼的清單上（群組、社群、其他媒體）</span></button>' : '';
    const ph = { etf: '想追的是哪一檔？', news: '是哪一則新聞？', div: '是哪一檔要除息？', hot: '是哪一檔？', loss: '是哪一檔在虧？' }[pickKind];
    body.innerHTML = `<section class="co-pick"><h2>${ph}</h2>
      ${opts.length || extra ? `<div class="co-opts">${opts.map((x, i) => `<button class="co-opt" data-opt="${i}"><b>${esc(x.t)}</b><span class="num">${esc(x.s || '')}</span></button>`).join('')}${extra}</div>` : `<p class="muted">${pickKind === 'loss' ? '你記的持股目前沒有一檔在虧損。這是好事；想先練習的話，可以從其他情境開始。' : '目前沒有可以選的項目。'}</p>`}
      ${['etf', 'hot', 'div'].includes(pickKind) ? `<label class="co-search"><span>${ICON.search}</span><input class="input" id="co-q" placeholder="或輸入代號、名稱，例如 0050" autocomplete="off" inputmode="search"></label><div class="co-res" id="co-res"></div>` : ''}
    </section>`;
    $$('[data-opt]', body).forEach((b) => b.addEventListener('click', () => {
      FX.sfx('tap');
      const k = b.dataset.opt;
      if (k === 'ext') pick = { ext: true };
      else pick = opts[+k];
      drawPlay(id, { pick });
    }));
    const qi = $('#co-q', body);
    if (qi) {
      qi.addEventListener('input', () => {
        const s = qi.value.trim().toUpperCase();
        const res = $('#co-res', body);
        if (!s) { res.innerHTML = ''; return; }
        const hit = (S.summary ? S.summary.etfs : []).filter((r) => r.c.includes(s) || r.n.toUpperCase().includes(s)).slice(0, 6);
        res.innerHTML = hit.map((r) => `<button class="co-opt" data-c="${esc(r.c)}"><b>${esc(r.n)}</b><span class="num">${esc(r.c)}</span></button>`).join('') || '<p class="muted small">找不到</p>';
        $$('[data-c]', res).forEach((b) => b.addEventListener('click', () => { FX.sfx('tap'); const r = S.rows.get(b.dataset.c); drawPlay(id, { pick: { c: r.c, t: r.n, dv: r.dv || null } }); }));
      });
    }
    return;
  }
  // 準備資料
  const ctx = {
    today: today(), mkt: taiexNow(), P: S.P, rows: S.rows, quote, news: (S.news && S.news.items) || [], privacy: settings.privacy,
    risk: settings.risk, fee: settings.fee, watch: settings.watch || [], adv: adviceFor,
  };
  const need = ['0050'];
  if (pick && pick.c && !pick.item && pickKind !== 'news') need.push(pick.c);
  const hs = {};
  await Promise.all([...new Set(need)].map(async (c) => { hs[c] = await ensureHist(c).catch(() => null); }));
  if (S.openCode !== '__coach' || my !== seq) return;
  ctx.h0050 = hs['0050'] || null;
  if (pick && pick.c && pickKind !== 'news') {
    ctx.row = S.rows.get(pick.c) || null;
    ctx.h = hs[pick.c] || null;
    ctx.dv = pick.dv || null;
    ctx.held = S.P ? S.P.holdings.find((x) => x.code === pick.c) || null : null;
    if (ctx.held) ctx.firstBuy = firstBuyOf(pick.c);
  }
  if (pickKind === 'news') ctx.item = pick && pick.ext ? { ext: true } : pick ? pick.item : null;
  if (pickKind === 'hot' && ctx.row) ctx.holders = await holdersTrend(ctx.row.c);
  if (hooks.xray && (pickKind === 'rally' || pickKind === 'hot' || pickKind === 'news' || pickKind === 'etf')) {
    try {
      const xr = await hooks.xray(ctx.row ? ctx.row.c : null);
      if (xr) { ctx.overlap = xr.overlap || ''; ctx.overlapWarn = !!xr.warn; ctx.xrayNames = xr.names || null; }
    } catch { /* 沒有成分股資料就跳過 */ }
  }
  if (S.openCode !== '__coach' || my !== seq) return;
  const steps = buildPlay(id, ctx);
  const sm = summarize(steps);
  const subject = subjectOf(ctx);
  const nextBtns = nextOf(id, ctx);
  body.innerHTML = `${subject ? `<div class="co-subj"><span>情境</span><b>${esc(subject)}</b>${pickKind ? '<button class="link small" id="co-repick">換一個</button>' : ''}</div>` : ''}
    <div class="co-rail" aria-hidden="true">${steps.map((s, k) => `<i class="lv-${s.lvl}" style="--i:${k}"></i>`).join('')}</div>
    <ol class="co-steps">${steps.map((s, k) => stepHTML(s, k)).join('')}</ol>
    <section class="co-end panel" aria-label="教練小結">
      <div class="co-end-h"><span class="co-seal num">${sm.total}</span><div><b>教練小結</b><span class="num">要小心 ${sm.warn}・照常 ${sm.ok}・要看懂 ${sm.info}</span></div></div>
      <p>${sm.warn ? `有 <b class="num">${sm.warn}</b> 個地方要小心，想清楚再決定。` : '沒有特別要小心的地方。'}教練不替你決定；想好了，把想法交給副官用你的紀律檢查一次。</p>
      <div class="row-btns">${nextBtns.map((b, i) => `<button class="btn${i === 0 ? ' primary' : ''}" data-next="${i}">${b.icon || ''}${esc(b.t)}</button>`).join('')}${FX.hasVoice() ? `<button class="btn ghost" id="co-say">${ICON.speaker}念給我聽</button>` : ''}</div>
    </section>`;
  const rp = $('#co-repick', body);
  if (rp) rp.addEventListener('click', () => { FX.sfx('tap'); drawPlay(id); });
  $$('[data-next]', body).forEach((b) => b.addEventListener('click', () => { const n = nextBtns[+b.dataset.next]; if (n && n.go) n.go(); }));
  bindLinks(body);
  const say = $('#co-say', body);
  if (say) say.addEventListener('click', () => {
    if (FX.isSpeaking()) { FX.stopSpeak(); return; }
    FX.sfx('comms');
    FX.speak(speechOf(Pb, subject, steps, sm), { force: true });
  });
  revealSteps(body, steps);
}
/** 這一檔第一筆有日期的買進（現在顯示的那一本帳） */
const subjectOf = (ctx) => (ctx.row ? `${ctx.row.n}（${ctx.row.c}）` : ctx.item && !ctx.item.ext ? ctx.item.t : ctx.item && ctx.item.ext ? '在別的地方看到的新聞' : '');
function firstBuyOf(code) {
  const ds = (book.lots || []).filter((l) => l.c === code && l.side === 'buy' && l.d).map((l) => l.d).sort((a, b) => a - b);
  return ds[0] || null;
}
function stepHTML(s, k) {
  const L = s.links || {};
  const rel = [
    L.lesson ? `<button type="button" class="ls-rel" data-co-lesson="${esc(L.lesson)}">今日一課</button>` : '',
    L.case ? `<button type="button" class="ls-rel case" data-co-case="${esc(L.case)}">看案例</button>` : '',
    L.term ? `<button type="button" class="ls-rel" data-co-term="${esc(L.term)}">名詞</button>` : '',
  ].join('');
  const src = (L.src || []).map((x) => `<a href="${esc(x.u)}" target="_blank" rel="noopener">${ICON.ext}${esc(x.n)}</a>`).join('');
  return `<li class="co-st lv-${s.lvl}" style="--i:${k}">
    <div class="co-n num" aria-hidden="true">${String(k + 1).padStart(2, '0')}</div>
    <div class="co-card">
      <div class="co-h"><span class="co-lt" title="${LV[s.lvl]}">${LV[s.lvl]}</span><h3>${esc(s.t)}</h3></div>
      <div class="co-v">${s.v}</div>
      ${s.how ? `<p class="co-how"><b>怎麼看</b>${esc(s.how)}</p>` : ''}
      ${s.trap ? `<p class="co-trap"><b>陷阱</b>${esc(s.trap)}</p>` : ''}
      ${rel || src ? `<div class="co-links">${rel}${src ? `<span class="co-src">${src}</span>` : ''}</div>` : ''}
    </div></li>`;
}
function bindLinks(root) {
  $$('[data-co-lesson]', root).forEach((b) => b.addEventListener('click', () => hooks.lesson && hooks.lesson(b.dataset.coLesson)));
  $$('[data-co-case]', root).forEach((b) => b.addEventListener('click', () => hooks.kase && hooks.kase(b.dataset.coCase)));
  $$('[data-co-term]', root).forEach((b) => b.addEventListener('click', () => hooks.term && hooks.term(b.dataset.coTerm)));
}
function revealSteps(body, steps) {
  const lis = $$('.co-st', body);
  const rails = $$('.co-rail i', body);
  if (!FX.fxOn()) { lis.forEach((li) => li.classList.add('on')); rails.forEach((r) => r.classList.add('on')); return; }
  FX.sfx('scan');
  FX.haptic('lock');
  lis.forEach((li, k) => setTimeout(() => {
    li.classList.add('on');
    if (rails[k]) rails[k].classList.add('on');
    const l = steps[k].lvl;
    FX.sfx(l === 'warn' ? 'warn' : l === 'stop' ? 'stop' : 'good');
  }, 260 + k * 230));
  setTimeout(() => {
    const end = $('.co-end', body);
    if (end) end.classList.add('on');
    const sm = summarize(steps);
    FX.cue(sm.warn ? 'warn' : 'ok');
  }, 360 + lis.length * 230);
}
function nextOf(id, ctx) {
  const go = (o) => () => { if (hooks.idea) hooks.idea(o); };
  const c = ctx.row ? ctx.row.c : ctx.held ? ctx.held.code : null;
  const B = [];
  if (id === 'crash') {
    B.push({ t: '我想趁跌加碼', icon: ICON.aide, go: go({ stance: 'bull' }) });
    B.push({ t: '我想先減碼', go: go({ stance: 'bear' }) });
    B.push({ t: '先觀望', go: go({ stance: 'wait' }) });
  } else if (id === 'rally' || id === 'hot') {
    B.push({ t: '交給副官檢查', icon: ICON.aide, go: go({ stance: 'bull', code: c }) });
    B.push({ t: '先觀望', go: go({ stance: 'wait', code: c }) });
  } else if (id === 'news') {
    B.push({ t: '交給副官檢查', icon: ICON.aide, go: go({ tags: ['news'] }) });
  } else if (id === 'div') {
    B.push({ t: '交給副官檢查', icon: ICON.aide, go: go({ stance: 'bull', code: c, tags: ['yield'] }) });
  } else if (id === 'loss') {
    B.push({ t: '我想停損／減碼', icon: ICON.aide, go: go({ stance: 'bear', code: c }) });
    B.push({ t: '我想續抱', go: go({ stance: 'wait', code: c }) });
    B.push({ t: '我想攤平', go: go({ stance: 'bull', code: c }) });
  }
  if (hooks.ask) B.push({ t: '帶去問 Claude', icon: ICON.comms, go: () => hooks.ask(id, ctx, subjectOf(ctx)) });
  return B;
}
function speechOf(Pb, subject, steps, sm) {
  const strip = (h) => plainText(h, '。');
  return `判斷教練，${Pb.t}。${subject ? `${subject}。` : ''}${steps.map((s, i) => `第${i + 1}步，${s.t}。${strip(s.v)}`).join('')}小結：要小心的地方有${sm.warn}個。教練不替你決定，想好了交給副官檢查。`;
}
/** 帶去問 Claude 的內容：amt＝false 時用隱藏金額的方式重算（持股只寫比例） */
export function coachPacket(id, ctx, subject, amt) {
  const Pb = playById(id);
  const strip = (h) => plainText(h, '；');
  const steps = buildPlay(id, { ...ctx, privacy: ctx.privacy || !amt });
  return { title: Pb ? Pb.t : '', subject, lines: steps.map((s, i) => `${i + 1}. ${s.t}（${LV[s.lvl]}）：${strip(s.v)}`) };
}
