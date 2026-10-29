/* 冷眼 — 表單：記一筆交易、可投入現金、到價提醒、備份與匯入。 */
import {
  $, $$, esc, isNum, S, PF, settings, saveSettings, book, saveBook, alerts, saveAlerts, newId, fmt, money,
  catName, toast, buzz, bus, ICON, quote, today, store, isPaper, replaceBook, otherBook, setBooks, twParts, journal, saveJournal,
  savePlans, normReserve,
} from './core.js';
import { TAGS as WHY_TAGS, EMO_TAGS, sanitizeJournal } from './aide.js';
import * as FX from './fx.js';

// ------------------------------------------------------------------ 模擬倉的成交規則
export const PAPER_FRESH_MIN = 15;   // 盤中價格超過幾分鐘沒更新，就先不讓模擬倉成交（避免用舊價格占便宜）
const isoHm = (iso) => (iso ? +iso.slice(11, 13) * 100 + +iso.slice(14, 16) : 0);   // 後台時間一律是台灣時間（+08:00）
const isoD = (iso) => (iso ? +iso.slice(0, 10).replace(/-/g, '') : 0);
/**
 * 模擬倉現在能不能成交、用什麼價格。跟真的下單一樣，只能用「現在」的價格：
 * 09:00–13:25 用盤中即時價（資料要夠新）；13:25–13:30 收盤集合競價不成交；
 * 13:30 收盤後到 14:30 用今天的收盤價（比照盤後定價交易）。價格不能自己填，所以不能挑價格。
 */
export function paperFill(row) {
  if (!row) return { ok: false, why: '' };
  const at = S.live && S.live.at;
  const now = Date.now();
  // 手機時間比冷眼的資料還早（時間被調過）：不成交，不然等於拿「未來」才知道的價格下單
  const newest = Math.max(at ? Date.parse(at) || 0 : 0, S.summary && S.summary.generated ? Date.parse(S.summary.generated) || 0 : 0);
  if (newest > now + 2 * 60e3) return { ok: false, why: '手機的日期或時間比冷眼的資料還早，請先確認手機的時間設定。' };
  const { wd, h, min } = twParts();
  const hm = h * 100 + min;
  if (wd < 1 || wd > 5 || hm < 900 || hm >= 1430) return { ok: false, why: '模擬倉只在交易日 09:00–14:30 成交（13:30 以後用收盤價），跟真的下單一樣。現在可以先看建議、設到價提醒。' };
  const q = quote(row);
  if (q.date !== today() || !isNum(q.px) || !(q.px > 0)) return { ok: false, why: `${row.n} 今天還沒有成交價，等它有成交再下單。` };
  // 成交很少的 ETF：盤中資料的日期是今天，但價格可能是好幾天前最後一筆成交
  if (row.d !== today() && S.summary && row.d < S.summary.asof) return { ok: false, why: `${row.n} 成交很少，上一個交易日沒有成交，盤中顯示的可能是好幾天前的價格，模擬倉先不提供。` };
  if (hm < 1325) {
    const age = at ? (now - Date.parse(at)) / 60000 : Infinity;
    if (!(age <= PAPER_FRESH_MIN)) return { ok: false, why: `盤中價格已經 ${isFinite(age) ? Math.round(age) + ' 分鐘' : '一陣子'}沒有更新，等後台送來新價格再下單，避免用舊價格成交。` };
  } else if (row.d !== today() && !(q.live && q.time && String(q.time) >= '13:30')) {
    // 13:25 以後：要等證交所 13:30 收盤後的資料（看這檔資料本身的時間，不是後台發布的時間）
    return { ok: false, why: hm < 1340 ? '13:25–13:30 是收盤集合競價，等收盤價出來（大約 13:35）再下單。' : '後台還沒送來今天的收盤價，稍後再試。' };
  }
  return { ok: true, px: q.px, qat: at || null };
}

// ------------------------------------------------------------------ 共用的底部彈出視窗
let lastFocus = null;
export function openModal(html, { label = '', onClose = null } = {}) {
  const m = $('#modal');
  lastFocus = document.activeElement;
  m.innerHTML = `<div class="modal-back" data-close></div><div class="modal-card" role="dialog" aria-modal="true" aria-label="${esc(label)}"><div class="grab" aria-hidden="true"></div>${html}</div>`;
  m.hidden = false;
  m._onClose = onClose;
  document.body.classList.add('locked');
  FX.sfx('open');
  $$('[data-close]', m).forEach((b) => b.addEventListener('click', () => closeModal()));
  const first = $('input, textarea, select, button:not([data-close])', $('.modal-card', m));
  if (first && !first.matches('[data-noautofocus]')) setTimeout(() => { try { first.focus({ preventScroll: true }); } catch { /* 舊瀏覽器 */ } }, 60);
  return $('.modal-card', m);
}
export function closeModal() {
  const m = $('#modal');
  if (!m || m.hidden) return;
  m.hidden = true;
  m.innerHTML = '';
  if (!$('#sheet') || $('#sheet').hidden) document.body.classList.remove('locked');
  FX.sfx('close');
  const fn = m._onClose;
  m._onClose = null;
  if (typeof fn === 'function') fn();
  if (lastFocus && lastFocus.focus) try { lastFocus.focus({ preventScroll: true }); } catch { /* 元素已移除 */ }
  bus.emit('modalclosed');
}
export const modalOpen = () => { const m = $('#modal'); return m && !m.hidden; };

const toInt = (s) => {
  const n = Number(String(s ?? '').replace(/[,\s，]/g, ''));
  return isFinite(n) ? n : NaN;
};
const isoOf = (d) => (d ? `${String(d).slice(0, 4)}-${String(d).slice(4, 6)}-${String(d).slice(6, 8)}` : '');
const dOf = (iso) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? Number(iso.replace(/-/g, '')) : null);

