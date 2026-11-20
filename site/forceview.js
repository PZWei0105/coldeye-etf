/* 冷眼 — 兵力分頁的畫面（2026/11/20）：今日指令、自由資金（存入／提出／改成）、每一檔的核心（定期定額）與機動（自己買的）、
   核心要不要跟減碼訊號（附你的每一檔的回測）、指揮台今日行動與晨報的兵力指令、單檔頁「我的兵力」。
   計算全部在 force.js（純函式，core.js 的 computePF 算好放在 S.force）；這裡只負責畫，「隱藏金額」時遮掉金額與股數。 */
import { $, $$, esc, isNum, S, PF, settings, saveSettings, fmt, money, sharesOf, ICON, today, isPaper, bus, ensureHist, toast } from './core.js';
import { coreFollowSim, dcaMonthly } from './force.js';
import { planDays, firstMonth } from './calc.js';
import { compact } from './plan.js';
import { openCashForm } from './forms.js';
import { openDetail } from './sheet.js';
import { haloHTML, rollAttr } from './hud.js';
import * as FX from './fx.js';

const MASK = '••••';
const priv = () => settings.privacy === true;
/** 隱藏金額時，指令文字裡的股數（3 張 182 股、901 股）遮掉；價格（84.45）、百分比、日期照常 */
export const maskSh = (t) => (priv() ? String(t).replace(/\d[\d,]*\s*張(\s*\d[\d,]*\s*股)?|\d[\d,]*\s*股/g, MASK) : String(t));
const tx = (t) => esc(maskSh(t));
/** 金額寫短一點（8,500 元、8.3萬元）；隱藏時寫占總資產幾 % */
const yuan = (x) => { const c = compact(x); return /[萬億]$/.test(c) ? `${c}元` : `${c} 元`; };
const amt = (x, T) => (priv() ? (T > 0 ? `總資產 ${(Math.abs(x) / T * 100).toFixed(1)}%` : MASK) : yuan(x));
const pc1 = (x) => (isNum(x) ? `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(1)}%` : '—');
const ym = (d) => (d ? `${Math.floor(d / 10000)}/${Math.floor(d / 100) % 100}` : '—');
const ymZ = (d) => (d ? `${Math.floor(d / 10000)} 年 ${Math.floor(d / 100) % 100} 月` : '—');
// 「核心照扣」用極光紫（你自己）；class 叫 self，不叫 core（.core 是副官核心的圖，會被撐滿整列）
const CHIP_CLS = { warn2: 'warn2', go: 'go', mute: 'mute', warn: 'warn', core: 'self' };
export const forceItemOf = (code) => (S.force ? S.force.items.find((i) => i.code === code) || null : null);
export function forceChipHTML(code) {
  const i = forceItemOf(code);
  if (!i || !i.chip) return '';
  return `<span class="chip act ${CHIP_CLS[i.chip[1]] || 'mute'}" data-term="force">${tx(i.chip[0])}</span>`;
}

// ------------------------------------------------------------------ 今日指令
// 第一眼就回答「今天加多少、減多少、留多少」（2026/11/21，PZ：「找不到它建議我現在是繼續加碼投資、投資多少」）：
// 加碼／減碼／留著三列，要做的那幾檔放在各自那一列底下；持有的其他幾檔寫為什麼今天不加碼、要等到什麼價位。
const SIG_CLS = { trim: 'warn2', caution: 'warn', add: 'go2', wait: 'go2', hold: 'mute', pause: 'warn', none: 'mute' };
/** 主句裡的金額：隱藏金額時改寫成占總資產幾 %（glue：隱藏時接在前面那句後面的字） */
const amtSay = (lead, x, T, glue = '') => (priv()
  ? `${esc(lead)}${glue}占總資產 <b class="num">${T > 0 ? (Math.abs(x) / T * 100).toFixed(1) : '—'}%</b>`
  : `${esc(lead)} <b class="num">${esc(yuan(x))}</b>`);
