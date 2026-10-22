/* 冷眼 — 定期定額（照國泰證券的規則）：計畫設定、每期自動入帳（預估）、一鍵核對、補記以前扣過的、和國泰庫存對齊。
   計畫和「刪掉的那幾期」存在設定（只在這支手機），一律經過 core.js 的 savePlans（先讀最新的、再改、再存）；
   自動記的交易寫進真實部位（coldeye.pf），一律經過 core.js 的 updateRealBook（也是先讀最新的再改）。
   「每一期應該記成什麼樣子」由 calc.js 的 dcaReconcile 算（純函式）：只動還沒核對的「預估」，核對過的、你自己記的交易一律不動。 */
import {
  $, $$, esc, isNum, S, PF, settings, saveSettings, savePlans, reloadPlans, fmt, money, sharesOf, ICON, toast, bus, today, newId,
  ensureHist, updateRealBook, realLots, isPaper, PLAN_MAX, store,
} from './core.js';
import { openModal, closeModal, modalOpen } from './forms.js';
import * as C from './calc.js';
import * as FX from './fx.js';

export const DCA_FEE = 1;                        // 國泰 2026/12/31 前定期定額每筆 1 元（計畫裡可以改）
const PROMO_END = 20261231;
const HIST_FROM = 20200102;                      // 冷眼的官方歷史資料從 2020 年 1 月開始
const CAL_CODES = ['0050', '0056', '006208'];    // 市場交易日：這幾檔有成交的日子聯集（單看一檔會漏掉它自己停止交易的日子）
const WAIT_MS = 20000;                           // 抓一個資料檔最多等 20 秒，免得卡住之後每一次自動入帳

const nameOf = (c) => (S.rows.get(c) || {}).n || c;
const planOf = (id) => (settings.plans || []).find((p) => p.id === id) || null;
const daysText = (p) => `每月 ${C.planDays(p).join('、')} 號`;
/** 國泰那邊改了設定時接在這個計畫後面的新設定（有 prev 的；舊資料沒有 prev：同一檔、在停扣後 10 天內開始的） */
const successorOf = (p) => (settings.plans || []).find((q) => q.id !== p.id && q.c === p.c && (q.prev === p.id || (!q.prev && p.end && q.start > p.end && q.start <= PF.addDays(p.end, 10)))) || null;
const keyOf = (l) => `${l.c}|${l.dca.s}`;
const isoOf = (d) => (d ? `${String(d).slice(0, 4)}-${String(d).slice(4, 6)}-${String(d).slice(6, 8)}` : '');
const dOf = (iso) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? Number(iso.replace(/-/g, '')) : null);
const num = (v) => Number(String(v ?? '').replace(/[,\s，]/g, ''));
const bindClose = (root) => $$('[data-close]', root).forEach((b) => b.addEventListener('click', () => closeModal()));
/** 還沒核對的自動入帳（真實部位） */
export const pendingLots = () => realLots().filter((l) => C.isDcaLot(l) && l.dca.est === true);

// ------------------------------------------------------------------ 官方資料：交易日與收盤價
const TIMEOUT = Symbol('timeout');
const timed = (p, ms = WAIT_MS) => Promise.race([p, new Promise((r) => { setTimeout(() => r(TIMEOUT), ms); })]);
let calMemo = { asof: null, cal: null };
/** 市場交易日（官方資料，到最新收盤日）；沒拿到就回傳 null（這次先不記） */
async function loadCal() {
  const asof = S.summary && S.summary.asof;
  if (!asof) return null;
  if (calMemo.asof === asof && calMemo.cal) return calMemo.cal;
  const hs = await Promise.all(CAL_CODES.map((c) => timed(ensureHist(c, { fresh: true }))));
  const ok = hs.filter((h) => h && h !== TIMEOUT && Array.isArray(h.d) && h.d.length);
  if (ok.length < 2) return null;
  const cal = C.marketCal(ok.map((h) => h.d));
  if (!cal.length || cal[cal.length - 1] < asof) return null;
  calMemo = { asof, cal };
  return cal;
}
/** 畫面用（同步）：已經載入的交易日；還沒載入就 null（之後的日子本來就先當作星期一到五都開市） */
const calNow = () => (S.summary && calMemo.asof === S.summary.asof ? calMemo.cal : null);
async function priceData(codes) {
  const out = new Map();
  for (const c of codes) {
    const h = await timed(ensureHist(c, { fresh: true }));
    const m = S.histMeta[c];
    out.set(c, {
      h: h && h !== TIMEOUT ? h : null,
      hist404: h === null && !!m && m.status === 404 && !!S.summary && m.asof === S.summary.asof,
      row: S.rows.get(c) || null,
    });
  }
  return out;
}

// ------------------------------------------------------------------ 自動入帳
let chain = Promise.resolve();
let last = { ask: [], extras: [], wait: 0, waits: [], none: [] };
const NOTHING = { added: [], removed: [], ask: [], moved: 0 };
/** 最近一次自動入帳的結果：要問你的（可能已經自己記過）、等資料的期數、國泰不會扣的期數 */
export const dcaState = () => last;
/**
 * 照計畫把到期的每一期記進真實部位（預估），順便整理：重複的、和計畫不符的預估刪掉，國泰不會扣的（停止交易、下市）不記。
 * 開 App、資料更新、回到 App、存計畫的時候執行。同一個分頁裡排隊一個一個做；同一支手機開好幾個分頁時，用瀏覽器的鎖輪流做。
 * 回傳 { added, removed, ask }。
 */
export function runPlans(o = {}) {
  const go = () => lockDca(() => runOnce(o)).catch((e) => { console.error(e); return NOTHING; });
  chain = chain.then(go, go);
  return chain;
}
const LOCK_WAIT_MS = 30000;   // 另一個分頁拿著鎖太久（例如 iPhone 把它暫停在背景）：最多等 30 秒就自己做
let lockOffUntil = 0;         // 等不到過一次：接下來 5 分鐘不再等（不然每一次都要等 30 秒）
function lockDca(fn) {
  try {
    if (Date.now() >= lockOffUntil && navigator.locks && typeof navigator.locks.request === 'function') {
      const ac = typeof AbortController === 'function' ? new AbortController() : null;
      const t = ac ? setTimeout(() => ac.abort(), LOCK_WAIT_MS) : null;
      let ran = false;
      return navigator.locks.request('coldeye-dca', ac ? { signal: ac.signal } : {}, () => { ran = true; if (t) clearTimeout(t); return fn(); })
        .catch((e) => { if (!ran) { lockOffUntil = Date.now() + 5 * 60e3; return fn(); } throw e; });   // 等不到鎖、或這個瀏覽器的鎖不能用：直接做（不會做兩次）
    }
  } catch { /* 不支援：直接做（寫進去之前照樣會用最新的資料再比對一次） */ }
  return fn();
}
async function runOnce({ quiet = false } = {}) {
  if (!S.summary || S.offline) return NOTHING;
  reloadPlans();
  if (!settings.plans.length) { last = { ask: [], extras: [], wait: 0, waits: [], none: [] }; return NOTHING; }
  const cal = await loadCal();
  if (!cal || S.offline) return NOTHING;
  const data = await priceData([...new Set(settings.plans.map((p) => p.c))]);
  if (S.offline) return NOTHING;
  const upto = Math.min(today(), S.summary.asof);
  const priceOf = (c, d) => { const x = data.get(c); return x ? C.dcaPrice({ ...x, cal }, d) : { st: 'unknown' }; };
  let res = null;
  const added = [];
  updateRealBook((b) => {
    reloadPlans();   // 另一個分頁可能剛改過計畫或刪了某一期：寫進去之前再讀一次，用最新的交易紀錄比對
    res = C.dcaReconcile({ plans: settings.plans, lots: b.lots, cal, upto, skip: new Set(settings.dcaSkip), noAsk: new Set(settings.dcaNoAsk), priceOf });
    if (!res.add.length && !res.del.length) return false;
    if (res.del.length) { const del = new Set(res.del); b.lots = b.lots.filter((l) => !del.has(l.id)); }
    const at = new Date().toISOString();
    for (const x of res.add) {
      const lot = { id: newId(), ...x, note: '定期定額（自動）', at };
      b.lots.push(lot);
      added.push(lot);
    }
    return true;
  });
  if (!res) return NOTHING;
  const before = new Set([...last.ask.map((x) => `${x.key}|${x.cand.id}`), ...last.extras.map((x) => x.id)]);
  last = { ask: res.ask, extras: res.extras, wait: res.wait, waits: res.waits, none: res.none };
  const newAsk = [...res.ask.filter((x) => !before.has(`${x.key}|${x.cand.id}`)), ...res.extras.filter((x) => !before.has(x.id))];
  if (added.length || res.del.length || newAsk.length) bus.emit('book');
  if (!quiet && (added.length || res.del.length || newAsk.length)) {
    const parts = [];
    if (added.length === 1) parts.push(`已自動記下定期定額：${nameOf(added[0].c)} ${fmt.d(added[0].d)} ${sharesOf(added[0].sh)}（預估）`);
    else if (added.length) parts.push(`已自動記下 ${added.length} 筆定期定額（預估）`);
    if (res.del.length) parts.push(`整理掉 ${res.del.length} 筆重複或和計畫不符的預估`);
    if (newAsk.length) parts.push(`有 ${newAsk.length} 件事要你確認（可能重複記了），到「核對」看一下（確認前不會重複記）`);
    FX.cue('ok');
    toast(`${parts.join('；')}${isPaper() && (added.length || res.del.length) ? '（記在真實部位）' : ''}`, null);
  }
  return { added, removed: res.del, ask: res.ask, moved: res.moved };
}
/**
 * 定期定額記的那一筆被刪掉了（「部位」或核對時刪的）：這一期記在 dcaSkip，之後不再自動補回來。
 * skip === false：你說「只是記錯了」→ 不記成「沒扣到」，冷眼會重新用收盤價估一筆。
 */