// ------------------------------------------------------------------ 記一筆交易
/**
 * @param {object} o  code：預先選好的 ETF；side：buy／sell；lot：要編輯的交易
 */
export function openTradeForm(o = {}) {
  if (isPaper() && !book.start) { openPaperStart(); return; }
  if (isPaper() && o.lot) { openPaperLot(o.lot); return; }
  const paper = isPaper();
  const lot = o.lot || null;
  // 定期定額記的那一期（真實部位）：刪除時要問是「沒扣到」還是「記錯了」
  const dcaLot = !paper && lot && lot.dca && typeof lot.dca === 'object' && typeof lot.dca.plan === 'string' && Number.isInteger(lot.dca.s);
  const f = {
    code: lot ? lot.c : o.code || null,
    side: lot ? lot.side : o.side || 'buy',
    unit: lot && lot.sh % 1000 === 0 && lot.sh >= 1000 ? 'lot' : 'sh',
    d: lot ? lot.d : today(),
    undated: lot ? !lot.d : false,
    qty: lot ? (lot.sh % 1000 === 0 && lot.sh >= 1000 ? lot.sh / 1000 : lot.sh) : '',
    px: lot ? lot.px : null,
    fee: lot && isNum(lot.fee) ? lot.fee : null,
    tax: lot && isNum(lot.tax) ? lot.tax : null,
    // 定期定額的手續費是國泰的（2026 年底前每筆 1 元），不要用一般的公式重算
    feeTouched: !!(lot && (lot.feeManual || lot.dca)),
    taxTouched: !!(lot && lot.taxManual),
    note: lot ? lot.note || '' : '',
  };
  if (f.code && f.px == null) {
    const row = S.rows.get(f.code);
    if (row) f.px = quote(row).px;
  }
  const card = openModal(`<form class="form" id="tf" novalidate autocomplete="off">
      <h2 class="m-title">${paper ? (lot ? '編輯模擬交易' : '模擬下單') : lot ? '編輯交易' : '記一筆交易'}</h2>
      ${paper ? '<p class="m-desc paper-note">模擬倉：用「現在」的價格成交（盤中即時價，13:30 以後用收盤價），手續費、證交稅照你的設定自動算，現金自動扣、自動加。成交後不能修改，跟真的一樣。</p><div class="f-fill" id="f-fill" role="status"></div>' : ''}
      <div class="field" id="f-etf"></div>
      <div class="seg wide" role="radiogroup" aria-label="買或賣">
        <button type="button" data-side="buy" aria-pressed="${f.side === 'buy'}">買進</button>
        <button type="button" data-side="sell" aria-pressed="${f.side === 'sell'}">賣出</button>
      </div>
      <div class="row2"${paper ? ' hidden' : ''}>
        <label class="field"><span>成交日期</span><input class="input" type="date" id="f-date" value="${isoOf(f.d)}" max="${isoOf(today())}" ${f.undated ? 'disabled' : ''}></label>
        <label class="check"><input type="checkbox" id="f-undated" ${f.undated ? 'checked' : ''}><span>不記得日期<small>（已領配息會無法計算）</small></span></label>
      </div>
      <div class="row2">
        <label class="field"><span>數量</span><span class="with-unit"><input class="input num" id="f-qty" inputmode="numeric" value="${esc(f.qty)}" placeholder="0"><span class="seg mini" role="radiogroup" aria-label="單位"><button type="button" data-unit="sh" aria-pressed="${f.unit === 'sh'}">股</button><button type="button" data-unit="lot" aria-pressed="${f.unit === 'lot'}">張</button></span></span></label>
        <label class="field"><span>成交價</span><input class="input num" id="f-px" inputmode="decimal" value="${f.px ?? ''}" placeholder="0.00"></label>
      </div>
      <div class="row2">
        <label class="field"><span>手續費<small id="f-feeh"></small></span><input class="input num" id="f-fee" inputmode="numeric"></label>
        <label class="field" id="f-taxw"><span>證交稅<small id="f-taxh"></small></span><input class="input num" id="f-tax" inputmode="numeric"></label>
      </div>
      <label class="field"><span>筆記（選填）</span><input class="input" id="f-note" maxlength="80" value="${esc(f.note)}" placeholder="例如：拉回月線分批、除息前不追"></label>
      ${!lot && settings.autoJ !== false ? `<div class="field" id="f-whyw"><span class="lab">理由（選填）<small>副官會把今天的交易記進決策日記，20 個交易日後對答案</small></span><div class="tag-pick small">${Object.entries(WHY_TAGS).map(([k, t]) => `<button type="button" class="tg${EMO_TAGS.includes(k) ? ' emo' : ''}" data-why="${k}" aria-pressed="false">${esc(t)}</button>`).join('')}</div></div>` : ''}
      <div class="f-sum" id="f-sum" aria-live="polite"></div>
      <div class="f-err" id="f-err" role="alert"></div>
      ${dcaLot ? `<div class="p-delw" id="f-dcadel" hidden><p class="small">這是定期定額的一期。為什麼要刪？</p><div class="m-actions">
        <button type="button" class="btn danger ghost" data-dcadel="skip">這期國泰沒扣到（不要再補）</button>
        <button type="button" class="btn ghost" data-dcadel="redo">只是記錯了，讓冷眼重新估一筆</button>
        ${lot.dca.link ? '<button type="button" class="btn ghost" data-dcadel="unlink">這筆不是定期定額（取消連結、交易留著）</button>' : ''}
        <button type="button" class="btn ghost" data-dcadel="no">取消</button></div></div>` : ''}
      <div class="m-actions">
        ${lot ? '<button type="button" class="btn danger ghost" id="f-del">刪除</button>' : ''}
        <button type="button" class="btn ghost" data-close>取消</button>
        <button type="submit" class="btn primary">${lot ? '儲存修改' : '儲存'}</button>
      </div>
    </form>`, { label: lot ? '編輯交易' : '記一筆交易' });

  const etfBox = $('#f-etf', card);
  function drawEtf() {
    if (f.code) {
      const row = S.rows.get(f.code);
      etfBox.innerHTML = `<span class="lab">ETF</span><div class="picked"><b>${esc(row ? row.n : f.code)}</b><span class="num muted">${esc(f.code)}</span>${row ? `<span class="muted">${esc(catName(row.k))}</span>` : ''}<button type="button" class="link" id="f-change">更換</button></div>`;
      $('#f-change', etfBox).addEventListener('click', () => { f.code = null; drawEtf(); $('#f-q', etfBox).focus(); });
    } else {
      etfBox.innerHTML = `<label class="lab" for="f-q">ETF</label><input class="input" id="f-q" placeholder="輸入代號或名稱，例如 0050、高股息" autocomplete="off"><div class="sugg" id="f-sugg"></div>`;
      const q = $('#f-q', etfBox), sugg = $('#f-sugg', etfBox);
      q.addEventListener('input', () => {
        const s = q.value.trim().toLowerCase();
        if (!s) { sugg.innerHTML = ''; return; }
        const hits = S.summary.etfs.filter((r) => r.c.toLowerCase().includes(s) || (r.n || '').toLowerCase().includes(s)).slice(0, 8);
        sugg.innerHTML = hits.map((r) => `<button type="button" data-pick="${r.c}">${esc(r.n)} <span class="num">${r.c}</span></button>`).join('') || '<span class="muted small">找不到這檔 ETF</span>';
        $$('[data-pick]', sugg).forEach((b) => b.addEventListener('click', () => {
          f.code = b.dataset.pick;
          const row = S.rows.get(f.code);
          if (row && !$('#f-px', card).value) $('#f-px', card).value = quote(row).px;
          drawEtf();
          recalc();
          $('#f-qty', card).focus();
        }));
      });
    }
  }
  drawEtf();

  const qtyEl = $('#f-qty', card), pxEl = $('#f-px', card), feeEl = $('#f-fee', card), taxEl = $('#f-tax', card);
  const dateEl = $('#f-date', card), undEl = $('#f-undated', card);
  if (f.fee != null) feeEl.value = f.fee;
  if (f.tax != null) taxEl.value = f.tax;
  const submitBtn = $('#tf button[type=submit]', card);
  if (paper) for (const el of [pxEl, feeEl, taxEl]) { el.readOnly = true; el.classList.add('locked'); }
  /** 模擬倉：價格跟著現價走，不能成交時說明原因 */
  function paperSync() {
    const row = f.code ? S.rows.get(f.code) : null;
    const fill = paperFill(row);
    const box = $('#f-fill', card);
    pxEl.value = fill.ok ? fill.px : '';
    box.textContent = fill.ok ? '' : fill.why;
    box.hidden = fill.ok || !fill.why;
    submitBtn.disabled = !fill.ok;
    return fill;
  }

  function shares() {
    const q = toInt(qtyEl.value);
    return f.unit === 'lot' ? q * 1000 : q;
  }
  const whyW = $('#f-whyw', card);
  const why = [];
  if (whyW) $$('[data-why]', whyW).forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.why;
    const i = why.indexOf(k);
    if (i >= 0) why.splice(i, 1); else why.push(k);
    b.setAttribute('aria-pressed', why.includes(k));
  }));
  function recalc() {
    if (paper) paperSync();
    // 只有今天的交易會記進決策日記（補記以前的交易，當時的規則觀點已經不知道了）
    if (whyW) whyW.hidden = !(paper || (!f.undated && dOf(dateEl.value) === today()));
    const sh = shares();
    const px = toInt(pxEl.value);
    const row = f.code ? S.rows.get(f.code) : null;
    const tcat = PF.taxCat(row);
    const d = f.undated ? today() : dOf(dateEl.value) || today();
    $('#f-taxw', card).hidden = f.side !== 'sell';
    let auto = null;
    if (sh > 0 && px > 0) auto = PF.tradeCost(f.side, sh, px, tcat, d, settings.fee);
    $('#f-feeh', card).textContent = auto ? `（自動 ${fmt.n(auto.fee)}）` : '';
    $('#f-taxh', card).textContent = auto && f.side === 'sell' ? `（自動 ${fmt.n(auto.tax)}${auto.tax === 0 && PF.taxRateOf(tcat, d) === 0 ? '，債券 ETF 停徵' : ''}）` : '';
    if (auto && !f.feeTouched) feeEl.value = auto.fee;
    if (auto && !f.taxTouched) taxEl.value = f.side === 'sell' ? auto.tax : 0;
    const fee = toInt(feeEl.value) || 0;
    const tax = f.side === 'sell' ? (toInt(taxEl.value) || 0) : 0;
    const sum = $('#f-sum', card);
    if (sh > 0 && px > 0) {
      const amt = sh * px;
      const net = f.side === 'buy' ? amt + fee : amt - fee - tax;
      sum.innerHTML = `${f.side === 'buy' ? '付出' : '拿回'} <b class="num">${fmt.n(net)}</b> 元　<span class="muted">${PF.sharesText(sh)} × ${fmt.px(px)}${fee ? `，手續費 ${fmt.n(fee)}` : ''}${tax ? `，證交稅 ${fmt.n(tax)}` : ''}</span>`;
    } else {
      sum.innerHTML = '<span class="muted">輸入數量與成交價</span>';
    }
  }
  $$('[data-side]', card).forEach((b) => b.addEventListener('click', () => {
    f.side = b.dataset.side;
    $$('[data-side]', card).forEach((x) => x.setAttribute('aria-pressed', x === b));
    f.taxTouched = false;
    recalc();
  }));
  // 切換單位時保留輸入的數字（打「2」再點「張」就是 2 張）
  $$('[data-unit]', card).forEach((b) => b.addEventListener('click', () => {
    f.unit = b.dataset.unit;
    $$('[data-unit]', card).forEach((x) => x.setAttribute('aria-pressed', x === b));
    recalc();
  }));
  undEl.addEventListener('change', () => { f.undated = undEl.checked; dateEl.disabled = f.undated; recalc(); });
  [qtyEl, pxEl, dateEl].forEach((el) => el.addEventListener('input', recalc));
  feeEl.addEventListener('input', () => { f.feeTouched = true; recalc(); });
  taxEl.addEventListener('input', () => { f.taxTouched = true; recalc(); });
  recalc();

  if (lot) {
    const drop = (skip) => {
      const k = book.lots.findIndex((x) => x.id === lot.id);
      if (k >= 0) book.lots.splice(k, 1);
      saveBook();
      closeModal();
      buzz();
      toast(dcaLot ? (skip ? '已刪除這一期（國泰沒扣到，之後不會再補回來）' : '已刪除，冷眼會重新用收盤價估一筆') : '已刪除這筆交易');
      bus.emit('lotdel', { id: lot.id, lot, skip });
      bus.emit('book');
      if (dcaLot && !skip) bus.emit('dcarun');   // 重新估那一期
    };
    $('#f-del', card).addEventListener('click', (e) => {
      const b = e.currentTarget;
      if (dcaLot) { $('#f-dcadel', card).hidden = false; $('#f-dcadel', card).scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = '確定刪除？'; return; }
      drop(true);
    });
    $$('[data-dcadel]', card).forEach((b) => b.addEventListener('click', () => {
      const v = b.dataset.dcadel;
      if (v === 'no') { $('#f-dcadel', card).hidden = true; return; }
      if (v === 'unlink') {
        // 你說「就是這筆」說錯了：把連結拿掉（交易還是你的），這一期冷眼重新估，也不會再拿這一筆來問
        const k = book.lots.findIndex((x) => x.id === lot.id);
        if (k >= 0) { const { dca, ...rest } = book.lots[k]; book.lots[k] = rest; }
        saveBook();
        savePlans((st) => { const key = `${lot.c}|${lot.dca.s}|${lot.id}`; if (!st.dcaNoAsk.includes(key)) st.dcaNoAsk.push(key); });
        closeModal();
        toast('已取消連結：這筆交易留著，那一期冷眼會重新估');
        bus.emit('book');
        bus.emit('dcarun');
        return;
      }
      drop(v === 'skip');
    }));
  }

  $('#tf', card).addEventListener('submit', (e) => {
    e.preventDefault();
    const err = $('#f-err', card);
    const sh = shares();
    const px = toInt(pxEl.value);
    const d = f.undated ? null : dOf(dateEl.value);
    const row = f.code ? S.rows.get(f.code) : null;
    const problems = [];
    if (!row) problems.push('請選一檔 ETF');
    if (!(sh > 0) || Math.abs(sh - Math.round(sh)) > 1e-9) problems.push('數量要是正整數股（1 張 = 1000 股）');
    if (!(px > 0)) problems.push('請輸入成交價');
    if (!f.undated && !d) problems.push('請選成交日期，或勾選「不記得日期」');
    if (d && d > today()) problems.push('成交日期不能是未來');
    if (!paper && row && px > 0 && (px > row.p * 3 || px < row.p / 3) && !(!d || d < 20251231)) problems.push(`成交價和目前價格（${fmt.px(row.p)}）差太多，請確認`);
    if (paper && row) {
      const before = pxEl.value;
      const fill = paperSync();
      if (!fill.ok) { err.textContent = fill.why; buzz(30); return; }
      if (String(fill.px) !== String(before)) { recalc(); err.textContent = `價格剛更新成 ${fmt.px(fill.px)}，確認後再按一次「儲存」`; buzz(30); return; }
      if (d !== today()) problems.push('模擬倉只能記今天的交易');
      if (f.side === 'buy' && sh > 0) {
        const need = PF.tradeCost('buy', Math.round(sh), fill.px, PF.taxCat(row), today(), settings.fee).net;
        if (need > book.cash + 1e-6) problems.push(`模擬倉現金只剩 ${fmt.n(book.cash)} 元，不夠買這筆（需要 ${fmt.n(need)} 元）`);
      }
    }
    if (f.side === 'sell' && row) {
      const held = PF.holdingFromLots(book.lots.filter((x) => x.c === f.code && (!lot || x.id !== lot.id)), (S.divs && S.divs[f.code] && S.divs[f.code].s) || []);
      if (Math.round(sh) > held.sh + 1e-9) problems.push(`目前記錄的持股只有 ${PF.sharesText(held.sh)}，賣出數量超過了`);
    }
    if (problems.length) { err.textContent = problems.join('；'); buzz(30); return; }
    let fee = toInt(feeEl.value);
    let tax = f.side === 'sell' ? toInt(taxEl.value) : 0;
    if (paper) {   // 模擬倉的費用一律照設定自動算，不能手改
      const c = PF.tradeCost(f.side, Math.round(sh), +px, PF.taxCat(row), today(), settings.fee);
      fee = c.fee;
      tax = f.side === 'sell' ? c.tax : 0;
    }
    const rec = {
      id: lot ? lot.id : newId(), c: f.code, side: f.side, d, sh: Math.round(sh), px: +px,
      fee: isNum(fee) && fee >= 0 ? fee : 0, tax: isNum(tax) && tax >= 0 ? tax : 0,
      feeManual: !paper && f.feeTouched, taxManual: !paper && f.taxTouched,
      note: $('#f-note', card).value.trim().slice(0, 80), at: lot ? lot.at : new Date().toISOString(),
      snap: lot ? lot.snap : null,
      ...(paper ? { qat: S.live ? S.live.at : null } : {}),
      // 定期定額記的：保留是哪個計畫的哪一期；在這裡真的改了股數、價格、手續費或日期，才算核對過
      ...(lot && lot.dca && typeof lot.dca === 'object' ? { dca: { ...lot.dca, est: lot.dca.est === true && Math.round(sh) === lot.sh && +px === lot.px && (isNum(fee) ? fee : 0) === (lot.fee || 0) && d === (lot.d || null) } } : {}),
    };
    // 交易日就是最新資料日（或之後）時，記下當時的規則觀點，日後回頭看決策
    if (!lot && row && (!d || d >= row.d)) rec.snap = { st: row.st, ps: row.ps, sc: row.sc, d: row.d };
    if (lot) {
      const k = book.lots.findIndex((x) => x.id === lot.id);
      if (k >= 0) book.lots[k] = rec; else book.lots.push(rec);
    } else {
      book.lots.push(rec);
    }
    if (!saveBook()) { err.textContent = '這個瀏覽器不允許儲存資料（可能是私密瀏覽模式）'; return; }
    closeModal();
    buzz('lock');
    FX.sfx('lock');
    if (paper && !lot) FX.stamp(f.side === 'buy' ? '模擬買進' : '模擬賣出', 'aurora', `${PF.sharesText(sh)} × ${fmt.px(+px)}`);
    toast(lot ? '已更新交易' : `${paper ? '模擬' : '已記下：'}${f.side === 'buy' ? '買進' : '賣出'} ${row.n} ${PF.sharesText(sh)}`, null);
    if (lot) bus.emit('lotedit', { lot: rec });
    else bus.emit('trade', { lot: rec, tags: why.slice(), paper });
    bus.emit('book');
  });
}

