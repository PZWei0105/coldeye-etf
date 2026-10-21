/* 冷眼 — 定期定額（照國泰證券的規則）：計畫設定、每期自動入帳（預估）、一鍵核對、補齊以前扣過的、和國泰庫存對齊。
   計畫存在設定的 plans（只在這支手機）；自動記的交易寫進真實部位（coldeye.pf），一律經過 core.js 的 updateRealBook。
   每一筆自動記的交易帶著 dca: { plan: 計畫 id, s: 原本的扣款日, est: 還沒核對 }；同一個計畫的同一期只會記一次，
   你刪掉的那一期記在計畫的 skip，不會再自動補回來。 */
import {
  $, $$, esc, isNum, S, PF, settings, saveSettings, fmt, money, sharesOf, ICON, toast, bus, today, newId,
  ensureHist, updateRealBook, realLots, isPaper,
} from './core.js';
import { openModal, closeModal } from './forms.js';
import * as C from './calc.js';
import * as FX from './fx.js';

export const DCA_FEE = 1;            // 國泰 2026/12/31 前定期定額每筆 1 元（計畫裡可以改）
const HIST_FROM = 202001;            // 冷眼的官方歷史資料從 2020 年 1 月開始
const nameOf = (c) => (S.rows.get(c) || {}).n || c;
const planOf = (id) => (settings.plans || []).find((p) => p.id === id) || null;
const daysText = (p) => `每月 ${C.planDays(p).join('、')} 號`;
const ymOf = (d) => Math.floor(d / 100);
const ymText = (ym) => `${Math.floor(ym / 100)}/${String(ym % 100).padStart(2, '0')}`;
const monthInput = (ym) => `${Math.floor(ym / 100)}-${String(ym % 100).padStart(2, '0')}`;
const parseMonth = (v) => { const m = /^(\d{4})-(\d{2})$/.exec(String(v || '')); return m ? +m[1] * 100 + +m[2] : null; };
const lastDayOf = (ym) => ym * 100 + new Date(Date.UTC(Math.floor(ym / 100), ym % 100, 0)).getUTCDate();
const okDca = (l) => !!(l && l.dca && typeof l.dca.plan === 'string' && Number.isInteger(l.dca.s));
/** 還沒核對的自動入帳（真實部位） */
export const pendingLots = () => realLots().filter((l) => okDca(l) && l.dca.est === true);

// ------------------------------------------------------------------ 自動入帳
let chain = Promise.resolve();
/**
 * 把到期、還沒記的每一期記進真實部位（預估）。開 App、資料更新、存計畫的時候執行；同一期不會記兩次。
 * 用官方資料判斷那天有沒有開市（0050 每個交易日都有成交，當作行事曆），價格用那天的官方收盤價。
 * 同時呼叫好幾次會排隊一個一個做（不會兩邊同時記）。回傳這次新記的交易。
 */
