/* 冷眼 — 加碼計畫與市場溫度。
   - 加碼計畫卡（部位分頁的第二張）：可動用的錢＝現金－緊急預備金－定期定額接下來一個月要扣的（－上次更新現金之後已經扣的），
     分 3 份、照順序（可加碼的先、信心高的先）每一檔最多一份（pf.js 的 allocAdds）；每一檔旁邊標「可加碼多少」（planTagHTML）。
   - 全球市場與市場溫度（#temp）：後台 data/global.json（Cboe、Nasdaq、央行、期交所、美國財政部，pipeline/globalmkt.py）。
     溫度只提醒、不改股數；回測一律並列：溫度 vs 任何一天、照冷眼加碼 vs 每月定期定額（pipeline/addsim.py）。
   不連 AI、不替你決定買賣；畫面上每個數字都標日期或時間。 */
import {
  $, $$, esc, isNum, S, PF, settings, fmt, money, sharesOf, ICON, sparkSVG, catName, isPaper, actChip, slotVar, ensureGlobal,
} from './core.js';
import { openCashForm } from './forms.js';
import { openDetail, closeDetail } from './sheet.js';
import * as FX from './fx.js';

// ------------------------------------------------------------------ 小工具
/** 金額寫短一點：8,500、2.4萬、64萬、1.25億 */
export function compact(x) {
  if (!isNum(x)) return '—';
  const a = Math.abs(x);
  if (a >= 1e8) return `${(x / 1e8).toFixed(2)}億`;
  if (a >= 1e6) return `${Math.round(x / 1e4)}萬`;
  if (a >= 1e4) return `${(x / 1e4).toFixed(1).replace(/\.0$/, '')}萬`;
  return Math.round(x).toLocaleString('en-US');
}
const pc1 = (x) => (isNum(x) ? `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(1)}%` : '—');
const pc0 = (x) => (isNum(x) ? `${Math.round(x * 100)}%` : '—');
const ptS = (x, d = 2) => (isNum(x) ? `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(d)}%` : '—');   // 已經是百分比
const hm = (iso) => { const m = /T(\d{2}):(\d{2})/.exec(String(iso || '')); return m ? `${m[1]}:${m[2]}` : ''; };
// 後台 global.json 的日期一律先轉成整數再寫（不把字串原樣放進畫面）
const day8 = (d) => { const n = +d; return Number.isInteger(n) && n >= 19000101 && n <= 21001231 ? n : null; };
const ymS = (d) => { const n = day8(d); return n ? `${Math.floor(n / 10000)}/${Math.floor(n / 100) % 100}` : '—'; };
const dyS = (d) => { const n = day8(d); return n ? fmt.dy(n) : '—'; };
/** 加碼金額：隱藏金額時改寫成占總資產幾 % */
const amtOf = (x, T) => (settings.privacy ? (T > 0 ? `總資產 ${(x / T * 100).toFixed(1)}%` : '••••') : `≈ ${compact(x)}`);

// ------------------------------------------------------------------ 回測的比較句子（照數字寫，不寫死）
/** 冷眼加碼 vs 定期定額：最大跌幅（負數，越接近 0 越小）、期末、溫度打折 */
function simCmp(r) {
  const dd = r.rules.mdd - r.dca.mdd;
  const fin = r.dca.final > 0 ? r.rules.final / r.dca.final : 1;
  const tp = r.rules_temp && r.rules.final > 0 ? r.rules_temp.final / r.rules.final : null;
  return {
    dd: dd >= 0.1 ? '小很多' : dd >= 0.02 ? '比較小' : dd > -0.02 ? '差不多' : '比較大',
    fin: fin < 0.9 ? '少' : fin > 1.1 ? '多' : '差不多',
    tmp: tp == null ? null : Math.abs(tp - 1) < 0.02 ? '幾乎一樣' : tp > 1 ? '多' : '少',
    tradeoff: dd >= 0.02 && fin < 0.9,
  };
}
/** 加碼計畫卡上的一句 */
function simShort(r) {
  const c = simCmp(r);
  const keep = '定期定額要扣的錢先留著、不拿來算加碼，加碼計畫管的是額外的錢。';
  if (c.tradeoff) return `這段期間大多是多頭：錢放著沒買就少賺，冷眼換到的是比較小的跌幅。所以${keep}`;
  return `冷眼的最大跌幅${c.dd === '差不多' ? '和定期定額差不多' : c.dd}，期末${c.fin === '差不多' ? '和定期定額差不多' : `比定期定額${c.fin}`}。${keep}`;
}

// ------------------------------------------------------------------ 市場溫度的小徽章
const WX = {
  晴: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  陰: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.2 18.5h9.6a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.8 1.4A3.3 3.3 0 0 0 7.2 18.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  雨: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.2 14.5h9.6a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.8 1.4A3.3 3.3 0 0 0 7.2 14.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8.5 17.5l-1 2.5M12.5 17.5l-1 2.5M16.5 17.5l-1 2.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};
const LV_CLS = { 晴: 'clear', 陰: 'cloud', 雨: 'rain' };
export function tempBadgeHTML(t, o = {}) {
  if (!t || !WX[t.level]) return '';
  return `<span class="mt-badge ${LV_CLS[t.level]}${o.big ? ' big' : ''}" data-term="temp">${WX[t.level]}<b>${esc(t.level)}</b>${o.n === false ? '' : `<small class="num">${t.flags.length}/7</small>`}</span>`;
}