// ------------------------------------------------------------------ 模擬倉的一筆交易：成交後不能改
/** 只有「最新一筆、今天下的、價格還沒更新」可以撤銷：價格一更新就知道結果了，再撤銷等於事後反悔。 */
export function paperUndoable(lot) {
  const lots = PF.sortLots(book.lots);
  const last = lots[lots.length - 1];
  const mins = (Date.now() - (Date.parse(lot.at) || 0)) / 60000;
  return !!(last && last.id === lot.id && lot.d === today() && lot.qat && S.live && lot.qat === S.live.at
    && mins >= -2 && mins <= PAPER_FRESH_MIN);
}
function openPaperLot(lot) {
  const row = S.rows.get(lot.c);
  const sell = lot.side === 'sell';
  const can = paperUndoable(lot);
  const card = openModal(`<div class="form">
      <h2 class="m-title">模擬${sell ? '賣出' : '買進'}・${esc(row ? row.n : lot.c)}</h2>
      <p class="m-desc"><span class="num">${fmt.dy(lot.d)}</span>　${PF.sharesText(lot.sh)} × <b class="num">${fmt.px(lot.px)}</b>，手續費 <span class="num">${fmt.n(lot.fee || 0)}</span>${sell ? `、證交稅 <span class="num">${fmt.n(lot.tax || 0)}</span>` : ''}</p>
      ${lot.note ? `<p class="m-desc">筆記：${esc(lot.note)}</p>` : ''}
      <p class="m-desc">模擬倉的交易成交後就不能修改，跟真的下單一樣。${can ? '價格還沒更新，可以撤銷這一筆。' : `只有最新一筆、下單 ${PAPER_FRESH_MIN} 分鐘內、而且價格還沒更新以前可以撤銷（價格一變就知道結果了，再撤銷等於事後反悔）。`}</p>
      <div class="m-actions">${can ? '<button type="button" class="btn danger ghost" id="pl-undo">撤銷這筆</button>' : ''}<button type="button" class="btn ghost" data-close>關閉</button></div>
    </div>`, { label: '模擬交易' });
  const u = $('#pl-undo', card);
  if (u) u.addEventListener('click', (e) => {
    const b = e.currentTarget;
    if (!paperUndoable(lot)) { toast('價格已經更新，這筆不能撤銷了'); closeModal(); return; }
    if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = '確定撤銷？'; return; }
    const k = book.lots.findIndex((x) => x.id === lot.id);
    if (k >= 0) book.lots.splice(k, 1);
    saveBook();
    closeModal();
    buzz();
    toast('已撤銷這筆模擬交易');
    bus.emit('lotdel', { id: lot.id, lot });
    bus.emit('book');
  });
}