export function onDcaLotDel({ lot, skip } = {}) {
  if (!C.isDcaLot(lot) || skip === false) return;
  const key = keyOf(lot);
  savePlans((st) => { if (!st.dcaSkip.includes(key)) st.dcaSkip.push(key); });
  failWarn(lot);
}
/** 國泰：同一個帳戶的台股定期定額連續 3 次扣款失敗，會自動終止全部的定期定額 */
function failWarn(lot) {
  const p = planOf(lot.dca.plan);
  const cal = calNow();
  if (!p || !cal) return;
  const skip = new Set(settings.dcaSkip);
  const xs = C.dcaSchedule(p, cal, Math.min(today(), cal[cal.length - 1])).slice(-3);
  if (xs.length === 3 && xs.every((x) => skip.has(`${p.c}|${x.s}`))) {
    setTimeout(() => toast('提醒：國泰規定同一個帳戶的台股定期定額連續 3 次扣款失敗，會自動終止全部的定期定額。記得到國泰 App 確認計畫還在、帳戶餘額夠。', 'warn'), 1600);
  }
}
/** 清除真實部位之後：還在扣的計畫從明天起照樣自動記（以前的不再補回來）；已經停扣的計畫一起刪掉 */
export function dcaAfterWipe() {
  const tm = PF.addDays(today(), 1);
  savePlans((st) => {
    st.plans = st.plans.filter((p) => !(p.end && p.end < tm)).map((p) => ({ ...p, start: Math.max(p.start, tm) }));
  });
  last = { ask: [], extras: [], wait: 0, waits: [], none: [] };
}

// ------------------------------------------------------------------ 今日行動
/** 這支手機看到過「今天休市」的日子（後台開盤後有跑、證交所的資料卻停在之前）：用來判斷扣款有沒有順延到今天 */
const closedDays = () => { const xs = store.get('closed', []); return Array.isArray(xs) ? xs.filter((x) => Number.isInteger(x)) : []; };
function noteClosed(td) { const xs = closedDays(); if (!xs.includes(td)) store.set('closed', [...xs, td].slice(-40)); }
const weekdayOf = (d) => new Date(Date.UTC(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100)).getUTCDay();
/** 原本的扣款日到昨天的每一個平日都確定休市，國泰才會順延到今天（資料只是晚到的時候不亂說） */
function rolledKnown(p, td, asof) {
  const closed = new Set(closedDays());
  const days = new Set(C.planDays(p));
  for (let x = PF.addDays(asof, 1); x < td; x = PF.addDays(x, 1)) {
    if (!days.has(x % 100)) continue;
    let ok = true;
    for (let y = x; y < td; y = PF.addDays(y, 1)) { const w = weekdayOf(y); if (w >= 1 && w <= 5 && !closed.has(y)) { ok = false; break; } }
    if (ok) return true;
  }
  return false;
}
/** 今天扣款的計畫、待核對的筆數（給指揮台的「今日行動」） */
export function dcaActions(chip) {
  const out = [];
  const td = today();
  const lots = realLots();
  const L = S.live;
  const openToday = !!(L && L.date === td);          // 今天有盤中資料＝今天有開市
  // 後台今天開盤後跑過、證交所的即時資料卻停在之前的日期＝今天休市（和頂端狀態列同一個判斷）
  const ranToday = !!(L && L.at && +String(L.at).slice(0, 10).replace(/-/g, '') === td && +String(L.at).slice(11, 13) * 100 + +String(L.at).slice(14, 16) >= 905);
  const closedToday = ranToday && L.date != null && L.date < td;
  if (closedToday) noteClosed(td);
  const asof = S.summary ? S.summary.asof : null;
  for (const p of settings.plans || []) {
    const due = C.dcaDueToday(p, td);
    const rolled = !due && openToday && asof && asof < td && C.dcaRolledToday(p, td, asof) && rolledKnown(p, td, asof);
    if (!due && !rolled) continue;
    const r = S.rows.get(p.c);
    if (!r) continue;
    const done = lots.find((l) => C.isDcaLot(l) && l.dca.plan === p.id && l.d === td);
    const rule = r.ps === 'trim' || r.ps === 'caution' ? `；規則現在是「${r.ps === 'trim' ? '減碼' : '先不加碼'}」，另外的單筆加碼先等一等` : '';
    out.push({
      pri: 1, code: p.c, chip: chip('扣款日', 'alert'), title: r.n,
      text: done
        ? `今天國泰扣 <b class="num">${money(p.amt)}</b> 元，冷眼已經用收盤價記下 <b class="num">${sharesOf(done.sh)}</b>（預估）。定期定額照紀律扣，不看短期訊號${rule}。`
        : closedToday
          ? `今天是扣款日，但今天休市：國泰會順延到下一個交易日扣 <b class="num">${money(p.amt)}</b> 元，冷眼會照實際成交那天自動記。`
          : rolled
            ? `前幾天的扣款日遇到休市，國泰順延到今天扣 <b class="num">${money(p.amt)}</b> 元。收盤資料出來後，冷眼會照實際成交那天自動記${rule}。`
            : `今天是扣款日：國泰扣 <b class="num">${money(p.amt)}</b> 元（遇到休市就順延到下一個交易日）。收盤資料出來後，冷眼會自動記一筆預估。定期定額照紀律扣，不看短期訊號${rule}。`,
    });
  }
  const n = pendingLots().length;
  const q = last.ask.length + last.extras.length;
  if (n || q) {
    out.push({
      pri: 2, act: 'dca', chip: chip('待核對', 'go2'), title: '定期定額',
      text: q
        ? `有 <b class="num">${q}</b> 件事要你確認（你自己也記了一筆、或改了設定之後多出來的紀錄），確認前不會重複記${n ? `；另外 <b class="num">${n}</b> 筆預估等你核對` : ''}。`
        : `有 <b class="num">${n}</b> 筆自動記的是預估，對照國泰 App 的成交回報核對一下，或一次和庫存對齊。`,
    });
  }
  return out;
}

// ------------------------------------------------------------------ 計畫清單（設定頁、「部位」頁）
function statusOf(p) {
  const mine = realLots().filter((l) => C.isDcaLot(l) && l.dca.plan === p.id);
  const pend = mine.filter((l) => l.dca.est === true).length;
  const td = today();
  const ended = p.end && p.end < td;
  let next = null;
  if (!ended) {
    // 下一期（只看日期，平日放假要等官方資料才知道）
    for (let k = 0; k < 400 && !next; k++) {
      const d = PF.addDays(td, k);
      if (C.dcaDueToday(p, d) && !mine.some((l) => l.d === d)) next = d;
    }
  }
  const halts = last.none.filter((x) => x.plan === p.id && x.why === 'halt').length;
  const waiting = last.waits.filter((x) => x.plan === p.id).length;
  const bits = [];
  // 國泰改了設定：舊的設定留著（到變更生效的前一天），新的設定是另一個計畫
  const succ = !!(p.end && successorOf(p));
  if (ended) bits.push(succ ? `已換新設定（${fmt.d(p.end)} 以前成交的照這個）` : `已停扣（${fmt.d(p.end)} 以前成交的才算）`);
  else if (next) bits.push(`下一期 ${fmt.d(next)}`);
  if (mine.length) bits.push(`已記 ${mine.length} 期`);
  if (pend) bits.push(`<b class="pend">待核對 ${pend}</b>`);
  if (halts) bits.push(`${halts} 期停止交易、國泰沒扣`);
  if (waiting) bits.push(`${waiting} 期等官方收盤資料`);
  if (!ended && td > PROMO_END && p.fee === 1) bits.push('<b class="pend">1 元手續費優惠到 2026/12/31，國泰改了記得來改</b>');
  return bits.join('・');
}
const planRows = (ps) => `<ul class="plan-list">${ps.map((p) => `<li><button type="button" class="plan-row" data-plan="${esc(p.id)}"><span class="pl-n"><b>${esc(nameOf(p.c))}</b> <span class="muted num">${esc(p.c)}</span></span><span class="pl-d">${esc(daysText(p))}・<b class="num">${money(p.amt)}</b> 元</span><span class="pl-s small muted">${statusOf(p)}</span></button></li>`).join('')}</ul>`;
const sortPlans = (ps) => ps.slice().sort((a, b) => (!!a.end - !!b.end) || a.c.localeCompare(b.c) || a.start - b.start);
/** 已經有計畫、還沒看過新版說明的人：說一次「現在會自動記、你自己記過的會先問」 */
const noticeHTML = () => ((settings.plans || []).length && settings.dcaNotice !== 2
  ? '<div class="dca-note"><span>定期定額現在會<b>自動記</b>：扣款日收盤後，冷眼用官方收盤價記一筆「預估」，不用再自己記一筆。如果你之前已經自己記過某幾期，冷眼會先問你是不是同一筆，不會重複記。</span><button type="button" class="btn small ghost" data-dca="ok">知道了</button></div>'
  : '');