// ------------------------------------------------------------------ 每一檔旁邊的「可加碼多少」
/** 0 股時的簡短原因（清單上的小字） */
function shortWhy(p) {
  if (p.cuts && p.cuts.includes('prem0')) return '溢價太高';
  switch (p.limit) {
    case 'cash': return !(p.cashAll > 0) ? '未設現金' : !(p.cash > 0) ? '沒有可動用的錢' : PF.planShort(p) ? '錢分給前面的了' : '錢不夠 1 股';
    case 'cap': return '到比重上限';
    case 'cat': return '同類到上限';
    case 'co': return '公司到上限';
    default: return '風險預算太小';
  }
}
/** 持股、關注清單的那一格：可加碼約多少（續抱裡想小額加碼的寫「小額」）；沒有分到就寫為什麼 */
export function planTagHTML(a, T = (S.P && S.P.totals.T) || 0) {
  if (!a || !a.plan || !(T > 0)) return '';
  const p = a.plan;
  if (p.n > 0) return `<span class="ap-tag${a.key === 'hold' ? ' sm' : ''}" data-term="plan">${a.key === 'hold' ? '<i>想加碼：小額</i>' : ''}<b class="num">${esc(amtOf(p.spend, T))}</b></span>`;
  if (!['add', 'full', 'hold_off'].includes(a.key)) return '';
  return `<span class="ap-tag none" data-term="plan">${esc(shortWhy(p))}</span>`;
}