// ------------------------------------------------------------------ 可投入現金
export function openCashForm() {
  if (isPaper()) { openPaperStart(); return; }
  const card = openModal(`<form class="form" id="cf" novalidate>
      <h2 class="m-title">可投入的現金</h2>
      <p class="m-desc">準備拿來買 ETF、但還沒買的錢。冷眼用「持股市值＋這筆現金」當作你的總資產，計算比重上限與每次最多買多少。只存在這支手機。</p>
      <label class="field"><span>金額（元）</span><input class="input num big" id="c-amt" inputmode="numeric" value="${book.cash || ''}" placeholder="0"></label>
      <div class="quick">${[50000, 100000, 300000, 500000].map((v) => `<button type="button" class="pill" data-q="${v}">${v / 10000} 萬</button>`).join('')}</div>
      <label class="field"><span>其中的緊急預備金（元，不拿去加碼）</span><input class="input num" id="c-res" inputmode="numeric" value="${settings.reserve || ''}" placeholder="0"></label>
      <p class="m-desc small">加碼計畫會先扣掉緊急預備金、再扣掉定期定額接下來一個月要扣的錢，剩下的才分給可以加碼的 ETF。定期定額扣款、買賣之後，記得回來更新這個金額。</p>
      <div class="m-actions"><button type="button" class="btn ghost" data-close>取消</button><button type="submit" class="btn primary">儲存</button></div>
    </form>`, { label: '可投入的現金' });
  const amt = $('#c-amt', card);
  $$('[data-q]', card).forEach((b) => b.addEventListener('click', () => { amt.value = b.dataset.q; amt.focus(); }));
  $('#cf', card).addEventListener('submit', (e) => {
    e.preventDefault();
    const v = toInt(amt.value);
    if (!(v >= 0)) { amt.focus(); return; }
    const res = $('#c-res', card);
    const rv = res.value.trim() === '' ? 0 : toInt(res.value);
    if (!(rv >= 0)) { res.focus(); return; }
    book.cash = Math.round(v);
    book.cashD = today();   // 現金是今天更新的：之前定期定額扣的錢已經算在這個數字裡
    saveBook();
    settings.reserve = normReserve(rv);
    saveSettings();
    closeModal();
    buzz();
    toast('現金已更新');
    bus.emit('book');
  });
}