export function runPlans(o = {}) {
  const go = () => runOnce(o).catch(() => []);
  chain = chain.then(go, go);
  return chain;
}
async function runOnce({ quiet = false } = {}) {
  if (!S.summary || S.offline) return [];
  const plans = (settings.plans || []).filter((p) => p && p.v === 2 && C.planDays(p).length);
  if (!plans.length) return [];
  {
    const cal = await ensureHist('0050', { fresh: true });
    if (!cal || !cal.d || !cal.d.length) return [];
    const upto = Math.min(today(), S.summary.asof);
    // 已經記過的期數：同一個計畫的同一期；計畫刪掉後重建的，同一檔同一期也算記過（不會重複記）
    const ids = new Set(plans.map((p) => p.id));
    const mine = realLots().filter(okDca);
    const have = new Set(mine.map((l) => `${l.dca.plan}|${l.dca.s}`));
    const orphan = new Set(mine.filter((l) => !ids.has(l.dca.plan)).map((l) => `${l.c}|${l.dca.s}`));
    const added = [];
    for (const p of plans) {
      const due = C.dcaSchedule(p, cal.d, upto).filter((x) => !have.has(`${p.id}|${x.s}`) && !orphan.has(`${p.c}|${x.s}`) && !(p.skip || []).includes(x.s));
      if (!due.length) continue;
      const h = await ensureHist(p.c, { fresh: true });
      const row = S.rows.get(p.c);
      for (const x of due) {
        // 官方收盤價：歷史檔；上市太短還沒有歷史檔的，只有最新一天能用（之後資料進來再補）
        let q = h ? C.closeOn(h, x.d) : null;
        if (!q && row && row.d === x.d && row.p > 0) q = { d: row.d, px: row.p };
        if (!q) continue;
        const est = C.dcaEstimate(p.amt, p.fee, q.px);
        if (!est) continue;   // 這一期的金額連 1 股都買不到：國泰也不會成交，不記
        added.push({
          id: newId(), c: p.c, side: 'buy', d: x.d, sh: est.sh, px: q.px, fee: est.fee, tax: 0,
          note: '定期定額（自動）', at: new Date().toISOString(), dca: { plan: p.id, s: x.s, est: true },
        });
      }
    }
    if (!added.length) return [];
    updateRealBook((b) => { b.lots.push(...added); });
    bus.emit('book');
    if (!quiet) {
      FX.cue('ok');
      const one = added[0];
      toast(added.length === 1
        ? `已自動記下定期定額：${nameOf(one.c)} ${fmt.d(one.d)} ${sharesOf(one.sh)}（預估），有空對照國泰 App 核對${isPaper() ? '（記在真實部位）' : ''}`
        : `已自動記下 ${added.length} 筆定期定額（預估），有空對照國泰 App 核對${isPaper() ? '（記在真實部位）' : ''}`, null);
    }
    return added;
  }
}
/** 定期定額自動記的那一筆被刪掉了：記在計畫的 skip，之後不再自動補回來 */
export function onDcaLotDel({ lot } = {}) {
  if (!okDca(lot)) return;
  const p = planOf(lot.dca.plan);
  if (!p) return;
  if (!p.skip.includes(lot.dca.s)) { p.skip.push(lot.dca.s); saveSettings(); }
}

// ------------------------------------------------------------------ 今日行動
/** 今天扣款的計畫、待核對的筆數（給指揮台的「今日行動」） */
export function dcaActions(chip) {
  const out = [];
  const td = today();
  const lots = realLots();
  for (const p of settings.plans || []) {
    if (!C.dcaDueToday(p, td)) continue;
    const r = S.rows.get(p.c);
    if (!r) continue;
    const done = lots.find((l) => okDca(l) && l.dca.plan === p.id && l.d === td);
    const rule = r.ps === 'trim' || r.ps === 'caution' ? `；規則現在是「${r.ps === 'trim' ? '減碼' : '先不加碼'}」，另外的單筆加碼先等一等` : '';
    out.push({
      pri: 1, code: p.c, chip: chip('扣款日', 'alert'), title: r.n,
      text: done
        ? `今天國泰扣 <b class="num">${money(p.amt)}</b> 元，冷眼已經用收盤價記下 <b class="num">${sharesOf(done.sh)}</b>（預估）。定期定額照紀律扣，不看短期訊號${rule}。`
        : `今天國泰扣 <b class="num">${money(p.amt)}</b> 元（${daysText(p)}）。定期定額照紀律扣，不看短期訊號${rule}。收盤資料出來後，冷眼會自動記一筆預估。`,
    });
  }
  const n = pendingLots().length;
  if (n) out.push({ pri: 2, act: 'dca', chip: chip('待核對', 'go2'), title: '定期定額', text: `有 <b class="num">${n}</b> 筆自動記的是預估，對照國泰 App 的成交回報核對一下，或一次和庫存對齊。` });
  return out;
}