/** 要買的一檔（只有一檔時金額已經寫在「加碼」那一句，這裡不重複） */
function buyRow(o, T, one) {
  return `<li><button class="fz-o bare buy" data-code="${esc(o.code)}"><span class="fz-b"><span class="fz-t"><b>${esc(o.name)}</b><span class="fz-n num">${sharesOf(o.n)}</span></span><small>${[o.held ? '' : '關注的', one ? '' : `約 ${amt(o.spend, T)}`, `分 ${o.parts} 批`, `出場線 ${fmt.px(o.stop)}`].filter(Boolean).join('・')}</small>${o.lim ? `<small class="fz-lim">只買這麼多：${esc(o.lim)}</small>` : ''}</span>${ICON.chev}</button></li>`;
}
/** 要賣的一檔（只有一檔時金額已經寫在「減碼」那一句，這裡不重複） */
function sellRow(o, T, one) {
  const from = o.core && o.mob ? `機動 ${sharesOf(o.mob)}＋核心 ${sharesOf(o.core)}` : o.core ? '核心（定期定額買的）' : '機動（自己買的）';
  return `<li><button class="fz-o bare sell" data-code="${esc(o.code)}"><span class="fz-b"><span class="fz-t"><b>${esc(o.name)}</b><span class="fz-n num">${sharesOf(o.n)}</span></span><small>${[from, o.by === 'over' ? '超過比重上限' : '這一輪減碼', one ? '' : `約拿回 ${amt(o.net, T)}`].filter(Boolean).join('・')}</small></span>${ICON.chev}</button></li>`;
}
/** 持有、今天不加碼的一檔：規則訊號、為什麼、等到什麼價位（只寫價位那一句，價位放大） */
function heldRow(i) {
  const g = i.sig || { k: 'none', t: '—' };
  const wait = i.wait ? esc(String(i.wait).split('，')[0]).replace(/\d[\d,]*\.\d+/, '<b class="num">$&</b>') : '';
  return `<li><button class="fz-o bare held" data-code="${esc(i.code)}"><span class="fz-b"><span class="fz-t"><b>${esc(i.name)}</b><span class="chip act ${SIG_CLS[g.k] || 'mute'}">${esc(g.t)}</span></span>${i.noAdd ? `<small class="fz-why1">${tx(i.noAdd)}</small>` : ''}${wait ? `<small class="fz-wt">等${wait}</small>` : ''}</span>${ICON.chev}</button></li>`;
}
const ansRow = (k, on, label, body) => `<div class="fz-a ${k}"><dt><span class="fz-tag ${on || 'off'}">${label}</span></dt><dd>${body}</dd></div>`;
export function forceOrdersHTML(P) {
  const F = S.force;
  if (!F || !F.ans || !P || !(P.totals.T > 0)) return '';
  const T = P.totals.T;
  const fr = F.free;
  const paper = isPaper();
  const cn = paper ? '模擬倉現金' : '自由資金';
  const sells = F.orders.filter((o) => o.k === 'sell');
  const buys = F.orders.filter((o) => o.k === 'buy');
  const tone = sells.length ? 'warn' : buys.length ? 'go' : 'calm';
  // 加碼：今天用多少、買哪幾檔；沒有的話為什麼
  const ad = F.ans.add;
  let addB;
  if (ad.k === 'buy') addB = `<b class="fz-am">${amtSay(`今天用${cn}`, fr.use, T, '，')}</b><ol class="fz-list">${buys.map((o) => buyRow(o, T, buys.length === 1)).join('')}</ol>`;
  else if (ad.k === 'unset') addB = `<b class="fz-am">還算不出來</b><small>還沒設定自由資金：輸入準備拿來單筆加碼的錢（沒有就填 0），冷眼就會照你的紀律算出今天加多少；比重上限也要用「持股＋自由資金」才算得準。</small><span class="fz-btns"><button class="btn small primary" data-free="set">${ICON.plus}設定自由資金</button></span>`;
  else {
    const neg = ad.k === 'zero' && fr.now <= 0 && !paper;
    addB = `<b class="fz-am">今天不加碼</b><small>${tx(String(ad.t).replace(/^今天不加碼，/, ''))}${neg ? (fr.now < 0 ? '：記的單筆買進比設定的多，記得存入或改成實際的金額' : '：想加碼的話，先存入準備拿來加碼的錢') : ''}</small>${neg ? `<span class="fz-btns"><button class="btn small" data-free="in">${ICON.plus}存入</button>${fr.now < 0 ? '<button class="btn small ghost" data-free="set">改成</button>' : ''}</span>` : ''}`;
  }
  // 減碼：賣哪幾檔；不用賣的話，有減碼訊號的為什麼不賣
  const sl = F.ans.sell;
  const sellB = sells.length
    ? `<b class="fz-am">${amtSay(`今天賣 ${sells.length} 檔，約拿回`, fr.back, T)}</b><ol class="fz-list">${sells.map((o) => sellRow(o, T, sells.length === 1)).join('')}</ol>${sl.why ? `<small>${tx(sl.why)}</small>` : ''}`
    : `<b class="fz-am">不用賣</b>${sl.why ? `<small>${tx(sl.why)}</small>` : ''}`;
  // 留著：自由資金做完今天的指令還剩多少（可動用、緊急預備金、定期定額另外扣）
  let keepB = '';
  if (fr.set && fr.now > 0) {
    const m = paper ? 0 : dcaMonthly(settings.plans, today());
    const sub = [
      fr.usable > 0 ? `可動用 ${amt(fr.usable, T)}${fr.use > 0 ? `，今天用 ${amt(fr.use, T)}` : '，沒有要買的先放著'}` : '',
      fr.reserve > 0 ? `緊急預備金 ${amt(fr.reserve, T)} 不動` : '',
      fr.dca > 0 ? `定期定額先留 ${amt(fr.dca, T)}` : !paper && m ? `定期定額每月 ${priv() ? MASK : yuan(m)}另外扣` : '',
      fr.back > 0 ? `賣出約拿回的 ${amt(fr.back, T)} 也會回到這裡` : '',
    ].filter(Boolean);
    keepB = `<button class="fz-am fz-go" data-fz-free>${amtSay(cn, Math.max(0, fr.keep), T)}${ICON.chev}</button>${sub.length ? `<small>${esc(sub.join('；'))}</small>` : ''}`;
  }
  // 持有的其他幾檔：為什麼今天不加碼、要等到什麼價位
  const rest = F.items.filter((i) => i.act !== 'buy');
  const heldB = rest.length ? `<div class="fz-held"><p class="fz-hh">持有的${rest.length < F.items.length ? '其他' : ''} ${rest.length} 檔今天不加碼</p><ol class="fz-list">${rest.map(heldRow).join('')}</ol></div>` : '';
  return `<div class="sec-h"><h2 data-term="force">今日指令</h2><span class="aside">${esc(PF.PROFILES[settings.risk].name)}型紀律・照你的兵力算</span>${haloHTML('eod')}</div>
    <section class="panel fz-cmd tone-${tone}" id="fz-cmd" aria-label="今日指令">
      <dl class="fz-ans">
        ${ansRow('add', ad.k === 'buy' ? 'buy' : '', '加碼', addB)}
        ${ansRow('sell', sells.length ? 'sell' : '', '減碼', sellB)}
        ${keepB ? ansRow('keep', 'free', '留著', keepB) : ''}
      </dl>
      ${heldB}
      ${sells.length || buys.length ? '<p class="fz-foot">照做之後在冷眼「記一筆」：自由資金、股數和明天的指令會自動跟著改。</p>' : ''}
    </section>`;
}