// ------------------------------------------------------------------ 模擬倉：開倉或重設
export function openPaperStart() {
  const had = !!book.start;
  const card = openModal(`<form class="form" id="ps" novalidate>
      <h2 class="m-title">${had ? '重設模擬倉' : '開一個模擬倉'}</h2>
      <p class="m-desc">用虛擬資金、真實價格練習照紀律買賣。結果會和「同一天把錢全部買 0050」比較，看看你的判斷（或冷眼的建議）有沒有比較好。${had ? '<b>重設會清掉模擬倉裡的全部交易。</b>' : ''}</p>
      <label class="field"><span>起始資金（元）</span><input class="input num big" id="ps-amt" inputmode="numeric" value="${had ? book.start.cash0 : 1000000}"></label>
      <div class="quick">${[100000, 500000, 1000000, 3000000].map((v) => `<button type="button" class="pill" data-q="${v}">${v / 10000} 萬</button>`).join('')}</div>
      <div class="f-err" id="ps-err" role="alert"></div>
      <div class="m-actions"><button type="button" class="btn ghost" data-close>取消</button><button type="submit" class="btn primary">${had ? '確定重設' : '開始模擬'}</button></div>
    </form>`, { label: '模擬倉' });
  const amt = $('#ps-amt', card);
  $$('[data-q]', card).forEach((b) => b.addEventListener('click', () => { amt.value = b.dataset.q; amt.focus(); }));
  $('#ps', card).addEventListener('submit', (e) => {
    e.preventDefault();
    const v = Math.round(toInt(amt.value));
    if (!(v >= 10000 && v <= 100000000)) { $('#ps-err', card).textContent = '起始資金請填 1 萬到 1 億元'; return; }
    const bench = S.rows.get('0050');
    const q = bench ? quote(bench) : null;   // 按下去的這一刻才讀價格；pxd 是這個價格的日期（開盤前就是昨收）
    if (!q || !isNum(q.px)) { $('#ps-err', card).textContent = '還拿不到 0050 的價格，稍後再試'; return; }
    replaceBook({ cash: v, lots: [], colors: {}, start: { d: today(), cash0: v, code: '0050', px0: q.px, pxd: q.date || today() } });
    closeModal();
    buzz();
    toast(had ? '模擬倉已重設' : `模擬倉開張：${fmt.n(v)} 元`);
    bus.emit('book');
  });
}