/** 設定頁的「定期定額」那一列 */
export function plansHTML() {
  const ps = sortPlans(settings.plans || []);
  const n = pendingLots().length + last.ask.length + last.extras.length;
  return `<div class="srow col"><div><div class="h" data-term="dca">定期定額（國泰證券）</div><div class="d">每到扣款日，等官方收盤資料出來，冷眼自動幫你記一筆「預估」，你再對照國泰 App 的成交回報核對。以前扣過的可以補記，再一次和國泰庫存對齊。只記在這支手機的真實部位。</div></div>
    ${noticeHTML()}${ps.length ? planRows(ps) : ''}
    <div class="row-btns"><button type="button" class="btn small" data-dca="add">${ICON.plus}新增定期定額</button>${n ? `<button type="button" class="btn small ghost" data-dca="pend">核對（${n}）</button>` : ''}</div></div>`;
}
/** 「部位」頁的定期定額小卡：沒有計畫時是一句邀請，有計畫時列出狀態 */
export function dcaStripHTML() {
  if (isPaper()) return '';
  const ps = sortPlans(settings.plans || []);
  const n = pendingLots().length + last.ask.length + last.extras.length;
  if (!ps.length) {
    return `<section class="panel pad dca-strip invite"><div><b>有在國泰定期定額嗎？</b><span class="small muted">設定一次，每期扣款後冷眼自動記進部位；以前扣過的也能補記。</span></div><button type="button" class="btn small" data-dca="add">${ICON.plus}設定定期定額</button></section>`;
  }
  return `<div class="sec-h"><h2 data-term="dca">定期定額</h2><span class="aside">國泰・收盤後自動記</span></div>
    <section class="panel pad dca-strip">${noticeHTML()}${planRows(ps)}
      <div class="row-btns"><button type="button" class="btn small ghost" data-dca="add">${ICON.plus}新增</button>${n ? `<button type="button" class="btn small" data-dca="pend">核對（${n}）</button>` : ''}</div></section>`;
}
/** 交易紀錄上的小標籤 */
export function dcaTagsHTML(l) {
  if (!C.isDcaLot(l)) return '';
  return `<span class="tx-tag">定期定額</span>${l.dca.est === true ? '<span class="tx-tag est">預估・待核對</span>' : l.dca.cal ? '<span class="tx-tag ok">已對齊</span>' : ''}`;
}
export function bindPlans(root, redraw) {
  $$('[data-dca="add"]', root).forEach((b) => b.addEventListener('click', () => openPlanForm(null, redraw)));
  $$('[data-dca="pend"]', root).forEach((b) => b.addEventListener('click', () => openPending(redraw)));
  $$('[data-dca="ok"]', root).forEach((b) => b.addEventListener('click', () => { settings.dcaNotice = 2; saveSettings(); if (redraw) redraw(); }));
  $$('[data-plan]', root).forEach((b) => b.addEventListener('click', () => openPlanForm(b.dataset.plan, redraw)));
}