// ------------------------------------------------------------------ 自由資金
export function freeCardHTML(P) {
  if (!P || isPaper() || !P.free) return '';
  const fc = P.free;
  const dep = P.deploy || {};
  const T = P.totals.T;
  const m = dcaMonthly(settings.plans, today());
  const set = fc.d ? `${fmt.d(fc.d)} 設定 ${money(fc.base)}${fc.items.length ? `，之後的單筆買賣 ${money(fc.flow, true)}` : ''}` : '還沒設定';
  const led = fc.items.length ? `<details class="fz-led"><summary>${fmt.d(fc.d)} 之後記的單筆買賣 ${fc.items.length} 筆</summary><ul>${fc.items.slice(-12).reverse().map((x) => {
    const r = S.rows.get(x.c);
    return `<li><span>${fmt.d(x.d)}</span><span class="nm">${x.side === 'sell' ? '賣出' : '買進'} ${esc(r ? r.n : x.c)}${x.dca ? '（定期定額）' : ''}</span><b class="num ${x.amt >= 0 ? 'in' : ''}">${money(x.amt, true)}</b></li>`;
  }).join('')}</ul></details>` : '';
  return `<div class="sec-h"><h2 data-term="free">自由資金</h2><span class="aside">${esc(set)}</span></div>
    <section class="panel fz-free" aria-label="自由資金">
      <div class="fz-free-top">
        <div class="fz-free-v"><b class="num${fc.now < 0 ? ' bad' : ''}"${rollAttr('free', money(fc.now))}>${money(fc.now)}</b><small>元${fc.now < 0 ? '・買超過了，記得存入或改成實際的金額' : ''}</small></div>
        <div class="fz-free-btns" role="group" aria-label="改自由資金"><button class="btn small" data-free="in">${ICON.plus}存入</button><button class="btn small" data-free="out">提出</button><button class="btn small ghost" data-free="set">改成</button></div>
      </div>
      <div class="fz-eq">
        <span>自由資金 <b class="num">${money(Math.max(0, fc.now))}</b></span>
        <span>− <button class="link" data-free="res" data-term="reserve">緊急預備金</button> <b class="num">${money(dep.emergency || 0)}</b></span>
        ${!dep.sep && dep.dca && dep.dca.total ? `<span>− 定期定額保留 <b class="num">${money(dep.dca.total)}</b><small>（${dep.dca.items.length} 期）</small></span>` : ''}
        <span class="fz-use">＝ <span data-term="deploy">可動用</span> <b class="num">${money(dep.usable)}</b></span>
      </div>
      <p class="fz-note">${dep.sep ? `定期定額${m ? `每月 ${priv() ? MASK : money(m)} 元` : ''}另外扣，不算在自由資金裡。` : `定期定額${m ? `每月 ${priv() ? MASK : money(m)} 元` : ''}從自由資金扣：扣款前先留一個月的錢。`}之後記的單筆買進會自動從自由資金扣、賣出加回。${T > 0 ? `自由資金占總資產 ${fmt.r(Math.max(0, fc.now) / T, 1, false)}。` : ''}</p>
      ${led}
    </section>`;
}

