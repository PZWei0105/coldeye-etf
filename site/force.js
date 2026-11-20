/* 冷眼 — 兵力：照你的股數、自由資金與紀律，算出今天每一檔要加多少、減多少、留多少（2026/11/20，PZ：「更爲專屬的專屬」）。
   全部是純函式，不碰畫面、不連網，同樣的輸入永遠得到同樣的結果（tests/force_test.mjs）。
   - 核心＝定期定額買的股數，機動＝你自己單筆買的（calc.js 的 dcaPart：賣出照國泰的規則先賣現股、最後才賣定期定額）。
   - 核心照扣、不跟減碼訊號賣。只有兩種情況會動到核心：比重超過上限（多 OVER_TOL 以上）要賣回上限，
     或你打開「核心也跟減碼訊號」（settings.coreFollow）。
   - 機動照部位訊號：減碼是「這一輪」減一次（一般 1/3、主題／主動／期貨 1/2、槓桿／反向全部，pf.js 的 TRIM_FRAC），
     這一輪已經賣過就不再叫你賣；這一輪從哪天開始看歷史檔的訊號取樣（trimFrom）。加碼照加碼計畫（pf.js 的 allocAdds）用自由資金買。
   - 自由資金＝你設定的金額＋之後記的單筆買賣（freeCash）。定期定額預設另外扣、不算在自由資金裡（settings.dcaFund）。
   金額一律回傳數字，文字裡不寫金額（畫面再照「隱藏金額」決定怎麼寫）。 */
import { TRIM_FRAC, TRIM_DEFAULT, OVER_TOL, CAT_NAMES, capOf, sellValue, taxCat, normLot, sharesText, planWhy, noPlanWhy, addDays, tradeCost } from './pf.js';
import { dcaPart, isDcaLot, signalOn, deductionDays, sharesFor, firstMonth, planDays } from './calc.js';