// ------------------------------------------------------------------ 加碼計畫卡（部位分頁）
export function planCardHTML(P) {
  if (!P || !(P.totals.T > 0) || !S.alloc) return '';
  const T = P.totals.T;
  const none = { total: 0, items: [] };
  const dep = P.deploy || { cash: P.totals.cash, emergency: 0, dca: none, spent: none, usable: P.totals.cash };
  const A = S.alloc;
  const funded = [];
  const rest = [];
  for (const code of A.order) {
    const a = A.adv.get(code);
    const row = S.rows.get(code);
    if (!a || !row) continue;
    if (a.plan && a.plan.n > 0) funded.push({ code, a, row });
    else rest.push({ code, a, row });
  }
  const used = funded.reduce((t, x) => t + x.a.plan.spend, 0);
  const held = new Map(P.holdings.map((x) => [x.code, x]));
  const colorOf = (code) => (held.has(code) ? slotVar(held.get(code).slot) : 'var(--glacier)');
  // 現金去哪了：加碼計畫（每一檔）｜剩下沒動的｜定期定額（上次更新現金之後已經扣的＋接下來要扣的）｜緊急預備金
  const cash = Math.max(0, dep.cash);
  const spentT = Math.min(cash, (dep.spent && dep.spent.total) || 0);
  const dcaT = Math.min(Math.max(0, cash - spentT), (dep.dca && dep.dca.total) || 0);
  const emg = Math.min(Math.max(0, cash - spentT - dcaT), dep.emergency || 0);
  const left = Math.max(0, dep.usable - used);
  // 隱藏金額時，提示文字只寫占現金的比例
  const vs = (v) => (settings.privacy ? `${cash > 0 ? Math.round(v / cash * 100) : 0}%` : compact(v));
  const seg = (v, cls, style, title) => (v > 0 ? `<span class="${cls}" style="flex:${v.toFixed(0)} 1 0;${style || ''}" title="${esc(title)}"></span>` : '');
  const bar = cash > 0 ? `<div class="ap-bar" role="img" aria-label="現金的用途：加碼計畫 ${vs(used)}、剩下 ${vs(left)}、定期定額 ${vs(dcaT + spentT)}、緊急預備金 ${vs(emg)}">${
    funded.map((x) => seg(x.a.plan.spend, 'f', `background:${colorOf(x.code)}`, `${x.row.n} ${vs(x.a.plan.spend)}`)).join('')
  }${seg(left, 'left', '', `剩下沒動 ${vs(left)}`)}${seg(dcaT + spentT, 'dca', '', `定期定額 ${vs(dcaT + spentT)}`)}${seg(emg, 'emg', '', `緊急預備金 ${vs(emg)}`)}</div>` : '';
  const paper = isPaper();
  const dcaItems = (dep.dca && dep.dca.items) || [];
  const lastD = dcaItems.length ? dcaItems[dcaItems.length - 1].d : null;
  const nSpent = ((dep.spent && dep.spent.items) || []).length;
  const eq = cash > 0 ? `<div class="ap-eq">
      <span>現金 <b class="num">${money(dep.cash)}</b></span>
      ${!paper ? `<span>− <button class="link num" id="ap-res" data-term="reserve">緊急預備金 ${money(dep.emergency || 0)}</button></span>` : ''}
      ${!paper && dcaT > 0 ? `<span>− <span data-term="deploy">定期定額保留</span> <b class="num">${money(dcaT)}</b><small>（${dcaItems.length} 期，到 ${fmt.d(lastD)}）</small></span>` : ''}
      ${!paper && spentT > 0 ? `<span>− <button class="link" id="ap-spent" data-term="deploy">定期定額已經扣的</button> <b class="num">${money(spentT)}</b><small>（上次更新現金之後 ${nSpent} 期；更新現金後就不用扣）</small></span>` : ''}
      <span class="ap-use">＝ <span data-term="deploy">可動用</span> <b class="num">${money(dep.usable)}</b></span>
    </div>` : '<p class="ap-empty">現金是 0：在上面點現金金額，輸入準備拿來加碼的錢，冷眼就會算出每一檔可以加碼多少。</p>';
  // 分到的錢是「一份」的，原因寫在上面那一句；每一列只寫它自己的（別的上限、只拿到剩下的、減半）
  const rowHTML = (x) => {
    const p = x.a.plan;
    const why = [p.limit === 'cash' && !PF.planShort(p) ? null : `受限於${PF.planLimitText(p, { cat: x.row.k })}`, ...(p.cuts || []).filter((c) => PF.CUT_TEXT[c]).map((c) => PF.CUT_TEXT[c])].filter(Boolean);
    return `<button class="ap-row" data-code="${x.code}">
      <i class="ap-dot" style="background:${colorOf(x.code)}"></i>
      <span class="ap-name">${esc(x.row.n)}</span>
      <span class="ap-amt">${x.a.key === 'hold' ? '<small>想加碼的話</small>' : ''}<b class="num">${esc(amtOf(p.spend, T))}</b></span>
      <span class="ap-sub"><span class="num">${x.code}</span>${held.has(x.code) ? '' : '<em>關注</em>'}${actChip(x.a)}</span>
      <span class="ap-sh">${sharesOf(p.n)}・分 ${p.parts.length} 批</span>
      <span class="ap-why">${why.length ? esc(why.join('；')) + '；' : ''}出場線 <b class="num">${fmt.px(p.stop)}</b></span>
    </button>`;
  };
  const restHTML = rest.length ? `<details class="ap-rest"${funded.length ? '' : ' open'}><summary>沒有分到的 ${rest.length} 檔，為什麼</summary><ul>${rest.map((x) => `<li><button data-code="${x.code}"><span class="ap-name">${esc(x.row.n)}<small class="num">${x.code}</small></span>${actChip(x.a)}<span class="ap-why">${esc(PF.noPlanWhy(x.a, x.row))}</span></button></li>`).join('')}</ul></details>` : '';
  // 你持有的 ETF 還沒拿到成分股明細：單一公司的上限還沒把它們算進去（拿到之後會自動重算）
  const pend = (P.coPending || []).filter((c) => S.rows.has(c));
  const pendHTML = pend.length && funded.length ? `<p class="ap-pend">${esc(pend.join('、'))} 的成分股明細還沒拿到（載入中，或這次抓不到、稍後會再試）：單一公司的上限還沒把它們算進去，上面的金額可能偏高，拿到之後會自動重算。</p>` : '';
  const t = S.global && S.global.temp;
  const tempLine = t ? `<button class="ap-temp" id="ap-temp">${tempBadgeHTML(t)}<span><b>市場溫度：${esc(t.level)}</b>${t.flags.length ? `（${esc(t.flags.map((f) => f.t).join('、'))}）` : '（沒有警訊）'}${t.notes && t.notes.length ? `；${esc(t.notes.map((z) => z.t).join('、'))}` : ''}。只提醒風險、不改股數</span>${ICON.chev}</button>`
    : '<button class="ap-temp" id="ap-temp"><span class="muted">全球市場與市場溫度</span>' + ICON.chev + '</button>';
  const sim = S.global && S.global.sim && S.global.sim.res && S.global.sim.res['0050'];
  const simHTML = sim && sim.dca && sim.rules ? `<button class="ap-bt" id="ap-bt" aria-label="看加碼計畫的回測">
      <span class="ap-bt-h">回測：每月存 ${compact(sim.monthly)}元（${ymS(sim.from)}～${ymS(sim.to)}，0050）</span>
      <span class="ap-bt-r"><span>每月定期定額</span><b class="num">${compact(sim.dca.final)}</b><small>最大跌幅 ${pc1(sim.dca.mdd)}</small></span>
      <span class="ap-bt-r me"><span>照冷眼的加碼計畫</span><b class="num">${compact(sim.rules.final)}</b><small>最大跌幅 ${pc1(sim.rules.mdd)}・平均留 ${pc0(sim.rules.cash)} 現金</small></span>
      <span class="ap-bt-n">${esc(simShort(sim))}</span>
    </button>` : '';
  const slice = isNum(A.slice) ? A.slice : 0;
  const rule = `可動用的錢分 <b class="num">${PF.CASH_SLICES}</b> 份${settings.privacy ? '' : `（一份約 <b class="num">${money(slice)}</b>）`}，照順序每一檔最多拿 1 份：可加碼的先、信心高的先，分完就停；再照紀律、信心、溢價調整。`;
  const plans0 = rest.filter((x) => x.a.plan);
  const tooSmall = plans0.length > 0 && plans0.every((x) => x.a.plan.limit === 'cash' && !(x.a.plan.cuts || []).includes('prem0'));
  const total = funded.length ? `<p class="ap-sum">${rule}合計 <b class="num">${esc(amtOf(used, T))}</b>（${funded.length} 檔）${settings.privacy ? '' : `，剩 <b class="num">${money(left)}</b> 不動`}。</p>`
    : (cash > 0 ? `<p class="ap-sum">${!(dep.usable > 0) ? '可動用的錢是 0：現金都留給緊急預備金和定期定額了。' : tooSmall ? `可動用的錢太少：分 ${PF.CASH_SLICES} 份之後，一份不夠買 1 股。` : '這次沒有分到可以加碼的，每一檔的原因寫在下面。'}</p>` : '');
  return `<div class="sec-h"><h2>加碼計畫${paper ? '（模擬倉）' : ''}</h2><span class="aside" data-term="plan">依你的紀律・${esc(PF.PROFILES[settings.risk].name)}型</span></div>
    <section class="panel ap-card" aria-label="加碼計畫">
      ${bar}${eq}
      ${total}
      ${pendHTML}
      ${funded.length ? `<div class="ap-list">${funded.map(rowHTML).join('')}</div>` : ''}
      ${restHTML}
      ${tempLine}
      ${simHTML}
    </section>`;
}
export function bindPlanCard(v) {
  $$('.ap-card [data-code]', v).forEach((b) => b.addEventListener('click', () => openDetail(b.dataset.code)));
  for (const id of ['#ap-res', '#ap-spent']) {
    const el = $(id, v);
    if (el) el.addEventListener('click', () => openCashForm());
  }
  const tb = $('#ap-temp', v);
  if (tb) tb.addEventListener('click', () => openTemp());
  const bt = $('#ap-bt', v);
  if (bt) bt.addEventListener('click', () => openTemp(true, 'sim'));
}