// ------------------------------------------------------------------ 每一檔（持股清單裡）
/** 持股那一列多出來的兵力：核心／機動的比例條、股數、建議持有與上限、指令、等什麼 */
export function forceRowHTML(code) {
  const i = forceItemOf(code);
  if (!i) return '';
  const h = i.hold || {};
  const changed = isNum(h.after) && h.after !== h.now;
  return `<span class="fz-row">
    <span class="fz-split" role="img" aria-label="核心 ${esc(sharesOf(i.core))}、機動 ${esc(sharesOf(i.mob))}"><i class="c" style="flex:${Math.max(0, i.core)} 1 0"></i><i class="m" style="flex:${Math.max(0, i.mob)} 1 0"></i></span>
    <span class="fz-sm"><span><i class="c"></i><span data-term="core">核心</span> <b class="num">${sharesOf(i.core)}</b></span><span><i class="m"></i><span data-term="mobile">機動</span> <b class="num">${sharesOf(i.mob)}</b></span><span class="fz-keep">${changed ? '之後' : '建議'}持有 <b class="num">${sharesOf(h.after)}</b>${isNum(h.max) ? `<small>／上限 ${sharesOf(h.max)}</small>` : ''}</span></span>
    <span class="fz-say">${tx(i.say)}</span>
    ${i.wait ? `<span class="fz-wait">等：${esc(i.wait)}</span>` : ''}
  </span>`;
}