// ------------------------------------------------------------------ 新增／編輯計畫
function pickerHTML(id, ph) {
  return `<div class="picker"><input class="input" id="${id}" placeholder="${esc(ph)}" autocomplete="off"><div class="sugg" id="${id}-s"></div></div>`;
}
const choice = (attr, val, on, title, desc) => `<button type="button" class="choice" data-${attr}="${val}" aria-pressed="${on}"><b>${title}</b>${desc ? `<small>${desc}</small>` : ''}</button>`;
/** 你自己記的（不是定期定額記的）同一檔買進：不記得日期的股數、有日期的筆數（補記以前的可能會重複） */
function manualOf(code, from) {
  const ls = realLots().filter((l) => l.c === code && l.side === 'buy' && !C.isDcaLot(l));
  return { undated: ls.filter((l) => !l.d).reduce((a, l) => a + l.sh, 0), dated: ls.filter((l) => l.d && (!from || l.d >= from)).length };
}
export function openPlanForm(id, after) {
  if (!S.summary) return;
  reloadPlans();
  const old = id ? planOf(id) : null;
  if (id && !old) { toast('這個計畫已經不在了（可能在另一個分頁刪掉了）'); if (after) after(); return; }
  const td = today();
  // 生效日要用官方的交易日算（遇到連假會差一兩天）：還沒載入就先載入，載完再更新畫面上的說明
  let cal = calNow();
  let cutToday = C.dcaCutover(td, cal);
  const f = {
    code: old ? old.c : null,
    days: old ? C.planDays(old) : [],
    from: null,                       // 新計畫：back（補記以前的）、now（只記之後的）、new（今天才申請）
    ended: !!(old && old.end),
    why: null,                        // 編輯時改了扣款設定：cathay（國泰那邊改了）、fix（當初填錯）
  };
  const recorded = old ? realLots().filter((l) => C.isDcaLot(l) && l.dca.plan === old.id).length : 0;
  const skips = old ? (settings.dcaSkip || []).filter((k) => k.startsWith(`${old.c}|`)).map((k) => +k.split('|')[1]).sort((a, b) => b - a) : [];
  const skipped = skips.length;
  // 國泰那邊改過設定：這是舊的那一段，後面接著新設定的計畫（不是真的停扣，不能在這裡改回「還在扣」）
  const successor = old && old.end ? successorOf(old) : null;
  const card = openModal(`<div class="form dca">
      <h2 class="m-title">${old ? '編輯定期定額' : '新增定期定額'}</h2>
      <p class="m-desc">照國泰證券的規則：每月可以選好幾天；遇到休市順延到下一個交易日；那個月沒有的日期（例如 2/30）那一期不買；分割等停止交易的日子不扣也不補。</p>
      <div class="field"><span class="lab">哪一檔</span><div id="p-etf"></div></div>
      <div class="field"><span class="lab">每月幾號扣款（可以選好幾天）</span><div class="day-grid" role="group" aria-label="扣款日">${Array.from({ length: 31 }, (_, k) => `<button type="button" data-day="${k + 1}" aria-pressed="${f.days.includes(k + 1)}" class="num">${k + 1}</button>`).join('')}</div></div>
      <div class="f-row">
        <label class="field"><span class="lab">每期金額（含手續費）</span><input class="input num" id="p-amt" inputmode="numeric" placeholder="例如 3000" value="${old ? esc(old.amt) : ''}"></label>
        <label class="field"><span class="lab">每筆手續費</span><input class="input num" id="p-fee" inputmode="decimal" value="${esc(old ? old.fee : DCA_FEE)}"></label>
      </div>
      <p class="small muted">國泰定期定額以百元為單位、每筆最低 100 元；2026/12/31 前每筆手續費 1 元。有開「智慧加減碼」的話每期金額會變，核對時照國泰的成交回報改就好。</p>
      ${old ? `<div class="field"><label class="field inline"><span class="lab">從哪一天開始記（成交日）</span><input class="input num" type="date" id="p-start" min="${isoOf(HIST_FROM)}" value="${isoOf(old.start)}"></label>
        <p class="small muted">改早一點會補記；改晚一點，之前還沒核對的預估會刪掉（核對過的不動）。</p>
        ${skipped ? `<details class="p-skips"><summary class="small">這檔你刪掉過 <b class="num">${skipped}</b> 期（例如按了「這期沒扣到」），冷眼不會自動補回來。刪錯了可以恢復</summary>
          <ul>${skips.slice(0, 12).map((x) => `<li><span class="num">${fmt.d(x)}</span> 那一期<button type="button" class="link small" data-unskip="${x}">恢復</button></li>`).join('')}</ul>
          ${skipped > 1 ? `<button type="button" class="link small" data-unskip="all">全部 ${skipped} 期都恢復</button>` : ''}</details>` : ''}</div>`
      : `<div class="field"><span class="lab">從什麼時候開始記</span>
        <div class="choices" role="radiogroup" aria-label="從什麼時候開始記">
          ${choice('from', 'back', false, '已經在扣了，補記以前的', '從你選的那天起，每一期用那天的官方收盤價補記成「預估」')}
          ${choice('from', 'now', false, '已經在扣了，只記之後的', '今天起成交的才記，以前的不補')}
          ${choice('from', 'new', false, '今天才在國泰申請', `國泰規定申請後 1 個交易日才生效：${fmt.d(cutToday)}（含）以後成交的才算`)}
        </div>
        <div class="p-from" id="p-back" hidden><label class="field inline"><span class="lab">從哪一天開始補</span><input class="input num" type="date" id="p-start" min="${isoOf(HIST_FROM)}" max="${isoOf(td)}"></label>
          <p class="small muted">選第一次扣款那天，或你想開始記的那天。官方歷史資料從 2020 年 1 月開始；補完可以一次和國泰 App 的庫存對齊。</p>
          <p class="small k-warn" id="p-dup" hidden></p></div>
      </div>`}
      ${successor ? `<p class="est-box small">已換新設定：這一段設定記到 <b class="num">${fmt.d(old.end)}</b>（含）成交的那幾期，之後照「${esc(daysText(successor))}・${money(successor.amt)} 元」那個計畫。要改新的設定，請到那個計畫。</p>` : ''}
      <button type="button" class="switch-row" id="p-ended" aria-pressed="${f.ended}"${successor ? ' hidden' : ''}><span class="switch" role="switch" aria-checked="${f.ended}"></span><span>已經停扣了<small>（之後不再自動記）</small></span></button>
      <div class="p-from" id="p-endw"${f.ended && !successor ? '' : ' hidden'}><label class="field inline"><span class="lab">哪天在國泰按停扣</span><input class="input num" type="date" id="p-stop" min="${isoOf(HIST_FROM)}" max="${isoOf(td)}" value="${isoOf(old && old.end ? old.stop || old.end : td)}"></label>
        <p class="small muted" id="p-stoptxt"></p></div>
      ${old ? `<div class="p-why" id="p-why" hidden><span class="lab">這次改了扣款的設定，是…</span>
        <div class="choices" role="radiogroup" aria-label="修改的原因">
          ${choice('why', 'cathay', false, '國泰那邊改了設定', '以前記的照舊；從變更生效那天起照新的設定')}
          ${choice('why', 'fix', false, '當初填錯了', '以前還沒核對的預估照新的設定重算（核對過的不動）')}
        </div>
        <div class="p-from" id="p-sentw" hidden><label class="field inline"><span class="lab">哪天在國泰送出變更</span><input class="input num" type="date" id="p-sent" min="${isoOf(HIST_FROM)}" max="${isoOf(td)}" value="${isoOf(td)}"></label>
          <p class="small muted" id="p-senttxt"></p></div></div>` : ''}
      <div class="f-err" id="p-err" role="alert"></div>
      <div class="m-actions" id="p-acts">${old ? '<button type="button" class="btn danger ghost" id="p-del">刪除計畫</button>' : ''}<button type="button" class="btn ghost" data-close>取消</button><button type="button" class="btn primary" id="p-save">${ICON.ok}儲存</button></div>
      <div class="p-delw" id="p-delw" hidden></div>
    </div>`, { label: old ? '編輯定期定額' : '新增定期定額' });
  const etf = $('#p-etf', card);
  const err = $('#p-err', card);
  const fail = (t) => { err.textContent = t; FX.sfx('err'); return false; };
  const dupWarn = () => {
    const w = $('#p-dup', card);
    if (!w) return;
    const from = dOf(($('#p-start', card) || {}).value);
    const m = f.code && f.from === 'back' ? manualOf(f.code, from) : { undated: 0, dated: 0 };
    const lines = [];
    if (m.undated) lines.push(`這檔你有 ${sharesOf(m.undated)}是用「不記得日期」記的。如果那些就是定期定額買的，補記以前的會重複算：建議選「只記之後的」，或補記之後刪掉那一筆。`);
    if (m.dated) lines.push(`這段期間你自己記過 ${m.dated} 筆這檔的買進：扣款日附近有你自己記的，冷眼會先問你是不是同一筆，不會重複記。`);
    w.innerHTML = lines.map(esc).join('<br>');
    w.hidden = !lines.length;
  };
  const drawEtf = () => {
    if (f.code) {
      const r = S.rows.get(f.code);
      etf.innerHTML = `<div class="picked"><b>${esc(r ? r.n : f.code)}</b> <span class="num muted">${esc(f.code)}</span>${r && isNum(r.p) ? `<small class="muted num">最新收盤 ${fmt.px(r.p)}</small>` : ''}<button type="button" class="link small" id="p-chg">更換</button></div>`;
      $('#p-chg', etf).addEventListener('click', () => { f.code = null; drawEtf(); const q = $('#p-q', etf); if (q) q.focus(); });
      dupWarn();
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
  $$('[data-from]', card).forEach((b) => b.addEventListener('click', () => {
    f.from = b.dataset.from;
    $$('[data-from]', card).forEach((x) => x.setAttribute('aria-pressed', x === b));
    $('#p-back', card).hidden = f.from !== 'back';
    if (f.from === 'back') { const s = $('#p-start', card); if (s && !s.value) setTimeout(() => s.focus(), 30); }
    dupWarn();
  }));
  const startEl = $('#p-start', card);
  if (startEl && !old) startEl.addEventListener('input', dupWarn);
  // 停扣：國泰規定終止 1 個交易日後才生效，送出那天和隔天成交的照樣扣
  const stopTxt = () => {
    const s = dOf($('#p-stop', card).value);
    $('#p-stoptxt', card).textContent = s ? `國泰規定停扣 1 個交易日後才生效：${fmt.d(PF.addDays(C.dcaCutover(s, cal), -1))}（含）以前成交的那幾期照樣會扣，之後就不記了。` : '';
  };
  let stopTouched = false;
  $('#p-stop', card).addEventListener('input', () => { stopTouched = true; stopTxt(); });
  stopTxt();
  const endBtn = $('#p-ended', card);
  endBtn.addEventListener('click', () => {
    f.ended = !f.ended;
    endBtn.setAttribute('aria-pressed', f.ended);
    $('.switch', endBtn).setAttribute('aria-checked', f.ended);
    $('#p-endw', card).hidden = !f.ended;
  });
  const sentTxt = () => {
    const el = $('#p-sent', card);
    if (!el) return;
    const s = dOf(el.value);
    $('#p-senttxt', card).textContent = s ? `國泰規定變更 1 個交易日後生效：${fmt.d(PF.addDays(C.dcaCutover(s, cal), -1))}（含）以前成交的照原本的設定，${fmt.d(C.dcaCutover(s, cal))} 起照新的設定。` : '';
  };
  if ($('#p-sent', card)) { $('#p-sent', card).addEventListener('input', sentTxt); sentTxt(); }
  const newTxt = () => { const x = $('[data-from="new"] small', card); if (x) x.textContent = `國泰規定申請後 1 個交易日才生效：${fmt.d(cutToday)}（含）以後成交的才算`; };
  const useCal = (c) => { if (!c || c === TIMEOUT) return; cal = c; cutToday = C.dcaCutover(td, cal); if (card.isConnected) { newTxt(); stopTxt(); sentTxt(); } };
  if (!cal) timed(loadCal(), 8000).then(useCal).catch(() => {});
  $$('[data-why]', card).forEach((b) => b.addEventListener('click', () => {
    f.why = b.dataset.why;
    $$('[data-why]', card).forEach((x) => x.setAttribute('aria-pressed', x === b));
    $('#p-sentw', card).hidden = f.why !== 'cathay';
    err.textContent = '';
  }));

  // 刪錯的那幾期：一期一期恢復（或全部），從 dcaSkip 拿掉，讓冷眼重新補記
  $$('[data-unskip]', card).forEach((btn) => btn.addEventListener('click', async () => {
    const v = btn.dataset.unskip;
    btn.disabled = true;
    savePlans((st) => { st.dcaSkip = st.dcaSkip.filter((k) => !(k.startsWith(`${old.c}|`) && (v === 'all' || k === `${old.c}|${v}`))); });
    const r = await runPlans({ quiet: true });
    if (card.isConnected) closeModal();
    FX.cue('ok');
    toast(`已恢復：重新補記 ${r.added.length} 期（預估）${r.ask.length ? `，${r.ask.length} 期要你確認` : ''}`, null);
    bus.emit('book');
    if (after) after();
  }));
  // 刪除：問要不要連同還沒核對的預估一起刪
  const del = $('#p-del', card);
  if (del) del.addEventListener('click', () => {
    const est = realLots().filter((l) => C.isDcaLot(l) && l.dca.plan === old.id && l.dca.est === true).length;
    const w = $('#p-delw', card);
    w.hidden = false;
    $('#p-acts', card).hidden = true;
    FX.sfx('warn');
    w.innerHTML = `<p class="small">如果是在國泰停扣了，請按「取消」，改用上面的「已經停扣了」：以前記的都會留著，之後不再記。</p>
      <div class="m-actions">${est ? `<button type="button" class="btn danger ghost" data-del="all">刪除計畫和還沒核對的 ${est} 筆預估</button>` : ''}<button type="button" class="btn danger ghost" data-del="plan">${est ? '只刪計畫，記過的交易留著' : '刪除計畫（記過的交易留著）'}</button><button type="button" class="btn ghost" data-del="no">取消</button></div>`;
    w.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    $$('[data-del]', w).forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.del === 'no') { w.hidden = true; $('#p-acts', card).hidden = false; return; }
      const withEst = b.dataset.del === 'all';
      savePlans((st) => { st.plans = st.plans.filter((p) => p.id !== old.id); });
      if (withEst) updateRealBook((bk) => { bk.lots = bk.lots.filter((l) => !(C.isDcaLot(l) && l.dca.plan === old.id && l.dca.est === true)); });
      if (card.isConnected) closeModal();
      toast(withEst ? '已刪除定期定額計畫和還沒核對的預估（核對過的留著）' : '已刪除定期定額計畫（已經記的交易留著，要刪請到「部位」）', null);
      bus.emit('book');
      if (after) after();
      runPlans({ quiet: true });
    }));
  });

  $('#p-save', card).addEventListener('click', async () => {
    err.textContent = '';
    // 已經下市、不在最新收盤資料裡的那一檔：原本的計畫還是可以改（例如標成已經停扣）
    if (!f.code || (!S.rows.get(f.code) && !(old && f.code === old.c))) return fail('先選一檔 ETF');
    if (!f.days.length) return fail('至少選一個扣款日');
    const amt = Math.round(num($('#p-amt', card).value));
    if (!(amt >= 100 && amt <= 10000000)) return fail('每期金額請填 100 元到 1,000 萬元');
    if (amt % 100) return fail('國泰的定期定額以百元為單位，例如 3000、3100');
    const fee = num($('#p-fee', card).value);
    if (!(fee >= 0 && fee <= 1000)) return fail('手續費請填 0 到 1,000 元');
    const r = S.rows.get(f.code);
    if (r && isNum(r.p) && amt - fee < r.p) return fail(`每期金額扣掉手續費，連 1 股都買不到（最新收盤 ${fmt.px(r.p)} 元）`);
    if (!cal) {
      // 生效日要用官方交易日算：先等資料（最多 6 秒），這段時間不能再按，按了取消就不存
      const sb = $('#p-save', card);
      sb.disabled = true;
      useCal(await timed(loadCal(), 6000).catch(() => null));
      if (!card.isConnected) return false;
      sb.disabled = false;
    }
    // 從哪天開始記（看成交日）
    let start;
    if (old) {
      start = dOf($('#p-start', card).value);
      if (!start || start < HIST_FROM) return fail('開始記的日期請選 2020/1/2 以後');
    } else if (f.from === 'back') {
      start = dOf($('#p-start', card).value);
      if (!start || start < HIST_FROM || start > td) return fail('補記的開始日請選 2020/1/2 到今天');
    } else if (f.from === 'now') start = td;
    else if (f.from === 'new') start = cutToday;
    else return fail('請選從什麼時候開始記');
    if (!old && (settings.plans || []).length >= PLAN_MAX) return fail(`計畫已經有 ${PLAN_MAX} 個了，先刪掉用不到的（例如很久以前停扣的）再新增`);
    // 停扣
    let end = null, stop = null;
    if (f.ended && old && old.end && !stopTouched) {
      end = old.end;                                   // 沒動停扣的日期：照原本的，不要每存一次就重算往後跑
      stop = old.stop;
    } else if (f.ended) {
      stop = dOf($('#p-stop', card).value);
      if (!stop || stop > td) return fail('停扣的日期請選今天或以前');
      end = PF.addDays(C.dcaCutover(stop, cal), -1);
    }
    if (end && end < start) return fail('停扣生效比開始記的日期還早，請再檢查一次');
    const next = { id: old ? old.id : newId(), c: f.code, days: f.days, amt, fee, start, end, stop };
    let parts = [next];
    // 編輯時改了扣款的設定（代號、扣款日、金額、手續費），而且已經記過：要知道是國泰那邊改了、還是當初填錯
    const changed = old && (old.c !== f.code || old.amt !== amt || old.fee !== fee || C.planDays(old).join() !== f.days.join());
    // 已經停扣（或換過設定）的計畫：改的一定是以前的紀錄（當初填錯），不會再分成兩段
    if (changed && recorded && !(old.end && old.end < td)) {
      if (!f.why) { $('#p-why', card).hidden = false; $('#p-why', card).scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return fail('這個計畫已經記過，請先選這次修改是哪一種'); }
      if (f.why === 'cathay') {
        const sent = dOf($('#p-sent', card).value);
        if (!sent || sent > td) return fail('請選在國泰送出變更的日期（今天或以前）');
        const cut = C.dcaCutover(sent, cal);
        if (end && end < cut) return fail('停扣比這次變更生效還早，新的設定不會扣到；請再檢查一次');
        if (cut > start) {
          // 舊的設定到變更生效的前一天；新的設定從生效那天開始（另外一個計畫）
          parts = [
            { ...old, start, end: PF.addDays(cut, -1), stop: sent, sb: false },
            { ...next, id: newId(), start: cut, prev: old.id },
          ];
        }
      }
    }
    const normed = parts.map((p) => C.normPlan(p, td));
    if (normed.some((p) => !p)) return fail('計畫的內容有問題，請再檢查一次');
    // 同一檔、同一天、期間重疊：國泰一張申購單就能選好幾天，重疊多半是重複設定（會記兩次）
    const others = (settings.plans || []).filter((p) => !old || p.id !== old.id);
    const clash = others.find((o) => normed.some((p) => C.plansOverlap(p, o)));
    if (clash) return fail(`${nameOf(clash.c)} 已經有一個 ${daysText(clash)} 的計畫和這個重疊（同一天會記兩次）。國泰一張申購單就能選好幾天，請直接編輯原本那個計畫。`);
    // 同一檔、期間重疊、扣款日不同的另一個計畫：國泰一張申購單就能選好幾天，多半是重複設定 → 確定是兩張申購單才存（按兩次）
    const conc = others.find((o) => o.c === f.code && !(old && (o.prev === old.id || old.prev === o.id)) && normed.some((p) => p.start <= (o.end || 99991231) && o.start <= (p.end || 99991231)));
    if (conc && !f.concOk) { f.concOk = true; return fail(`${nameOf(conc.c)} 已經有一個「${daysText(conc)}」的計畫同時在扣。國泰一張申購單就能選好幾天，多半直接編輯原本那個就好；如果真的是兩張不同的申購單，再按一次「儲存」。`); }
    if (!savePlans((st) => { st.plans = st.plans.filter((p) => !old || p.id !== old.id).concat(normed); })) return fail('這個瀏覽器不允許儲存資料（可能是私密瀏覽模式）');
    const btn = $('#p-save', card);
    btn.disabled = true;
    btn.textContent = start < td ? '補記中…' : '儲存中…';
    const res = await runPlans({ quiet: true });
    if (card.isConnected) closeModal();
    FX.cue('lock');
    const main = normed[normed.length - 1];
    FX.stamp(old ? '計畫已更新' : '計畫已啟動', 'aurora', `${nameOf(main.c)}・${daysText(main)}`);
    const msg = [];
    if (res.added.length) msg.push(`補記 ${res.added.length} 期（預估）`);
    if (res.removed.length) msg.push(`刪掉 ${res.removed.length} 筆和新設定不符的預估`);
    if (res.ask.length) msg.push(`${res.ask.length} 期你好像已經自己記過，等你確認`);
    if (changed && res.moved) msg.push(`${res.moved} 筆核對過的照舊算在新設定的那一期（不會重複記）`);
    toast(msg.length ? `已${old ? '更新' : '新增'}定期定額：${msg.join('、')}` : old ? '已更新定期定額計畫' : `已新增：${nameOf(main.c)} ${daysText(main)}，扣款日收盤後自動記一筆`, null);
    bus.emit('book');
    if (after) after();
    // 補記了好幾期：接著問要不要和國泰庫存對齊；有要確認的先問那個
    // （這段時間你已經打開別的視窗就不打擾）
    if (res.ask.length) setTimeout(() => { if (!modalOpen()) openPending(after); }, 900);
    else if (res.added.length > 1 && start < td) setTimeout(() => { if (!modalOpen()) openCalibrate(main.c, { fresh: true }); }, 900);
  });
}