// ------------------------------------------------------------------ 設定頁：計畫清單
function statusOf(p) {
  const mine = realLots().filter((l) => okDca(l) && l.dca.plan === p.id);
  const pend = mine.filter((l) => l.dca.est === true).length;
  const td = today();
  const ended = p.end && p.end < td;
  let next = null;
  if (!ended) {
    // 下一期（只看日期，休市順延要等官方資料才知道）
    for (let k = 0; k < 400 && !next; k++) {
      const d = PF.addDays(td, k);
      if (C.dcaDueToday(p, d) && !mine.some((l) => l.d === d)) next = d;
    }
  }
  return `${ended ? `已停扣（到 ${ymText(ymOf(p.end))}）` : next ? `下一期 ${fmt.d(next)}` : ''}${mine.length ? `・已記 ${mine.length} 期` : ''}${pend ? `・<b class="pend">待核對 ${pend}</b>` : ''}`;
}
const planRows = (ps) => `<ul class="plan-list">${ps.map((p) => `<li><button type="button" class="plan-row" data-plan="${esc(p.id)}"><span class="pl-n"><b>${esc(nameOf(p.c))}</b> <span class="muted num">${esc(p.c)}</span></span><span class="pl-d">${esc(daysText(p))}・<b class="num">${money(p.amt)}</b> 元</span><span class="pl-s small muted">${statusOf(p)}</span></button></li>`).join('')}</ul>`;
/** 設定頁的「定期定額」那一列 */
export function plansHTML() {
  const ps = settings.plans || [];
  const n = pendingLots().length;
  return `<div class="srow col"><div><div class="h" data-term="dca">定期定額（國泰證券）</div><div class="d">每到扣款日，等官方收盤資料出來，冷眼自動幫你記一筆「預估」，你再對照國泰 App 的成交回報核對。以前扣過的可以補齊，再一次和國泰庫存對齊。只記在這支手機的真實部位。</div></div>
    ${ps.length ? planRows(ps) : ''}
    <div class="row-btns"><button type="button" class="btn small" data-dca="add">${ICON.plus}新增定期定額</button>${n ? `<button type="button" class="btn small ghost" data-dca="pend">核對預估（${n}）</button>` : ''}</div></div>`;
}
/** 「部位」頁的定期定額小卡：沒有計畫時是一句邀請，有計畫時列出狀態 */
export function dcaStripHTML() {
  if (isPaper()) return '';
  const ps = settings.plans || [];
  const n = pendingLots().length;
  if (!ps.length) {
    return `<section class="panel pad dca-strip invite"><div><b>有在國泰定期定額嗎？</b><span class="small muted">設定一次，每期扣款後冷眼自動記進部位；以前扣過的也能補齊。</span></div><button type="button" class="btn small" data-dca="add">${ICON.plus}設定定期定額</button></section>`;
  }
  return `<div class="sec-h"><h2 data-term="dca">定期定額</h2><span class="aside">國泰・收盤後自動記</span></div>
    <section class="panel pad dca-strip">${planRows(ps)}
      <div class="row-btns"><button type="button" class="btn small ghost" data-dca="add">${ICON.plus}新增</button>${n ? `<button type="button" class="btn small" data-dca="pend">核對預估（${n}）</button>` : ''}</div></section>`;
}
export function bindPlans(root, redraw) {
  $$('[data-dca="add"]', root).forEach((b) => b.addEventListener('click', () => openPlanForm(null, redraw)));
  $$('[data-dca="pend"]', root).forEach((b) => b.addEventListener('click', () => openPending()));
  $$('[data-plan]', root).forEach((b) => b.addEventListener('click', () => openPlanForm(b.dataset.plan, redraw)));
}