// ------------------------------------------------------------------ 核心要不要跟減碼訊號
export function coreFollowHTML() {
  const items = (S.force && S.force.items) || [];
  if (isPaper() || !items.some((i) => i.core > 0)) return '';
  const on = settings.coreFollow === true;
  return `<section class="panel fz-core${on ? ' on' : ''}" aria-label="核心要不要跟減碼訊號">
      <div class="srow"><div><div class="h">核心也跟減碼訊號</div><div class="d">${on
        ? '打開了：減碼訊號出現時，核心（定期定額買的）和機動一起，這一輪先減三分之一（先賣機動）；賣掉的錢回到自由資金，轉「可加碼」時照加碼計畫買回。定期定額照扣。'
        : '關著（預設）：定期定額買的核心照扣、不跟減碼訊號賣，只有比重超過上限才會減。自己買的機動照訊號。'}</div></div><button class="switch" role="switch" id="fz-cf" aria-checked="${on}" aria-label="核心也跟減碼訊號"></button></div>
      <details class="fz-bt" id="fz-bt"${S.fzBtOpen ? ' open' : ''}><summary>歷史演練（不是你的帳戶）：照扣不動 vs 跟減碼訊號</summary><div class="fz-bt-body" id="fz-btb">${S.fzBtOpen ? coreBtHTML() : ''}</div></details>
    </section>`;
}
/** 歷史演練用的扣款金額與日子：那一檔還在扣的計畫（每月合計、第一個扣款日）；沒有計畫就每月 1 萬、1 號 */
function planOf(code) {
  const td = today();
  const ps = (settings.plans || []).filter((p) => p.c === code);
  const live = ps.filter((p) => !p.end || p.end >= td);
  const use = live.length ? live : ps.slice(-1);
  const amount = use.reduce((t, p) => t + (p.amt || 0) * planDays(p).length, 0) || 10000;
  const d0 = use.length ? Math.min(...use.map((p) => planDays(p)[0] || 1)) : 1;
  return { amount, day: Math.min(28, Math.max(1, d0)), real: use.length > 0 };
}
function coreBtHTML() {
  const items = ((S.force && S.force.items) || []).filter((i) => i.core > 0);
  const rows = [];
  const wait = [];
  for (const i of items) {
    const h = S.hist[i.code];
    if (!h) { wait.push(i.code); continue; }
    const pl = planOf(i.code);
    const f = PF.TRIM_FRAC[i.cat] ?? PF.TRIM_DEFAULT;
    const r = coreFollowSim(h, { start: firstMonth(h), amount: pl.amount, day: pl.day, frac: f, cat: i.cat, fee: settings.fee });
    if (r) rows.push({ i, r, pl });
  }
  if (wait.length) {
    for (const c of wait) ensureHist(c).then(() => { if (S.fzBtOpen) { const b = $('#fz-btb'); if (b) b.innerHTML = coreBtHTML(); } });
    if (!rows.length) return '<p class="fz-bt-wait">正在載入官方收盤資料…</p>';
  }
  if (!rows.length) return '<p class="fz-bt-wait">歷史資料不夠，算不出來。</p>';
  const body = rows.map(({ i, r, pl }) => {
    const k = r.keep, fo = r.follow;
    const diff = k.value > 0 ? fo.value / k.value - 1 : 0;
    return `<div class="fz-bt-row">
      <div class="fz-bt-h"><b>${esc(i.name)}</b><small>${pl.real ? `每月 ${priv() ? MASK : money(pl.amount)} 元（你的計畫）` : '每月 1 萬元（沒有計畫，示範用）'}・${ym(r.start)}～${ym(r.end)}・${r.months} 期</small></div>
      <div class="fz-bt-g">
        <span>照扣不動</span><b class="num">${priv() ? '基準' : compact(k.value)}</b><small>最深 ${pc1(k.mdd)}</small>
        <span>跟減碼訊號</span><b class="num ${diff >= 0 ? 'up' : 'down'}">${priv() ? pc1(diff) : compact(fo.value)}</b><small>最深 ${pc1(fo.mdd)}</small>
      </div>
      <p>${priv() ? '' : `期末差 ${pc1(diff)}；`}賣 ${fo.sells} 次、買回 ${fo.backs} 次，其中 ${fo.dear} 次買回的價格比賣出高${fo.side > 0 ? `；最近一輪賣掉的${priv() ? '錢' : ` ${yuan(fo.side)}`}還在等訊號轉多買回` : ''}。</p>
    </div>`;
  }).join('');
  const more = rows.filter((x) => x.r.follow.value > x.r.keep.value).length;
  const shallow = rows.filter((x) => x.r.follow.mdd > x.r.keep.mdd).length;
  const s0 = Math.min(...rows.map((x) => x.r.start));
  const e0 = Math.max(...rows.map((x) => x.r.end));
  const sum = `跟減碼訊號：${rows.length} 檔裡 ${more} 檔期末比較多、${rows.length - more} 檔比較少；途中最深的跌幅 ${shallow} 檔比較小。${s0 <= 20220101 && e0 >= 20221231 ? '期間包含 2022 年的空頭。' : ''}`;
  // 第一句先講假設：從哪個月開始、每月扣多少（2026/11/21 PZ：「2020 四月，我也沒有投資啊」）
  const mo = (d) => Math.floor(d / 100);
  const late = rows.filter((x) => mo(x.r.start) > mo(s0));
  const demo = rows.some((x) => !x.pl.real);
  const assume = `假設從 ${ymZ(s0)}起${late.length ? `（${late.map((x) => `${x.i.name}從 ${ymZ(x.r.start)}`).join('、')}）` : ''}，每個月照你現在的扣款金額${demo ? '（沒有計畫的用 1 萬元示範）' : ''}買進，用過去真的收盤價演練兩種做法。這不是你的帳戶，也不是預測。`;
  return `<p class="fz-bt-as">${esc(assume)}</p><p class="fz-bt-sum">${esc(sum)}</p>${body}<p class="fz-bt-n">怎麼算：每個月照你的計畫扣款買進；「跟減碼訊號」在訊號轉成減碼那天賣掉這一類的減碼幅度（一般三分之一），轉回可加碼或漲多分批那天，把賣掉拿回的錢全部買回。訊號每 5 個交易日取樣一次、只用那天之前的（和存股時光機一樣），用收盤價成交，手續費、證交稅照算，配息再投入。最深跌幅扣掉每月新存進去的錢。過去的結果不代表以後。</p>`;
}