// ------------------------------------------------------------------ 核對一筆
export function openConfirm(lotId) {
  const lot = realLots().find((l) => l.id === lotId);
  if (!lot || !C.isDcaLot(lot)) return;
  const p = planOf(lot.dca.plan);
  const card = openModal(`<div class="form dca">
      <h2 class="m-title">核對定期定額</h2>
      <p class="m-desc"><b>${esc(nameOf(lot.c))}</b> <span class="num">${esc(lot.c)}</span>・成交日 ${fmt.dy(lot.d)}${lot.dca.s !== lot.d ? `（原本扣款日 ${fmt.d(lot.dca.s)}，遇到休市順延）` : ''}</p>
      <div class="est-box">${lot.dca.est ? '冷眼預估' : '目前記的'}：<b class="num">${sharesOf(lot.sh)}</b> × <span class="num">${fmt.px(lot.px)}</span>${lot.dca.est ? (lot.dca.pd ? `（那天整股沒有成交，用 ${fmt.d(lot.dca.pd)} 的收盤價）` : '（那天的官方收盤價）') : ''}＋手續費 <span class="num">${fmt.n(lot.fee || 0)}</span> 元＝<b class="num">${money(lot.sh * lot.px + (lot.fee || 0))}</b> 元${p ? `<small>計畫每期 ${money(p.amt)} 元</small>` : ''}</div>
      <p class="small muted">打開國泰 App 的成交回報（或對帳單），把這一期實際買到的股數和均價（或成交金額）填進來。國泰是盤中、盤後分批買，成交均價通常和收盤價差一點點。餘額不足扣款失敗的，國泰不會補扣：按「這期沒扣到」。</p>
      <div class="f-row">
        <label class="field"><span class="lab">成交股數</span><input class="input num" id="c-sh" inputmode="numeric" value="${esc(lot.sh)}"></label>
        <label class="field"><span class="lab">成交均價</span><input class="input num" id="c-px" inputmode="decimal" value="${esc(lot.px)}"></label>
      </div>
      <div class="f-row">
        <label class="field"><span class="lab">或填成交金額（不含手續費）</span><input class="input num" id="c-amt" inputmode="numeric" placeholder="填了就用它算均價"></label>
        <label class="field"><span class="lab">手續費</span><input class="input num" id="c-fee" inputmode="decimal" value="${esc(lot.fee || 0)}"></label>
      </div>
      <div class="k-prev small" id="c-sum"></div>
      <div class="f-err" id="c-err" role="alert"></div>
      <div class="m-actions"><button type="button" class="btn danger ghost" id="c-skip">這期沒扣到</button>${lot.dca.est ? '<button type="button" class="btn ghost" id="c-same">和預估一樣</button>' : ''}<button type="button" class="btn primary" id="c-save">${ICON.ok}存檔</button></div>
      <button type="button" class="link small" id="c-cal">一筆一筆太麻煩？和國泰庫存一次對齊</button>
    </div>`, { label: '核對定期定額' });
  const shEl = $('#c-sh', card), pxEl = $('#c-px', card), amtEl = $('#c-amt', card), feeEl = $('#c-fee', card), err = $('#c-err', card), sum = $('#c-sum', card);
  // 填了成交金額就一律用「金額 ÷ 股數」當均價（改股數也跟著重算），不會留下舊的均價
  const read = () => {
    const sh = Math.round(num(shEl.value)), a = num(amtEl.value), fee = num(feeEl.value);
    const useAmt = String(amtEl.value).trim() !== '' && a > 0;
    const px = useAmt ? (sh > 0 ? a / sh : NaN) : num(pxEl.value);
    return { sh, px, fee, useAmt };
  };
  const show = () => {
    const x = read();
    if (x.useAmt && x.sh > 0) pxEl.value = +x.px.toFixed(4);
    pxEl.readOnly = x.useAmt;
    sum.textContent = x.sh >= 1 && x.px > 0 && x.fee >= 0 ? `存檔後：${sharesOf(x.sh)} × ${fmt.px(x.px)}＋手續費 ${fmt.n(x.fee)} 元＝${money(x.sh * x.px + x.fee)} 元` : '';
  };
  [shEl, amtEl, feeEl, pxEl].forEach((el) => el.addEventListener('input', show));
  show();
  const write = (fn, msg) => {
    if (!updateRealBook((b) => { const l = b.lots.find((x) => x.id === lot.id); if (!l) return false; fn(l); return true; })) { toast('找不到這一筆（可能在另一個分頁改過了）'); closeModal(); bus.emit('book'); return; }
    closeModal();
    FX.cue('lock');
    toast(msg, null);
    bus.emit('book');
  };
  $('#c-save', card).addEventListener('click', () => {
    const x = read();
    if (!(x.sh >= 1)) { err.textContent = '成交股數至少 1 股'; FX.sfx('err'); return; }
    if (!(x.px > 0)) { err.textContent = '請填成交均價或成交金額'; FX.sfx('err'); return; }
    if (!(x.fee >= 0)) { err.textContent = '手續費格式不對'; FX.sfx('err'); return; }
    if (x.px > lot.px * 1.25 || x.px < lot.px * 0.8) { err.textContent = `均價 ${fmt.px(x.px)} 和那天的收盤價 ${fmt.px(lot.px)} 差太多（台股一天最多漲跌 10%），請再對一次成交回報`; FX.sfx('err'); return; }
    write((l) => { l.sh = x.sh; l.px = +x.px.toFixed(4); l.fee = x.fee; l.dca = { ...l.dca, est: false }; }, '已核對這一期');
  });
  const same = $('#c-same', card);
  if (same) same.addEventListener('click', () => write((l) => { l.dca = { ...l.dca, est: false }; }, '已核對：和預估一樣'));
  $('#c-skip', card).addEventListener('click', (ev) => {
    const b = ev.currentTarget;
    if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = '確定刪除這一期？'; FX.sfx('warn'); return; }
    updateRealBook((bk) => { bk.lots = bk.lots.filter((x) => x.id !== lot.id); });
    onDcaLotDel({ lot });
    closeModal();
    toast('已刪除這一期（之後不會再自動補回來）', null);
    bus.emit('book');
  });
  $('#c-cal', card).addEventListener('click', () => { closeModal(); openCalibrate(lot.c); });
}