// ------------------------------------------------------------------ 新增／編輯計畫
function pickerHTML(id, ph) {
  return `<div class="picker"><input class="input" id="${id}" placeholder="${esc(ph)}" autocomplete="off"><div class="sugg" id="${id}-s"></div></div>`;
}
export function openPlanForm(id, after) {
  if (!S.summary) return;
  const old = id ? planOf(id) : null;
  const td = today();
  const thisYm = ymOf(td);
  const f = {
    code: old ? old.c : null,
    days: old ? C.planDays(old) : [],
    amt: old ? old.amt : '',
    fee: old ? old.fee : DCA_FEE,
    back: old ? !!old.back : true,                             // 以前扣過的要不要補齊
    startYm: old ? ymOf(old.start) : thisYm,
    ended: !!(old && old.end),
    endYm: old && old.end ? ymOf(old.end) : thisYm,
  };
  FX.sfx('open');
  const card = openModal(`<div class="form dca">
      <h2 class="m-title">${old ? '編輯定期定額' : '新增定期定額'}</h2>
      <p class="m-desc">照國泰證券的規則：每月可以選好幾天；遇到休市順延到下一個交易日；那個月沒有的日期（例如 2/30）那一期不買。</p>
      <div class="field"><span class="lab">哪一檔</span><div id="p-etf"></div></div>
      <div class="field"><span class="lab">每月幾號扣款（可以選好幾天）</span><div class="day-grid" role="group" aria-label="扣款日">${Array.from({ length: 31 }, (_, k) => `<button type="button" data-day="${k + 1}" aria-pressed="${f.days.includes(k + 1)}" class="num">${k + 1}</button>`).join('')}</div></div>
      <div class="f-row">
        <label class="field"><span class="lab">每期金額（含手續費）</span><input class="input num" id="p-amt" inputmode="numeric" placeholder="例如 3000" value="${esc(f.amt)}"></label>
        <label class="field"><span class="lab">每筆手續費</span><input class="input num" id="p-fee" inputmode="decimal" value="${esc(f.fee)}"></label>
      </div>
      <p class="small muted">國泰定期定額以百元為單位、每筆最低 100 元；2026/12/31 前每筆手續費 1 元。</p>
      <div class="field"><span class="lab">以前扣過的</span>
        <div class="seg" role="radiogroup" aria-label="以前扣過的"><button type="button" data-back="1" aria-pressed="${f.back}">幫我補齊以前每一期</button><button type="button" data-back="0" aria-pressed="${!f.back}">新開的，從今天開始</button></div>
        <div class="p-from" id="p-from"${f.back ? '' : ' hidden'}><label class="field inline"><span class="lab">從哪個月開始扣</span><input class="input num" type="month" id="p-start" min="2020-01" max="${monthInput(thisYm)}" value="${monthInput(f.startYm)}"></label>
          <p class="small muted">冷眼用每一期成交日的官方收盤價，把以前每一期補記成「預估」；補完可以一次和國泰 App 的庫存對齊。官方歷史資料從 2020 年 1 月開始。</p></div>
      </div>
      <button type="button" class="switch-row" id="p-ended" aria-pressed="${f.ended}"><span class="switch" role="switch" aria-checked="${f.ended}"></span><span>已經停扣了<small>（之後不再自動記）</small></span></button>
      <div class="p-from" id="p-endw"${f.ended ? '' : ' hidden'}><label class="field inline"><span class="lab">扣到哪個月為止</span><input class="input num" type="month" id="p-end" min="2020-01" max="${monthInput(thisYm)}" value="${monthInput(f.endYm)}"></label></div>
      <div class="f-err" id="p-err" role="alert"></div>
      <div class="m-actions">${old ? '<button type="button" class="btn danger ghost" id="p-del">刪除計畫</button>' : ''}<button type="button" class="btn ghost" data-close>取消</button><button type="button" class="btn primary" id="p-save">${ICON.ok}儲存</button></div>
    </div>`, { label: old ? '編輯定期定額' : '新增定期定額' });
  const etf = $('#p-etf', card);
  const drawEtf = () => {
    if (f.code) {
      const r = S.rows.get(f.code);
      etf.innerHTML = `<div class="picked"><b>${esc(r ? r.n : f.code)}</b> <span class="num muted">${esc(f.code)}</span>${r && isNum(r.p) ? `<small class="muted num">最新收盤 ${fmt.px(r.p)}</small>` : ''}<button type="button" class="link small" id="p-chg">更換</button></div>`;
      $('#p-chg', etf).addEventListener('click', () => { f.code = null; drawEtf(); const q = $('#p-q', etf); if (q) q.focus(); });
      return;
    }
    etf.innerHTML = pickerHTML('p-q', '輸入代號或名稱，例如 0050、00878');
    const q = $('#p-q', etf), sugg = $('#p-q-s', etf);
    q.addEventListener('input', () => {
      const s = q.value.trim().toLowerCase();
      if (!s) { sugg.innerHTML = ''; return; }
      const hits = S.summary.etfs.filter((r) => r.c.toLowerCase().includes(s) || (r.n || '').toLowerCase().includes(s)).slice(0, 8);
      sugg.innerHTML = hits.map((r) => `<button type="button" data-pick="${esc(r.c)}">${esc(r.n)} <span class="num">${esc(r.c)}</span></button>`).join('') || '<span class="muted small">找不到這檔 ETF</span>';
      $$('[data-pick]', sugg).forEach((b) => b.addEventListener('click', () => { f.code = b.dataset.pick; FX.sfx('tap'); drawEtf(); }));
    });
  };
  drawEtf();
  $$('[data-day]', card).forEach((b) => b.addEventListener('click', () => {
    const d = +b.dataset.day;
    f.days = f.days.includes(d) ? f.days.filter((x) => x !== d) : f.days.concat(d).sort((a, b2) => a - b2);
    b.setAttribute('aria-pressed', f.days.includes(d));
  }));
  $$('[data-back]', card).forEach((b) => b.addEventListener('click', () => {
    f.back = b.dataset.back === '1';
    $$('[data-back]', card).forEach((x) => x.setAttribute('aria-pressed', x === b));
    $('#p-from', card).hidden = !f.back;
  }));
  const endBtn = $('#p-ended', card);
  endBtn.addEventListener('click', () => {
    f.ended = !f.ended;
    endBtn.setAttribute('aria-pressed', f.ended);
    $('.switch', endBtn).setAttribute('aria-checked', f.ended);
    $('#p-endw', card).hidden = !f.ended;
  });
  const err = $('#p-err', card);
  const fail = (t) => { err.textContent = t; FX.sfx('err'); return false; };
  const del = $('#p-del', card);
  if (del) del.addEventListener('click', (ev) => {
    const b = ev.currentTarget;
    const mine = realLots().filter((l) => okDca(l) && l.dca.plan === old.id);
    if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = mine.length ? `確定刪除？（已記的 ${mine.length} 筆交易會留著）` : '確定刪除？'; FX.sfx('warn'); return; }
    settings.plans = settings.plans.filter((p) => p.id !== old.id);
    saveSettings();
    closeModal();
    toast('已刪除定期定額計畫（已經記的交易留著，要刪請到「部位」）', null);
    bus.emit('book');
    if (after) after();
  });
  $('#p-save', card).addEventListener('click', async () => {
    err.textContent = '';
    if (!f.code || !S.rows.get(f.code)) return fail('先選一檔 ETF');
    if (!f.days.length) return fail('至少選一個扣款日');
    const amt = Math.round(Number(String($('#p-amt', card).value).replace(/[,\s]/g, '')));
    if (!(amt >= 100 && amt <= 10000000)) return fail('每期金額請填 100 元到 1,000 萬元');
    if (amt % 100) return fail('國泰的定期定額以百元為單位，例如 3000、3100');
    const fee = Number($('#p-fee', card).value);
    if (!(fee >= 0 && fee <= 1000)) return fail('手續費請填 0 到 1,000 元');
    const r = S.rows.get(f.code);
    if (isNum(r.p) && amt - fee < r.p) return fail(`每期金額扣掉手續費，連 1 股都買不到（最新收盤 ${fmt.px(r.p)} 元）`);
    let start = td;
    if (f.back) {
      const ym = parseMonth($('#p-start', card).value);
      if (!ym || ym < HIST_FROM || ym > thisYm) return fail('開始的月份請選 2020 年 1 月到這個月');
      start = ym * 100 + 1;
    } else if (old && !old.back) start = old.start;        // 原本就是「從那天開始」的計畫：保留那一天
    let end = null;
    if (f.ended) {
      const ym = parseMonth($('#p-end', card).value);
      if (!ym || ym > thisYm || ym * 100 + 31 < start) return fail('停扣的月份要在開始之後、而且不晚於這個月');
      end = lastDayOf(ym);
    }
    const next = C.normPlan({ id: old ? old.id : newId(), c: f.code, days: f.days, amt, fee, start, end, back: f.back, skip: old ? old.skip : [] }, td);
    if (!next) return fail('計畫的內容有問題，請再檢查一次');
    settings.plans = old ? settings.plans.map((p) => (p.id === old.id ? next : p)) : (settings.plans || []).concat(next);
    saveSettings();
    const btn = $('#p-save', card);
    btn.disabled = true;
    btn.textContent = start < td ? '補齊中…' : '儲存中…';
    const added = await runPlans({ quiet: true });
    closeModal();
    FX.cue('lock');
    FX.stamp(old ? '計畫已更新' : '計畫已啟動', 'aurora', `${nameOf(next.c)}・${daysText(next)}`);
    if (added.length) toast(`已補記 ${added.length} 期定期定額（預估）`, null);
    else toast(old ? '已更新定期定額計畫' : `已新增：${nameOf(next.c)} ${daysText(next)}，扣款日收盤後自動記一筆`, null);
    bus.emit('book');
    if (after) after();
    // 補了好幾期：接著問要不要和國泰庫存對齊
    if (added.length > 1) setTimeout(() => openCalibrate(next.c), 900);
  });
}