const isNum = (x) => typeof x === 'number' && isFinite(x);
const okDay = (d) => Number.isInteger(d) && d >= 19000101 && d <= 21001231;
const pxS = (x) => (isNum(x) ? x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');
const pctS = (x, d = 1) => (isNum(x) ? `${(x * 100).toFixed(d)}%` : '—');
const md = (d) => (okDay(d) ? `${Math.floor(d / 100) % 100}/${d % 100}` : '');
const list = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join('、')}和${xs[xs.length - 1]}`);
const FRAC_T = (f) => (f >= 1 ? '全部' : f === 0.5 ? '一半' : '三分之一');

// ------------------------------------------------------------------ 自由資金
/**
 * 自由資金（真實部位）：你在「自由資金」設定的金額（book.cash；設定那天 cashD、那一刻 cashAt），加上之後記的單筆買賣——
 * 買進扣掉（成交金額＋手續費）、賣出加回（成交金額－手續費－證交稅）。
 * 「之後」＝成交日在設定那天之後；同一天的看記下的時間（at）比設定的那一刻晚。沒填日期的、你勾掉「用自由資金」（free: false）的不算。
 * 定期定額的那幾期：dcaFree（設定選「從自由資金扣」）才扣，預設另外扣、不算。
 * 回傳 { base, d, at, items: [{ id, c, side, d, amt, dca }], flow, now }（now 可能是負的：買超過自由資金了）
 */
export function freeCash(book, o = {}) {
  const base = book && isNum(book.cash) && book.cash > 0 ? book.cash : 0;
  const d0 = book && okDay(book.cashD) ? book.cashD : null;
  const at0 = book && typeof book.cashAt === 'string' ? book.cashAt : null;
  const items = [];
  if (d0) {
    for (const l of (book.lots || [])) {
      if (!l || !okDay(l.d) || l.d < d0 || (okDay(o.today) && l.d > o.today)) continue;
      if (l.d === d0 && !(at0 && typeof l.at === 'string' && l.at > at0)) continue;
      const dca = isDcaLot(l);
      if (dca ? !o.dcaFree : l.free === false) continue;
      if (!(l.sh > 0) || !(l.px > 0)) continue;
      const fee = isNum(l.fee) ? l.fee : 0;
      const tax = isNum(l.tax) ? l.tax : 0;
      const amt = l.side === 'sell' ? l.sh * l.px - fee - tax : -(l.sh * l.px + fee);
      items.push({ id: l.id, c: l.c, side: l.side === 'sell' ? 'sell' : 'buy', d: l.d, at: l.at || '', amt: Math.round(amt), dca });
    }
  }
  items.sort((a, b) => a.d - b.d || String(a.at).localeCompare(String(b.at)));
  const flow = items.reduce((t, x) => t + x.amt, 0);
  return { base, d: d0, at: at0, items, flow, now: base + flow };
}

/** 定期定額每個月扣多少（還在扣的計畫：每期金額 × 每月幾個扣款日）；code 給了就只算那一檔 */
export function dcaMonthly(plans, today, code = null) {
  let t = 0;
  for (const p of plans || []) {
    if (!p || (code && p.c !== code) || (p.end && okDay(today) && p.end < today)) continue;
    t += (p.amt || 0) * planDays(p).length;
  }
  return t;
}

// ------------------------------------------------------------------ 這一輪減碼從哪天開始
/**
 * 歷史檔的 sig 是每 5 個交易日一次的部位訊號取樣。從最後一筆往回找連續的「減碼」，回傳它前一筆（不是減碼的那一次取樣）的隔天；
 * 最後一筆不是減碼（剛轉成減碼、還沒取樣到）就用最後一筆的隔天。這一天（含）以後的賣出，算「這一輪已經減過」。
 * 取樣是 5 天一次，所以這一天最多比真正開始的那天早 4 個交易日（那幾天的賣出也算進去，只會讓冷眼少叫你賣，不會多叫）。
 * 沒有資料回傳 null（呼叫的地方當作今天才開始）。
 */
export function trimFrom(sig) {
  if (!Array.isArray(sig) || !sig.length) return null;
  let k = sig.length - 1;
  while (k >= 0 && sig[k] && sig[k][1] === 'trim') k--;
  if (k < 0) return okDay(sig[0][0]) ? sig[0][0] : null;
  return okDay(sig[k][0]) ? addDays(sig[k][0], 1) : null;
}

// ------------------------------------------------------------------ 每一檔
const SIG_T = {
  trim: '減碼', caution: '先不加碼', add: '可加碼', wait: '漲多分批', hold: '續抱',
};
/** 規則訊號的原因（白話，不含「規則「減碼」：」） */
function sigReason(r, px) {
  switch (r.ps) {
    case 'trim': return `觀點偏空，收盤 ${pxS(px)} 跌破移動防守線 ${pxS(r.dl)}`;
    case 'caution': {
      const fl = r.fl || [];
      return r.st < 0 ? '觀點偏空' : isNum(r.dl) && px < r.dl ? `收盤跌破移動防守線 ${pxS(r.dl)}` : fl.includes('disposal') || fl.includes('notice') ? '注意／處置中' : '溢價偏高';
    }
    case 'add': return `觀點偏多${isNum(r.cf) ? `，信心 ${r.cf}` : ''}`;
    case 'wait': return '觀點偏多，但短線漲多';
    case 'hold': return '觀點中性';
    default: return '';
  }
}
/** 規則訊號的一句（為什麼） */
function signalWhy(r, px) {
  return SIG_T[r.ps] ? `規則「${SIG_T[r.ps]}」：${sigReason(r, px)}` : '';
}
/** 等什麼：轉回不偏空的價位（只寫規則算得出來的） */
function waitLine(r, px) {
  if (r.st < 0 && isNum(r.iv)) return `收盤站上 ${pxS(r.iv)}（轉多線），偏空的看法就不成立`;
  if (r.ps === 'caution' && isNum(r.dl) && isNum(px) && px < r.dl) return `收盤站回移動防守線 ${pxS(r.dl)} 以上`;
  if (r.st === 0 && isNum(r.r1)) return `收盤站上 ${pxS(r.r1)} 轉偏多`;
  return null;
}
/** 加碼計畫的一檔 → 兵力的「買」；lim＝股數受限於什麼（為什麼只買這麼多，pf.js 的 planWhy） */
const buyOf = (p, cat) => ({ n: p.n, spend: p.spend, parts: p.parts.length, stop: p.stop, stopName: p.stopName, newW: p.newW, lim: planWhy(p, { cat }) });

function forceItem(x, inp) {
  const T = inp.T || 0;
  const r = x.row;
  const px = x.px;
  const cat = x.cat || (r && r.k) || null;
  const lots = (inp.lots || []).filter((l) => l && l.c === x.code);
  const sp = (inp.splitsOf && inp.splitsOf(x.code)) || [];
  const sh = Math.round(x.h.sh);
  const part = dcaPart(lots, sp);
  const core = Math.max(0, Math.min(sh, Math.round(part.dca.sh)));
  const mob = sh - core;
  const cap = capOf(inp.profile, cat);
  const max = T > 0 && px > 0 ? Math.floor((cap * T) / px + 1e-9) : null;
  const it = {
    code: x.code, name: x.name, cat, catName: CAT_NAMES[cat] || '同類', px, w: x.w, cap, sh, core, mob, ps: r ? r.ps || null : null,
    act: 'keep', sell: null, buy: null, small: null, trim: null, over: 0, why: [], wait: null, chip: null, say: '', hold: null,
    sig: null, noAdd: '',
  };
  const why = (t) => { if (t) it.why.push(t); };
  const done = () => { it.hold = { now: sh, after: sh - (it.sell ? it.sell.n : 0) + (it.buy ? it.buy.n : 0), max }; return it; };

  if (!r || r.st == null || !isNum(px)) {
    it.act = 'none';
    it.chip = ['資料不足', 'mute'];
    it.say = '資料不足，先不動';
    why(r && r.young ? `上市只有 ${r.young} 個交易日，規則至少要 70 個交易日的資料` : '暫時沒有這檔的價格或規則觀點');
    it.sig = { k: 'none', t: '資料不足', why: '' };
    it.noAdd = it.why[0];
    if (core > 0) why(`${sharesText(core)}是定期定額買的核心：照扣`);
    return done();
  }
  const fl = r.fl || [];
  if (fl.includes('disposal') || fl.includes('notice')) {
    it.act = 'pause';
    it.chip = ['交易受限', 'warn'];
    it.say = `被列為${fl.includes('disposal') ? '處置' : '注意'}標的：不加也不減`;
    why('交易受限的時候買賣都比較難照計畫成交，等解除再說');
    it.sig = { k: 'pause', t: '交易受限', why: `被列為${fl.includes('disposal') ? '處置' : '注意'}標的` };
    it.noAdd = `被列為${fl.includes('disposal') ? '處置' : '注意'}標的，買賣都比較難照計畫成交：等解除再說`;
    return done();
  }
  why(signalWhy(r, px));
  it.sig = { k: r.ps || 'hold', t: SIG_T[r.ps] || '續抱', why: sigReason(r, px) };

  // ---- 減碼：這一輪減一次
  let need = 0;
  if (r.ps === 'trim') {
    const f = TRIM_FRAC[cat] ?? TRIM_DEFAULT;
    const s0 = inp.since ? inp.since(x.code) : null;
    const t0 = okDay(s0) ? s0 : inp.today;
    const before = dcaPart(lots.filter((l) => !okDay(l.d) || l.d < t0), sp);
    const base0 = Math.round(inp.coreFollow ? before.dca.sh + before.other.sh : before.other.sh);
    const sold = Math.round(lots.filter((l) => l.side === 'sell' && okDay(l.d) && l.d >= t0).reduce((s, l) => s + normLot(l, sp).nsh, 0));
    const target = base0 > 0 ? (f >= 1 ? base0 : Math.ceil(base0 * f - 1e-9)) : 0;
    need = Math.max(0, Math.min(target - sold, inp.coreFollow ? sh : mob));
    it.trim = { from: t0, known: okDay(s0), f, base: base0, target, sold, need };
  }
  // ---- 比重超過上限：賣回上限以內（機動先賣，不夠才賣到核心）
  // 還沒設定自由資金（真實部位）：總資產只算得到持股，比重會被高估，先不照比重上限賣（設定過、就算是 0 才照算）
  const unknownT = inp.free && inp.free.set === false;
  const overW = T > 0 && isNum(x.w) && x.w > cap + OVER_TOL && isNum(x.mv);
  const over = overW && !unknownT ? Math.min(sh, Math.ceil((x.mv - cap * T) / px - 1e-9)) : 0;
  it.over = Math.max(0, over);
  if (overW && unknownT) why(`只算持股的話占 ${pctS(x.w)}，超過上限 ${pctS(cap, 0)}；但還沒設定自由資金，總資產算不準，先不照比重賣`);
  const n = Math.min(sh, Math.max(need, it.over));
  if (n > 0) {
    const fromMob = Math.min(n, mob);
    const sv = sellValue(n, px, taxCat(r), inp.today, inp.fee);
    it.act = 'sell';
    it.sell = { n, mob: fromMob, core: n - fromMob, amount: sv.amount, fee: sv.fee, tax: sv.tax, net: sv.net, by: it.over > need ? 'over' : 'trim' };
    it.chip = [`賣 ${sharesText(n)}`, 'warn2'];
    const from = fromMob && n - fromMob ? `機動 ${sharesText(fromMob)}＋核心 ${sharesText(n - fromMob)}` : fromMob ? '機動' : '核心';
    it.say = `賣 ${sharesText(n)}（${from}）`;
    if (it.sell.by === 'trim') {
      why(`這一輪先減${FRAC_T(it.trim.f)}：${inp.coreFollow ? `核心也跟訊號（你打開了），${md(it.trim.from)} 起的 ${sharesText(it.trim.base)}減${FRAC_T(it.trim.f)}` : `機動的 ${sharesText(it.trim.base)}減${FRAC_T(it.trim.f)}`}${it.trim.sold ? `，已經賣了 ${sharesText(it.trim.sold)}` : ''}`);
      if (!inp.coreFollow && core > 0) why(`${sharesText(core)}是定期定額買的核心：照扣、不賣`);
    } else {
      why(`占總資產 ${pctS(x.w)}，超過你的上限 ${pctS(cap, 0)}（${it.catName}）：賣回上限以內`);
      if (n - fromMob > 0) why(`機動不夠，要動到定期定額買的核心 ${sharesText(n - fromMob)}`);
    }
    if (cat === 'lev' || cat === 'inv') why('槓桿／反向型每天重新平衡，長期持有會偏離指數');
    it.noAdd = it.sell.by === 'trim' ? it.sig.why : `占總資產 ${pctS(x.w)}，超過你的上限 ${pctS(cap, 0)}`;
    it.wait = waitLine(r, px);
    return done();
  }

  // ---- 不賣：看加碼計畫有沒有分到自由資金
  const a = inp.adv ? inp.adv(x.code) : null;
  const p = a && a.plan;
  if (p && p.n > 0 && a.key === 'add') {
    it.act = 'buy';
    it.buy = buyOf(p, cat);
    it.chip = [`買 ${sharesText(p.n)}`, 'go'];
    it.say = `用${inp.cashName || '自由資金'}買 ${sharesText(p.n)}，分 ${p.parts.length} 批`;
    why(planWhy(p, { cat }));
    why(`出場線 ${pxS(p.stop)}（${p.stopName}）：買齊後收盤跌破就出場`);
    if (core > 0) why(`定期定額照扣，${sharesText(core)}核心不動`);
    return done();
  }
  if (p && p.n > 0 && a.key === 'hold') it.small = buyOf(p, cat);

  if (r.ps === 'trim') {
    const tr = it.trim;
    if (tr.target > 0) {
      it.chip = ['已減碼', 'mute'];
      it.say = `這一輪已經減過（${md(tr.from)} 起賣了 ${sharesText(tr.sold)}），剩下的續抱`;
      if (!inp.coreFollow && core > 0) why(`${sharesText(core)}是定期定額買的核心：照扣、不賣`);
    } else if (!inp.coreFollow && core > 0) {
      it.chip = ['核心照扣', 'core'];
      it.say = mob > 0 ? `核心照扣、不賣；機動是這一輪減碼（${md(tr.from)} 起）之後才買的，這一輪不減` : '定期定額的核心照扣、不賣';
      why(`${sharesText(core)}${mob > 0 ? '是' : '都是'}定期定額買的核心：核心不跟減碼訊號賣（要跟的話，在兵力分頁打開）`);
    } else {
      // 這一輪開始之前沒有可以減的股數：都是這一輪開始之後才買的
      it.chip = ['續抱', 'mute'];
      it.say = `這一輪減碼從 ${md(tr.from)} 開始，之後才買的這一輪不減`;
    }
    it.noAdd = it.sig.why;
  } else if (r.ps === 'caution') {
    it.chip = ['不動', 'mute'];
    it.say = core > 0 ? '先不加碼：不買也不賣，定期定額照扣' : '先不加碼：不買也不賣';
    it.noAdd = it.sig.why;
  } else if (r.ps === 'add' || r.ps === 'wait') {
    it.chip = ['續抱', 'mute'];
    // 0 股的原因：加碼計畫算得出來的照 planWhy；比重已經到上限（續抱）的沒有計畫
    const cant = p ? planWhy(p, { cat }) : a && a.key === 'full' ? '已經到你設定的比重上限' : `這次沒有分到${inp.cashName || '自由資金'}`;
    it.say = `可以加碼，但${cant}`;
    it.noAdd = it.say;
    if (core > 0) why('定期定額照扣');
  } else {
    it.chip = ['續抱', 'mute'];
    it.say = core > 0 ? '續抱，定期定額照扣' : '續抱';
    it.noAdd = `觀點中性，不是加碼訊號${it.small ? `；想加碼的話小額就好，最多 ${sharesText(it.small.n)}` : ''}`;
    if (it.small) why(`想加碼的話，小額就好：最多 ${sharesText(it.small.n)}`);
  }
  if ((cat === 'lev' || cat === 'inv') && core > 0) why('槓桿／反向型每天重新平衡，長期持有會偏離指數，不適合定期定額');
  it.wait = r.ps === 'add' || r.ps === 'wait' ? null : waitLine(r, px);
  return done();
}

// ------------------------------------------------------------------ 全部
/**
 * 兵力指令。
 * inp：{
 *   holdings：buildPortfolio 的 holdings（code, name, row, px, h, mv, w, cat）；lots：這一本的交易；splitsOf(code)：分割
 *   adv(code)：加碼計畫給這一檔的建議（allocAdds 的 adv）；order：加碼計畫的順序（持有＋關注）；rowOf(code)：summary 的一列
 *   T、profile、fee、today、coreFollow（核心也跟減碼訊號）、cashName（真實部位「自由資金」、模擬倉「模擬倉現金」）
 *   free：{ now, reserve, dca, usable, set }（自由資金、緊急預備金、定期定額保留款、可動用、設定過自由資金沒有（模擬倉一律 true））
 *   since(code)：這一輪減碼從哪天開始（trimFrom；null＝還不知道，當作今天）
 * }
 * 回傳 {
 *   items：每一檔（act：sell／buy／keep／pause／none；sell／buy 的股數與金額；core、mob；hold：{ now, after, max }；chip、say、why、wait；
 *          sig：{ k, t, why } 規則訊號與原因；noAdd：今天為什麼不加碼（買的那一檔是空字串）），
 *   buys：關注清單裡（還沒持有）照加碼計畫要買的，
 *   free：{ now, reserve, dca, usable, set, use：今天的指令用掉的, left：可動用剩下的, back：賣出約拿回的, keep：自由資金留下的 },
 *   orders：照順序要做的事 [{ k: 'sell'|'buy', … }]（買的 lim：為什麼只買這麼多），
 *   ans：直接回答「今天加多少、減多少」——add：{ k: buy／unset（還沒設定自由資金）／zero（可動用的是 0）／none（有錢、沒有可加碼的）, t }、
 *        sell：{ k: sell／none, t, why }（文字不寫金額，畫面再照「隱藏金額」補上），
 *   head：一句結論（「加碼：…。減碼：…。」），quiet：今天不用買也不用賣
 * }
 */
export function forceOrders(inp) {
  const items = (inp.holdings || []).filter((x) => x && x.h && x.h.sh > 0).map((x) => forceItem(x, inp));
  const held = new Set(items.map((i) => i.code));
  const buys = [];
  for (const code of inp.order || []) {
    if (held.has(code)) continue;
    const a = inp.adv ? inp.adv(code) : null;
    if (!a || a.key !== 'add' || !a.plan || !(a.plan.n > 0)) continue;
    const row = inp.rowOf ? inp.rowOf(code) : null;
    buys.push({ code, name: row ? row.n : code, cat: row ? row.k : null, row, buy: buyOf(a.plan, row && row.k), why: [signalWhy(row || { ps: 'add' }, null), planWhy(a.plan, { cat: row && row.k })].filter(Boolean) });
  }
  // 買的順序照加碼計畫（可加碼的先、信心高的先）
  const rank = new Map((inp.order || []).map((c, i) => [c, i]));
  const byPlan = (a, b) => (rank.get(a.code) ?? 999) - (rank.get(b.code) ?? 999);
  const sells = items.filter((i) => i.sell);
  const heldBuys = items.filter((i) => i.buy).sort(byPlan);
  const allBuys = [...heldBuys.map((i) => ({ code: i.code, name: i.name, buy: i.buy, held: true })), ...buys.map((b) => ({ code: b.code, name: b.name, buy: b.buy, held: false }))].sort(byPlan);
  const fr = inp.free || {};
  const cn = inp.cashName || '自由資金';
  const now = isNum(fr.now) ? fr.now : 0;
  const use = allBuys.reduce((t, b) => t + b.buy.spend, 0);
  const back = sells.reduce((t, i) => t + i.sell.net, 0);
  const free = {
    now, reserve: fr.reserve || 0, dca: fr.dca || 0, usable: Math.max(0, fr.usable || 0), set: fr.set !== false,
    use, left: Math.max(0, (fr.usable || 0) - use), back, keep: now - use,
  };
  const orders = [];
  for (const i of sells) orders.push({ k: 'sell', code: i.code, name: i.name, n: i.sell.n, mob: i.sell.mob, core: i.sell.core, net: i.sell.net, by: i.sell.by });
  for (const b of allBuys) orders.push({ k: 'buy', code: b.code, name: b.name, n: b.buy.n, spend: b.buy.spend, parts: b.buy.parts, stop: b.buy.stop, held: b.held, lim: b.buy.lim });

  // ---- 加碼：用多少自由資金、買哪幾檔；沒有的話為什麼
  const nm = (xs) => list(xs.map((x) => x.name));
  let add;
  if (allBuys.length) add = { k: 'buy', t: `用${cn}買 ${list(allBuys.map((b) => `${b.name} ${sharesText(b.buy.n)}`))}` };
  else if (!free.set) add = { k: 'unset', t: `還沒設定${cn}，算不出能加碼多少` };
  else if (!(free.usable > 0)) {
    const kept = [free.reserve > 0 ? '緊急預備金' : null, free.dca > 0 ? '定期定額' : null].filter(Boolean);
    add = { k: 'zero', t: `今天不加碼，${now < 0 ? `${cn}已經用完了` : now > 0 && kept.length ? `${cn}都要留給${kept.join('和')}` : `${cn}是 0`}` };
  } else add = { k: 'none', t: `今天不加碼，${noAddWhy(items, inp)}` };

  // ---- 減碼：賣哪幾檔；不用賣的話，有減碼訊號的為什麼不賣
  const trimKeep = items.filter((i) => i.ps === 'trim' && !i.sell);
  const trimCore = trimKeep.filter((i) => i.chip && i.chip[1] === 'core' && i.mob === 0);
  const trimDone = trimKeep.filter((i) => i.trim && i.trim.target > 0);
  const trimMix = trimKeep.filter((i) => i.chip && i.chip[1] === 'core' && i.mob > 0);
  const trimLate = trimKeep.filter((i) => !trimCore.includes(i) && !trimDone.includes(i) && !trimMix.includes(i));
  const coreKeep = items.filter((i) => i.core > 0 && !(i.sell && i.sell.core > 0));
  const sw = [];
  if (trimCore.length) sw.push(`${nm(trimCore)}轉減碼，但都是定期定額買的核心，照扣`);
  if (trimDone.length) sw.push(`${nm(trimDone)}這一輪已經減過`);
  if (trimMix.length) sw.push(`${nm(trimMix)}的核心照扣，機動是這一輪減碼開始之後才買的，這一輪不減`);
  if (trimLate.length) sw.push(`${nm(trimLate)}是這一輪減碼開始之後才買的，這一輪不減`);
  if (!sw.length && coreKeep.length) sw.push('定期定額照扣');
  const sell = sells.length
    ? { k: 'sell', t: `賣 ${list(sells.map((i) => `${i.name} ${sharesText(i.sell.n)}`))}`, why: sw.join('；') }
    : { k: 'none', t: '不用賣', why: sw.join('；') };

  const head = `加碼：${add.t}。減碼：${sell.t}${sell.why ? `，${sell.why}` : ''}。`;
  return { items, buys, free, orders, ans: { add, sell }, head, quiet: !sells.length && !allBuys.length };
}

/** 有可動用的錢、卻沒有要買的：持有和關注的都沒有「可加碼」訊號，或有訊號的為什麼沒分到（不寫金額） */
function noAddWhy(items, inp) {
  const mine = new Map(items.map((i) => [i.code, i]));
  const codes = inp.order && inp.order.length ? inp.order : items.map((i) => i.code);
  const cs = codes.map((code) => {
    const it = mine.get(code) || null;
    const row = inp.rowOf ? inp.rowOf(code) : null;
    return { code, it, row, name: it ? it.name : row ? row.n : code, ps: it ? it.ps : row ? row.ps : null, a: inp.adv ? inp.adv(code) : null };
  });
  if (!cs.length) return '還沒有持股或關注的 ETF';
  const want = cs.filter((x) => x.ps === 'add' || x.ps === 'wait');
  const nw = cs.filter((x) => !x.it).length;
  if (!want.length) return cs.length === 1 ? `${cs[0].name}沒有「可加碼」訊號` : `${nw ? (items.length ? '持有和關注' : '關注') : '持有'}的 ${cs.length} 檔都沒有「可加碼」訊號`;
  const why = [...new Set(want.map((x) => {
    if (x.a && x.a.plan) return planWhy(x.a.plan, { cat: x.row && x.row.k });
    if (x.a && x.a.key === 'full') return '已經到你設定的比重上限';
    return (x.a && noPlanWhy(x.a, x.row)) || `這次沒有分到${inp.cashName || '自由資金'}`;
  }))];
  return `「可加碼」的${want.length > 3 ? `${want.slice(0, 3).map((x) => x.name).join('、')}等 ${want.length} 檔` : list(want.map((x) => x.name))}這次沒有分到：${why.join('；')}`;
}

// ------------------------------------------------------------------ 核心要不要跟減碼訊號：回測
/**
 * 用歷史檔（實際收盤、每 5 個交易日一次的部位訊號取樣、配息、分割）回推「每月定期定額」的兩種做法：
 *   keep：照扣、永遠不賣。
 *   follow：照扣；訊號轉成減碼（取樣到的第一筆）那天賣掉 frac（一般 1/3），訊號轉回可加碼／漲多分批那天，把賣掉拿回的錢全部買回。
 * 和存股時光機一樣：扣款日、訊號都用「那天之前」最近一次取樣（不偷看），用收盤價成交，手續費、證交稅照算，配息再投入下一次扣款。
 * 最大跌幅用時間加權（扣掉每月新存進去的錢），兩種做法用同一套算法。
 * opt：{ start: yyyymm（沒給就從第一個有訊號的下一個月）, amount, day, frac, cat, fee }
 * 回傳 { start, end, months, invested, keep: { value, mdd }, follow: { value, mdd, sells, backs, dear, side } } 或 null
 */
export function coreFollowSim(hist, opt = {}) {
  if (!hist || !Array.isArray(hist.d) || !Array.isArray(hist.p) || !hist.d.length) return null;
  const D = hist.d, P = hist.p;
  const start = opt.start || firstMonth(hist);
  const amount = opt.amount > 0 ? opt.amount : 10000;
  const day = Number.isInteger(opt.day) && opt.day >= 1 && opt.day <= 28 ? opt.day : 1;
  const f = isNum(opt.frac) && opt.frac > 0 ? Math.min(1, opt.frac) : TRIM_DEFAULT;
  const days = deductionDays(D, start, day);
  if (days.length < 6) return null;
  const isDed = new Set(days);
  const evs = [];
  for (const [d, k] of hist.splits || []) if (k > 0) evs.push([d, 0, k]);
  for (const [d, c] of hist.divs || []) if (c > 0) evs.push([d, 1, c]);
  evs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const mk = () => ({ sh: 0, pool: 0, side: 0, twr: 1, peak: 1, mdd: 0, prev: null, sells: 0, backs: 0, dear: 0, sold: [] });
  const K = mk(), F = mk();
  let invested = 0;
  let k0 = 0;
  while (k0 < D.length && D[k0] < days[0]) k0++;
  let e = 0;
  while (e < evs.length && evs[e][0] <= D[k0]) e++;
  let prevTrim = false;
  for (let i = k0; i < D.length; i++) {
    const d = D[i], px = P[i];
    while (i > k0 && e < evs.length && evs[e][0] <= d) {
      const [, kind, v] = evs[e++];
      for (const s of [K, F]) {
        if (kind === 0) { s.sh *= v; for (const x of s.sold) x.px /= v; continue; }
        s.pool += Math.floor(s.sh * v + 1e-9);
      }
    }
    if (!(px > 0)) continue;
    const flow = isDed.has(d) ? amount : 0;
    for (const s of [K, F]) {
      const v0 = s.sh * px + s.pool + s.side;
      if (s.prev != null && s.prev > 0) {
        s.twr *= v0 / s.prev;
        s.peak = Math.max(s.peak, s.twr);
        s.mdd = Math.min(s.mdd, s.twr / s.peak - 1);
      }
      if (flow) {
        s.pool += flow;
        const n = sharesFor(s.pool, px, opt.cat, d, opt.fee);
        if (n > 0) { const c = tradeCost('buy', n, px, opt.cat, d, opt.fee); s.sh += n; s.pool -= c.net; }
      }
    }
    if (flow) invested += flow;
    const sig = signalOn(hist.sig, d);
    const trim = sig === 'trim';
    if (trim && !prevTrim && F.sh > 0) {
      const n = f >= 1 ? Math.floor(F.sh) : Math.floor(F.sh * f);
      if (n > 0) {
        const c = tradeCost('sell', n, px, opt.cat, d, opt.fee);
        F.sh -= n; F.side += c.net; F.sells++;
        F.sold.push({ px, n });
      }
    } else if ((sig === 'add' || sig === 'wait') && F.side > 0) {
      const n = sharesFor(F.side, px, opt.cat, d, opt.fee);
      if (n > 0) {
        const c = tradeCost('buy', n, px, opt.cat, d, opt.fee);
        F.sh += n; F.side -= c.net; F.backs++;
        const sn = F.sold.reduce((t, x) => t + x.n, 0);
        const avg = sn > 0 ? F.sold.reduce((t, x) => t + x.px * x.n, 0) / sn : null;
        if (avg != null && px > avg) F.dear++;
        F.sold = [];
        F.pool += F.side;   // 買不到 1 股的零頭併回去，下一次扣款一起用
        F.side = 0;
      }
    }
    prevTrim = trim;
    for (const s of [K, F]) s.prev = s.sh * px + s.pool + s.side;
  }
  const last = D[D.length - 1];
  const val = (s) => Math.round(s.prev || 0);
  return {
    start: days[0], end: last, months: days.length, invested, amount, day, frac: f,
    keep: { value: val(K), mdd: K.mdd },
    follow: { value: val(F), mdd: F.mdd, sells: F.sells, backs: F.backs, dear: F.dear, side: Math.round(F.side) },
  };
}