// ------------------------------------------------------------------ 待核對：可能已經自己記過的、預估
/**
 * 「就是這筆」：把你自己記的那一筆連到這一期（算核對過），冷眼就不另外記；這一期如果已經有預估，預估刪掉。
 * all：同一天成交的好幾期一起問、你說「就是這幾期加起來」→ 其他幾期記成「不再補」。
 * 你自己記的那一筆如果進了決策日記、還沒定案，日記拿掉（定期定額不是在猜漲跌，不算命中率）。回傳有沒有成功。
 */
function linkManual(a, all = true) {
  const ok = updateRealBook((b) => {
    const l = b.lots.find((x) => x.id === a.cand.id);
    if (!l || C.isDcaLot(l)) return false;
    if (b.lots.some((x) => C.isDcaLot(x) && `${x.c}|${x.dca.s}` === a.key && x.dca.est !== true)) return false;
    l.dca = { plan: a.plan, s: a.s, est: false, link: true };
    b.lots = b.lots.filter((x) => !(C.isDcaLot(x) && x.dca.est === true && `${x.c}|${x.dca.s}` === a.key));
    return true;
  });
  if (ok && all && a.more && a.more.length) savePlans((st) => { for (const m of a.more) if (!st.dcaSkip.includes(m.key)) st.dcaSkip.push(m.key); });
  if (ok) bus.emit('dcalink', { id: a.cand.id });
  return ok;
}
/** 「是，重複了」：這一期已經核對過，你自己又記了一筆 → 刪掉你記的那一筆（照一般刪交易的流程，決策日記跟著處理） */
function dropDup(a) {
  let gone = null;
  const ok = updateRealBook((b) => {
    const l = b.lots.find((x) => x.id === a.cand.id);
    if (!l || C.isDcaLot(l)) return false;
    if (!b.lots.some((x) => C.isDcaLot(x) && `${x.c}|${x.dca.s}` === a.key && x.dca.est !== true)) return false;
    gone = l;
    b.lots = b.lots.filter((x) => x.id !== l.id);
    return true;
  });
  if (ok && gone) bus.emit('lotdel', { id: gone.id, lot: gone });
  return ok;
}
const askText = (a) => {
  const head = `<b>${esc(nameOf(a.c))}</b> <span class="num muted">${esc(a.c)}</span>・`;
  const mine = `你在 <b class="num">${fmt.d(a.cand.d)}</b> 自己記了 <b class="num">${sharesOf(a.cand.sh)}</b> × <span class="num">${fmt.px(a.cand.px)}</span>`;
  if (a.dup) return `${head}${fmt.d(a.s)} 那一期已經核對過了（${sharesOf(a.dup.sh)} × ${fmt.px(a.dup.px)}），${mine}。是不是同一筆記了兩次？`;
  if (a.est) return `${head}${fmt.d(a.s)} 那一期冷眼已經用收盤價記了一筆預估（${sharesOf(a.sh)}），${mine}。這兩筆是同一筆嗎？`;
  if (a.more && a.more.length) return `${head}${[a, ...a.more].map((x) => fmt.d(x.s)).join('、')} 這 ${a.more.length + 1} 期都順延到 ${fmt.d(a.d)} 成交，冷眼估這幾期加起來 ${sharesOf(a.gsh)}。${mine}。這筆是這幾期加起來的嗎？`;
  return `${head}${fmt.d(a.s)} 那一期（${fmt.d(a.d)} 成交，冷眼估 ${sharesOf(a.sh)}）。${mine}。這筆就是這一期定期定額嗎？`;
};
/** 每一題的按鈕：[答案代號, 文字, 主要按鈕] */
const askBtns = (a) => (a.dup ? [['dup', '是，刪掉我記的那筆', true], ['no', '不是，兩筆都留著']]
  : a.est ? [['yes', '是，留我記的、刪預估', true], ['no', '不是，兩筆都留著']]
    : a.more && a.more.length ? [['yes', '是，這幾期加起來', true], ['one', '只是其中一期'], ['no', '都不是，冷眼照估']]
      : [['yes', '是，就是這筆', true], ['no', '不是，冷眼照估一筆']]);