// ------------------------------------------------------------------ 全球市場與市場溫度（#temp）
export function openTemp(push = true, at = null) {
  if (S.openCode !== '__temp') FX.cue('open');
  S.openCode = '__temp';
  if (push && location.hash !== '#temp') history.pushState({ tool: 'temp' }, '', '#temp');
  const sh = $('#sheet');
  sh.hidden = false;
  document.body.classList.add('locked');
  sh.scrollTop = 0;
  drawTemp(true, at);
  if (!S.global) ensureGlobal({ force: true }).then(() => { if (S.openCode === '__temp') drawTemp(true, at); });
}
/** 資料同步換了 global.json：開著的話重畫（保留捲動位置，不重播動畫） */
export function refreshTemp() {
  const sh = $('#sheet');
  if (S.openCode !== '__temp' || !sh || sh.hidden) return;
  const y = sh.scrollTop;
  drawTemp(false);
  sh.scrollTop = y;
}

const FLAG_DEF = (R) => [
  { k: 'taiex', t: `加權指數在季線（${R.ma_tw} 日均線）之下` },
  { k: 'breadth', t: `${Math.round(R.breadth_low * 100)}% 以上的 ETF 在自己的季線之下` },
  { k: 'spx', t: `S&P 500 在 ${R.ma_us} 日均線之下` },
  { k: 'sox', t: `費城半導體在 ${R.ma_us} 日均線之下` },
  { k: 'vix', t: `VIX 恐慌指數 ${R.vix_hi} 以上` },
  { k: 'twd', t: `新台幣 20 個交易日貶值 ${R.twd_weak}% 以上` },
  { k: 'ust', t: `美國 10 年期公債殖利率 20 個交易日升 ${R.ust_jump} 個百分點以上` },
];
const RULE0 = { ma_tw: 60, ma_us: 200, breadth_low: 0.6, vix_hi: 25, vix_panic: 35, twd_weak: 2, ust_jump: 0.5, night_drop: -1.5 };
/** 後台的門檻：只收數字（不是數字就用預設），畫面上不會出現後台給的其他文字 */
const ruleOf = (rule) => Object.fromEntries(Object.entries(RULE0).map(([k, v]) => [k, rule && Number.isFinite(+rule[k]) ? +rule[k] : v]));
/** 每一個警訊現在的數字（亮不亮看後台算好的 temp.flags） */
function flagValue(G, k) {
  const ix = G.idx || {};
  const vs = (x, n) => (x && isNum(x.c) && isNum(x.ma) ? `${fmt.n(x.c, n)}，均線 ${fmt.n(x.ma, n)}（${ptS((x.c / x.ma - 1) * 100, 1)}）` : '資料暫缺');
  const tw = (G.tw || {}).taiex;
  switch (k) {
    case 'taiex': return [vs(tw, 0), tw && tw.d ? `${fmt.d(tw.d)} 收盤` : ''];
    case 'breadth': return [isNum((G.tw || {}).breadth) ? `${pc0(G.tw.breadth)}（${G.tw.nbr} 檔，不含反向型）` : '資料暫缺', tw && tw.d ? `${fmt.d(tw.d)} 收盤` : ''];
    case 'spx': case 'sox': return [vs(ix[k], 0), ix[k] ? `美東 ${fmt.d(ix[k].d)} 收盤` : ''];
    case 'vix': return [ix.vix && isNum(ix.vix.c) ? fmt.n(ix.vix.c, 2) : '資料暫缺', ix.vix ? `美東 ${fmt.d(ix.vix.d)} 收盤` : ''];
    case 'twd': return [ix.twd && isNum(ix.twd.r20) ? `${fmt.n(ix.twd.c, 3)}，20 日${ix.twd.r20 >= 0 ? '貶' : '升'} ${Math.abs(ix.twd.r20).toFixed(1)}%` : '資料暫缺', ix.twd ? `${fmt.d(ix.twd.d)} 銀行間收盤` : ''];
    case 'ust': return [isNum((G.ust || {}).d20) ? `20 日 ${G.ust.d20 >= 0 ? '+' : '−'}${Math.abs(G.ust.d20).toFixed(2)} 個百分點` : '資料暫缺', ''];
    default: return ['', ''];
  }
}
/** 美股報價的時間說法（交易所的延遲報價，時間是美東） */
function usWhen(x) {
  const L = x.live;
  if (L && L.open) return `盤中・美東 ${fmt.d(L.d)} ${L.t || ''}（延遲 15 分鐘）`;
  if (L && L.close) return `美東 ${fmt.d(L.d)} 收盤`;
  if (L && L.t) return `美東 ${fmt.d(L.d)} ${L.t}（還沒開盤）`;
  return `美東 ${fmt.d(x.d)} 收盤`;
}
function ringSVG(lit, total = 7, anim = false) {
  const R = 54, cx = 64, cy = 64, gap = 7;
  const span = 360 / total;
  const pt = (deg) => { const a = (deg - 90) * Math.PI / 180; return [cx + R * Math.cos(a), cy + R * Math.sin(a)]; };
  let segs = '';
  for (let i = 0; i < total; i++) {
    const a0 = i * span + gap / 2, a1 = (i + 1) * span - gap / 2;
    const [x0, y0] = pt(a0), [x1, y1] = pt(a1);
    segs += `<path class="seg${i < lit ? ' lit' : ''}" style="--i:${i}" d="M${x0.toFixed(2)} ${y0.toFixed(2)}A${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}"/>`;
  }
  return `<svg class="mt-ring${anim ? ' anim' : ''}" viewBox="0 0 128 128" aria-hidden="true"><circle class="trk" cx="${cx}" cy="${cy}" r="${R - 9}"/>${segs}</svg>`;
}
function drawTemp(anim = false, at = null) {
  const sh = $('#sheet');
  const G = S.global;
  const top = `<div class="sheet-top"><button class="icon-btn" id="back" aria-label="返回">${ICON.back}</button><span class="ttl"><b class="ttl-b">全球市場與溫度</b><span>${G && G.at ? `後台 ${fmt.d(+String(G.at).slice(0, 10).replace(/-/g, ''))} ${hm(G.at)} 更新` : '加碼前先看一眼'}</span></span></div>`;
  if (!G || !G.temp) {
    sh.innerHTML = top + `<div class="sheet-body tool mt"><div class="skeleton" style="height:220px"></div><p class="disclaim">${S.global === null ? '全球市場的資料還在載入；後台第一次整理好之前這裡是空的。' : ''}</p></div>`;
    $('#back', sh).addEventListener('click', () => closeDetail());
    return;
  }
  const t = G.temp;
  const R = ruleOf(G.rule);
  const litSet = new Set(t.flags.map((f) => f.k));
  // 七個警訊照固定順序列（位置不跳），環上亮的格數＝警訊數
  const flags = FLAG_DEF(R).map((d) => ({ ...d, on: litSet.has(d.k) }));
  const asof = t.asof || {};
  const hero = `<section class="mt-hero ${LV_CLS[t.level] || ''}">
      <div class="mt-dial">${ringSVG(t.flags.length, 7, anim && settings.fx !== false)}<div class="mt-c"><b class="mt-lv">${esc(t.level)}</b><span class="mt-n num">${t.flags.length}／7 警訊</span></div></div>
      <div class="mt-say"><h2>${t.level === '晴' ? '風險訊號不多' : t.level === '陰' ? '有幾個風險訊號' : t.flags.length >= 4 ? '風險訊號很多' : `VIX 到了 ${R.vix_panic} 以上（市場恐慌）`}</h2>
        <p>${t.flags.length ? esc(t.flags.map((f) => f.t).join('、')) + '。' : '七個警訊都沒有亮。'}${t.notes && t.notes.length ? ` ${esc(t.notes.map((z) => z.t).join('、'))}。` : ''}</p>
        <p class="mt-asof">台灣看 ${fmt.d(asof.tw)} 收盤；美股、VIX 看美東 ${fmt.d(asof.us)} 收盤；匯率看 ${fmt.d(asof.twd)}。只提醒風險，<b>不改加碼股數</b>。</p></div>
    </section>`;
  const flagList = `<div class="sec-h"><h2>七個警訊</h2><span class="aside">2 個以上陰、4 個以上雨</span></div>
    <section class="panel list mt-flags">${flags.map((f) => { const [v, d] = flagValue(G, f.k); return `<div class="mt-f${f.on ? ' on' : ''}"><i class="mt-led" aria-hidden="true"></i><span class="mt-ft">${esc(f.t)}</span><span class="mt-fv num">${esc(v)}${d ? `<small>${esc(d)}</small>` : ''}</span><span class="mt-fs">${f.on ? '警訊' : '沒有'}</span></div>`; }).join('')}</section>`;
  // 全球指數
  const ix = G.idx || {};
  const card = (name, px, pct, when, spark, extra = '') => `<div class="mt-ix"><span class="mt-ixn">${esc(name)}</span><span class="mt-ixv num">${px}</span><span class="mt-ixc num ${isNum(pct) ? (pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat') : ''}">${isNum(pct) ? ptS(pct) : ''}</span>${spark || ''}<span class="mt-ixw">${esc(when)}${extra}</span></div>`;
  const cards = [];
  for (const [k, nm, d] of [['spx', 'S&P 500', 2], ['ndx', '那斯達克 100', 2], ['sox', '費城半導體', 2], ['vix', 'VIX 恐慌指數', 2]]) {
    const x = ix[k];
    if (!x) continue;
    const L = x.live;
    const px = L ? L.px : x.c;
    const pct = L && isNum(L.pct) ? L.pct : x.chg;
    cards.push(card(nm, fmt.n(px, d), pct, usWhen(x), sparkSVG(x.spark, 96, 26, pct), L && L.at ? `<small>後台 ${hm(L.at)} 抓到</small>` : ''));
  }
  if (ix.twd) cards.push(card('新台幣（每美元）', fmt.n(ix.twd.c, 3), ix.twd.chg, `${fmt.d(ix.twd.d)} 銀行間收盤（央行）`, sparkSVG(ix.twd.spark, 96, 26, ix.twd.chg)));
  const tx = G.txf || {};
  if (tx.txf_day) cards.push(card('台指期・日盤', fmt.n(tx.txf_day.px, 0), tx.txf_day.pct, `${fmt.d(tx.txf_day.d)} ${tx.txf_day.t || ''}`, ''));
  if (tx.txf_night) cards.push(card('台指期・夜盤', fmt.n(tx.txf_night.px, 0), tx.txf_night.pct, `${fmt.d(tx.txf_night.d)} 15:00 開盤的夜盤・最新 ${tx.txf_night.t || '—'}`, ''));
  const ixHTML = `<div class="sec-h"><h2>全球市場</h2><span class="aside">美股盤中、夜盤每 10 分鐘</span></div><section class="mt-grid">${cards.join('')}</section>`;
  // 溫度準不準：回測
  const bt = G.bt && G.bt.res && G.bt.res['0050'];
  let btHTML = '';
  if (bt) {
    const rowsB = ['任何一天', '晴', '陰', '雨'].filter((k) => bt[k]).map((k) => { const x = bt[k]; return `<tr class="${k === t.level ? 'now' : ''}${k === '任何一天' ? ' base' : ''}"><td>${k === '任何一天' ? '任何一天' : `${tempBadgeHTML({ level: k, flags: [] }, { n: false })}`}</td><td class="r num">${fmt.n(x.n)}</td><td class="r num">${pc1(x.avg)}</td><td class="r num">${pc0(x.up)}</td><td class="r num">${pc1(x.p10)}</td><td class="r num">${pc1(x.mdd)}</td></tr>`; }).join('');
    const h = Number.isInteger(+G.bt.h) ? +G.bt.h : 20;
    const rn = bt['雨'], cl = bt['晴'];
    let read = '這段期間的資料還分不出明顯差別。';
    if (rn && cl && isNum(rn.p10) && isNum(cl.p10) && isNum(rn.up)) {
      const gap = cl.p10 - rn.p10;
      const sep = gap >= 0.05 ? '溫度分得出風險高低（最差的情況差很多）' : gap > 0.01 ? '雨的最差情況比晴差一些' : null;
      if (sep) read = `雨的日子之後 ${h} 個交易日，上漲的比例 ${pc0(rn.up)}、最差 10% 的情況 ${pc1(rn.p10)}；晴是 ${pc0(cl.up)}、${pc1(cl.p10)}。${sep}，但雨之後${rn.up >= 0.5 ? '一樣有一半以上的時候是漲的' : '上漲的比例不到一半'}——它不是叫你賣，是提醒你接下來波動可能比較大。`;
    }
    btHTML = `<div class="sec-h"><h2>溫度準不準</h2><span class="aside">0050，之後 ${h} 個交易日</span></div>
      <section class="panel tbl-wrap"><table class="t mt-bt"><thead><tr><th>那一天</th><th class="r">天數</th><th class="r">平均</th><th class="r">上漲</th><th class="r">最差10%</th><th class="r">期間跌幅</th></tr></thead><tbody>${rowsB}</tbody></table>
      <p class="small muted pad-x mt-note">${dyS(G.bt.from)}～${dyS(G.bt.to)} 每個交易日用「那天收盤時已經知道的資料」算溫度（不偷看），再看買 0050 之後 ${h} 個交易日的含息報酬；「期間跌幅」是那段時間最低點離買進價多遠（平均）。${read}</p></section>`;
  }
  // 加碼計畫的回測
  const sim = G.sim && G.sim.res;
  let simHTML = '';
  if (sim && Object.keys(sim).length) {
    const blocks = Object.values(sim).map((r) => `<tr class="grp"><td colspan="5"><b>${esc(r.name || r.code)}</b> <span class="num">${esc(r.code)}</span><small>${dyS(r.from)}～${dyS(r.to)}，每月存 ${compact(r.monthly)}元，共投入 ${compact(r.dca.invested)}元</small></td></tr>
      ${[['dca', '每月定期定額'], ['rules', '冷眼加碼計畫'], ['rules_temp', '＋溫度打折']].filter(([k]) => r[k]).map(([k, nm]) => { const x = r[k]; return `<tr class="${k === 'rules' ? 'me' : ''}"><td>${nm}</td><td class="r num">${compact(x.final)}</td><td class="r num">${pc1(x.mdd)}</td><td class="r num">${pc1(x.p10)}</td><td class="r num">${pc0(x.cash)}</td></tr>`; }).join('')}`).join('');
    const r = sim['0050'] || Object.values(sim)[0];
    const c = simCmp(r);
    const caps = G.sim.caps && typeof G.sim.caps === 'object' ? G.sim.caps : null;
    const pcN = (x) => (isNum(x) ? `${Math.round(x * 100)}%` : '—');
    const capTxt = caps ? `單檔上限照穩健型（${Object.entries(caps).filter(([k]) => PF.CAT_NAMES[k]).map(([k, v]) => `${PF.CAT_NAMES[k]} ${pcN(v)}`).join('、')}）` : '單檔上限 60%';
    simHTML = `<div class="sec-h" id="mt-sim"><h2>加碼計畫的回測</h2><span class="aside">照冷眼建議 vs 每月固定金額</span></div>
      <section class="panel tbl-wrap"><table class="t mt-sim"><thead><tr><th>做法</th><th class="r">期末</th><th class="r">最大跌幅</th><th class="r">最差10%</th><th class="r">現金</th></tr></thead><tbody>${blocks}</tbody></table>
      <div class="prose pad mt-read"><p>「最大跌幅」是這個做法的報酬從最高點跌下來最深的一次（不受存錢影響）；「最差10%」是任何一段 20 個交易日裡最差的 10%；「現金」是平均有多少比例的錢留著沒買。</p>
        <p>每個月第一個交易日存一筆錢：定期定額當天全部買；冷眼的加碼計畫把錢先放著，訊號「可加碼／漲多分批」的日子照紀律買，觀點中性的「續抱」日子買一半（單筆最多虧總資產 1%、${capTxt}、現金分 3 份、信心不到 70 減半），「減碼」時賣三分之一、超過上限賣回上限。用那天收盤時已經知道的資料，不偷看；用收盤價成交、含息。和 App 現在的算法不完全一樣：只有一檔、出場線一律用移動防守線，沒有算手續費、單一公司上限和溢價（沒有歷史的成分股明細與盤中溢價）。</p>
        <p>結果：照冷眼的加碼計畫，<b>最大跌幅 ${pc1(r.rules.mdd)}</b>，${c.dd === '差不多' ? '和' : '比'}定期定額的 ${pc1(r.dca.mdd)} ${c.dd}；平均留了 <b>${pc0(r.rules.cash)}</b> 的現金，<b>期末 ${compact(r.rules.final)}，${c.fin === '差不多' ? '和' : '比'}定期定額的 ${compact(r.dca.final)} ${c.fin}</b>${c.tradeoff ? '（這段期間大多是多頭，錢放著沒買就少賺）' : ''}。${r.rules_temp ? `加上市場溫度打折（陰減半、雨剩四分之一）期末 ${compact(r.rules_temp.final)}，${c.tmp === '幾乎一樣' ? '和沒打折的幾乎一樣' : `比沒打折的${c.tmp}`}${c.tmp === '多' ? '；冷眼目前還是不拿溫度改股數（第一次回測沒有變好，結果改變時要連最大跌幅、最差 10% 一起重新評估）' : '——所以冷眼不拿溫度改股數'}。` : ''}</p>
        <p>這代表：加碼計畫不是用來取代定期定額的。冷眼把定期定額接下來要扣的錢先留著、不拿來算加碼；加碼計畫管的是額外的錢，它的好處是不追高、跌的時候比較少，代價是多頭的時候少賺。過去的結果不代表未來。</p></div></section>`;
  }
  const srcs = Object.values(G.src || {}).filter((s) => s && typeof s.n === 'string').map((s) => (typeof s.u === 'string' && /^https:\/\//.test(s.u) ? `<li><a href="${esc(s.u)}" target="_blank" rel="noopener">${esc(s.n)}</a></li>` : `<li>${esc(s.n)}</li>`)).join('');
  sh.innerHTML = top + `<div class="sheet-body tool mt">
    ${hero}${flagList}${ixHTML}${btHTML}${simHTML}
    <section class="panel"><details class="rules"><summary>市場溫度怎麼判斷</summary><div class="in prose">${tempRulesHTML(G.rule)}</div></details></section>
    <section class="panel pad mt-src"><b>來源</b><ul>${srcs}<li>美國財政部：10 年期公債殖利率</li><li>證交所、櫃買中心：加權指數與每一檔 ETF 的收盤</li></ul></section>
    <p class="disclaim">市場溫度是固定規則數警訊，不連 AI、不預測漲跌，也不替你決定買賣。美股報價是交易所延遲 15 分鐘的報價，畫面上的時間是美東時間。</p>
  </div>`;
  $('#back', sh).addEventListener('click', () => closeDetail());
  if (at === 'sim') { const el = $('#mt-sim', sh); if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'start' })); }
  if (anim && settings.fx !== false) FX.sfx('scan');
}

