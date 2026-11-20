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
// 「核心照扣」用極光紫（你自己）；class 叫 self，不叫 core（.core 是副官核心的圖，會被撐滿整列）
const CHIP_CLS = { warn2: 'warn2', go: 'go', mute: 'mute', warn: 'warn', core: 'self' };
export const forceItemOf = (code) => (S.force ? S.force.items.find((i) => i.code === code) || null : null);
export function forceChipHTML(code) {
  const i = forceItemOf(code);
  if (!i || !i.chip) return '';
  return `<span class="chip act ${CHIP_CLS[i.chip[1]] || 'mute'}" data-term="force">${tx(i.chip[0])}</span>`;
}

// ------------------------------------------------------------------ 今日指令
function orderRow(o, T) {
  const tag = (t, cls) => `<span class="fz-tag ${cls}">${t}</span>`;
  if (o.k === 'sell') {
    const from = o.core && o.mob ? `機動 ${sharesOf(o.mob)}＋核心 ${sharesOf(o.core)}` : o.core ? '核心（定期定額買的）' : '機動（自己買的）';
    return `<li><button class="fz-o sell" data-code="${esc(o.code)}">${tag('賣', 'sell')}<span class="fz-b"><span class="fz-t"><b>${esc(o.name)}</b><span class="fz-n num">${sharesOf(o.n)}</span></span><small>${from}・${o.by === 'over' ? '超過比重上限' : '這一輪減碼'}・約拿回 ${amt(o.net, T)}</small></span>${ICON.chev}</button></li>`;
  }
  if (o.k === 'buy') {
    return `<li><button class="fz-o buy" data-code="${esc(o.code)}">${tag('買', 'buy')}<span class="fz-b"><span class="fz-t"><b>${esc(o.name)}</b><span class="fz-n num">${sharesOf(o.n)}</span></span><small>約 ${amt(o.spend, T)}・分 ${o.parts} 批・出場線 ${fmt.px(o.stop)}${o.held ? '' : '・關注的'}</small></span>${ICON.chev}</button></li>`;
  }
  if (o.k === 'core') {
    const m = dcaMonthly(settings.plans, today());
    const sep = settings.dcaFund !== 'free';
    return `<li><div class="fz-o keep">${tag('核心', 'self')}<span class="fz-b"><span class="fz-t"><b>定期定額照扣，不賣</b></span><small>${o.items.map((i) => `${esc(i.name)} ${sharesOf(i.n)}`).join('・')}${m ? `・每月 ${priv() ? MASK : money(m)} 元${sep ? '另外扣' : '從自由資金扣'}` : ''}</small></span></div></li>`;
  }
  if (o.k === 'free') {
    const head = o.use > 0 ? `今天用 ${amt(o.use, T)}，留 ${amt(o.left, T)}` : `${amt(o.usable, T)}先留著`;
    return `<li><button class="fz-o free" data-fz-free>${tag('資金', 'free')}<span class="fz-b"><span class="fz-t"><b>${isPaper() ? '模擬倉現金' : '自由資金'}：${esc(head)}</b></span><small>可動用 ${amt(o.usable, T)}${o.reserve ? `（另有緊急預備金 ${amt(o.reserve, T)}）` : ''}</small></span>${ICON.chev}</button></li>`;
  }
  return '';
}
export function forceOrdersHTML(P) {
  const F = S.force;
  if (!F || !P || !(P.totals.T > 0)) return '';
  const T = P.totals.T;
  const tone = F.orders.some((o) => o.k === 'sell') ? 'warn' : F.orders.some((o) => o.k === 'buy') ? 'go' : 'calm';
  const act = F.orders.some((o) => o.k === 'sell' || o.k === 'buy');
  return `<div class="sec-h"><h2 data-term="force">今日指令</h2><span class="aside">${esc(PF.PROFILES[settings.risk].name)}型紀律・照你的兵力算</span>${haloHTML('eod')}</div>
    <section class="panel fz-cmd tone-${tone}" id="fz-cmd" aria-label="今日指令">
      <div class="fz-cmd-h"><span class="fz-k">兵力指令</span><p class="fz-head">${tx(F.head)}</p></div>
      <ol class="fz-list">${F.orders.map((o) => orderRow(o, T)).join('')}</ol>
      ${act ? '<p class="fz-foot">照做之後在冷眼「記一筆」：自由資金、股數和明天的指令會自動跟著改。</p>' : ''}
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
      <details class="fz-bt" id="fz-bt"${S.fzBtOpen ? ' open' : ''}><summary>回測：你的每一檔，照扣不動 vs 跟減碼訊號</summary><div class="fz-bt-body" id="fz-btb">${S.fzBtOpen ? coreBtHTML() : ''}</div></details>
    </section>`;
}
/** 回測用的扣款金額與日子：那一檔還在扣的計畫（每月合計、第一個扣款日）；沒有計畫就每月 1 萬、1 號 */
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
  return `<p class="fz-bt-sum">${esc(sum)}</p>${body}<p class="fz-bt-n">怎麼算：每個月照你的計畫扣款買進；「跟減碼訊號」在訊號轉成減碼那天賣掉這一類的減碼幅度（一般三分之一），轉回可加碼或漲多分批那天，把賣掉拿回的錢全部買回。訊號每 5 個交易日取樣一次、只用那天之前的（和存股時光機一樣），用收盤價成交，手續費、證交稅照算，配息再投入。最深跌幅扣掉每月新存進去的錢。過去的結果不代表以後。</p>`;
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
/** 今日行動裡的兵力：要賣的、要買的（持有和關注的）、交易受限的；有指令或持股有減碼／先不加碼時，另外一句結論（點了到兵力分頁） */
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
  if (!F.quiet || flagged) out.push({ pri: 0, code: 'FORCE', act: 'force', chip: chip('兵力', 'self'), title: '今日指令', text: tx(F.head) });
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