// ------------------------------------------------------------------ 核對一筆
export function openConfirm(lotId) {
  const lot = realLots().find((l) => l.id === lotId);
  if (!lot || !okDca(lot)) return;
  const p = planOf(lot.dca.plan);
  FX.sfx('open');
  const card = openModal(`<div class="form dca">
      <h2 class="m-title">核對定期定額</h2>
      <p class="m-desc"><b>${esc(nameOf(lot.c))}</b> <span class="num">${esc(lot.c)}</span>・成交日 ${fmt.dy(lot.d)}${lot.dca.s !== lot.d ? `（原本扣款日 ${fmt.d(lot.dca.s)}，遇到休市順延）` : ''}</p>
      <div class="est-box">${lot.dca.est ? '冷眼預估' : '目前記的'}：<b class="num">${sharesOf(lot.sh)}</b> × <span class="num">${fmt.px(lot.px)}</span>${lot.dca.est ? '（那天的官方收盤價）' : ''}＋手續費 <span class="num">${fmt.n(lot.fee || 0)}</span> 元＝<b class="num">${money(lot.sh * lot.px + (lot.fee || 0))}</b> 元${p ? `<small>計畫每期 ${money(p.amt)} 元</small>` : ''}</div>
      <p class="small muted">打開國泰 App 的成交回報（或對帳單），把這一期實際買到的股數和均價填進來。國泰是盤中、盤後分批買，成交均價通常和收盤價差一點點。</p>
      <div class="f-row">
        <label class="field"><span class="lab">成交股數</span><input class="input num" id="c-sh" inputmode="numeric" value="${esc(lot.sh)}"></label>
        <label class="field"><span class="lab">成交均價</span><input class="input num" id="c-px" inputmode="decimal" value="${esc(lot.px)}"></label>
      </div>
      <div class="f-row">
        <label class="field"><span class="lab">或填成交金額（不含手續費）</span><input class="input num" id="c-amt" inputmode="numeric" placeholder="會自動換算均價"></label>
        <label class="field"><span class="lab">手續費</span><input class="input num" id="c-fee" inputmode="decimal" value="${esc(lot.fee || 0)}"></label>
      </div>
      <div class="f-err" id="c-err" role="alert"></div>
      <div class="m-actions"><button type="button" class="btn danger ghost" id="c-skip">這期沒扣到</button>${lot.dca.est ? '<button type="button" class="btn ghost" id="c-same">和預估一樣</button>' : ''}<button type="button" class="btn primary" id="c-save">${ICON.ok}存檔</button></div>
      <button type="button" class="link small" id="c-cal">一筆一筆太麻煩？和國泰庫存一次對齊</button>
    </div>`, { label: '核對定期定額' });
  const shEl = $('#c-sh', card), pxEl = $('#c-px', card), amtEl = $('#c-amt', card), feeEl = $('#c-fee', card), err = $('#c-err', card);
  const num = (el) => Number(String(el.value).replace(/[,\s]/g, ''));
  amtEl.addEventListener('input', () => { const sh = num(shEl), a = num(amtEl); if (sh > 0 && a > 0) pxEl.value = +(a / sh).toFixed(4); });
  const write = (fn, msg) => {
    updateRealBook((b) => { const l = b.lots.find((x) => x.id === lot.id); if (l) fn(l); });
    closeModal();
    FX.cue('lock');
    toast(msg, null);
    bus.emit('book');
  };
  $('#c-save', card).addEventListener('click', () => {
    const sh = Math.round(num(shEl)), px = num(pxEl), fee = num(feeEl);
    if (!(sh >= 1)) { err.textContent = '成交股數至少 1 股'; FX.sfx('err'); return; }
    if (!(px > 0)) { err.textContent = '請填成交均價或成交金額'; FX.sfx('err'); return; }
    if (!(fee >= 0)) { err.textContent = '手續費格式不對'; FX.sfx('err'); return; }
    write((l) => { l.sh = sh; l.px = +px.toFixed(4); l.fee = fee; l.dca = { ...l.dca, est: false }; }, '已核對這一期');
  });
  const same = $('#c-same', card);
  if (same) same.addEventListener('click', () => write((l) => { l.dca = { ...l.dca, est: false }; }, '已核對：和預估一樣'));
  $('#c-skip', card).addEventListener('click', (ev) => {
    const b = ev.currentTarget;
    if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = '確定刪除這一期？'; FX.sfx('warn'); return; }
    updateRealBook((bk) => { const k = bk.lots.findIndex((x) => x.id === lot.id); if (k >= 0) bk.lots.splice(k, 1); });
    onDcaLotDel({ lot });
    closeModal();
    toast('已刪除這一期（之後不會再自動補回來）', null);
    bus.emit('book');
  });
  $('#c-cal', card).addEventListener('click', () => { closeModal(); openCalibrate(lot.c); });
}