/** 設定頁「市場溫度怎麼判斷」（照後台 global.json 的 rule 寫，門檻改了會跟著變） */
export function tempRulesHTML(rule) {
  const R = ruleOf(rule || (S.global && S.global.rule));
  return `<p><b>七個警訊</b>（固定門檻）：① 加權指數收在季線（${R.ma_tw} 日均線）之下；② ${Math.round(R.breadth_low * 100)}% 以上的 ETF（不含反向型）收在自己的季線之下；③ S&P 500 在 ${R.ma_us} 日均線之下；④ 費城半導體在 ${R.ma_us} 日均線之下；⑤ VIX ${R.vix_hi} 以上；⑥ 新台幣 20 個交易日貶值 ${R.twd_weak}% 以上；⑦ 美國 10 年期公債殖利率 20 個交易日上升 ${R.ust_jump} 個百分點以上。</p>
    <p><b>等級</b>0～1 個晴、2～3 個陰、4 個以上雨；VIX ${R.vix_panic} 以上直接算雨。台指期夜盤跌超過 ${Math.abs(R.night_drop)}% 只在台股開盤前提醒，不算進警訊（沒有歷史可以回測）。</p>
    <p><b>不偷看</b>台灣這一側用收盤資料；美股、VIX、匯率、美債用前一天以前的（美股在台灣收盤之後才開盤，匯率下午才公布），回測也用同樣的算法。</p>
    <p><b>只提醒、不改股數</b>回測（2020/4 起，0050）：雨的日子之後 20 個交易日的最差 10% 明顯比晴差，溫度分得出風險高低；但拿溫度去打折加碼金額（陰減半、雨剩四分之一），結果沒有變好，所以加碼計畫的股數不看溫度。</p>
    <p><b>更新</b>美股盤中、台指期夜盤每 10 分鐘一輪（美股是交易所延遲 15 分鐘的報價）；歷史收盤每天早上 07:45 整理一次。來源：Cboe（VIX、S&P 500）、Nasdaq（那斯達克 100、費城半導體）、中央銀行（新臺幣/美元銀行間收盤匯率）、臺灣期貨交易所（台指期）、美國財政部（公債殖利率）、證交所與櫃買中心。</p>`;
}

