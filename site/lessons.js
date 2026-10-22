/* 冷眼 — 今日一課：帶著 PZ 成長的固定課程。
   內容全部是固定文字（不連 AI），每一課附官方出處；「現在的例子」用今天的真實數字舉例。
   三類：基礎觀念（basic）、陷阱提醒（trap）、看盤判斷（read）。每天照日期輪一課（從 2026/10/22 起算，三類輪流），
   可以往前翻、看全部課程；上過的課記在這支手機（coldeye.lessons），不上傳。
   新增一課：加進 LESSONS 就好（id 不要改，上過的紀錄跟著 id）；每一課一定要有 src（官方來源）。 */
import { $, $$, esc, isNum, S, settings, store, fmt, quote, premBand, today, journal, ICON } from './core.js';
import { openModal, closeModal } from './forms.js';
import { openTerm } from './learn.js';
import { openCase, CASES } from './cases.js';
import * as FX from './fx.js';

export const LESSON_CATS = { basic: '基礎觀念', trap: '陷阱提醒', read: '看盤判斷' };
const EPOCH = 20261022;   // 第一課的日期

// ------------------------------------------------------------------ 官方出處（只放一手來源）
const SRC = {
  trading: { n: '證交所：集中市場交易制度介紹', u: 'https://www.twse.com.tw/zh/products/system/trading.html' },
  etf: { n: '證交所：ETF 總覽與一般投資風險', u: 'https://www.twse.com.tw/zh/products/securities/etf/overview/introduction.html' },
  li: { n: '證交所：槓桿型及反向型 ETF', u: 'https://www.twse.com.tw/zh/ETF/li' },
  etfQA: { n: '證交所：ETF 為什麼會下市（Q&A）', u: 'https://www.twse.com.tw/downloads/zh/ETF/ETFQA.pdf' },
  nav: { n: '證交所：ETF 盤中預估淨值與折溢價', u: 'https://mis.twse.com.tw/stock/etf_nav.jsp?ex=tse' },
  dayTrade: { n: '證交所：當日沖銷交易專區', u: 'https://www.twse.com.tw/zh/products/system/day-trading.html' },
  relax: { n: '證交所：放寬漲跌幅度專區', u: 'https://www.twse.com.tw/zh/products/system/relax-range.html' },
  punish: { n: '證交所：注意、處置股票公告', u: 'https://www.twse.com.tw/zh/announcement/punish.html' },
  punishRule: { n: '證交所：注意交易資訊暨處置作業要點', u: 'https://twse-regulation.twse.com.tw/m/LawContent.aspx?FID=FL007225' },
  divPre: { n: '證交所：除權除息預告表', u: 'https://www.twse.com.tw/zh/announced/exright/twt48u.html' },
  index: { n: '證交所：市場成交資訊（加權指數）', u: 'https://www.twse.com.tw/zh/trading/historical/fmtqik.html' },
  flows: { n: '證交所：三大法人買賣超日報', u: 'https://www.twse.com.tw/zh/trading/foreign/t86.html' },
  margin: { n: '證交所：融資融券餘額', u: 'https://www.twse.com.tw/zh/trading/margin/mi-margn.html' },
  guide: { n: '證交所：臺灣投資指南（交易成本）', u: 'https://www.twse.com.tw/zh/about/company/guide.html' },
  news: { n: '證交所：最新消息', u: 'https://www.twse.com.tw/zh/about/news/news/list.html' },
  tdcc: { n: '集保結算所：集保戶股權分散表', u: 'https://www.tdcc.com.tw/portal/zh/smWeb/qryStock' },
  tax: { n: '證券交易稅條例（全國法規資料庫）', u: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=G0340078' },
  tax21: { n: '證券交易稅條例第 2-1 條（債券 ETF 停徵）', u: 'https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=G0340078&flno=2-1' },
  nhiDiv: { n: '健保署：股利所得補充保險費實例', u: 'https://www.nhi.gov.tw/ch/cp-2512-4c478-3151-1.html' },
  nhiLimit: { n: '健保署：補充保險費的上、下限', u: 'https://www.nhi.gov.tw/ch/cp-2855-c7fc6-3150-1.html' },
  cathay: { n: '國泰證券：定期定額說明', u: 'https://istockapp.cathaysec.com.tw/Marketing/DCA/' },
  ust: { n: '美國財政部：公債殖利率', u: 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve' },
  cbc: { n: '中央銀行：新聞稿', u: 'https://www.cbc.gov.tw/tw/lp-302-1.html' },
  fsc: { n: '金管會：新聞稿', u: 'https://www.fsc.gov.tw/ch/home.jsp?id=96&parentpath=0,2' },
};

// ------------------------------------------------------------------ 舉例用的小工具
const rowsAll = () => (S.summary ? S.summary.etfs : []);
const mine = () => {
  const held = S.P ? S.P.holdings.map((x) => x.code) : [];
  return [...new Set([...held, ...(settings.watch || [])])].map((c) => S.rows.get(c)).filter(Boolean);
};
const pct = (x, d = 1) => (isNum(x) ? `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(d)}%` : '—');
const r2 = (x) => (isNum(x) ? x.toFixed(2) : '—');
const premOf = (r) => { const q = quote(r); return isNum(q.prem) ? q.prem : null; };
const nameOf = (c) => { const r = S.rows.get(c); return r ? r.n : c; };

// ------------------------------------------------------------------ 課程
export const LESSONS = [
  // ============================================================ 基礎觀念
  {
    id: 'b-nav', k: 'basic', t: '一檔 ETF 有兩個價格：市價和淨值',
    hook: '市價是大家喊出來的，淨值是裡面的東西真的值多少。兩個差太多，就是折溢價。',
    b: [
      'ETF 裡面裝著一籃子股票或債券。把裡面的東西照現在的價格算出總值、除以單位數，就是「淨值」：每一單位真的值多少錢。投信每天收盤後算一次並公告。',
      '你在券商 App 看到的價格是「市價」，是買賣雙方撮合出來的。買的人多，市價就會被喊得比淨值高（溢價）；賣的人多就低於淨值（折價）。',
      '盤中投信會用成分股的即時價格算「預估淨值」，證交所網站大約每 15 秒更新一次。冷眼的折溢價就是拿它算的；收盤後再換成真正的淨值。',
      '台股 ETF 的淨值很好估，溢價超過 0.5% 冷眼就警戒；海外、債券、期貨型的淨值比較難即時估，放寬到 1%。',
    ],
    ex: () => {
      const rs = mine().map((r) => [r, premOf(r)]).filter(([, p]) => isNum(p)).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
      if (!rs.length) return '';
      const [r, p] = rs[0];
      return `你關注的 ETF 裡，${r.n} 現在${p >= 0 ? '溢價' : '折價'}最大：${Math.abs(p).toFixed(2)}%（警戒線 ${premBand(r)[0]}%）。`;
    },
    src: [SRC.etf, SRC.nav], terms: ['prem', 'nav'],
  },
  {
    id: 'b-exdiv', k: 'basic', t: '除息不是白賺：配息那天，股價會先扣掉配息',
    hook: '配 1 元，除息日股價就先少 1 元；之後漲回來（填息）才算真的賺到。',
    b: [
      '除息日那天開盤，交易所會把前一天的收盤價減掉配息金額，當成新的參考價。所以配 1 元、股價少 1 元，你的總資產在那一刻沒有變多，只是從「股價」搬到「現金」。',
      '要股價再漲回除息前的價格（填息），這筆配息才是真的賺到。填息可能幾天、幾個月，也可能一直填不回來。',
      '誰領得到：除息日的前一個交易日（含）以前買進、而且除息日前沒賣掉。除息日當天買的領不到。錢通常在除息後約 3～5 週入帳。',
      '健保的補充保費：單次配息（屬於股利、利息的部分）達 2 萬元，整筆扣 2.11%。單次不到 2 萬元免扣，所以同一檔分很多次配、每次不到 2 萬，就不會被扣。',
    ],
    ex: () => {
      const rs = mine().filter((r) => r.dv && r.dv.d >= today()).sort((a, b) => a.dv.d - b.dv.d);
      if (!rs.length) return '';
      const r = rs[0];
      return `${r.n} ${fmt.dy(r.dv.d)} 除息${r.dv.cash ? `，每單位 ${r.dv.cash} 元：那天的參考價會比前一天收盤少 ${r.dv.cash} 元` : '，金額還沒公告'}。要領到，最晚要在 ${fmt.dy(r.dv.d)} 的前一個交易日買進。`;
    },
    src: [SRC.divPre, SRC.nhiDiv, SRC.nhiLimit], terms: ['div', 'annual'], cases: ['divfill'],
  },
  {
    id: 'b-yield', k: 'basic', t: '殖利率是「過去一年配了多少 ÷ 現在的價格」',
    hook: '殖利率高有三種可能：配得多、價格跌了、或配的是你自己的本金。',
    b: [
      '冷眼的殖利率＝近 12 個月的配息加總 ÷ 現價。它只告訴你「照過去的配法，現在買進一年大概領多少」，不保證之後也配這麼多。',
      '殖利率突然變高，先看是分子變大（真的配比較多）還是分母變小（價格跌了）。價格跌出來的高殖利率，常常不是好消息。',
      '高股息 ETF 的配息來源有三種：成分股的股利、賣股票賺的價差、還有「收益平準金」（新進來的錢先放著用來維持配息水準）。後兩種配的其實是淨值裡原本就有的錢。',
      '所以比較 ETF 要看「含息總報酬」：價差加配息一起算。殖利率 8% 但含息報酬 −5%，等於一邊領息一邊賠本金。',
    ],
    ex: () => {
      const rs = rowsAll().filter((r) => isNum(r.y) && isNum(r.r1y)).sort((a, b) => b.y - a.y);
      if (!rs.length) return '';
      const r = rs[0], b = S.rows.get('0050');
      return `全市場殖利率最高的是 ${r.n}：${r.y.toFixed(2)}%，近一年含息報酬 ${pct(r.r1y)}${b && isNum(b.r1y) ? `；同期 0050 殖利率 ${r2(b.y)}%、含息報酬 ${pct(b.r1y)}` : ''}。`;
    },
    src: [SRC.etf, SRC.fsc], terms: ['y', 'r1y'], cases: ['hidiv'],
  },
  {
    id: 'b-tr', k: 'basic', t: '含息總報酬與「還原權息價」：比較 ETF 的唯一公平方法',
    hook: '把配息當成當天買回去、分割照倍數換算，才能把高配息和不配息的 ETF 放在同一把尺上。',
    b: [
      '只看股價，高股息 ETF 每次除息都會「掉一截」，看起來永遠漲不動；不配息的 ETF 則一路往上。這樣比是不公平的。',
      '「還原權息價」是把每一次配息當成在除息日用收盤價買回同一檔，分割（例如 0050 一拆四）照倍數換算成同一個基準。這樣算出來的曲線，漲跌才真的代表你賺賠多少。',
      '冷眼裡的近一年含息報酬、對決、時光機、戰績，全部用還原權息價計算；對答案也是。所以你在不同地方看到的數字可以互相對照。',
    ],
    ex: () => {
      const a = S.rows.get('0050'), b = S.rows.get('0056');
      return a && b && isNum(a.r1y) && isNum(b.r1y) ? `近一年含息報酬：0050 ${pct(a.r1y)}、0056 ${pct(b.r1y)}（都已經把配息算回去）。` : '';
    },
    src: [SRC.etf], terms: ['r1y', 'total'], cases: ['hidiv', 'split0050'],
  },
  {
    id: 'b-fee', k: 'basic', t: '一買一賣要付多少：手續費和證交稅',
    hook: '手續費買賣各一次、證交稅只有賣的時候繳。小錢，但每一筆都會扣。',
    b: [
      '手續費：成交金額 × 0.1425%（這是主管機關訂的上限）× 券商給你的折扣，無條件捨去。整股多數券商最低收 20 元、零股最低 1 元。買和賣都要付。',
      '證交稅：賣出 ETF 時繳成交金額的 0.1%（股票是 0.3%），買進不用繳。',
      '債券 ETF 的證交稅：被動式（追蹤債券指數的）停徵到 2026 年 12 月 31 日；主動式債券 ETF（代號尾碼 D）目前照課。行政院已經提案把停徵再延長 10 年、2027 年起把主動式也納入，要等立法院三讀才算數，通過後冷眼會改。',
      '冷眼算損益時，已經把你設定的折扣、最低手續費和證交稅都扣掉了；設定頁可以改成你的券商條件。',
    ],
    ex: () => {
      const f = settings.fee || { disc: 1, min: 20, minOdd: 1 };
      const amt = 100000;
      const fee = Math.max(f.min, Math.floor(amt * 0.001425 * f.disc));
      const tax = Math.floor(amt * 0.001);
      return `照你的設定（${f.disc < 1 ? `${(f.disc * 10).toFixed(1).replace(/\.0$/, '')} 折` : '原價'}），買 10 萬元再用同樣價格賣掉：手續費 ${fee} + ${fee} 元、證交稅 ${tax} 元，一共 ${fee * 2 + tax} 元，約 ${((fee * 2 + tax) / amt * 100).toFixed(2)}%。`;
    },
    src: [SRC.guide, SRC.tax, SRC.tax21], terms: ['fee', 'tax', 'be'],
  },
  {
    id: 'b-t2', k: 'basic', t: 'T+2 交割：今天買，後天早上才扣錢',
    hook: '成交那一刻錢還在戶頭裡；第二個營業日早上扣不到錢，就是違約交割。',
    b: [
      '台股的交割是「T+2」：今天（T）成交，第二個營業日（T+2）上午（多數券商是 10 點前），券商從你的交割帳戶扣款；賣出則是那天把錢匯進來。',
      '這代表你可以先買、兩天內再把錢存進去；但也代表扣款那天餘額不夠，就是違約交割：券商會通報、留下紀錄，以後開戶和交易都可能受限，金額大的還有法律責任。',
      '只辦交割、不交易的日子（例如春節前一天）也算營業日。定期定額是券商直接扣款，不會有這個問題。',
    ],
    src: [SRC.trading],
  },
  {
    id: 'b-hours', k: 'basic', t: '一天的交易時段：09:00 開盤，13:25 之後是集合競價',
    hook: '盤中是「逐筆撮合」，最後五分鐘改成「集合競價」，13:30 一次撮出收盤價。',
    b: [
      '整股：08:30 開始收單，09:00 開盤。09:00～13:25 逐筆撮合（你的單一送進去就馬上配對）；13:25～13:30 只收單不撮合，13:30 用集合競價一次撮出收盤價。這五分鐘不收市價單。',
      '盤後定價：14:00～14:30 收單，14:30 用當天收盤價一次撮合。',
      '盤中零股：09:10 第一次撮合（證交所規劃 2026 年底前改成和整股一樣 09:00 開盤），之後每 5 秒撮合一次到 13:30，只收限價、當日有效的單。盤後零股：13:40～14:30 收單，14:30 一次撮合。',
      '冷眼盤中約每 5 分鐘更新一次價格，不是逐秒；13:30 以後的「收盤」要等證交所收盤資料送來。',
    ],
    src: [SRC.trading],
  },
  {
    id: 'b-limit', k: 'basic', t: '漲跌幅 10%，但國外成分的 ETF 沒有這條線',
    hook: '沒有漲跌幅限制的 ETF 不能下市價單，證交所規定的。',
    b: [
      '台股一天最多漲或跌 10%（以當天的參考價算）。到了這個價格就是「漲停」「跌停」，想買的人排隊也不一定買得到。',
      '成分股在國外的 ETF（美股、日股、海外債券…）沒有漲跌幅限制，因為它們跟著國外的市場走。',
      '證交所規定：沒有漲跌幅限制的有價證券不得使用市價委託，避免成交價格超出預期。所以買海外 ETF 一定要填價格。',
      'ETF 的升降單位（最小跳動價格）只有兩段：未滿 50 元每檔跳 0.01 元、50 元以上跳 0.05 元（股票分成六段，和 ETF 不同）。所以 0050 的價格一定是 0.05 的倍數，00878 可以到 0.01。',
    ],
    ex: () => { const n = rowsAll().filter((r) => r.k === 'overseas').length; return n ? `目前台股有 ${n} 檔海外股票 ETF 沒有漲跌幅限制。` : ''; },
    src: [SRC.trading, SRC.relax],
  },
  {
    id: 'b-odd', k: 'basic', t: '零股怎麼買：每 5 秒撮合一次，只能限價',
    hook: '零股的買賣價差通常比整股大一點，買之前看一下整股的價格。',
    b: [
      '一張是 1,000 股，不到一張的叫零股。盤中零股 09:10 開始（證交所規劃 2026 年底前提前到 09:00）、每 5 秒撮合一次，到 13:30；只能用限價、當日有效的委託，不能市價單，也不能當沖。',
      '盤後零股：13:40～14:30 收單，14:30 用集合競價一次撮合，成交價不一定等於收盤價。',
      '零股的買賣雙方比整股少，價差通常大一點：想馬上成交，可能要比整股的價格多出一、兩個升降單位。冷眼單檔頁的「盤中零股五檔」可以看現在差多少。',
      '定期定額買的就是零股（國泰在盤中、盤後分批買），不用自己填價格。',
    ],
    src: [SRC.trading, SRC.cathay], terms: ['dca'],
  },
  {
    id: 'b-types', k: 'basic', t: '市值型、高股息、債券、槓反：四種 ETF 四種脾氣',
    hook: '名字裡有「50」「高股息」「債」「正 2」「反 1」，背後的規則完全不同。',
    b: [
      '市值型（0050、006208…）：買市值最大的那一群公司，漲跌跟大盤差不多，配息不多。長期報酬主要來自股價。',
      '高股息（0056、00878、00919…）：用殖利率、配息紀錄等條件挑股票，配息多但成分股和大盤不一樣，漲的時候常常漲得比大盤少。',
      '債券 ETF（00679B…）：買一籃子債券，價格和利率反著走；配息穩定但 2022 年升息時也跌了兩成以上。證交稅目前停徵。',
      '槓桿型（正 2）、反向型（反 1）：追蹤指數「每天」報酬的 2 倍或 −1 倍，每天重新平衡，長期下來不會剛好是 2 倍，盤整時會磨損，證交所明白建議不適合長期持有。',
      '冷眼的「類別」就是照這個分的，同類基準、單檔上限、溢價警戒線都依類別不同。',
    ],
    ex: () => { const b = S.breadth; return b && b.n ? `今天全市場 ${b.n} 檔 ETF 的規則判讀：偏多 ${b.bull}、中性 ${b.neu}、偏空 ${b.bear}（不含反向型）。` : ''; },
    src: [SRC.etf, SRC.li], terms: ['lev', 'inv', 'bond'],
  },
  {
    id: 'b-split', k: 'basic', t: '分割：價格變 1/4、股數變 4 倍，你沒有變窮',
    hook: '0050 在 2025 年 6 月一拆四，188 元變 47 元；那幾天停止交易，定期定額也不扣。',
    b: [
      '分割只是把一單位切成好幾單位：你原本 1 張 188 元的 0050，分割後變成 4 張 47 元，總值一樣。目的是讓價格低一點、小資比較好買。',
      '分割前後有幾天會停止交易（0050 是 2025/6/11～6/17），恢復交易那天用新的價格開盤。停止交易那幾天定期定額不扣、也不補。',
      '看走勢圖要用還原價，不然圖上會出現一根「跌了 75%」的假懸崖。冷眼的歷史資料都已經照倍數換算，部位的成本、股數也會自動調整。',
    ],
    src: [SRC.trading], cases: ['split0050'], terms: ['r1y'],
  },
  {
    id: 'b-delist', k: 'basic', t: 'ETF 也會下市：規模太小就會被清算',
    hook: '股票型 ETF 平均規模低於 1 億、債券型低於 2 億（依各檔公開說明書），投信就可能申請終止。',
    b: [
      'ETF 的信託契約都寫了終止條件，常見的是「最近 30 個營業日平均規模低於門檻」（股票型多為 1 億元、債券型 2 億元、期貨型 5 千萬元）或「淨值跌掉 90%」。實際數字以各檔公開說明書為準。',
      '下市不是錢不見：最後交易日之前可以賣掉；抱到下市的，基金清算後把剩餘淨值按比例還你，大約再等一個月。但清算價就是當時的價格，沒有選擇權。',
      '冷眼的回測特別把已經下市的 ETF 算進去，避免只看活下來的；單檔頁的「規模」一直縮小又很少成交的，要留意。',
    ],
    ex: () => {
      const rs = rowsAll().filter((r) => isNum(r.aum) && r.aum > 0).sort((a, b) => a.aum - b.aum);
      const n = S.track && S.track.delisted_n;
      return rs.length ? `現在規模最小的是 ${rs[0].n}：約 ${fmt.big(rs[0].aum)} 元${n ? `；冷眼的回測包含 ${n} 檔已經下市的 ETF` : ''}。` : '';
    },
    src: [SRC.etfQA, SRC.etf], terms: ['aum', 'bt'],
  },
  {
    id: 'b-dca', k: 'basic', t: '定期定額的本質：不挑時機，買的是「平均」',
    hook: '贏在一直扣，不是贏在買得巧。扣款失敗連續 3 次，國泰會把全部台股定期定額終止。',
    b: [
      '每個月固定日期、固定金額買進，價格高時買到的股數少、價格低時買到的多，長期下來成本是一個平均值。它不保證賺錢，但把「要不要現在買」這個最難的問題拿掉了。',
      '國泰的規則：每月 1～31 號任選、可以選好幾天；遇到休市順延到下一個交易日；那個月沒有的日期（例如 2/30）那一期不買；每筆金額已含手續費（2026 年底前每筆 1 元）；申請、變更、停扣都是送出後 1 個交易日生效。',
      '餘額不足扣款失敗不會補扣，連續 3 次失敗會自動終止全部台股定期定額，要重新申請。',
      '冷眼會照這套規則在扣款日自動記一筆預估，你再對照國泰的成交回報核對。',
    ],
    ex: () => { const n = (settings.plans || []).length; return n ? `你在冷眼設了 ${n} 個定期定額計畫。` : '還沒設定期定額計畫：設定頁「投資紀律」裡可以加。'; },
    src: [SRC.cathay], terms: ['dca', 'irr'],
  },
  {
    id: 'b-insti', k: 'basic', t: '三大法人是誰：外資、投信、自營商',
    hook: '一天的買賣超很吵，連續好幾天同方向才算訊號。',
    b: [
      '外資：外國的機構投資人，資金最大，常跟著國際市場進出。投信：國內的基金公司（ETF 本身就是投信發行的，ETF 進錢時投信就得買成分股）。自營商：券商用自己的錢交易，常為了避險或造市，方向最沒有參考性。',
      '買超＝買的比賣的多。證交所每天收盤後公布；冷眼大盤之瞳下面那一列是當天全市場的金額，單檔頁的籌碼是那一檔 ETF 的張數。',
      '單日的數字容易被一筆大單帶偏。看連續 5 天、10 天的方向，再對照指數有沒有跟著動，比較有意義。',
    ],
    ex: () => { const m = S.summary && S.summary.market && S.summary.market.insti; return m ? `${fmt.d(m.date)}：外資${m.f > 0 ? '買超' : '賣超'} ${fmt.big(Math.abs(m.f))} 元、投信${m.t > 0 ? '買超' : '賣超'} ${fmt.big(Math.abs(m.t))} 元、自營商${m.d > 0 ? '買超' : '賣超'} ${fmt.big(Math.abs(m.d))} 元。` : ''; },
    src: [SRC.flows], terms: ['insti'],
  },
  {
    id: 'b-bond', k: 'basic', t: '債券 ETF 為什麼跟利率反著走',
    hook: '利率往上，手上舊債券的價格就往下；年期越長，跌得越兇。',
    b: [
      '債券是固定利息的借據。市場利率升到 5%，你手上那張只付 3% 的舊債就沒人要，價格得跌到「用新價格買、報酬也有 5%」才賣得掉。利率往下則相反。',
      '年期越長越敏感：20 年期公債 ETF（00679B 這類）利率每動 1 個百分點，價格可能動十幾個百分點；短天期的幾乎不動。',
      '所以債券 ETF 的配息穩，價格不一定穩。2022 年美國一年升息七次，長天期債券 ETF 跌了兩成以上。冷眼的「大環境」面向看美國 20 年期公債殖利率的變化來判斷債券 ETF。',
    ],
    src: [SRC.ust, SRC.etf], terms: ['bond'], cases: ['bondrate', 'bear2022'],
  },

  // ============================================================ 陷阱提醒
  {
    id: 't-prem', k: 'trap', t: '溢價追高：溢價 3% 買進，等於先賠 3%',
    hook: '投信會增發單位把溢價壓回去，追高的人付的錢不會回來。',
    b: [
      'ETF 熱門時，想買的人比願意賣的多，市價被喊得比淨值高。這時候買，你付的錢比裡面的東西多；溢價消失時，多付的部分就是你的虧損。',
      '溢價不會一直在：投信可以增發新單位賣到市場上，把價格壓回淨值附近。熱門新 ETF 掛牌初期、停止申購時、市場大漲大跌時，溢價特別容易失控。',
      '證交所從 2026 年 9 月起，在盤中預估淨值網頁把折溢價超過 3% 的 ETF 標成紅底，並要求券商在下單畫面提醒。冷眼的警戒線更嚴：台股 ETF 0.5%、海外與債券 1%，超過就列進今日行動。',
    ],
    do: ['下單前看冷眼單檔頁的折溢價；超過警戒線寧可等。', '溢價特別高時，看看是不是「停止申購」或剛掛牌。', '溢價是跟淨值比，不是跟昨天的價格比：跌了一天還是可能溢價。'],
    ex: () => {
      const rs = rowsAll().map((r) => [r, premOf(r)]).filter(([, p]) => isNum(p)).sort((a, b) => b[1] - a[1]);
      return rs.length ? `現在溢價最高的 ETF 是 ${rs[0][0].n}：${rs[0][1].toFixed(2)}%${rs.filter(([, p]) => p > 3).length ? `；全市場有 ${rs.filter(([, p]) => p > 3).length} 檔溢價超過 3%` : ''}。` : '';
    },
    src: [SRC.nav, SRC.etf], terms: ['prem', 'units'], cases: ['ipo00940'],
  },
  {
    id: 't-ipo', k: 'trap', t: '熱門募集，不等於好的進場點',
    hook: '一檔 ETF 五天募到 1,752 億、70 萬人申購；掛牌第一天就跌破 10 元。',
    b: [
      '新 ETF 募集時只有一個價格（10 元），沒有折溢價可看、也沒有歷史可查，熱度全靠廣告和話題。募到的錢越多，投信越得在短時間內把幾百億、上千億買進成分股。',
      '2024 年 3 月的 00940 募到 1,752 億元，是台灣 ETF 募集的紀錄；4 月 1 日掛牌，收 9.76 元，低於 10 元的申購價。一年後，它的含息報酬還是落後同期的 0050。',
      '這不代表新 ETF 都不好，而是「很多人買」和「值得買」是兩件事。掛牌之後有了淨值、折溢價、成交量，再用冷眼的規則看，資訊比募集時多得多。',
    ],
    do: ['募集期間不急：掛牌後隨時買得到，而且看得到折溢價。', '新 ETF 上市未滿一年，冷眼的近一年報酬、波動都是空的，對決時要注意。'],
    src: [SRC.etf, SRC.nav], cases: ['ipo00940'], terms: ['prem', 'hd'],
  },
  {
    id: 't-divchase', k: 'trap', t: '除息前搶進「賺配息」：賺到配息、賠掉價差，還要扣健保',
    hook: '配息是從股價裡扣出來的；除息前一天買，只是提前把自己的錢領回來。',
    b: [
      '除息前買進，除息日股價先扣掉配息，你的總資產一毛沒多。真正決定賺賠的是之後填不填息、填多快。',
      '而且配息單次達 2 萬元要扣 2.11% 補充保費、要併入所得；股價那一段「價差」則沒有這些成本。純粹為了領息而在除息前搶進，是在付成本換一張收據。',
      '高殖利率的那一次除息，填息常常特別慢：0056 在 2022 年 10 月配 2.1 元（當時殖利率 8%），除息後花了 33 個交易日才填回來；2024 年 10 月那次配 1.07 元，等了超過一年。',
    ],
    do: ['要不要買，看冷眼的規則觀點和折溢價，不看除息日。', '單檔頁的配息紀錄可以看每一次填息花了多久。', '真的想領息：除息前一個交易日前買進就領得到，但別為了這個追高。'],
    src: [SRC.divPre, SRC.nhiDiv], terms: ['div', 'y'], cases: ['divfill'],
  },
  {
    id: 't-yield', k: 'trap', t: '殖利率越高越好？先看含息報酬',
    hook: '殖利率 10% 但淨值一直縮，等於用自己的本金配給自己。',
    b: [
      '殖利率的分母是現價，價格跌了殖利率就「變高」；分子裡的配息又可能來自收益平準金或賣股價差。所以殖利率排行榜上的前幾名，常常不是賺最多的。',
      '比的時候把「含息總報酬」放旁邊：殖利率 8%、含息報酬 −3%，代表配出來的 8% 裡有一大半是本金。',
      '冷眼單檔頁和對決裡，殖利率和近一年含息報酬永遠並排顯示，就是為了這個。',
    ],
    ex: () => {
      const rs = rowsAll().filter((r) => isNum(r.y) && isNum(r.r1y)).sort((a, b) => b.y - a.y).slice(0, 5);
      if (rs.length < 3) return '';
      const bad = rs.filter((r) => r.r1y < r.y / 100);
      return `殖利率前五名：${rs.map((r) => `${r.n} ${r.y.toFixed(1)}%（含息 ${pct(r.r1y, 0)}）`).join('、')}。${bad.length ? `其中 ${bad.length} 檔的含息報酬比殖利率還低，代表價格在跌。` : ''}`;
    },
    src: [SRC.etf, SRC.fsc], terms: ['y', 'r1y'], cases: ['hidiv'],
  },
  {
    id: 't-lev', k: 'trap', t: '槓桿 ETF 不是「2 倍」：盤整會磨損',
    hook: '指數漲 10% 再跌 9.1% 回到原點，正 2 ETF 剩 98.2%。',
    b: [
      '正 2 ETF 追蹤的是指數「每一天」報酬的 2 倍，每天收盤重新平衡。連續兩天以上，結果就不是 2 倍了。',
      '算一次：指數 100 → 110（+10%）→ 100（−9.09%）。正 2 ETF：100 → 120（+20%）→ 98.2（−18.18%）。指數回到原點，它少了 1.8%。來回越多次、幅度越大，磨損越多。',
      '一路上漲時它會比 2 倍更多（複利），一路下跌時跌得比 2 倍少；最怕的是上上下下的盤整。2022 年 0050 含息 −22%，00631L −37%，不是 −44%。證交所明白建議槓桿、反向 ETF 不適合長期持有。',
    ],
    do: ['要用，先決定持有多久；不設期限的錢不要放槓桿 ETF。', '冷眼的單檔上限：槓桿型比其他類別低得多（設定頁的表）。'],
    ex: () => { const a = S.rows.get('0050'), b = S.rows.get('00631L'); return a && b && isNum(a.r1y) && isNum(b.r1y) ? `近一年含息：0050 ${pct(a.r1y)}、00631L ${pct(b.r1y)}（${(b.r1y / a.r1y).toFixed(2)} 倍，不是 2 倍）。` : ''; },
    src: [SRC.li], terms: ['lev'], cases: ['lev2x'],
  },
  {
    id: 't-inv', k: 'trap', t: '反向 ETF 不是「買了放著避險」',
    hook: '它每天重設，市場長期往上時會一路耗損；是短線工具，不是保險。',
    b: [
      '反 1 ETF 追蹤指數「每天」報酬的 −1 倍。指數跌它漲，但也是每天重新平衡，抱越久、偏離越大。',
      '台股長期趨勢向上，加上每天重設的磨損，反向 ETF 放著不管，長期幾乎一定虧。它的用途是「短期內想對沖一段下跌」，而且要自己決定什麼時候出場。',
      '冷眼的大盤之瞳不算反向型（它的偏多就是大盤的偏空，會把溫度算錯）；它的規則觀點也只當參考。',
    ],
    ex: () => { const r = S.rows.get('00632R'); return r && isNum(r.r1y) ? `00632R 近一年含息報酬 ${pct(r.r1y)}。` : ''; },
    src: [SRC.li], terms: ['inv', 'breadth'],
  },
  {
    id: 't-dispose', k: 'trap', t: '處置股：每 5 或 20 分鐘才撮合一次，買之前要先付錢',
    hook: '被處置的 ETF 冷眼一律建議先暫停，不是因為它會跌，而是它變得很難買賣。',
    b: [
      '成交異常（漲跌太大、周轉率太高、集中度太高）時，交易所先公布「注意」；連續或情況嚴重就「處置」。',
      '處置期間通常 10 個營業日：改成每 5 分鐘撮合一次（短期內第二次處置是每 20 分鐘），而且達到一定張數的委託（第二次處置是全部）下單前要先把錢或股票交給券商（預收款券）。這段時間想買想賣都不方便，價格也容易失真。',
      'ETF 被處置多半是溢價失控、散戶追價造成的。冷眼的今日行動會列出來，單檔頁有標示；情報分頁的「風險名單」有全部。',
    ],
    ex: () => { const rs = rowsAll().filter((r) => (r.fl || []).some((f) => f === 'disposal' || f === 'notice')); return rs.length ? `現在有 ${rs.length} 檔 ETF 在注意或處置名單：${rs.slice(0, 3).map((r) => r.n).join('、')}${rs.length > 3 ? '…' : ''}。` : '現在沒有 ETF 被列入注意或處置。'; },
    src: [SRC.punishRule, SRC.punish], terms: ['notice'],
  },
  {
    id: 't-hot', k: 'trap', t: '人多就安全？受益人數暴增常伴隨溢價',
    hook: '幾十萬人持有代表好買好賣，不代表之後會漲。',
    b: [
      '受益人數是集保每週公布的「有多少人持有這檔」。人數多，成交量大、買賣價差小，這是好處。',
      '但人數短時間暴增，代表一堆人同時在追，這時候最容易出現溢價，也最容易在下一次回檔時集體離開。人數是結果，不是理由。',
      '冷眼的「人氣」只是對決六角形的一個角，規則觀點完全不看人數。',
    ],
    ex: () => { const rs = rowsAll().filter((r) => isNum(r.hd)).sort((a, b) => b.hd - a.hd).slice(0, 3); return rs.length ? `受益人數最多：${rs.map((r) => `${r.n} ${fmt.n(r.hd)} 人`).join('、')}。` : ''; },
    src: [SRC.tdcc], terms: ['hd'],
  },
  {
    id: 't-news', k: 'trap', t: '看新聞下單：標題裡的「飆」「狂」「必買」都不是資訊',
    hook: '冷眼只收官方公告和事實新聞，情緒標題預設藏起來。',
    b: [
      '一則新聞有兩種成分：事實（誰、什麼時候、公告了什麼）和情緒（看好、看壞、必買、大逃殺）。前者會改變你的判斷依據，後者只會改變你的心情。',
      '官方公告（證交所、櫃買、金管會、央行、投信的公告）是一手資料；媒體報導是二手；社群、KOL 是三手，而且常常有立場。冷眼只收前兩種，標題含預測、推薦、情緒字眼的預設隱藏。',
      '看到新聞想做什麼之前，先問：這則新聞改變了哪一個數字？折溢價？配息？規則？如果一個都沒變，那它只是在推你。',
    ],
    do: ['看到消息，先到冷眼的情報分頁找官方原文。', '想做決定，先說給副官聽：理由如果是「新聞說」，副官會提醒你冷靜。'],
    src: [SRC.news, SRC.fsc], terms: ['aide', 'cool'],
  },
  {
    id: 't-recent', k: 'trap', t: '只看近一年報酬挑 ETF：看不到下市的，也看不到下一年',
    hook: '活下來的 ETF 報酬都好看，因為不好的已經被清算了。',
    b: [
      '排行榜只列現在還在的 ETF。過去幾年被清算下市的那些，當初的報酬也曾經在榜上；現在你看不到它們，榜單就自動變好看。這叫倖存者偏誤。',
      '近一年漲最多的類別，往往是這一年剛好對的題材；下一年換題材，排名就重洗。近一年報酬是「它剛剛做了什麼」，不是「它接下來會做什麼」。',
      '冷眼的回測特意把已經下市的 ETF 放回去算，並且和「同類 ETF 任何一天」比，就是為了不被好看的排行榜騙。',
    ],
    ex: () => { const n = S.track && S.track.delisted_n; const o = S.track && S.track.overall; return n && o ? `冷眼的回測從 ${fmt.dy(o.start)} 起，包含 ${n} 檔已經下市的 ETF。` : ''; },
    src: [SRC.etfQA], terms: ['bt', 'base'], nav: { tab: 'track', t: '看戰績' },
  },
  {
    id: 't-timing', k: 'trap', t: '一直等「可加碼」才買：挑時機的優勢比你想的小',
    hook: '回測裡「可加碼」之後的表現和任何一天差不多；真正有用的是「減碼」提醒風險。',
    b: [
      '冷眼每次都把規則和「同類 ETF 任何一天」並列，就是要你看到：加碼訊號挑時機的優勢很小，很多時候和隨便一天買差不多。',
      '相反的，「減碼」訊號之後的最差 10% 常常明顯更差：規則最有價值的地方，是在風險變大時提醒你，不是幫你抓最低點。',
      '所以紀律（分批、比重上限、出場線）比時機重要。存股時光機可以算給你看：照訊號買和每月固定買，差多少。',
    ],
    ex: () => {
      const p = S.track && S.track.pos && S.track.pos['*'], a = S.track && S.track.pos_adj;
      if (!p || !a || !p.add || !a.add) return '';
      return `回測：「可加碼」之後 20 日上漲 ${(p.add.up * 100).toFixed(0)}%，同類任何一天 ${(a.add.up * 100).toFixed(0)}%${p.trim && a.trim ? `；「減碼」之後上漲只有 ${(p.trim.up * 100).toFixed(0)}%（任何一天 ${(a.trim.up * 100).toFixed(0)}%）` : ''}。`;
    },
    src: [SRC.etf], terms: ['ps', 'p10', 'base'], nav: { sheet: 'tm', t: '開存股時光機' },
  },
  {
    id: 't-market', k: 'trap', t: '市價單買冷門 ETF：一口氣吃到很差的價格',
    hook: '五檔很薄的時候，市價單會把每一檔都掃過去；而且海外 ETF 根本不能下市價單。',
    b: [
      '市價單＝「不管多少錢，現在就成交」。冷門 ETF 的委託簿可能只掛幾張，你的單會一路往上吃到很差的價格，成交後才發現比看到的貴好幾個升降單位。',
      '證交所規定沒有漲跌幅限制的有價證券（海外成分 ETF）不能下市價單；收盤前的集合競價（13:25～13:30）也不收市價單。',
      '用限價單：填你願意的價格，成交不了就等。冷眼單檔頁的整股、零股五檔可以看現在掛了多少量。',
    ],
    do: ['一律限價，想快一點就填對方的第一檔價格。', '成交值小的 ETF（熱力圖格子很小的）尤其要限價。'],
    ex: () => { const rs = mine().filter((r) => isNum(r.val)).sort((a, b) => a.val - b.val); return rs.length ? `你關注的 ETF 裡成交值最小的是 ${rs[0].n}：最近一天 ${fmt.big(rs[0].val)} 元。` : ''; },
    src: [SRC.trading], terms: ['val'],
  },
  {
    id: 't-dcafail', k: 'trap', t: '定期定額扣款失敗連續 3 次，全部終止',
    hook: '餘額不足那一期不會補扣；連三次沒扣到，國泰會把你全部的台股定期定額停掉。',
    b: [
      '扣款日前兩天就要確認交割帳戶的錢夠。扣款失敗（餘額不足）那一期不會補扣，等於那個月沒買；連續 3 次失敗，全部台股定期定額自動終止，要重新申請。',
      '申請、變更、停扣都是送出後 1 個交易日生效，最晚要在扣款日前 2 天送出；前一天才改，隔天照舊扣。',
      '冷眼的今日行動會在扣款日提醒你，並把國泰那邊沒扣到的那一期記成「沒扣到」（在交易表單刪掉那筆時選「沒扣到」）。',
    ],
    ex: () => { const n = (settings.plans || []).filter((p) => !p.stop).length; return n ? `你有 ${n} 個還在扣的計畫。` : ''; },
    src: [SRC.cathay], terms: ['dca'],
  },
  {
    id: 't-active', k: 'trap', t: '主動式 ETF 不追蹤指數：經理人在選股',
    hook: '代號尾碼 A（股票）、D（債券）的是主動式；沒有指數可對照，證交稅也不一樣。',
    b: [
      '一般 ETF 是被動追蹤一個指數，成分股照規則換；主動式 ETF 由經理人決定買什麼，目標是打敗指數，但也可能輸給指數。',
      '因為沒有指數可以對照，「追蹤誤差」這個概念對它不適用；要看的是它和同類被動 ETF 的含息報酬差距，以及經理費（通常比被動式高）。',
      '稅：被動式債券 ETF 證交稅停徵到 2026 年底，主動式債券 ETF（尾碼 D）照課 0.1%。行政院已提案 2027 年起把主動式也納入停徵，要等立法院通過。',
    ],
    ex: () => { const rs = rowsAll().filter((r) => r.k === 'active'); return rs.length ? `台股現在有 ${rs.length} 檔主動式 ETF。` : ''; },
    src: [SRC.etf, SRC.tax21], terms: ['tax'],
  },

  // ============================================================ 看盤判斷
  {
    id: 'r-crash', k: 'read', t: '大盤單日大跌 3% 以上：先看三件事，先別做兩件事',
    hook: '2024/8/5 跌 8.35%、2025/4/7 跌 9.7%；0050 分別在 4 個和 24 個交易日後回到大跌前的價格。那兩天最糟的動作是用市價單追賣。',
    b: [
      '先看：① 大盤之瞳——偏多的 ETF 比例掉了多少？全市場一起跌是系統性的，和單一檔出事不同。② 加權指數和季線的距離——還站在季線上，多半是漲多回檔；跌破季線，趨勢要重新看。③ 三大法人——外資單日賣超幾百億很正常，連續一週才要在意。',
      '先別做：① 盤中追賣，尤其市價單——跌停那天很多 ETF 五檔是空的，市價單會成交在很糟的價格。② 盤中追買「抄底」——冷眼的規則要收盤才算，等收盤資料出來再看部位訊號。',
      '歷史上 2020/3、2022、2024/8、2025/4 這幾次大跌，0050 最後都回到大跌前的價格：快的幾個交易日，2022 年那次花了兩年；槓桿型每次都跌得更深、債券 ETF 也沒有真的避到險。案例教室有每一次的真實走勢。',
    ],
    do: ['大跌日當天：看，不動。', '收盤後看今日行動：有沒有持股跌破防守線（減碼／先不加碼）。', '記進決策日記：寫下你當時怎麼想，一個月後對答案。'],
    ex: () => { const m = S.summary && S.summary.market; const b = S.breadth; return m && isNum(m.ma60) ? `今天加權 ${fmt.n(m.close, 0)}（${fmt.pct(m.pct)}），${m.close >= m.ma60 ? '在季線之上' : '跌破季線'}（季線 ${fmt.n(m.ma60, 0)}）${b && b.n ? `；偏多 ETF 占 ${Math.round(b.pBull * 100)}%` : ''}。` : ''; },
    src: [SRC.index, SRC.flows], terms: ['breadth', 'ma', 'dl'], cases: ['crash20240805', 'tariff2025', 'covid2020'],
  },
  {
    id: 'r-volume', k: 'read', t: '成交量突然暴增，要分三種',
    hook: '價漲量增、價跌量增、還是只是除息日？先看折溢價和注意名單。',
    b: [
      '成交值暴增代表很多人在同一天做決定。配合價格看：價漲量增，多半是追價；價跌量增，是有人急著出場；價格沒動量卻大，可能是除息日或指數換股。',
      '追價的時候一定看折溢價：量大又溢價擴大，就是被追上去的，之後投信增發單位會把它壓回來。',
      '量太大、周轉率太高會被交易所列「注意」，連續幾天就「處置」。冷眼單檔頁有標示，情報分頁的風險名單有全部。',
    ],
    ex: () => { const rs = rowsAll().filter((r) => isNum(r.val)).sort((a, b) => b.val - a.val).slice(0, 3); return rs.length ? `最近一天成交值最大：${rs.map((r) => `${r.n} ${fmt.big(r.val)}`).join('、')}。` : ''; },
    src: [SRC.punish, SRC.nav], terms: ['val', 'prem', 'notice'],
  },
  {
    id: 'r-prem', k: 'read', t: '今天買不買，先看折溢價',
    hook: '台股 ETF 溢價超過 0.5%、海外和債券超過 1%，寧可等。',
    b: [
      '折溢價是「現在這個價格划不划算」最直接的指標：同一檔 ETF，溢價 1% 買和折價 0.5% 買，起跑點就差 1.5%。',
      '盤中看預估淨值（證交所約每 15 秒更新、冷眼每 5 分鐘抓一次）；收盤後投信公告真正的淨值，冷眼會換成它。海外 ETF 的預估淨值會受時差影響，國外休市時特別不準。',
      '折價不一定是便宜：長期折價的 ETF 常是流動性差、或市場預期它的成分股會跌。折溢價是「要不要今天買」的工具，不是「要不要買這檔」的理由。',
    ],
    do: ['要買：溢價在警戒線以內再下單；超過就等，通常幾天內會壓回來。', '要賣：折價時賣等於打折賣，不急的話等一下。'],
    ex: () => { const rs = mine().map((r) => [r, premOf(r)]).filter(([, p]) => isNum(p)); return rs.length ? `你關注的 ETF 現在的折溢價：${rs.slice(0, 6).map(([r, p]) => `${r.n} ${p >= 0 ? '+' : ''}${p.toFixed(2)}%`).join('、')}。` : ''; },
    src: [SRC.nav, SRC.etf], terms: ['prem', 'nav'],
  },
  {
    id: 'r-divnotice', k: 'read', t: '除息公告怎麼讀：四個欄位',
    hook: '除息日、每單位金額、收益分配的來源、最後買進日——其他的都是裝飾。',
    b: [
      '除息日：那天開盤參考價會先扣掉配息。最後買進日就是除息日的前一個交易日。',
      '每單位配息金額：常常先公告「預估」或「上限」，正式金額等投信公告，冷眼的情報分頁會標「待公告」。',
      '收益分配來源：投信會公告這次配息裡股利、資本利得、收益平準金各占多少。平準金占比高，代表配的是新進來的錢；股利占比高才是成分股真的賺來的。',
      '發放日：通常在除息後 3～5 週，這才是錢進帳的日子。冷眼的領息月曆用的是除息日，入帳時間另外估。',
    ],
    ex: () => { const rs = mine().filter((r) => r.dv && r.dv.d >= today()).sort((a, b) => a.dv.d - b.dv.d).slice(0, 3); return rs.length ? `接下來除息：${rs.map((r) => `${r.n} ${fmt.d(r.dv.d)}${r.dv.cash ? `（${r.dv.cash} 元）` : '（待公告）'}`).join('、')}。` : '你關注的 ETF 最近沒有除息預告。'; },
    src: [SRC.divPre, SRC.fsc], terms: ['div'], nav: { tab: 'news', t: '看除息行事曆' },
  },
  {
    id: 'r-halt', k: 'read', t: '停止交易公告怎麼讀：分割、換發、下市',
    hook: '停止期間不能買賣、定期定額那幾期不扣；恢復交易那天價格會不一樣。',
    b: [
      '分割或反分割：公告會寫「停止交易期間」和「恢復交易日」，恢復那天用換算後的價格開盤，你的股數跟著換算，總值不變。',
      '暫停交易（例如成分股出事、淨值無法計算）：等恢復公告；這段期間冷眼拿不到價格，會顯示最後一次成交。',
      '終止上市（下市）：公告會寫最後交易日和清算程序。最後交易日之前可以賣，之後只能等清算分配。',
      '定期定額：停止交易那幾天券商不扣也不補（冷眼照這個規則不記那一期）。',
    ],
    src: [SRC.trading, SRC.etfQA], cases: ['split0050'], terms: ['dca'],
  },
  {
    id: 'r-cbc', k: 'read', t: '央行、聯準會的決議怎麼讀',
    hook: '升息＝債券 ETF 價格壓力、股市資金變貴；但市場常常在決議前就先反應完了。',
    b: [
      '聯準會（美國央行）一年開 8 次會，台灣央行每季一次（3、6、9、12 月）。決議公布的是「利率往哪走」和「接下來怎麼看」，後者對市場的影響常常更大。',
      '債券 ETF 直接看美國長天期公債殖利率：殖利率往上，20 年期債券 ETF 價格往下。冷眼的「大環境」面向就是看它的變化。',
      '股票 ETF 的關係比較間接：利率高，資金成本高、估值被壓；但市場通常在決議前幾週就先把預期算進價格，決議當天反而常是「利多出盡」或「利空出盡」。',
      '所以不要用決議當天的漲跌判斷方向，看決議後幾天殖利率和指數的「趨勢」有沒有改變。',
    ],
    src: [SRC.cbc, SRC.ust], terms: ['bond'], cases: ['bondrate'],
  },
  {
    id: 'r-insti', k: 'read', t: '法人連續賣超怎麼看',
    hook: '一天賣超 300 億是日常，連續 5 天同方向、指數也跟著走，才是訊號。',
    b: [
      '外資一天買賣幾百億很正常，裡面有避險、有換股、有期貨結算，單日的方向幾乎沒有預測力。',
      '有意義的是「連續」和「一致」：連續 5 到 10 天同方向，而且指數跟著走、季線方向一致，趨勢才成立。外資連續賣但指數不跌，代表有別人在接，反而是強勢。',
      '投信買超有另一層意思：ETF 有新錢進來，投信就必須買成分股。所以高股息 ETF 大募集的時候，投信買超的名單幾乎就是那些 ETF 的成分股。',
    ],
    ex: () => { const m = S.summary && S.summary.market; return m && m.insti ? `${fmt.d(m.insti.date)} 外資${m.insti.f > 0 ? '買超' : '賣超'} ${fmt.big(Math.abs(m.insti.f))} 元，加權指數 ${fmt.pct(m.pct)}。` : ''; },
    src: [SRC.flows, SRC.index], terms: ['insti', 'ma'],
  },
  {
    id: 'r-margin', k: 'read', t: '融資餘額大增、價格卻在跌：散戶在接刀',
    hook: '借錢買的人變多、價格還跌，代表籌碼在往不穩的手上跑。',
    b: [
      '融資是向券商借錢買股票。融資餘額增加，代表借錢進場的人變多；這些人撐不住跌勢時會被迫賣出（斷頭），讓下跌加速。',
      '最要小心的組合：融資餘額大增 + 價格下跌 + 法人賣超。代表法人在出、散戶借錢在接。冷眼的「籌碼」面向遇到這種情況會扣分。',
      '相反的，融資大減、價格止跌，常是籌碼洗乾淨的訊號。單檔頁的籌碼區可以看那一檔的融資變化。',
    ],
    src: [SRC.margin], terms: ['margin'],
  },
  {
    id: 'r-dl', k: 'read', t: '跌破移動防守線代表什麼，該做什麼',
    hook: '它是一條會自己往上拉的停損線：收盤跌破，代表前一段漲勢中斷了，不是預測會跌。',
    b: [
      '移動防守線＝近 22 個交易日最高收盤，減掉 3 倍 ATR（一天的平均波動）。價格創新高時它跟著往上移；回檔時多半停著不動。',
      '收盤跌破它，代表這一波的漲勢結構斷了：冷眼的部位訊號會變成「先不加碼」，偏空時變成「減碼」。它不是預測接下來會大跌，而是「加碼的理由沒了」。',
      '回測裡「減碼」訊號之後的最差 10% 明顯更差，所以它最有用的地方是風險提醒。跌破之後要不要賣，看你的紀律和比重，不要在盤中反應。',
    ],
    ex: () => { const rs = mine().filter((r) => isNum(r.dl) && isNum(quote(r).px) && quote(r).px < r.dl); return rs.length ? `你關注的 ETF 現在跌破防守線的：${rs.map((r) => r.n).join('、')}。` : '你關注的 ETF 現在都在防守線之上。'; },
    src: [SRC.etf], terms: ['dl', 'ps', 'atr'], nav: { tab: 'home', t: '看今日行動' },
  },
  {
    id: 'r-track', k: 'read', t: '一個規則可不可信，看三個數字',
    hook: '命中率要和同類基準比、樣本要夠多、最差 10% 要看得下去。',
    b: [
      '命中率本身沒意義：多頭年「每次都看多」也會對 60%。所以冷眼一律把規則和「同類 ETF 任何一天照同樣方向做」並列，差距才是規則真正的貢獻。',
      '樣本數：幾十次的命中率是運氣，幾千次才是統計。你自己的決策日記也一樣，累積 20 筆以上再看命中率。',
      '最差 10%：把每次訊號之後的報酬由差排到好，最差那 10% 的門檻。它告訴你「照這個規則做，運氣不好時大概賠多少」，比平均值重要。',
    ],
    ex: () => { const o = S.track && S.track.overall, a = S.track && S.track.overall_adj; return o && a ? `回測 ${fmt.n(o.n)} 個樣本：偏多之後上漲 ${(o.bull.hit * 100).toFixed(1)}%，同類基準 ${(a.bull * 100).toFixed(1)}%。` : ''; },
    src: [SRC.etf], terms: ['base', 'p10', 'bt'], nav: { tab: 'track', t: '看戰績' },
  },
  {
    id: 'r-stale', k: 'read', t: '畫面上的數字是幾點的？',
    hook: '右上角的狀態燈：冰藍＝盤中新鮮、琥珀＝延遲、灰＝收盤或休市。',
    b: [
      '盤中冷眼約每 5 分鐘從證交所抓一次價格和預估淨值；GitHub 忙的時候會晚幾分鐘。狀態燈顯示「幾點的資料」，超過 12 分鐘沒更新會變琥珀色。',
      '13:30 收盤後，畫面上先是最後一筆盤中價，收盤價大約 14:30 後送來；法人、融資、淨值則在晚上陸續補上，那時規則觀點才會更新。',
      '休市日（週末、假日、颱風假）畫面會寫「休市」，數字是上一個交易日的。後台超過兩天完全沒動靜，指揮台上方會出現琥珀色的警示，那就要找 Claude 檢查後台了。',
    ],
    ex: () => { const L = S.live; return L && L.at ? `目前盤中資料的時間：${String(L.at).slice(0, 16).replace('T', ' ')}${S.summary ? `；收盤資料到 ${fmt.dy(S.summary.asof)}` : ''}。` : ''; },
    src: [SRC.nav, SRC.index],
  },
  {
    id: 'r-breadth', k: 'read', t: '大盤之瞳怎麼看：偏多比例是市場的溫度',
    hook: '偏多比例高是多頭氛圍；比例在幾天內掉很多，風險正在升高。',
    b: [
      '大盤之瞳的圓環是全市場 ETF（不含反向型）裡，規則偏多、中性、偏空各占多少。它不是預測，是「現在有多少 ETF 處在上漲的樣子」。',
      '看兩件事：絕對水準（偏多 70% 以上是全面多頭、30% 以下是全面空頭）和變化速度（幾天內從 70% 掉到 40%，比停在 40% 更值得注意）。',
      '配合季線看：指數在季線上、偏多比例高＝順勢；指數跌破季線、偏多比例還高＝分歧，通常不會持續太久。',
    ],
    ex: () => { const b = S.breadth; return b && b.n ? `現在偏多 ${Math.round(b.pBull * 100)}%（${b.bull} 檔）、中性 ${b.neu} 檔、偏空 ${b.bear} 檔。` : ''; },
    src: [SRC.index], terms: ['breadth', 'ma'], nav: { tab: 'home', t: '看大盤之瞳' },
  },
  {
    id: 'r-week', k: 'read', t: '一週復盤怎麼做：看命中率之前，先看理由',
    hook: '理由是「怕錯過」「聽人說」的那幾筆，命中率通常最差。',
    b: [
      '每週花五分鐘看決策日記：這週記了幾筆、對答案的結果如何、理由分成哪幾類（規則、紀律、情緒、消息）。',
      '先看理由再看結果：情緒類理由的比例，比命中率更能預測你下個月的表現。副官的「本週復盤」會自動分好。',
      '命中率一定和同類基準並列。累積 20 筆以上才看得出是判斷還是運氣；在那之前，練的是「每一筆都有記、每一筆都有理由」。',
    ],
    ex: () => { const n = journal.items.length; return n ? `你目前記了 ${n} 筆決定。` : '還沒有決策日記：指揮台的副官卡「我有想法」就能記第一筆。'; },
    src: [SRC.etf], terms: ['journal', 'cool'], nav: { tab: 'aide', t: '開副官' },
  },
];
// id 不能重複（新增時打錯會在這裡被擋下）
(() => { const seen = new Set(); for (const L of LESSONS) { if (seen.has(L.id)) throw new Error(`lesson id 重複：${L.id}`); seen.add(L.id); } })();

// ------------------------------------------------------------------ 輪課順序：三類輪流
export function lessonOrder() {
  const by = { basic: [], trap: [], read: [] };
  for (const L of LESSONS) if (by[L.k]) by[L.k].push(L.id);
  const out = [];
  const n = Math.max(...Object.values(by).map((a) => a.length));
  for (let i = 0; i < n; i++) for (const k of Object.keys(by)) if (by[k][i]) out.push(by[k][i]);
  return out;
}
const dayNum = (d) => Date.UTC(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100) / 86400e3;
/** 今天是第幾課（0 起算，照日期輪、輪完從頭） */
export function todayLessonIdx(td = today()) {
  const order = lessonOrder();
  const k = Math.round(dayNum(td) - dayNum(EPOCH));
  return ((k % order.length) + order.length) % order.length;
}
export const lessonById = (id) => LESSONS.find((L) => L.id === id) || null;

// ------------------------------------------------------------------ 上課紀錄（只在手機）
function progress() { const p = store.get('lessons', null); return p && typeof p === 'object' && p.seen && typeof p.seen === 'object' ? p : { seen: {} }; }
function markSeen(id) { const p = progress(); if (!p.seen[id]) { p.seen[id] = today(); store.set('lessons', p); } }
export const seenCount = () => Object.keys(progress().seen).filter((id) => lessonById(id)).length;
const isSeen = (id) => !!progress().seen[id];

// ------------------------------------------------------------------ 指揮台的小卡
export function lessonHomeHTML() {
  const order = lessonOrder();
  const i = todayLessonIdx();
  const L = lessonById(order[i]);
  if (!L) return '';
  const seen = isSeen(L.id);
  return `<section class="panel lesson-card${seen ? ' seen' : ''}" aria-label="今日一課">
    <div class="lc-h"><span class="lc-k">今日一課</span><span class="chip ghost">${LESSON_CATS[L.k]}</span><span class="lc-n num">第 ${i + 1} 課・已上 ${seenCount()}／${LESSONS.length}</span></div>
    <h3 class="lc-t">${esc(L.t)}</h3>
    <p class="lc-s">${esc(L.hook)}</p>
    <div class="row-btns"><button class="btn small primary" data-lesson="open">${seen ? '再看一次' : '上課'}</button><button class="btn small ghost" data-lesson="list">全部課程</button><button class="btn small ghost" data-lesson="cases">案例教室</button></div>
  </section>`;
}
export function bindLessonHome(root, nav) {
  navHook = nav || navHook;
  const order = lessonOrder();
  $$('[data-lesson="open"]', root).forEach((b) => b.addEventListener('click', () => openLesson(order[todayLessonIdx()])));
  $$('[data-lesson="list"]', root).forEach((b) => b.addEventListener('click', () => openLessonList()));
  $$('[data-lesson="cases"]', root).forEach((b) => b.addEventListener('click', () => openCase()));
}
let navHook = null;   // app.js 給的：切分頁、開工具頁

// ------------------------------------------------------------------ 一課的內容
function lessonSpeech(L) {
  return [`今日一課，${LESSON_CATS[L.k]}。${L.t}。`, ...L.b, ...(L.do ? ['怎麼做：', ...L.do] : [])].join('');
}
export function openLesson(id) {
  const L = lessonById(id);
  if (!L) return;
  const order = lessonOrder();
  const i = order.indexOf(L.id);
  let ex = '';
  try { ex = L.ex ? L.ex() : ''; } catch { ex = ''; }
  const rel = [
    ...(L.terms || []).map((k) => `<button type="button" class="ls-rel" data-term-open="${k}">${esc(termTitle(k))}</button>`),
    ...(L.cases || []).filter((c) => CASES.some((x) => x.id === c)).map((c) => `<button type="button" class="ls-rel case" data-case-open="${c}">案例：${esc(CASES.find((x) => x.id === c).t)}</button>`),
    ...(L.nav ? [`<button type="button" class="ls-rel nav" data-nav-tab="${esc(L.nav.tab || '')}" data-nav-sheet="${esc(L.nav.sheet || '')}">${esc(L.nav.t)}</button>`] : []),
  ].join('');
  const card = openModal(`<div class="form lesson">
      <div class="ls-top"><span class="term-k">今日一課・${LESSON_CATS[L.k]}</span><span class="num muted small">第 ${i + 1}／${order.length} 課</span>${FX.hasVoice() ? `<button type="button" class="icon-btn ls-say" id="ls-say" aria-label="念給我聽">${ICON.speaker}</button>` : ''}</div>
      <h2 class="m-title">${esc(L.t)}</h2>
      ${L.b.map((p) => `<p class="term-p">${esc(p)}</p>`).join('')}
      ${L.do ? `<div class="ls-do"><span>怎麼做</span><ul>${L.do.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${ex ? `<div class="term-ex"><span>現在的例子</span><p>${esc(ex)}</p></div>` : ''}
      <div class="ls-src"><span>出處</span>${L.src.map((s) => `<a href="${esc(s.u)}" target="_blank" rel="noopener">${ICON.ext}${esc(s.n)}</a>`).join('')}</div>
      ${rel ? `<div class="ls-rels">${rel}</div>` : ''}
      <div class="m-actions ls-nav"><button type="button" class="btn ghost small" data-ls-nav="-1" ${i <= 0 ? 'disabled' : ''}>上一課</button><button type="button" class="btn ghost small" data-ls-nav="1" ${i >= order.length - 1 ? 'disabled' : ''}>下一課</button><button type="button" class="btn" data-close>知道了</button></div>
    </div>`, { label: L.t, onClose: () => FX.stopSpeak() });
  markSeen(L.id);
  $$('[data-ls-nav]', card).forEach((b) => b.addEventListener('click', () => { const j = i + +b.dataset.lsNav; if (order[j]) { FX.stopSpeak(); closeModal(); openLesson(order[j]); } }));
  $$('[data-term-open]', card).forEach((b) => b.addEventListener('click', () => { closeModal(); openTerm(b.dataset.termOpen, null); }));
  $$('[data-case-open]', card).forEach((b) => b.addEventListener('click', () => { closeModal(); openCase(b.dataset.caseOpen); }));
  $$('[data-nav-tab],[data-nav-sheet]', card).forEach((b) => b.addEventListener('click', () => { closeModal(); if (navHook) navHook(b.dataset.navTab || null, b.dataset.navSheet || null); }));
  const say = $('#ls-say', card);
  if (say) say.addEventListener('click', () => {
    if (FX.isSpeaking()) { FX.stopSpeak(); return; }
    FX.sfx('comms');
    FX.speak(lessonSpeech(L), { force: true });
  });
  // 同一個分頁的其他地方（指揮台小卡）要更新「已上」的數字
  const card0 = $('.lesson-card');
  if (card0) { card0.classList.add('seen'); const n = $('.lc-n', card0); if (n) n.textContent = `第 ${todayLessonIdx() + 1} 課・已上 ${seenCount()}／${LESSONS.length}`; const b = $('[data-lesson="open"]', card0); if (b && order[todayLessonIdx()] === L.id) b.textContent = '再看一次'; }
}
function termTitle(k) {
  // 不直接 import TERMS（避免循環），用 learn.js 的 openTerm 開；標題照常見名詞對應
  const T = { prem: '折溢價', nav: '淨值', div: '除息', annual: '預估一年配息', y: '殖利率', r1y: '近一年含息報酬', total: '含息總報酬', fee: '手續費', tax: '證交稅', be: '損益兩平價', dca: '定期定額', irr: '年化報酬', lev: '槓桿型 ETF', inv: '反向型 ETF', bond: '債券 ETF', aum: '規模', bt: '回測', insti: '三大法人', units: '單位數', hd: '受益人數', notice: '注意與處置', aide: '副官', cool: '冷靜期', base: '同類基準', ps: '部位訊號', p10: '最差 10%', val: '成交值', breadth: '大盤之瞳', ma: '季線', dl: '移動防守線', atr: 'ATR', margin: '融資餘額', journal: '決策日記' };
  return T[k] || k;
}

// ------------------------------------------------------------------ 全部課程
export function openLessonList() {
  const order = lessonOrder();
  const ti = todayLessonIdx();
  const sec = Object.entries(LESSON_CATS).map(([k, name]) => {
    const Ls = LESSONS.filter((L) => L.k === k);
    return `<div class="ll-sec"><div class="ll-h"><b>${name}</b><span class="num muted small">已上 ${Ls.filter((L) => isSeen(L.id)).length}／${Ls.length}</span></div>
      ${Ls.map((L) => { const i = order.indexOf(L.id); return `<button type="button" class="ll-row${isSeen(L.id) ? ' seen' : ''}${i === ti ? ' today' : ''}" data-ls="${L.id}"><span class="ll-i num">${i + 1}</span><span class="ll-t">${esc(L.t)}${i === ti ? '<em>今天</em>' : ''}</span><span class="ll-ok">${isSeen(L.id) ? ICON.ok : ''}</span></button>`; }).join('')}</div>`;
  }).join('');
  const card = openModal(`<div class="form lesson-list">
      <div class="term-k">今日一課</div>
      <h2 class="m-title">全部課程</h2>
      <p class="m-desc">每天輪一課，三類輪流；上過的會打勾。內容固定、每一課都有官方出處，不是即時的建議。</p>
      <div class="ll-list">${sec}</div>
      <div class="m-actions"><button type="button" class="btn ghost small" data-cases>案例教室</button><button type="button" class="btn" data-close>關閉</button></div>
    </div>`, { label: '全部課程' });
  $$('[data-ls]', card).forEach((b) => b.addEventListener('click', () => { closeModal(); openLesson(b.dataset.ls); }));
  $$('[data-cases]', card).forEach((b) => b.addEventListener('click', () => { closeModal(); openCase(); }));
}
