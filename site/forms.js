/* 冷眼 — 表單：記一筆交易、可投入現金、到價提醒、備份與匯入。 */
import {
  $, $$, esc, isNum, S, PF, settings, saveSettings, book, saveBook, alerts, saveAlerts, newId, fmt, money,
  catName, toast, buzz, bus, ICON, quote, today, store,
} from './core.js';

// ------------------------------------------------------------------ 共用的底部彈出視窗
let lastFocus = null;
export function openModal(html, { label = '', onClose = null } = {}) {
  const m = $('#modal');
  lastFocus = document.activeElement;
  m.innerHTML = `<div class="modal-back" data-close></div><div class="modal-card" role="dialog" aria-modal="true" aria-label="${esc(label)}"><div class="grab" aria-hidden="true"></div>${html}</div>`;
  m.hidden = false;
  m._onClose = onClose;
  document.body.classList.add('locked');
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
  if (typeof m._onClose === 'function') m._onClose();
  if (lastFocus && lastFocus.focus) try { lastFocus.focus({ preventScroll: true }); } catch { /* 元素已移除 */ }
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
  const lot = o.lot || null;
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
    feeTouched: !!(lot && lot.feeManual),
    taxTouched: !!(lot && lot.taxManual),
    note: lot ? lot.note || '' : '',
  };
  if (f.code && f.px == null) {
    const row = S.rows.get(f.code);
    if (row) f.px = quote(row).px;
  }
  const card = openModal(`<form class="form" id="tf" novalidate autocomplete="off">
      <h2 class="m-title">${lot ? '編輯交易' : '記一筆交易'}</h2>
      <div class="field" id="f-etf"></div>
      <div class="seg wide" role="radiogroup" aria-label="買或賣">
        <button type="button" data-side="buy" aria-pressed="${f.side === 'buy'}">買進</button>
        <button type="button" data-side="sell" aria-pressed="${f.side === 'sell'}">賣出</button>
      </div>
      <div class="row2">
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
      <div class="f-sum" id="f-sum" aria-live="polite"></div>
      <div class="f-err" id="f-err" role="alert"></div>
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

  function shares() {
    const q = toInt(qtyEl.value);
    return f.unit === 'lot' ? q * 1000 : q;
  }
  function recalc() {
    const sh = shares();
    const px = toInt(pxEl.value);
    const row = f.code ? S.rows.get(f.code) : null;
    const cat = row ? row.k : null;
    const d = f.undated ? today() : dOf(dateEl.value) || today();
    $('#f-taxw', card).hidden = f.side !== 'sell';
    let auto = null;
    if (sh > 0 && px > 0) auto = PF.tradeCost(f.side, sh, px, cat, d, settings.fee);
    $('#f-feeh', card).textContent = auto ? `（自動 ${fmt.n(auto.fee)}）` : '';
    $('#f-taxh', card).textContent = auto && f.side === 'sell' ? `（自動 ${fmt.n(auto.tax)}${auto.tax === 0 && cat === 'bond' ? '，債券 ETF 停徵' : ''}）` : '';
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
    $('#f-del', card).addEventListener('click', (e) => {
      const b = e.currentTarget;
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = '確定刪除？'; return; }
      const k = book.lots.findIndex((x) => x.id === lot.id);
      if (k >= 0) book.lots.splice(k, 1);
      saveBook();
      closeModal();
      buzz();
      toast('已刪除這筆交易');
      bus.emit('book');
    });
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
    if (row && px > 0 && (px > row.p * 3 || px < row.p / 3) && !(d && d < 20251231)) problems.push(`成交價和目前價格（${fmt.px(row.p)}）差太多，請確認`);
    if (f.side === 'sell' && row) {
      const held = PF.holdingFromLots(book.lots.filter((x) => x.c === f.code && (!lot || x.id !== lot.id)), (S.divs && S.divs[f.code] && S.divs[f.code].s) || []);
      if (Math.round(sh) > held.sh + 1e-9) problems.push(`目前記錄的持股只有 ${PF.sharesText(held.sh)}，賣出數量超過了`);
    }
    if (problems.length) { err.textContent = problems.join('；'); buzz(30); return; }
    const fee = toInt(feeEl.value);
    const tax = f.side === 'sell' ? toInt(taxEl.value) : 0;
    const rec = {
      id: lot ? lot.id : newId(), c: f.code, side: f.side, d, sh: Math.round(sh), px: +px,
      fee: isNum(fee) && fee >= 0 ? fee : 0, tax: isNum(tax) && tax >= 0 ? tax : 0,
      feeManual: f.feeTouched, taxManual: f.taxTouched,
      note: $('#f-note', card).value.trim().slice(0, 80), at: lot ? lot.at : new Date().toISOString(),
      snap: lot ? lot.snap : null,
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
    buzz();
    toast(lot ? '已更新交易' : `已記下：${f.side === 'buy' ? '買進' : '賣出'} ${row.n} ${PF.sharesText(sh)}`);
    bus.emit('book');
  });
}

// ------------------------------------------------------------------ 可投入現金
export function openCashForm() {
  const card = openModal(`<form class="form" id="cf" novalidate>
      <h2 class="m-title">可投入的現金</h2>
      <p class="m-desc">準備拿來買 ETF、但還沒買的錢。冷眼用「持股市值＋這筆現金」當作你的總資產，計算比重上限與每次最多買多少。只存在這支手機。</p>
      <label class="field"><span>金額（元）</span><input class="input num big" id="c-amt" inputmode="numeric" value="${book.cash || ''}" placeholder="0"></label>
      <div class="quick">${[50000, 100000, 300000, 500000].map((v) => `<button type="button" class="pill" data-q="${v}">${v / 10000} 萬</button>`).join('')}</div>
      <div class="m-actions"><button type="button" class="btn ghost" data-close>取消</button><button type="submit" class="btn primary">儲存</button></div>
    </form>`, { label: '可投入的現金' });
  const amt = $('#c-amt', card);
  $$('[data-q]', card).forEach((b) => b.addEventListener('click', () => { amt.value = b.dataset.q; amt.focus(); }));
  $('#cf', card).addEventListener('submit', (e) => {
    e.preventDefault();
    const v = toInt(amt.value);
    if (!(v >= 0)) { amt.focus(); return; }
    book.cash = Math.round(v);
    saveBook();
    closeModal();
    buzz();
    toast('現金已更新');
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
      out.push({ a, row, q });
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
  return PF.makeBackup({
    pf: { cash: book.cash, lots: book.lots, colors: book.colors },
    alerts,
    prefs: { watch: settings.watch, risk: settings.risk, fee: settings.fee, name: settings.name, rules: settings.rules },
  });
}
export function openBackup() {
  const n = book.lots.length;
  const card = openModal(`<div class="form">
      <h2 class="m-title">備份與搬家</h2>
      <p class="m-desc">你的持股、交易、提醒都只存在這支手機的瀏覽器裡，冷眼的伺服器看不到。換手機、清除瀏覽資料之前，先備份一份。</p>
      <div class="bk">
        <div class="bk-h"><b>備份</b><span class="muted small">${n} 筆交易、${alerts.length} 個提醒</span></div>
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
      go.textContent = `確定用備份的 ${obj.pf.lots.length} 筆交易取代目前的 ${book.lots.length} 筆？`;
      return;
    }
    book.cash = obj.pf.cash || 0;
    book.lots = obj.pf.lots;
    book.colors = obj.pf.colors || {};
    saveBook();
    alerts.splice(0, alerts.length, ...(obj.alerts || []));
    saveAlerts();
    if (obj.prefs) {
      for (const k of ['watch', 'risk', 'fee', 'name', 'rules']) if (obj.prefs[k] != null) settings[k] = obj.prefs[k];
      saveSettings();
    }
    closeModal();
    buzz();
    toast(`已還原 ${obj.pf.lots.length} 筆交易`);
    bus.emit('book');
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

/** 清除所有部位資料（設定頁使用，兩段確認） */
export function wipeBook() {
  book.cash = 0;
  book.lots = [];
  book.colors = {};
  saveBook();
  alerts.splice(0, alerts.length);
  saveAlerts();
  store.del('seen');
  bus.emit('book');
}