// ------------------------------------------------------------------ 待核對清單
export function openPending() {
  const ls = pendingLots().slice().sort((a, b) => a.c.localeCompare(b.c) || b.d - a.d);
  if (!ls.length) { toast('沒有待核對的定期定額'); return; }
  const codes = [...new Set(ls.map((l) => l.c))];
  FX.sfx('open');
  const card = openModal(`<div class="form dca">
      <h2 class="m-title">核對定期定額</h2>
      <p class="m-desc">這些是冷眼用官方收盤價預估的。可以一筆一筆對照國泰 App 的成交回報，或每一檔一次和國泰的庫存股數對齊。</p>
      ${codes.map((c) => { const xs = ls.filter((l) => l.c === c); return `<div class="pend-g"><div class="pend-h"><b>${esc(nameOf(c))}</b> <span class="num muted">${esc(c)}</span><span class="small muted">${xs.length} 筆</span><button type="button" class="btn small" data-cal="${esc(c)}">和庫存對齊</button></div>
        <ul class="pend-list">${xs.slice(0, 24).map((l) => `<li><button type="button" class="pend-row" data-cf="${esc(l.id)}"><span class="num">${fmt.dy(l.d)}</span><span class="num">${sharesOf(l.sh)} × ${fmt.px(l.px)}</span><span class="chev">${ICON.chev}</span></button></li>`).join('')}${xs.length > 24 ? `<li class="small muted">還有 ${xs.length - 24} 筆（對齊會一起處理）</li>` : ''}</ul></div>`; }).join('')}
      <div class="m-actions"><button type="button" class="btn primary" data-close>完成</button></div>
    </div>`, { label: '核對定期定額' });
  $$('[data-cf]', card).forEach((b) => b.addEventListener('click', () => { closeModal(); openConfirm(b.dataset.cf); }));
  $$('[data-cal]', card).forEach((b) => b.addEventListener('click', () => { closeModal(); openCalibrate(b.dataset.cal); }));
}