export function openPending(after) {
  const card = openModal('<div class="form dca" id="pend"></div>', { label: '核對定期定額' });
  const root = $('#pend', card);
  let busy = false;
  const refresh = async (fn) => {
    if (busy) return;
    busy = true;
    let msg = '';
    try { msg = fn(); await runPlans({ quiet: true }); } finally { busy = false; }
    if (msg) toast(msg, null);
    FX.cue('lock');
    bus.emit('book');
    if (after) after();
    if (root.isConnected) draw();
  };
  const draw = () => {
    const asks = dcaState().ask;
    const extras = dcaState().extras;
    const ls = pendingLots().slice().sort((a, b) => a.c.localeCompare(b.c) || b.d - a.d);
    const codes = [...new Set(ls.map((l) => l.c))];
    if (!asks.length && !extras.length && !ls.length) {
      root.innerHTML = `<h2 class="m-title">核對定期定額</h2><p class="m-desc">都核對好了。</p><div class="m-actions"><button type="button" class="btn primary" data-close>完成</button></div>`;
      bindClose(root);
      return;
    }
    const plain = asks.filter((a) => !a.dup && !a.est && !(a.more && a.more.length));
    root.innerHTML = `<h2 class="m-title">核對定期定額</h2>
      ${asks.length ? `<p class="m-desc">這幾期的扣款日附近，你也自己記了一筆同一檔的買進。是同一筆的話，冷眼就不重複算。</p>
        ${asks.length > 1 && plain.length === asks.length ? '<div class="row-btns"><button type="button" class="btn small" data-askall="yes">全部都是同一筆</button><button type="button" class="btn small ghost" data-askall="no">全部都不是</button></div>' : ''}
        <ul class="ask-list">${asks.map((a, i) => `<li class="ask-row"><div>${askText(a)}</div>
          <div class="row-btns">${askBtns(a).map(([v, t, main]) => `<button type="button" class="btn small${main ? '' : ' ghost'}" data-ask="${i}" data-ans="${v}">${t}</button>`).join('')}</div></li>`).join('')}</ul>` : ''}
      ${extras.length ? `<p class="m-desc">改了設定之後，這幾筆核對過的紀錄照現在的設定，那段時間沒有對應的扣款。是多記的就刪掉，不是就留著。</p>
        <ul class="ask-list">${extras.map((x, i) => `<li class="ask-row"><div><b>${esc(nameOf(x.c))}</b> <span class="num muted">${esc(x.c)}</span>・<b class="num">${fmt.d(x.d)}</b> ${sharesOf(x.sh)} × <span class="num">${fmt.px(x.px)}</span>（原本 ${fmt.d(x.s)} 那一期，已經核對過）。這筆是不是多記了？</div>
          <div class="row-btns"><button type="button" class="btn small" data-ex="${i}" data-ans="del">是，刪掉這筆</button><button type="button" class="btn small ghost" data-ex="${i}" data-ans="keep">不是，留著</button></div></li>`).join('')}</ul>` : ''}
      ${ls.length ? `<p class="m-desc">這些是冷眼用官方收盤價預估的。可以一筆一筆對照國泰 App 的成交回報，或每一檔一次和國泰的庫存股數對齊。</p>
      ${codes.map((c) => { const xs = ls.filter((l) => l.c === c); return `<div class="pend-g"><div class="pend-h"><b>${esc(nameOf(c))}</b> <span class="num muted">${esc(c)}</span><span class="small muted">${xs.length} 筆</span><button type="button" class="btn small" data-cal="${esc(c)}">和庫存對齊</button></div>
        <ul class="pend-list">${xs.slice(0, 24).map((l) => `<li><button type="button" class="pend-row" data-cf="${esc(l.id)}"><span class="num">${fmt.dy(l.d)}</span><span class="num">${sharesOf(l.sh)} × ${fmt.px(l.px)}</span><span class="chev">${ICON.chev}</span></button></li>`).join('')}${xs.length > 24 ? `<li class="small muted">還有 ${xs.length - 24} 筆（對齊會一起處理）</li>` : ''}</ul></div>`; }).join('')}` : ''}
      <div class="m-actions"><button type="button" class="btn primary" data-close>完成</button></div>`;
    bindClose(root);
    const answer = (list, ans) => refresh(() => {
      let ok = 0, stale = 0;
      if (ans === 'no') {
        // 只記「這一筆不是」：同一期如果還有你記的別筆，之後還會問那一筆
        savePlans((st) => { for (const a of list) for (const k of [a.key, ...(a.more || []).map((m) => m.key)]) { const v = `${k}|${a.cand.id}`; if (!st.dcaNoAsk.includes(v)) st.dcaNoAsk.push(v); } });
        return list.some((a) => a.dup || a.est) ? '好，兩筆都留著' : '好，這幾期冷眼照收盤價記一筆預估（你記的那筆也留著）';
      }
      for (const a of list) { const r = ans === 'dup' ? dropDup(a) : linkManual(a, ans === 'yes'); if (r) ok++; else stale++; }
      if (stale && !ok) return '這一題已經不適用了（那一期剛剛核對過或改過），已經重新整理';
      if (ans === 'dup') return `已刪掉你重複記的 ${ok} 筆`;
      return `已連起來：${ok} 期用你自己記的那筆（算核對過）${stale ? `；${stale} 題已經不適用、重新整理了` : ''}`;
    });
    $$('[data-ask]', root).forEach((b) => b.addEventListener('click', () => { const a = asks[+b.dataset.ask]; if (a) answer([a], b.dataset.ans); }));
    $$('[data-ex]', root).forEach((b) => b.addEventListener('click', () => {
      const x = extras[+b.dataset.ex];
      if (!x) return;
      refresh(() => {
        if (b.dataset.ans === 'keep') {
          savePlans((st) => { const k = `${x.c}|${x.s}|${x.id}`; if (!st.dcaNoAsk.includes(k)) st.dcaNoAsk.push(k); });
          return '好，這筆留著';
        }
        let gone = null;
        const ok = updateRealBook((bk) => { gone = bk.lots.find((l) => l.id === x.id) || null; if (!gone) return false; bk.lots = bk.lots.filter((l) => l.id !== x.id); return true; });
        if (ok && gone) bus.emit('lotdel', { id: gone.id, lot: gone, skip: false });
        return ok ? '已刪掉多記的那一筆' : '這一筆已經不在了，已經重新整理';
      });
    }));
    $$('[data-askall]', root).forEach((b) => b.addEventListener('click', () => answer(plain.slice(), b.dataset.askall)));
    $$('[data-cf]', root).forEach((b) => b.addEventListener('click', () => { closeModal(); openConfirm(b.dataset.cf); }));
    $$('[data-cal]', root).forEach((b) => b.addEventListener('click', () => { closeModal(); openCalibrate(b.dataset.cal); }));
  };
  draw();
  // 先用最新的資料重新比對一次（上一次的題目可能已經不適用，例如剛剛核對過）
  runPlans({ quiet: true }).then(() => { if (root.isConnected && !busy) draw(); });
}