// ------------------------------------------------------------------ 到價提醒
export function openAlertForm(code) {
  const row = S.rows.get(code);
  if (!row) return;
  const q = quote(row);
  const mine = () => alerts.filter((a) => a.c === code);
  const card = openModal(`<form class="form" id="af" novalidate>
      <h2 class="m-title">到價提醒</h2>
      <p class="m-desc">${esc(row.n)} 現在 <b class="num">${fmt.px(q.px)}</b>。打開冷眼時，價格碰到你設定的價位就會出現在「今日行動」最上面。</p>
      <div class="row2">
        <label class="field"><span>跌到（含）以下</span><input class="input num" id="a-le" inputmode="decimal" placeholder="${isNum(row.dl) ? row.dl : ''}"></label>
        <label class="field"><span>漲到（含）以上</span><input class="input num" id="a-ge" inputmode="decimal" placeholder="${isNum(row.r1) ? row.r1 : ''}"></label>
      </div>
      <div class="quick">${isNum(row.dl) ? `<button type="button" class="pill" data-fill="le" data-v="${row.dl}">移動防守線 ${fmt.px(row.dl)}</button>` : ''}${isNum(row.iv) ? `<button type="button" class="pill" data-fill="le" data-v="${row.iv}">作廢線 ${fmt.px(row.iv)}</button>` : ''}${isNum(row.pb) ? `<button type="button" class="pill" data-fill="le" data-v="${row.pb}">拉回價 ${fmt.px(row.pb)}</button>` : ''}${isNum(row.r1) ? `<button type="button" class="pill" data-fill="ge" data-v="${row.r1}">壓力 ${fmt.px(row.r1)}</button>` : ''}</div>
      <div id="a-list"></div>
      <div class="m-actions"><button type="button" class="btn ghost" data-close>關閉</button><button type="submit" class="btn primary">新增提醒</button></div>
    </form>`, { label: '到價提醒' });
  const draw = () => {
    const list = mine();
    $('#a-list', card).innerHTML = list.length ? `<div class="al-list">${list.map((a) => `<div class="a-row"><span>${a.op === 'le' ? '跌到' : '漲到'} <b class="num">${fmt.px(a.px)}</b>${a.hit ? `<small class="muted">　已觸發 ${fmt.d(a.hit)}</small>` : ''}</span><button type="button" class="mini-btn" data-rm="${a.id}" aria-label="刪除提醒">${ICON.x}</button></div>`).join('')}</div>` : '';
    $$('[data-rm]', card).forEach((b) => b.addEventListener('click', () => {
      const k = alerts.findIndex((a) => a.id === b.dataset.rm);
      if (k >= 0) alerts.splice(k, 1);
      saveAlerts();
      draw();
      bus.emit('alerts');
    }));
  };
  draw();
  $$('[data-fill]', card).forEach((b) => b.addEventListener('click', () => { $(`#a-${b.dataset.fill}`, card).value = b.dataset.v; }));
  $('#af', card).addEventListener('submit', (e) => {
    e.preventDefault();
    let n = 0;
    for (const op of ['le', 'ge']) {
      const el = $(`#a-${op}`, card);
      const v = toInt(el.value);
      if (v > 0) { alerts.push({ id: newId(), c: code, op, px: v, at: new Date().toISOString(), hit: null }); n++; el.value = ''; }
    }
    if (!n) { toast('請輸入價格'); return; }
    saveAlerts();
    buzz();
    toast('已新增提醒');
    draw();
    bus.emit('alerts');
  });
}
/** 檢查提醒是否觸發（以目前報價）；觸發後記下日期，不重複提醒同一天 */
export function checkAlerts() {
  const out = [];
  const td = today();
  let dirty = false;
  for (const a of alerts) {
    const row = S.rows.get(a.c);
    if (!row) continue;
    const q = quote(row);
    if (!isNum(q.px)) continue;
    const hit = a.op === 'le' ? q.px <= a.px : q.px >= a.px;
    if (hit) {
      out.push({ a, row, q, fresh: a.hit !== td });
      if (a.hit !== td) { a.hit = td; dirty = true; }
    }
  }
  if (dirty) saveAlerts();
  return out;
}