// ------------------------------------------------------------------ 綁定
export function bindForce(v) {
  $$('[data-free]', v).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); openCashForm(b.dataset.free === 'res' ? null : b.dataset.free); }));
  $$('[data-fz-free]', v).forEach((b) => b.addEventListener('click', () => { const c = $('.fz-free', v); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'center' }); else openCashForm(); }));
  $$('.fz-cmd [data-code]', v).forEach((b) => b.addEventListener('click', () => openDetail(b.dataset.code)));
  const sw = $('#fz-cf', v);
  if (sw) sw.addEventListener('click', () => {
    settings.coreFollow = !(settings.coreFollow === true);
    saveSettings();
    FX.sfx(settings.coreFollow ? 'lock' : 'tap');
    toast(settings.coreFollow ? '核心也跟減碼訊號：減碼時核心一起先減三分之一' : '核心照扣、不跟減碼訊號賣', null);
    bus.emit('book');
  });
  const bt = $('#fz-bt', v);
  if (bt) bt.addEventListener('toggle', () => {
    S.fzBtOpen = bt.open;
    if (bt.open) { const b = $('#fz-btb', v); if (b) b.innerHTML = coreBtHTML(); }
  });
}

// ------------------------------------------------------------------ 指揮台：今日行動、晨報
/** 今日行動裡的兵力：要賣的、要買的（持有和關注的）、交易受限的；有指令、持股有減碼／先不加碼、或還沒設定自由資金（算不出能加碼多少）時，
    另外一句「加碼：…。減碼：…。」的結論（點了到兵力分頁） */