// ------------------------------------------------------------------ 和國泰庫存對齊（可以復原）
const undo = new Map();   // 代號 → 對齊之前和之後那幾筆的樣子（這次打開 App 期間可以復原）
/** 復原上次對齊：只復原還是「對齊完那個樣子」的那幾筆，之後你自己改過的不動。回傳 { n: 復原幾筆, kept: 改過沒動的筆數 } */
function restoreCal(code) {
  const snap = undo.get(code);
  if (!snap) return { n: 0, kept: 0 };
  const map = new Map(snap.map((x) => [x.id, x]));
  let n = 0, kept = 0;
  updateRealBook((b) => {
    for (const l of b.lots) {
      const x = map.get(l.id);
      if (!x) continue;
      const same = l.sh === x.after.sh && Math.abs(l.px - x.after.px) < 1e-9 && C.isDcaLot(l) && l.dca.est !== true && l.dca.cal === x.after.cal;
      if (!same) { kept++; continue; }
      l.sh = x.sh; l.px = x.px; l.dca = { ...x.dca };
      n++;
    }
    return n > 0;
  });
  undo.delete(code);
  return { n, kept };
}
const estKey = (ls) => ls.map((l) => `${l.id}:${l.sh}:${l.px}`).sort().join('|');
export function openCalibrate(code, o = {}) {
  const divs = S.divs && S.divs[code];
  const splits = divs ? divs.s : [];
  const holdingOf = (ls) => PF.holdingFromLots(ls, splits);
  const fac = (l) => (splits || []).reduce((f, [sd, k]) => (l.d && l.d < sd ? f * k : f), 1);
  // 每次都用最新的交易紀錄算（對話框開著的時候，自動入帳可能剛記了一期）
  const basis = () => {
    const lots = realLots().filter((l) => l.c === code);
    const est = lots.filter((l) => C.isDcaLot(l) && l.dca.est === true);
    return { lots, est, now: holdingOf(lots).sh, estSh: est.reduce((a, l) => a + l.sh * fac(l), 0) };
  };
  const B0 = basis();
  const card = openModal(`<div class="form dca" id="kal">
      <h2 class="m-title">和國泰庫存對齊</h2>
      <p class="m-desc" id="k-desc"></p>
      ${o.fresh ? '<p class="small muted">剛補記完：先確認補記的期數和金額對不對（例如開始的日期、扣款日），再和國泰的庫存對齊。</p>' : ''}
      ${B0.est.length ? `<label class="field"><span class="lab">國泰 App「庫存」裡這一檔的股數</span><input class="input num" id="k-sh" inputmode="numeric" placeholder="例如 1250"></label>
      <p class="small muted">對齊只會照同一個比例調整預估的那幾筆的股數（每一筆花的錢不變，所以均價會跟著變），你自己記的其他交易不動。台股一天最多漲跌 10%，國泰分批買的均價和收盤價差不了太多，所以差兩成以上就不給對齊。對齊之後這些就算核對過了。</p>
      <div class="k-prev small" id="k-prev"></div>` : '<p class="small muted">這一檔沒有待核對的預估，不需要對齊。</p>'}
      <div class="f-err" id="k-err" role="alert"></div>
      <div class="m-actions">${undo.has(code) ? '<button type="button" class="btn ghost" id="k-undo">復原上次對齊</button>' : ''}<button type="button" class="btn ghost" data-close>之後再說</button>${B0.est.length ? `<button type="button" class="btn primary" id="k-go" disabled>${ICON.ok}對齊</button>` : ''}</div>
    </div>`, { label: '和國泰庫存對齊' });
  const root = $('#kal', card);
  const desc = (B) => { $('#k-desc', root).innerHTML = `<b>${esc(nameOf(code))}</b> <span class="num">${esc(code)}</span>：冷眼目前算你有 <b class="num">${sharesOf(B.now)}</b>${B.est.length ? `，其中 <b class="num">${B.est.length}</b> 筆、共 <b class="num">${sharesOf(B.estSh)}</b>是定期定額的預估` : ''}。`; };
  desc(B0);
  const doUndo = () => {
    const r = restoreCal(code);
    if (r.n) { FX.cue('ok'); toast(`已復原 ${r.n} 筆：${nameOf(code)} 回到對齊之前的預估${r.kept ? `（${r.kept} 筆之後你改過，沒有動）` : ''}`, null); bus.emit('book'); } else toast('沒有可以復原的對齊（那幾筆之後都改過或刪掉了）');
    closeModal();
  };
  const ub = $('#k-undo', root);
  if (ub) ub.addEventListener('click', doUndo);
  if (!B0.est.length) return;
  const inp = $('#k-sh', root), prev = $('#k-prev', root), go = $('#k-go', root), err = $('#k-err', root);
  let res = null, sig = '';
  const preview = () => {
    const t = Math.round(num(inp.value));
    err.textContent = '';
    go.dataset.armed = '';
    go.innerHTML = `${ICON.ok}對齊`;
    const B = basis();
    desc(B);
    sig = estKey(B.est);
    res = t > 0 && B.est.length ? C.dcaCalibrate(B.lots, B.est.map((l) => l.id), splits, t, holdingOf) : null;
    if (!res) { prev.textContent = ''; go.disabled = true; return; }
    if (!res.ok) { prev.textContent = ''; err.textContent = res.why; go.disabled = true; return; }
    const pct = (res.k - 1) * 100;
    const far = Math.abs(res.k - 1) > C.CAL_OK;
    const unit = (splits || []).filter(([sd]) => B.est.some((l) => l.d && l.d < sd)).reduce((f, [, k]) => f * k, 1);
    prev.innerHTML = `預估的 ${B.est.length} 筆：<b class="num">${fmt.n(res.est)}</b> → <b class="num">${fmt.n(res.want - (res.miss || 0))}</b> 股（${pct >= 0 ? '多' : '少'} <span class="num">${Math.abs(pct).toFixed(1)}%</span>），總股數 <b class="num">${fmt.n(res.before)}</b> → <b class="num">${fmt.n(res.after)}</b>`
      + (res.miss ? `<span class="k-warn">${res.preSplit ? `分割前買的那幾筆 1 股＝${unit} 股，只能整份調` : '預估每筆的股數太少、只能整股調'}，最接近只能對到 ${fmt.n(res.after)} 股（和國泰差 ${fmt.n(Math.abs(res.miss))} 股）。</span>` : '')
      + (far ? `<span class="k-warn">差了 ${Math.abs(pct).toFixed(1)}%：國泰分批買的正常差距大約在 ${Math.round(C.CAL_OK * 100)}% 以內。先確認計畫的開始日期、扣款日和每期金額對不對（例如中間有暫停、加碼、扣款失敗），確定沒問題再對齊。</span>` : '');
    go.disabled = false;
  };
  inp.addEventListener('input', preview);
  if (o.target) { inp.value = String(o.target); preview(); }
  go.addEventListener('click', () => {
    if (!res || !res.ok) return;
    const needTwo = Math.abs(res.k - 1) > C.CAL_OK || res.miss;
    if (needTwo && go.dataset.armed !== '1') { go.dataset.armed = '1'; go.textContent = res.miss ? `差 ${fmt.n(Math.abs(res.miss))} 股，確定要對齊？` : `差 ${Math.abs((res.k - 1) * 100).toFixed(1)}%，確定要對齊？`; FX.sfx('warn'); return; }
    const map = new Map(res.changes.map((c) => [c.id, c]));
    const td = today();
    const snap = [];
    let stale = false;
    updateRealBook((b) => {
      // 寫進去之前再比一次：預估的那幾筆和預覽時不一樣（剛自動記了一期、另一個分頁改過）就不寫，請你重新看一次
      const fresh = b.lots.filter((l) => l.c === code && C.isDcaLot(l) && l.dca.est === true);
      if (estKey(fresh) !== sig) { stale = true; return false; }
      for (const l of b.lots) {
        const c = map.get(l.id);
        if (!c || !C.isDcaLot(l) || l.dca.est !== true) continue;
        snap.push({ id: l.id, sh: l.sh, px: l.px, dca: { ...l.dca }, after: { sh: c.sh, px: c.px, cal: td } });
        l.sh = c.sh; l.px = c.px; l.dca = { ...l.dca, est: false, cal: td };
      }
      return snap.length > 0;
    });
    if (stale || !snap.length) {
      FX.sfx('err');
      const t = inp.value;
      bus.emit('book');
      preview();
      err.textContent = '預估的紀錄剛剛更新了（例如剛自動記了一期），上面的預覽已經重算，請再看一次再按對齊。';
      inp.value = t;
      return;
    }
    undo.set(code, snap);
    FX.cue('lock');
    FX.stamp('已對齊', 'aurora', `${nameOf(code)} ${sharesOf(res.after)}`);
    bus.emit('book');
    const after = holdingOf(realLots().filter((l) => l.c === code)).sh;
    root.innerHTML = `<h2 class="m-title">已和國泰庫存對齊</h2>
      <div class="est-box"><b>${esc(nameOf(code))}</b> 現在是 <b class="num">${sharesOf(after)}</b>：調整了 ${snap.length} 筆預估，每一筆花的錢不變，這些都算核對過了。<small>對錯了可以馬上復原（這次打開冷眼期間都可以從「和庫存對齊」復原；之後你自己改過的那幾筆不會被蓋掉）。</small></div>
      <div class="m-actions"><button type="button" class="btn ghost" id="k-undo2">復原</button><button type="button" class="btn primary" data-close>完成</button></div>`;
    bindClose(root);
    $('#k-undo2', root).addEventListener('click', doUndo);
  });
  setTimeout(() => inp.focus(), 60);
}