// ------------------------------------------------------------------ 備份與匯入
const toB64 = (s) => { const bytes = new TextEncoder().encode(s); let bin = ''; bytes.forEach((b) => { bin += String.fromCharCode(b); }); return btoa(bin); };
const fromB64 = (b) => new TextDecoder().decode(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)));

function backupObject() {
  const cur = { cash: book.cash, lots: book.lots, colors: book.colors, ...(book.cashD ? { cashD: book.cashD } : {}), ...(book.start ? { start: book.start } : {}) };
  const other = otherBook();
  const real = isPaper() ? (other || { cash: 0, lots: [], colors: {} }) : cur;
  const paper = isPaper() ? cur : other;
  return PF.makeBackup({
    pf: { cash: real.cash || 0, lots: real.lots || [], colors: real.colors || {}, ...(real.cashD ? { cashD: real.cashD } : {}) },
    ...(paper && paper.start ? { paper } : {}),
    alerts,
    journal: journal.items,
    prefs: { watch: settings.watch, risk: settings.risk, fee: settings.fee, name: settings.name, rules: settings.rules, reserve: settings.reserve || 0, plans: settings.plans, dcaSkip: settings.dcaSkip, dcaNoAsk: settings.dcaNoAsk },
  });
}
export function openBackup() {
  const n = book.lots.length;
  const card = openModal(`<div class="form">
      <h2 class="m-title">備份與搬家</h2>
      <p class="m-desc">你的持股、交易、提醒都只存在這支手機的瀏覽器裡，冷眼的伺服器看不到。換手機、清除瀏覽資料之前，先備份一份。</p>
      <div class="bk">
        <div class="bk-h"><b>備份</b><span class="muted small">${n} 筆交易、${alerts.length} 個提醒、${journal.items.length} 筆決策日記</span></div>
        <div class="m-actions left"><button type="button" class="btn" id="b-dl">下載備份檔</button><button type="button" class="btn ghost" id="b-copy">複製備份碼</button></div>
        <p class="small muted">備份碼可以貼到 LINE 的「記事本」或備忘錄保存；在新手機打開冷眼，貼上就能還原。</p>
      </div>
      <div class="bk">
        <div class="bk-h"><b>還原</b></div>
        <textarea class="input area" id="b-in" rows="3" placeholder="貼上備份碼"></textarea>
        <div class="m-actions left"><label class="btn ghost file">選擇備份檔<input type="file" id="b-file" accept=".json,application/json" hidden></label><button type="button" class="btn" id="b-go">還原</button></div>
        <div class="f-err" id="b-err" role="alert"></div>
      </div>
      <div class="m-actions"><button type="button" class="btn ghost" data-close>關閉</button></div>
    </div>`, { label: '備份與搬家' });
  $('#b-dl', card).addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(backupObject(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `coldeye-backup-${today()}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('已下載備份檔');
  });
  $('#b-copy', card).addEventListener('click', async () => {
    const code = 'CE1:' + toB64(JSON.stringify(backupObject()));
    try { await navigator.clipboard.writeText(code); toast('備份碼已複製'); } catch {
      $('#b-in', card).value = code;
      $('#b-in', card).select();
      toast('無法自動複製，請長按上面的文字框複製');
    }
  });
  const go = $('#b-go', card);
  const disarm = () => { go.dataset.armed = ''; go._obj = null; go.textContent = '還原'; };
  // 模擬倉不能用比較舊的備份蓋掉（不然買了賠錢就還原，等於事後反悔）；換手機時模擬倉是空的，照常還原
  const activity = (b) => Math.max(0, ...((b && b.lots) || []).map((l) => Date.parse(l.at) || 0), b && b.start && b.start.d ? Date.parse(isoOf(b.start.d)) || 0 : 0);
  const paperOk = (obj) => {
    if (!obj.paper) return false;
    const cur = isPaper() ? book : otherBook();
    return !(cur && cur.start && activity(cur) > activity(obj.paper));
  };
  $('#b-in', card).addEventListener('input', disarm);
  const restore = (txt) => {
    const err = $('#b-err', card);
    err.textContent = '';
    let obj = null;
    if (go.dataset.armed === '1' && go._obj) {
      obj = go._obj;
    } else {
      try {
        const s = txt.trim();
        obj = JSON.parse(s.startsWith('CE1:') ? fromB64(s.slice(4)) : s);
        PF.readBackup(obj);
      } catch (e) { err.textContent = e.message && /冷眼|格式/.test(e.message) ? e.message : '看不懂這份備份，請確認是完整的備份碼或備份檔'; return; }
      go.dataset.armed = '1';
      go._obj = obj;
      const other = otherBook();
      const nReal = isPaper() ? ((other && other.lots) || []).length : book.lots.length;
      const nPaper = isPaper() ? book.lots.length : ((other && other.lots) || []).length;
      const jn = sanitizeJournal(obj.journal).filter((x) => !journal.items.some((y) => y.id === x.id)).length;
      const bp = obj.prefs && Array.isArray(obj.prefs.plans) ? obj.prefs.plans.length : 0;
      const np = (settings.plans || []).length;
      const planTxt = bp ? `；定期定額計畫：備份 ${bp} 個取代目前 ${np} 個` : np ? `；定期定額計畫：備份裡沒有，維持手機上的 ${np} 個` : '';
      go.textContent = `確定還原？真實部位：備份 ${obj.pf.lots.length} 筆取代目前 ${nReal} 筆${paperOk(obj) ? `；模擬倉：備份 ${obj.paper.lots.length} 筆取代目前 ${nPaper} 筆` : obj.paper ? '；模擬倉有備份之後的新交易，維持現狀' : '（模擬倉不變）'}${planTxt}${jn ? `；決策日記補回 ${jn} 筆（不會刪掉現有的）` : ''}`;
      return;
    }
    // 現金是哪天更新的（readBackup 檢查過）：沒有就當作今天（之後定期定額自動入帳扣的錢才算得出來）
    const real = { cash: obj.pf.cash || 0, lots: obj.pf.lots, colors: obj.pf.colors || {}, cashD: obj.pf.cashD || today() };
    const withPaper = paperOk(obj);
    setBooks(withPaper ? { real, paper: obj.paper } : { real });
    alerts.splice(0, alerts.length, ...(obj.alerts || []));
    saveAlerts();
    if (obj.prefs) {
      // readBackup 已經逐欄檢查過（代號、稱呼、紀律、風險屬性、手續費）
      for (const k of ['watch', 'risk', 'fee', 'name', 'rules', 'reserve']) if (obj.prefs[k] != null) settings[k] = obj.prefs[k];
      saveSettings();
      // 定期定額計畫換成備份裡的（逐欄檢查、舊版轉新版，同一個 id 只留一個）；刪掉的那幾期、說過「不是同一筆」的合併（只會更少重複）
      const pr = obj.prefs;
      savePlans((st) => {
        // 備份裡沒有計畫（舊的備份、或那時還沒設定）：保留手機上的，不要整個清掉
        if (Array.isArray(pr.plans) && pr.plans.length) st.plans = pr.plans;
        if (Array.isArray(pr.dcaSkip)) st.dcaSkip = st.dcaSkip.concat(pr.dcaSkip);
        if (Array.isArray(pr.dcaNoAsk)) st.dcaNoAsk = st.dcaNoAsk.concat(pr.dcaNoAsk);
      });   // 舊版計畫裡的 skip 由 core.js 整理時搬進 dcaSkip
    }
    // 決策日記用「合併」：只補回這支手機沒有的紀錄，不會刪掉或蓋掉現有的
    const add = sanitizeJournal(obj.journal).filter((x) => !journal.items.some((y) => y.id === x.id));
    if (add.length) { journal.items.push(...add); journal.items.sort((a, b) => String(a.at).localeCompare(String(b.at))); saveJournal(); }
    closeModal();
    buzz();
    toast(`已還原 ${obj.pf.lots.length} 筆交易${withPaper ? `、模擬倉 ${obj.paper.lots.length} 筆` : ''}${add.length ? `、決策日記 ${add.length} 筆` : ''}`);
    bus.emit('book');
    if (add.length) bus.emit('journal');
  };
  go.addEventListener('click', () => restore($('#b-in', card).value));
  $('#b-file', card).addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const txt = await file.text();
    disarm();
    $('#b-in', card).value = `（已讀取備份檔 ${file.name}）`;
    restore(txt);
  });
}

/** 清除真實部位的資料（設定頁使用，兩段確認）；模擬倉另外重設 */
export function wipeBook() {
  setBooks({ real: { cash: 0, lots: [], colors: {} } });
  alerts.splice(0, alerts.length);
  saveAlerts();
  store.del('seen');
  bus.emit('book');
}