export function forceActions(chip) {
  const F = S.force;
  const P = S.P;
  if (!F || !P) return [];
  const T = P.totals.T;
  const out = [];
  for (const o of F.orders) {
    if (o.k === 'sell') {
      const from = o.core && o.mob ? `機動 ${sharesOf(o.mob)}＋核心 ${sharesOf(o.core)}` : o.core ? '核心' : '機動';
      out.push({ pri: 0, code: o.code, chip: chip(o.by === 'over' ? '調節' : '減碼', 'warn2'), title: o.name, text: `賣 <b class="num">${sharesOf(o.n)}</b>（${from}），約拿回 ${esc(amt(o.net, T))}${o.by === 'over' ? '：超過比重上限' : '：這一輪減碼'}` });
    } else if (o.k === 'buy') {
      out.push({ pri: 1, code: o.code, chip: chip(o.held ? '加碼' : '買進', 'go'), title: o.name, text: `用${isPaper() ? '模擬倉現金' : '自由資金'}買 <b class="num">${sharesOf(o.n)}</b>，約 ${esc(amt(o.spend, T))}，分 ${o.parts} 批；出場線 <b class="num">${fmt.px(o.stop)}</b>` });
    }
  }
  for (const i of F.items) if (i.act === 'pause') out.push({ pri: 1, code: i.code, chip: chip('受限', 'warn'), title: i.name, text: tx(i.say) });
  const flagged = F.items.some((i) => i.ps === 'trim' || i.ps === 'caution');
  const unset = F.ans && F.ans.add.k === 'unset' && F.items.length > 0;
  if (!F.quiet || flagged || unset) out.push({ pri: 0, code: 'FORCE', act: 'force', chip: chip('兵力', 'self'), title: '今日指令', text: tx(F.head) });
  return out;
}
/** 晨報第二句用的「你持有的要處理的」：照兵力（要賣的、交易受限的才算要處理），不是通用的減碼訊號 */
export function forceBriefAdv() {
  const F = S.force;
  if (!F) return null;
  return new Map(F.items.map((i) => [i.code, { key: i.act === 'sell' ? (i.sell.by === 'over' ? 'rebalance' : 'trim') : i.act === 'pause' ? 'pause' : 'hold', label: maskSh(i.chip ? i.chip[0] : '') }]));
}

// ------------------------------------------------------------------ 單檔頁「我的兵力」
export function forceDetailHTML(code) {
  const i = forceItemOf(code);
  if (!i) return '';
  const h = i.hold || {};
  return `<div class="fz-mine">
    <div class="fz-mine-h"><span class="chip act ${CHIP_CLS[i.chip[1]] || 'mute'}" data-term="force">${tx(i.chip[0])}</span><b>${tx(i.say)}</b></div>
    <span class="fz-split" role="img" aria-label="核心 ${esc(sharesOf(i.core))}、機動 ${esc(sharesOf(i.mob))}"><i class="c" style="flex:${Math.max(0, i.core)} 1 0"></i><i class="m" style="flex:${Math.max(0, i.mob)} 1 0"></i></span>
    <span class="fz-sm"><span><i class="c"></i><span data-term="core">核心</span>（定期定額）<b class="num">${sharesOf(i.core)}</b></span><span><i class="m"></i><span data-term="mobile">機動</span>（自己買的）<b class="num">${sharesOf(i.mob)}</b></span></span>
    <span class="fz-sm"><span>${isNum(h.after) && h.after !== h.now ? '照指令做完持有' : '建議持有'} <b class="num">${sharesOf(h.after)}</b></span>${isNum(h.max) ? `<span>上限 <b class="num">${sharesOf(h.max)}</b><small>（${esc(i.catName)} ${Math.round(i.cap * 100)}%）</small></span>` : ''}</span>
    ${i.why.length ? `<ul class="fz-why">${i.why.map((w) => `<li>${tx(w)}</li>`).join('')}</ul>` : ''}
    ${i.wait ? `<p class="fz-wait">等：${esc(i.wait)}</p>` : ''}
  </div>`;
}