// ------------------------------------------------------------------ 指揮台的一條：加碼計畫的摘要（點了到「部位」的加碼計畫卡）
export function planStripHTML(P) {
  if (!P || !(P.totals.T > 0) || !S.alloc) return '';
  const T = P.totals.T;
  const dep = P.deploy || { usable: P.totals.cash };
  let used = 0;
  let n = 0;
  for (const a of S.alloc.adv.values()) if (a && a.plan && a.plan.n > 0) { used += a.plan.spend; n += 1; }
  const t = S.global && S.global.temp;
  const v = settings.privacy
    ? (n ? `分給 <b class="num">${n}</b> 檔，合計約總資產 <b class="num">${(used / T * 100).toFixed(1)}%</b>` : '這次沒有分到的')
    : `可動用 <b class="num">${compact(dep.usable)}</b>${n ? `・分給 <b class="num">${n}</b> 檔 ≈ <b class="num">${compact(used)}</b>` : '・這次沒有分到的'}`;
  return `<section class="panel ap-strip"><button id="ap-go" aria-label="打開加碼計畫"><span class="ap-s-k" data-term="plan">加碼計畫${isPaper() ? '・模擬倉' : ''}</span><span class="ap-s-v">${v}</span>${tempBadgeHTML(t)}${ICON.chev}</button></section>`;
}