// ------------------------------------------------------------------ 和國泰庫存對齊
export function openCalibrate(code) {
  const lots = realLots().filter((l) => l.c === code);
  const est = lots.filter((l) => okDca(l) && l.dca.est === true);
  const divs = S.divs && S.divs[code];
  const splits = divs ? divs.s : [];
  const holdingOf = (ls) => PF.holdingFromLots(ls, splits);
  const now = holdingOf(lots).sh;
  FX.sfx('open');
  const card = openModal(`<div class="form dca">
      <h2 class="m-title">和國泰庫存對齊</h2>
      <p class="m-desc"><b>${esc(nameOf(code))}</b> <span class="num">${esc(code)}</span>：冷眼目前算你有 <b class="num">${sharesOf(now)}</b>${est.length ? `，其中 <b class="num">${est.length}</b> 筆是定期定額的預估` : ''}。</p>
      ${est.length ? `<label class="field"><span class="lab">國泰 App「庫存」裡這一檔的股數</span><input class="input num" id="k-sh" inputmode="numeric" placeholder="例如 1250"></label>
      <p class="small muted">對齊只會調整那 ${est.length} 筆預估的股數（照比例，每一筆花的錢不變，所以均價會跟著變），你自己記的其他交易不動。對齊之後這些就算核對過了。</p>
      <div class="k-prev small" id="k-prev"></div>` : '<p class="small muted">這一檔沒有待核對的預估，不需要對齊。</p>'}
      <div class="f-err" id="k-err" role="alert"></div>
      <div class="m-actions"><button type="button" class="btn ghost" data-close>之後再說</button>${est.length ? `<button type="button" class="btn primary" id="k-go" disabled>${ICON.ok}對齊</button>` : ''}</div>
    </div>`, { label: '和國泰庫存對齊' });
  if (!est.length) return;
  const inp = $('#k-sh', card), prev = $('#k-prev', card), go = $('#k-go', card), err = $('#k-err', card);
  let res = null;
  inp.addEventListener('input', () => {
    const t = Math.round(Number(String(inp.value).replace(/[,\s]/g, '')));
    err.textContent = '';
    res = t > 0 ? C.dcaCalibrate(lots, est.map((l) => l.id), splits, t, holdingOf) : null;
    if (!res) { prev.textContent = ''; go.disabled = true; return; }
    if (!res.ok) { prev.textContent = ''; err.textContent = res.why; go.disabled = true; return; }
    const d = res.after - res.before;
    const big = res.before > 0 && Math.abs(d) / res.before > 0.1;
    prev.innerHTML = `會調整 ${res.changes.length} 筆預估：總股數 <b class="num">${fmt.n(res.before)}</b> → <b class="num">${fmt.n(res.after)}</b>（${d >= 0 ? '多' : '少'} ${fmt.n(Math.abs(d))} 股）${big ? '<span class="k-warn">差了一成以上：先確認計畫的開始月份、扣款日和每期金額對不對（例如中間有加碼或暫停），再對齊比較準。</span>' : ''}`;
    go.disabled = false;
  });
  go.addEventListener('click', () => {
    if (!res || !res.ok) return;
    const map = new Map(res.changes.map((c) => [c.id, c]));
    const td = today();
    updateRealBook((b) => { for (const l of b.lots) { const c = map.get(l.id); if (c) { l.sh = c.sh; l.px = c.px; l.dca = { ...l.dca, est: false, cal: td }; } } });
    closeModal();
    FX.cue('lock');
    FX.stamp('已對齊', 'aurora', `${nameOf(code)} ${sharesOf(res.after)}`);
    toast(`已和國泰庫存對齊：${nameOf(code)} ${sharesOf(res.after)}`, null);
    bus.emit('book');
  });
  setTimeout(() => inp.focus(), 60);
}