// ------------------------------------------------------------------ 情報分頁最上面：全球市場一條（點了打開 #temp）
export function globalTickerHTML() {
  const G = S.global;
  if (!G || !G.idx) return '';
  const ix = G.idx;
  const one = (name, x) => {
    if (!x) return '';
    const L = x.live;
    const pct = L && isNum(L.pct) ? L.pct : x.chg;
    return `<span class="gx-i"><i>${esc(name)}</i><b class="num ${isNum(pct) ? (pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat') : ''}">${isNum(pct) ? ptS(pct) : '—'}</b></span>`;
  };
  const tx = (G.txf || {}).txf_night;
  const items = [one('S&P 500', ix.spx), one('那斯達克', ix.ndx), one('費半', ix.sox),
    ix.vix ? `<span class="gx-i"><i>VIX</i><b class="num">${fmt.n((ix.vix.live && ix.vix.live.px) || ix.vix.c, 1)}</b></span>` : '',
    ix.twd ? `<span class="gx-i"><i>新台幣</i><b class="num">${fmt.n(ix.twd.c, 2)}</b></span>` : '',
    tx ? `<span class="gx-i"><i>台指期夜盤</i><b class="num ${tx.pct > 0 ? 'up' : tx.pct < 0 ? 'down' : 'flat'}">${ptS(tx.pct)}</b></span>` : ''].join('');
  // 這幾個數字是什麼時候的（美股是交易所延遲 15 分鐘的報價，時間是美東）
  const L = ix.spx && ix.spx.live;
  const when = ix.spx ? (L && L.open ? `美股盤中・美東 ${L.t || ''}（延遲 15 分鐘）` : `美股 ${fmt.d((L && L.close ? L.d : null) || ix.spx.d)} 收盤`) : '';
  const wn = tx && tx.t ? `夜盤最新 ${tx.t}` : '';
  return `<button class="panel gx-tick" id="gx-tick" aria-label="打開全球市場與溫度">${tempBadgeHTML(G.temp)}<span class="gx-items">${items}<span class="gx-w">${esc([when, wn].filter(Boolean).join('・'))}</span></span>${ICON.chev}</button>`;
}
export function bindGlobalTicker(v) {
  const b = $('#gx-tick', v);
  if (b) b.addEventListener('click', () => openTemp());
}
