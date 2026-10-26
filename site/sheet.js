/* 冷眼 — 單檔詳情：我的部位、冷眼建議、瞄準鏡、試算、交易紀錄，以及完整的規則分析。 */
import {
  $, $$, esc, clamp, isNum, S, PF, settings, saveSettings, book, alerts, fmt, money, sharesOf, cash3, dirCls, arrow,
  catName, ICON, ST, POS, quote, ensureDetail, ensureTrack, heldOf, adviceFor, ctxFor, holdingInput, stanceChip, posChip,
  actChip, gaugeSVG, animateNeedles, toast, bus, today, premBand, slotVar, isPaper, dayTag, quoteWhen,
} from './core.js';
import { openTradeForm, openAlertForm, closeModal, modalOpen } from './forms.js';
import { addToDuel, openDuel, openTM } from './tools.js';
import { aideDetailHTML, bindAideDetail, openIdea } from './desk.js';
import { openConfirm, dcaTagsHTML } from './dca.js';
import { xrayDetailHTML, bindXrayDetail } from './xray.js';
import * as FX from './fx.js';

const ICON_DUEL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4l9.5 9.5M4 4h3.5M4 4v3.5M20 4l-9.5 9.5M20 4h-3.5M20 4v3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M6.5 15.5l2 2M17.5 15.5l-2 2M5 19l2.5-2.5M19 19l-2.5-2.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const ICON_TM = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.6 12a8.4 8.4 0 1 0 2.5-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M3.2 3.6v4.2h4.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

// ------------------------------------------------------------------ 開關
export async function openDetail(code, push = true) {
  if (S.openCode !== code) FX.cue('open');
  S.openCode = code;
  if (push && location.hash !== '#' + code) history.pushState({ etf: code }, '', '#' + code);
  const sh = $('#sheet');
  sh.hidden = false;
  document.body.classList.add('locked');
  const row = S.rows.get(code);
  sh.innerHTML = sheetTop(code, row) + `<div class="sheet-body">${heroHTML(row)}<div class="skeleton" style="height:180px"></div><div class="skeleton" style="height:240px"></div></div>`;
  bindTop(code);
  sh.scrollTop = 0;
  await ensureTrack();
  let det = null;
  if (row && row.st != null) det = await ensureDetail(code);
  if (S.openCode !== code) return;
  renderDetail(code, det);
}
export function renderDetail(code, det = S.detail[code]) {
  const sh = $('#sheet');
  if (!sh || sh.hidden || S.openCode !== code) return;
  const row = S.rows.get(code);
  const y = sh.scrollTop;
  sh.innerHTML = sheetTop(code, row) + `<div class="sheet-body">${detailHTML(row, det)}</div>`;
  bindTop(code);
  bindDetail(code, row, det);
  animateNeedles(sh);
  sh.scrollTop = y;
}
export function closeDetail(fromPop = false) {
  if (modalOpen()) closeModal();
  if (S.openCode) FX.sfx('close');
  S.openCode = null;
  const sh = $('#sheet');
  sh.hidden = true;
  sh.innerHTML = '';
  document.body.classList.remove('locked');
  // 這一頁是 App 自己 push 進來的（有 state）就上一頁；直接從網址打開的（state 是 null，例如書籤、別人傳的連結）
  // 就只把網址的 # 拿掉，不然「上一頁」會離開冷眼
  if (!fromPop && location.hash) {
    if (history.state == null) history.replaceState(null, '', location.pathname + location.search);
    else history.back();
  }
  bus.emit('closed');
}
export function refreshDetailQuote() {
  if (!S.openCode || S.openCode.startsWith('__')) return;
  const el = $('#dq');
  const row = S.rows.get(S.openCode);
  if (!el || !row) return;
  const was = +el.dataset.px;
  el.outerHTML = quoteLine(row);
  const now = quote(row).px;
  // 盤中價格變了就閃一下（紅漲綠跌）
  if (isNum(was) && isNum(now) && was !== now) { const nel = $('#dq .p'); if (nel) nel.classList.add(now > was ? 'fl-up' : 'fl-down'); }
}

function sheetTop(code, row) {
  const on = settings.watch.includes(code);
  const nAl = alerts.filter((a) => a.c === code).length;
  return `<div class="sheet-top"><button class="icon-btn" id="back" aria-label="返回">${ICON.back}</button>
    <span class="ttl"><b class="ttl-b num">${esc(code)}</b>${row ? `<span>${esc(catName(row.k))}</span>` : ''}</span>
    <button class="icon-btn aide-btn" id="to-aide" aria-label="我有想法：讓副官檢查">${ICON.aide}</button>
    <button class="icon-btn" id="to-duel" aria-label="拿去和別檔對決">${ICON_DUEL}</button>
    <button class="icon-btn" id="to-tm" aria-label="放進存股時光機">${ICON_TM}</button>
    <button class="icon-btn${nAl ? ' on' : ''}" id="bell" aria-label="到價提醒${nAl ? `（${nAl} 個）` : ''}">${ICON.bell}</button>
    <button class="icon-btn star" id="star" aria-pressed="${on}" aria-label="${on ? '移除關注' : '加入關注'}">${ICON.star}</button></div>`;
}
function bindTop(code) {
  $('#back').addEventListener('click', () => closeDetail());
  $('#to-aide').addEventListener('click', () => openIdea({ code }));
  $('#to-duel').addEventListener('click', () => { addToDuel(code); history.replaceState(history.state, '', '#duel'); openDuel(false); });
  $('#to-tm').addEventListener('click', () => { history.replaceState(history.state, '', '#tm'); openTM(false, code); });
  $('#bell').addEventListener('click', () => openAlertForm(code));
  $('#star').addEventListener('click', (e) => {
    const on = settings.watch.includes(code);
    settings.watch = on ? settings.watch.filter((c) => c !== code) : settings.watch.concat(code);
    saveSettings();
    e.currentTarget.setAttribute('aria-pressed', !on);
    toast(on ? '已移除關注' : '已加入關注');
    bus.emit('watch');
  });
}

// ------------------------------------------------------------------ 標題與報價
function quoteLine(row) {
  const q = quote(row);
  return `<div class="pxline" id="dq" data-px="${isNum(q.px) ? q.px : ''}"><span class="p num">${fmt.px(q.px)}</span><span class="c num ${dirCls(q.pc)}">${arrow(q.ch)} ${isNum(q.ch) ? Math.abs(q.ch).toFixed(2) : '—'}　${fmt.pct(q.pc)}</span><span class="live">${esc(quoteWhen(q, row.d))}</span></div>`;
}
function heroHTML(row) {
  if (!row) return '<section class="panel empty">找不到這檔 ETF</section>';
  const q = quote(row);
  const prem = isNum(q.prem) ? `${q.prem >= 0 ? '溢價' : '折價'} ${Math.abs(q.prem).toFixed(2)}%` : '';
  return `<section class="d-hero"><h1>${esc(row.n)}</h1>
    <div class="sub">${row.m === 'otc' ? '上櫃' : '上市'}${isNum(row.aum) ? `　<span data-term="aum">規模</span>約 ${fmt.big(row.aum)}元` : ''}${prem ? `　<span data-term="prem">${prem}</span>` : ''}${isNum(row.r1y) ? `　<span data-term="r1y">近一年</span> ${fmt.r(row.r1y)}` : ''}</div>
    ${quoteLine(row)}
    <div class="chips">${stanceChip(row.st)}${posChip(row.ps)}${(row.fl || []).includes('weak_edge') ? '<span class="chip ghost">此類回測優勢弱</span>' : ''}</div></section>`;
}

// ------------------------------------------------------------------ 主體
function detailHTML(row, det) {
  if (!row) return '<section class="panel empty">找不到這檔 ETF</section>';
  const x = heldOf(row.c);
  const a = adviceFor(row.c);
  let h = heroHTML(row);
  if (x) h += myPositionHTML(x);
  if (a) h += adviceHTML(row, x, a);
  h += aideDetailHTML(row.c);
  if (row.st != null && det) h += scopeHTML(row, x, det.view);
  h += xrayDetailHTML(row.c);
  h += calcHTML(row, x);
  h += journalHTML(row.c);
  if (row.st == null || !det) {
    h += `<section class="panel pad prose"><p>${row.st == null ? `這檔上市只有 ${row.young || 0} 個交易日，規則至少需要 70 個交易日的資料才會給觀點。` : '詳細資料暫時載入失敗，稍後再試。'}</p></section>`;
    return `<div class="d-cols"><div class="d-left">${h}</div></div>`;
  }
  return `<div class="d-cols"><div class="d-left">${h}</div><div class="d-right">${analysisHTML(row, det, x)}</div></div>`;
}

function myPositionHTML(x) {
  const h = x.h;
  const pnlCls = dirCls(x.pnl);
  const cells = [
    ['持股', sharesOf(h.sh)],
    ['平均成本', `<span class="num">${settings.privacy ? '••••' : fmt.px(h.avg)}</span>`],
    ['市值', `<span class="num">${money(x.mv)}</span>`],
    ['未實現損益', `<span class="num ${pnlCls}">${money(x.pnl, true)}</span> <small class="num ${pnlCls}">${fmt.r(x.pct)}</small>`, 'upnl'],
    ['已領配息', x.undated && !x.divRecv ? '<small class="muted">要填買進日期</small>' : `<span class="num">${money(x.divRecv)}</span>`, 'div'],
    ['損益兩平', `<span class="num">${settings.privacy ? '••••' : fmt.px(x.be)}</span>`, 'be'],
    ['占總資產', `<span class="num">${fmt.r(x.w, 1, false)}</span>`, 'risk'],
    [dayTag(x.q && x.q.date), `<span class="num ${dirCls(x.day)}">${money(x.day, true)}</span>`],
  ];
  return `<section class="panel mine" aria-label="我的部位">
    <div class="mine-h"><h2>${isPaper() ? '模擬部位' : '我的部位'}</h2><button class="btn small" id="m-add">${ICON.plus}記一筆</button></div>
    <div class="kv">${cells.map(([k, v, t]) => `<div><div class="k"${t ? ` data-term="${t}"` : ''}>${k}</div><div class="v">${v}</div></div>`).join('')}</div>
    ${h.warnings.length ? `<div class="note warn">${h.warnings.map(esc).join('<br>')}</div>` : ''}
    ${x.undated ? `<div class="note">${x.undated} 筆交易沒填日期，已領配息只算有日期的部分。</div>` : ''}
  </section>`;
}

const KIND_ICON = { pro: ICON.ok, con: ICON.no, warn: ICON.bang, info: ICON.dot, stat: ICON.chart };
function adviceHTML(row, x, a) {
  const tone = { add: 'go', hold: 'mute', full: 'mute', none: 'mute', hold_off: 'warn', pause: 'warn', trim: 'warn2', rebalance: 'warn2' }[a.key] || 'mute';
  let plan = '';
  if (a.plan) plan = planHTML(a);
  let sell = '';
  if (a.sell && a.sell.n > 0) sell = sellHTML(a.sell, x);
  const lines = a.lines.map((l) => `<li class="ln ${l.kind}"><span class="ic">${KIND_ICON[l.kind] || ICON.dot}</span><span>${esc(l.text)}</span>${l.kind === 'stat' && a.ev ? evidenceBars(a.ev) : ''}</li>`).join('');
  return `<section class="panel advice hud tone-${tone}${tone === 'warn2' ? ' hazard' : ''}" aria-label="冷眼建議">
    <div class="adv-top"><div class="adv-h"><span class="adv-k">冷眼建議</span><span class="adv-label">${esc(a.label)}</span><span class="adv-by">${a.held ? '規則訊號 × 你的紀律' : '如果要買：規則訊號 × 你的紀律'}</span></div></div>
    ${sell}${plan}
    <ul class="lines">${lines}</ul>
    <p class="adv-foot" data-term="risk">${esc(PF.PROFILES[settings.risk].name)}型紀律：單筆最多虧總資產 ${(PF.PROFILES[settings.risk].loss * 100).toFixed(1)}%、${esc(catName(row.k))}單檔上限 ${(PF.capOf(settings.risk, row.k) * 100).toFixed(0)}%。可在設定調整。</p>
  </section>`;
}
function evidenceBars(ev) {
  const w = (v) => clamp(v * 100, 0, 100).toFixed(1);
  return `<div class="evi" role="img" aria-label="訊號之後上漲比例 ${(ev.up * 100).toFixed(0)}%，同類任何一天 ${(ev.base * 100).toFixed(0)}%">
    <div class="evi-r"><span>訊號之後</span><span class="evi-t"><i style="width:${w(ev.up)}%"></i></span><b class="num">${(ev.up * 100).toFixed(0)}%</b></div>
    <div class="evi-r base"><span>任何一天</span><span class="evi-t"><i style="width:${w(ev.base)}%"></i></span><b class="num">${(ev.base * 100).toFixed(0)}%</b></div>
    <div class="evi-n">${esc(ev.catName)}，${fmt.n(ev.n)} 次，20 個交易日後上漲的比例</div></div>`;
}
const LIMIT_TEXT = {
  cash: '分到的可用現金（現金分 3 份，每次加碼最多用 1 份）',
  cap: '單檔比重上限',
  risk: '單筆最多虧損的金額',
};
function planHTML(a) {
  const p = a.plan;
  const T = ctxFor(S.openCode).T;
  if (!(T > 0)) return '<div class="plan empty-plan">在「部位」輸入可投入現金或持股後，這裡會算出建議買多少。</div>';
  if (!(p.n > 0)) {
    const why = p.limit === 'cash' ? (p.cash > 0 ? '分到的現金不夠買 1 股' : '可投入現金是 0，先到「部位」設定現金') : p.limit === 'cap' ? '比重已到上限' : '單筆風險預算太小';
    return `<div class="plan empty-plan">${a.key === 'hold' ? '想加碼的話：' : ''}目前建議 0 股（${why}）。${p.ideal > 0 ? `依紀律最多 ${sharesOf(p.ideal)}。` : ''}</div>`;
  }
  const amt = p.parts.reduce((s, t) => s + t.sh * t.px, 0);
  return `<div class="plan">
    <div class="plan-h">${a.key === 'hold' ? '想加碼的話，小額就好：' : ''}這次最多 <b class="num">${sharesOf(p.n)}</b>，約 <b class="num">${money(amt)}</b> 元</div>
    <div class="plan-sub">受限於${LIMIT_TEXT[p.limit]}${p.small ? (p.smallWhy === 'conf' ? '；信心不到 70，再減半' : '；觀點中性，再減半') : ''}${p.ideal > p.n && p.limit === 'cash' ? `。依紀律最多 ${sharesOf(p.ideal)}` : ''}</div>
    <ol class="tranche">${p.parts.map((t, i) => `<li><span class="t-k">第 ${i + 1} 批</span><span class="t-w">${i === 0 ? `現價附近 <b class="num">${fmt.px(t.px)}</b>` : t.lim != null ? `拉回到 <b class="num">${fmt.px(t.lim)}</b>，或${i === 1 ? '一週後' : '兩週後'}` : esc(t.when)}</span><span class="t-n num">${sharesOf(t.sh)}</span></li>`).join('')}</ol>
    <div class="plan-stop">${ICON.warn}<span><span data-term="stop">出場線</span> <b class="num">${fmt.px(p.stop)}</b>（${esc(p.stopName)}）：買齊後收盤跌破就出場，約虧 <b class="num">${money(p.lossAtStop)}</b> 元${T > 0 ? `（總資產 ${(p.lossAtStop / T * 100).toFixed(2)}%）` : ''}</span></div>
    <div class="plan-after">買齊後${isNum(p.newAvg) && a.held ? `平均成本 <b class="num">${settings.privacy ? '••••' : fmt.px(p.newAvg)}</b>、` : ''}占總資產 <b class="num">${fmt.r(p.newW, 1, false)}</b></div>
  </div>`;
}
function sellHTML(s, x) {
  return `<div class="plan sell">
    <div class="plan-h">建議賣出 <b class="num">${sharesOf(s.n)}</b>，約 <b class="num">${money(s.amount)}</b> 元</div>
    <div class="plan-sub">${esc(s.why)}</div>
    <div class="plan-after">預估拿回 <b class="num">${money(s.net)}</b> 元（手續費 ${money(s.fee)}${s.taxFree ? '，免證交稅' : `、證交稅 ${money(s.tax)}`}），這部分已實現損益 <b class="num ${dirCls(s.realized)}">${money(s.realized, true)}</b> 元</div>
    <div class="plan-after">賣出後剩 <b class="num">${sharesOf(s.restSh)}</b>、占總資產 <b class="num">${fmt.r(s.restW, 1, false)}</b></div>
  </div>`;
}

// ------------------------------------------------------------------ 瞄準鏡：價位梯
function scopeHTML(row, x, V) {
  const q = quote(row);
  const px = q.px;
  const L = V.levels || {};
  const items = [];
  const push = (p, label, cls, side = 'r') => { if (isNum(p) && p > 0) items.push({ p, label, cls, side }); };
  (L.resistance || []).forEach((r, i) => push(r.price, `壓力${i + 1}・${r.label}`, 'res'));
  (L.support || []).forEach((r, i) => push(r.price, `支撐${i + 1}・${r.label}`, 'sup'));
  if (L.invalid) push(L.invalid.price, V.stance > 0 ? '作廢線' : '轉多線', 'inv');
  push(row.dl, '移動防守線', 'def');
  if (V.stance > 0 && L.pullback) push(L.pullback.price, '拉回價', 'pb');
  if (x && isNum(x.h.avg) && !settings.privacy) push(x.h.avg, '你的成本', 'me');
  for (const al of alerts.filter((a) => a.c === row.c)) push(al.px, al.op === 'le' ? '提醒：跌到' : '提醒：漲到', 'al');
  // 合併相同價位（例如作廢線剛好就是支撐 1），保留較重要的樣式
  const RANK = { inv: 6, def: 5, me: 4, al: 3, pb: 2, sup: 1, res: 1 };
  const merged = [];
  for (const it of items.filter((z) => Math.abs(z.p / px - 1) < 0.2).sort((a, b) => b.p - a.p)) {
    const same = merged.find((z) => Math.abs(z.p - it.p) < 0.005);
    if (same) {
      if ((RANK[it.cls] || 0) > (RANK[same.cls] || 0)) { same.label = `${it.label}／${same.label}`; same.cls = it.cls; } else same.label = `${same.label}／${it.label}`;
    } else merged.push({ ...it });
  }
  const vis = merged;
  const all = vis.concat([{ p: px, label: q.live ? '盤中' : '收盤', cls: 'now' }]).sort((a, b) => b.p - a.p);
  if (all.length < 2) return '';
  // 價位梯：依價格由高到低等距排列（距離看右邊的百分比），比按比例畫更好讀
  const gap = 34;
  const H = all.length * gap;
  all.forEach((z, k) => { z.y = gap / 2 + k * gap; });
  const marks = all.map((z) => {
    const d = z.cls === 'now' ? '' : `<span class="sc-d num">${fmt.pct((z.p / px - 1) * 100, 1)}</span>`;
    const term = { inv: 'iv', def: 'dl', pb: 'pb', me: 'be' }[z.cls];
    return `<div class="sc-row ${z.cls}" style="top:${z.y}px"><span class="sc-l"${term ? ` data-term="${term}"` : ''}>${esc(z.label)}</span><span class="sc-p num">${fmt.px(z.p)}</span>${d}</div>
      <span class="sc-tick ${z.cls}" style="top:${z.y}px" aria-hidden="true"></span>`;
  }).join('');
  const nowY = all.find((z) => z.cls === 'now').y;
  const def = all.find((z) => z.cls === 'def' || (z.label || '').includes('移動防守線'));
  const zone = def ? `<span class="sc-zone" style="top:${Math.min(nowY, def.y)}px;height:${Math.abs(def.y - nowY)}px" aria-hidden="true"></span>` : '';
  return `<div class="sec-h"><h2>瞄準鏡</h2><span class="aside">現價上下 20% 內的關鍵價位</span></div>
    <section class="panel scope" aria-label="關鍵價位">
      <div class="sc-wrap" style="height:${H}px"><span class="sc-rail" aria-hidden="true"></span>${zone}${marks}</div>
      <p class="small muted">移動防守線＝近 22 個交易日最高收盤減 3 倍 ATR，價格創高就跟著上移。${isNum(row.dl) && px < row.dl ? '現在價格已經在防守線之下，色帶是「要站回去」的距離。' : '現價到防守線之間的色帶，就是「還算正常的回檔空間」。'}</p>
    </section>`;
}

// ------------------------------------------------------------------ 試算
function calcHTML(row, x) {
  const held = !!x;
  return `<div class="sec-h"><h2>${held ? '加碼／賣出試算' : '買進試算'}</h2><span class="aside">逐條檢查你的紀律</span></div>
    <section class="panel calc" id="calc">
      ${held ? '<div class="seg wide" role="tablist"><button data-cm="buy" aria-pressed="true">加碼</button><button data-cm="sell" aria-pressed="false">賣出</button></div>' : ''}
      <div class="row2">
        <label class="field"><span>數量</span><span class="with-unit"><input class="input num" id="c-qty" inputmode="numeric" placeholder="0"><span class="seg mini"><button type="button" data-cu="sh" aria-pressed="true">股</button><button type="button" data-cu="lot" aria-pressed="false">張</button></span></span></label>
        <label class="field"><span>價格</span><input class="input num" id="c-px" inputmode="decimal" value="${quote(row).px ?? ''}"></label>
      </div>
      <div id="c-out" class="c-out" aria-live="polite"><span class="muted">輸入數量，看看這筆交易符不符合你的紀律。</span></div>
      ${settings.rules && settings.rules.length ? `<details class="myrules"><summary>你自己的紀律（下單前對一次）</summary><ul>${settings.rules.map((r, i) => `<li><label><input type="checkbox" data-rule="${i}"><span>${esc(r)}</span></label></li>`).join('')}</ul></details>` : ''}
    </section>`;
}
function bindCalc(row, x) {
  const box = $('#calc');
  if (!box) return;
  let mode = 'buy';
  let unit = 'sh';
  const out = $('#c-out', box);
  const run = () => {
    const qv = Number(String($('#c-qty', box).value).replace(/[,\s]/g, ''));
    const sh = unit === 'lot' ? qv * 1000 : qv;
    const px = Number($('#c-px', box).value);
    if (!(sh > 0) || !(px > 0)) { out.innerHTML = '<span class="muted">輸入數量，看看這筆交易符不符合你的紀律。</span>'; return; }
    const ctx = ctxFor(row.c);
    const H = x ? holdingInput(x) : { row, sh: 0, avg: null, cost: 0, px: quote(row).px, prem: quote(row).prem };
    if (mode === 'sell') {
      const s = PF.simulateSell(H, Math.round(sh), px, ctx);
      out.innerHTML = `<div class="c-grid">
        <div><span>拿回</span><b class="num">${money(s.net)}</b></div>
        <div><span>手續費／證交稅</span><b class="num">${money(s.fee)}／${s.taxFree ? '免' : money(s.tax)}</b></div>
        <div><span>已實現損益</span><b class="num ${dirCls(s.realized)}">${money(s.realized, true)}</b></div>
        <div><span>賣出後</span><b class="num">${sharesOf(s.restSh)}・${fmt.r(s.restW, 1, false)}</b></div></div>
        ${Math.round(sh) > H.sh ? `<p class="note warn">超過目前持股 ${sharesOf(H.sh)}，已用全部持股計算。</p>` : ''}`;
      return;
    }
    const r = PF.simulateAdd(H, Math.round(sh), px, ctx);
    const verdict = r.fails ? `<b class="bad">有 ${r.fails} 項不符合</b>` : '<b class="good">符合規則與紀律</b>';
    out.innerHTML = `<div class="c-grid">
        <div><span>需要</span><b class="num">${money(r.net)}</b></div>
        <div><span>手續費</span><b class="num">${money(r.fee)}</b></div>
        <div><span>${x ? '新平均成本' : '成本'}</span><b class="num">${settings.privacy ? '••••' : fmt.px(r.newAvg)}</b></div>
        <div><span>損益兩平</span><b class="num">${settings.privacy ? '••••' : fmt.px(r.be)}</b></div></div>
      <div class="verdict-line">${verdict}</div>
      <ul class="checks">${r.checks.map((c) => `<li class="${c.ok === true ? 'ok' : c.ok === false ? 'no' : 'na'}"><span class="ic">${c.ok === true ? ICON.ok : c.ok === false ? ICON.no : ICON.dot}</span><span>${esc(c.text)}</span></li>`).join('')}</ul>`;
  };
  $$('[data-cm]', box).forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.cm;
    $$('[data-cm]', box).forEach((z) => z.setAttribute('aria-pressed', z === b));
    run();
  }));
  $$('[data-cu]', box).forEach((b) => b.addEventListener('click', () => {
    unit = b.dataset.cu;
    $$('[data-cu]', box).forEach((z) => z.setAttribute('aria-pressed', z === b));
    run();
  }));
  $('#c-qty', box).addEventListener('input', run);
  $('#c-px', box).addEventListener('input', run);
}

// ------------------------------------------------------------------ 交易紀錄
function journalHTML(code) {
  const lots = book.lots.filter((l) => l.c === code).sort((a, b) => (b.d || 0) - (a.d || 0) || String(b.at).localeCompare(String(a.at)));
  if (!lots.length) {
    return `<section class="panel pad cta-row"><div><b>還沒有這檔的交易紀錄</b><div class="small muted">記下來就能算成本、損益、已領配息，建議也會依你的部位調整。</div></div><button class="btn primary" id="j-add">${ICON.plus}記一筆</button></section>`;
  }
  return `<div class="sec-h"><h2>交易紀錄</h2><button class="link" id="j-add">${ICON.plus}記一筆</button></div>
    <section class="panel list journal">${lots.map((l) => {
    const s = l.snap;
    const snap = s && s.st != null ? `當時規則：${ST[String(s.st)].t}${s.ps && POS[s.ps] ? `／${POS[s.ps].t}` : ''}` : '';
    const tags = isPaper() ? '' : dcaTagsHTML(l);
    return `<button class="j-row${tags && l.dca.est === true ? ' est' : ''}" data-lot="${esc(l.id)}"><span class="j-d num">${l.d ? fmt.dy(l.d) : '未填日期'}</span>
      <span class="j-m"><span class="j-l1"><b class="${l.side === 'sell' ? 'sell' : 'buy'}">${l.side === 'sell' ? '賣出' : '買進'}</b> ${sharesOf(l.sh)} × <span class="num">${fmt.px(l.px)}</span>${tags}</span>
      <span class="j-l2">手續費 <span class="num">${money(l.fee || 0)}</span>${l.tax ? `、證交稅 <span class="num">${money(l.tax)}</span>` : ''}${snap ? `　${snap}` : ''}</span>
      ${l.note ? `<span class="j-note">${esc(l.note)}</span>` : ''}</span>
      <span class="chev">${ICON.chev}</span></button>`;
  }).join('')}</section>`;
}

// ------------------------------------------------------------------ 規則分析（原本的單檔頁）
function analysisHTML(row, det, x) {
  const V = det.view;
  const st = ST[String(V.stance)];
  const sim = V.similar;
  let h = `<div class="sec-h"><h2>規則觀點</h2><span class="aside">時間尺度約 1 個月</span></div>
    <section class="panel verdict">
      <div class="verdict-top"><span class="big ${st.cls}" data-term="st">${V.stance > 0 ? ICON.up : V.stance < 0 ? ICON.down : ICON.flat}${st.t}</span>
        <span class="meta">${V.conf != null ? `<span data-term="cf">信心 <b class="num">${V.conf}</b></span>` : '<span data-term="cf">訊號分歧，不給信心</span>'}<span data-term="sc">規則分數 <b class="num">${V.score >= 0 ? '+' : ''}${V.score.toFixed(2)}</b></span></span></div>
      ${gaugeSVG(V.score, V.stance, true)}
      ${sim ? `<div class="src">回測中${sim.scope === 'cat' ? esc(catName(row.k)) + ' ETF' : '所有 ETF'}的${V.stance > 0 ? '偏多' : '偏空'}訊號，20 日後方向正確 <b class="num">${(sim.hit * 100).toFixed(0)}%</b>；同類${V.stance > 0 ? '一直看多' : '一直看空'}是 ${(sim.base * 100).toFixed(0)}%，${sim.delta >= 0 ? '高' : '低'} <b class="num">${Math.abs(sim.delta * 100).toFixed(1)}</b> 個百分點（${fmt.n(sim.n)} 次）。</div>` : ''}
    </section>
    <section class="panel pad summary">${esc(V.summary)}</section>`;
  if (V.flags && V.flags.length) h += `<section class="panel pad flags">${V.flags.map((f) => `<div class="flag">${ICON.warn}<span>${esc(f.text)}</span></div>`).join('')}</section>`;
  h += `<section class="panel chart-card"><div class="chart-head"><h3>價格與關鍵價位</h3><div class="seg">${[[60, '3 月'], [120, '6 月'], [250, '1 年']].map(([n, t]) => `<button data-rg="${n}" aria-pressed="${S.range === n}">${t}</button>`).join('')}</div></div>
      <div class="chart" id="pchart"></div>
      <div class="legend"><span><i style="border-color:var(--frost)"></i>收盤（還原權息）</span><span><i style="border-color:var(--ma20)"></i>月線</span><span><i style="border-color:var(--ma60)"></i>季線</span><span><i style="border-color:var(--ma120)"></i>半年線</span><span><i class="dash" style="border-color:var(--glacier)"></i>支撐／壓力</span><span><i class="dash" style="border-color:var(--amber)"></i>作廢線</span><span><i class="dot" style="border-color:var(--amber)"></i>防守線</span>${x && !settings.privacy ? '<span><i class="dash" style="border-color:var(--aurora)"></i>你的成本</span>' : ''}</div>
      ${ribbonHTML(det)}</section>`;
  h += `<div class="sec-h"><h2>各面向的理由</h2><span class="aside">資料涵蓋 ${Math.round((V.coverage || 0) * 100)}%</span></div><section class="panel comps">${V.components.map((c) => compHTML(c, row)).join('')}</section>`;
  h += profileHTML(row, det, V);
  h += flowsHTML(det, row);
  if (settings.dca) h += dcaHTML(row, V);
  h += btHTML(det);
  h += `<p class="disclaim">${esc(det.adjusted_note)}。觀點每天收盤後重新計算一次，盤中只更新價格與預估淨值。規則與資料來源都公開在設定裡。不保證報酬，買賣請自行判斷。</p>`;
  return h;
}

function ribbonHTML(det) {
  const hs = (det.hist || []).slice(-120);
  if (hs.length < 10) return '';
  return `<div class="ribbon" aria-label="過去 ${hs.length} 個交易日的規則觀點">${hs.map((x) => `<span class="${ST[String(x[1])].cls}" title="${fmt.d(x[0])} ${ST[String(x[1])].t}"></span>`).join('')}</div>
    <div class="ribbon-cap"><span class="num">${fmt.d(hs[0][0])}</span><span>每天的觀點：紅偏多、綠偏空、灰中性</span><span class="num">${fmt.d(hs[hs.length - 1][0])}</span></div>`;
}
function srcLink(key, label) {
  const s = S.summary.sources && S.summary.sources[key];
  if (!s) return esc(label || key);
  return `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(label || s.name)}</a>`;
}
function compSource(c, row) {
  const otc = row.m === 'otc';
  switch (c.src) {
    case 'price': return srcLink(otc ? 'tpex_daily' : 'twse_daily');
    case 'flows': return srcLink(otc ? 'tpex_flows' : 'twse_flows') + '、' + srcLink(otc ? 'tpex_margin' : 'twse_margin');
    case 'taiex': return srcLink('twse_market');
    case 'ust': return srcLink('ust');
    case 'mis': return srcLink('mis_etf');
    case 'nav': return srcLink('mis_etf', '投信公告淨值（證交所 MIS）');
    case 'div': return srcLink(otc ? 'tpex_div' : 'twse_div');
    default: return '';
  }
}
function compHTML(c, row) {
  const cells = [-2, -1, 0, 1, 2].map((k) => {
    if (k === 0) return '<span class="mid"></span>';
    const on = (k < 0 && c.score <= k + 0.5 && c.score < 0) || (k > 0 && c.score >= k - 0.5 && c.score > 0);
    return `<span class="${on ? 'on ' + (k > 0 ? 'pos' : 'neg') : ''}"></span>`;
  }).join('');
  return `<div class="comp"><div class="comp-h"><b>${esc(c.name)}</b><span class="w">權重 ${Math.round(c.weight * 100)}%</span><span class="meter" aria-label="分數 ${c.score.toFixed(1)}">${cells}</span><span class="num sc">${c.score > 0 ? '+' : ''}${c.score.toFixed(1)}</span></div><p>${esc(c.text)}</p><div class="src">來源：${compSource(c, row)}</div></div>`;
}
function profileHTML(row, det, V) {
  const r = V.risk || {};
  const q = quote(row);
  const hold = det.holders || [];
  const hNow = hold.length ? hold[hold.length - 1] : null;
  const hPrev = hold.length > 1 ? hold[hold.length - 2] : null;
  const u = det.units || [];
  const u20 = u.length > 20 ? u[u.length - 1][1] / u[u.length - 21][1] - 1 : null;
  const divs = (det.divs || []).slice(-8).reverse();
  const cells = [
    ['年化波動', isNum(r.vol_ann) ? `${r.vol_ann.toFixed(1)}<small>%</small>` : '—', 'vol'],
    ['距一年高點', isNum(r.dd_52w) ? `${r.dd_52w.toFixed(1)}<small>%</small>` : '—', 'dd52'],
    ['一年區間位置', isNum(r.pos_52w) ? `${r.pos_52w.toFixed(0)}<small>%</small>` : '—', 'pos52'],
    ['平均成交值', isNum(r.value20) ? `${fmt.big(r.value20)}<small>元/日</small>` : '—', 'val'],
    [isNum(q.prem) && q.prem < 0 ? '折價' : '溢價', isNum(q.prem) ? `${Math.abs(q.prem).toFixed(2)}<small>%</small>` : '—', 'prem'],
    ['近 12 月殖利率', isNum(row.y) ? `${row.y.toFixed(2)}<small>%</small>` : '—', 'y'],
    ['受益人數', hNow ? `${fmt.n(hNow[1])}<small>${hPrev ? ` 人（週 ${fmt.pct((hNow[1] / hPrev[1] - 1) * 100, 1)}）` : ' 人'}</small>` : '—', 'hd'],
    ['近 20 日單位數', isNum(u20) ? `${fmt.pct(u20 * 100, 1)}<small> ${u20 >= 0 ? '淨申購' : '淨贖回'}</small>` : '<small>資料累積中</small>', 'units'],
    ['近一年含息報酬', isNum(row.r1y) ? `${fmt.r(row.r1y)}` : '—', 'r1y'],
    ['近一年最大回檔', isNum(row.mdd) ? `−${(row.mdd * 100).toFixed(1)}<small>%</small>` : '—', 'mdd'],
  ];
  let h = `<div class="sec-h"><h2>ETF 體檢</h2><span class="aside">${srcLink('tdcc', '受益人數：集保')}</span></div><section class="panel kv">${cells.map(([k, val, t]) => `<div><div class="k"${t ? ` data-term="${t}"` : ''}>${k}</div><div class="v num">${val}</div></div>`).join('')}</section>`;
  const nav = det.nav || {};
  const prem = (nav.d || []).map((d, i) => (isNum(nav.nav[i]) && isNum(nav.c[i]) ? (nav.c[i] / nav.nav[i] - 1) * 100 : null));
  const pv = prem.filter(isNum);
  if (pv.length >= 5) h += `<section class="panel pad"><div class="small muted" style="margin-bottom:6px">收盤價相對官方淨值的折溢價（近 ${pv.length} 日）</div>${divBars(prem.slice(-40), (v) => v.toFixed(2) + '%')}<div class="src">來源：${srcLink('mis_etf', '投信公告淨值（證交所 MIS）')}</div></section>`;
  if (divs.length || det.div_next) {
    h += `<section class="panel tbl-wrap"><table class="t"><thead><tr><th>除息日</th><th class="r">每單位配息</th></tr></thead><tbody>${det.div_next ? `<tr class="hl"><td class="num">${fmt.dy(det.div_next.d)}（預告）</td><td class="r num">${det.div_next.cash ? cash3(det.div_next.cash) + ' 元' : '待公告'}</td></tr>` : ''}${divs.map((z) => `<tr><td class="num">${fmt.dy(z[0])}</td><td class="r num">${cash3(z[1])} 元</td></tr>`).join('')}</tbody></table></section>`;
  }
  return h;
}
function divBars(vals, label) {
  const v = vals.map((z) => (isNum(z) ? z : 0));
  const W = 320, H = 70, mid = H / 2, mx = Math.max(0.2, ...v.map((z) => Math.abs(z)));
  const bw = W / v.length;
  const bars = v.map((z, i) => {
    const hgt = (Math.abs(z) / mx) * (mid - 6);
    const y = z >= 0 ? mid - hgt : mid;
    return `<rect x="${(i * bw + 1).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1.5, bw - 2).toFixed(1)}" height="${Math.max(0.8, hgt).toFixed(1)}" rx="1" fill="${z >= 0 ? 'var(--up)' : 'var(--down)'}" opacity=".85"><title>${label(z)}</title></rect>`;
  }).join('');
  const last = v[v.length - 1];
  return `<svg class="bars-mini" viewBox="0 0 ${W} ${H + 14}" role="img" aria-label="最近一筆 ${label(last)}"><line x1="0" x2="${W}" y1="${mid}" y2="${mid}" stroke="var(--seam-2)"/>${bars}<text x="${W}" y="${H + 12}" text-anchor="end" class="ax">最新 ${label(last)}</text><text x="0" y="${H + 12}" class="ax">刻度 ±${label(mx)}</text></svg>`;
}
function flowsHTML(det, row) {
  const F = det.flows || {};
  const n = (F.d || []).length;
  if (!n) return '';
  const net = F.d.map((d, i) => (isNum(F.f[i]) || isNum(F.t[i]) ? ((F.f[i] || 0) + (F.t[i] || 0)) / 1000 : null));
  if (net.filter(isNum).length < 5) return '';
  const last20 = net.slice(-20);
  const sum20 = last20.filter(isNum).reduce((a, b) => a + b, 0);
  const M = det.margin || {};
  const mm = (M.m || []).filter(isNum);
  const mtxt = mm.length > 1 ? `融資餘額 ${fmt.n(mm[mm.length - 1])} 張（${mm.length >= 21 ? '20 日 ' + fmt.pct((mm[mm.length - 1] / mm[mm.length - 21] - 1) * 100, 1) : '近期資料累積中'}）` : '';
  const lab = (v) => (v > 0 ? '+' : '') + Math.round(v).toLocaleString('en-US') + ' 張';
  return `<div class="sec-h"><h2>籌碼</h2><span class="aside" data-term="insti">外資＋投信，單位：張</span></div><section class="panel pad">${divBars(last20, lab)}<div class="prose" style="margin-top:6px">近 20 日合計 <b class="num ${dirCls(sum20)}">${sum20 > 0 ? '+' : ''}${Math.round(sum20).toLocaleString('en-US')} 張</b>${mtxt ? '；' + mtxt : ''}。</div><div class="src">來源：${srcLink(row.m === 'otc' ? 'tpex_flows' : 'twse_flows')}、${srcLink(row.m === 'otc' ? 'tpex_margin' : 'twse_margin')}</div></section>`;
}
function dcaHTML(row, V) {
  const r = V.risk || {};
  const q = quote(row);
  const [w] = premBand(row);
  let tip;
  if (['lev', 'inv'].includes(row.k)) tip = '槓桿與反向型每日重新平衡，長期持有會偏離指數，不適合定期定額。';
  else if (isNum(q.prem) && q.prem > w) tip = `照常扣款；另外的單筆加碼等溢價回到 ${w}% 以內。`;
  else if (row.ps === 'trim' || row.ps === 'caution') tip = '定期定額照紀律扣款即可；另外的單筆加碼先等一等。';
  else tip = '照常扣款。回測顯示挑時機的優勢很小，長期扣款的關鍵是不中斷。';
  return `<section class="panel pad prose"><p><b data-term="dca">定期定額視角</b>　長期扣款看的是紀律，不是短期觀點。目前價格在一年區間的 ${isNum(r.pos_52w) ? r.pos_52w.toFixed(0) + '%' : '—'} 位置${isNum(q.prem) ? `，${q.prem >= 0 ? '溢價' : '折價'} ${Math.abs(q.prem).toFixed(2)}%` : ''}。${tip}</p></section>`;
}
function btHTML(det) {
  const b = det.bt;
  if (!b || !b.n) return '';
  const pc = (z) => (isNum(z) ? (z * 100).toFixed(0) + '%' : '—');
  const ps = det.pos_bt_self;
  return `<div class="sec-h"><h2>這檔的規則戰績</h2><span class="aside num" data-term="bt">${fmt.dy(b.start)} 起回測</span></div><section class="panel kv">
      <div><div class="k">偏多後 20 日上漲</div><div class="v num">${pc(b.bull.hit)}<small> ${fmt.n(b.bull.n)} 次</small></div></div>
      <div><div class="k">任何一天上漲</div><div class="v num">${pc(b.base_up)}<small> 全部 ${fmt.n(b.n)} 次</small></div></div>
      <div><div class="k">偏空後 20 日下跌</div><div class="v num">${pc(b.bear.hit)}<small> ${fmt.n(b.bear.n)} 次</small></div></div>
      <div><div class="k">偏多與偏空的報酬差</div><div class="v num">${isNum(b.bull.avg) && isNum(b.bear.avg) ? fmt.pct((b.bull.avg - b.bear.avg) * 100, 1) : '—'}</div></div>
      ${ps && ps.trim && ps.trim.n ? `<div><div class="k">減碼訊號後最差 10%</div><div class="v num">${fmt.r(ps.trim.p10)}<small> ${fmt.n(ps.trim.n)} 次</small></div></div><div><div class="k">任何一天最差 10%</div><div class="v num">${fmt.r(ps.all.p10)}</div></div>` : ''}
    </section><p class="disclaim">單一檔的樣本少（每 5 個交易日取一次），數字只當參考；同類別的統計在「戰績」頁。</p>`;
}

// ------------------------------------------------------------------ 綁定
function bindDetail(code, row, det) {
  const add = () => openTradeForm({ code });
  $$('#m-add, #j-add').forEach((b) => b.addEventListener('click', add));
  // 定期定額自動記的預估：點開是「核對」（國泰的 1 元手續費、預估的狀態都留著）；其他照一般的編輯
  $$('[data-lot]').forEach((b) => b.addEventListener('click', () => {
    const lot = book.lots.find((l) => l.id === b.dataset.lot);
    if (!lot) return;
    if (!isPaper() && lot.dca && lot.dca.est === true) openConfirm(lot.id); else openTradeForm({ lot });
  }));
  bindCalc(row, heldOf(code));
  bindAideDetail($('#sheet'), code);
  bindXrayDetail($('#sheet'), code);
  if (!det || row.st == null) return;
  const x = heldOf(code);
  drawPriceChart(det, S.range, row, x);
  $$('[data-rg]').forEach((b) => b.addEventListener('click', () => {
    S.range = +b.dataset.rg;
    $$('[data-rg]').forEach((z) => z.setAttribute('aria-pressed', z === b));
    drawPriceChart(det, S.range, row, x);
  }));
}

// ------------------------------------------------------------------ 價格圖
function niceStep(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v || 1)));
  const f = v / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}
function drawPriceChart(det, n, row, x) {
  const el = $('#pchart');
  if (!el) return;
  const B = det.bars;
  const k0 = Math.max(0, B.d.length - n);
  const D = B.d.slice(k0), C = B.c.slice(k0), Hh = B.h.slice(k0), Lo = B.l.slice(k0);
  const M20 = det.ma['20'].slice(k0), M60 = det.ma['60'].slice(k0), M120 = det.ma['120'].slice(k0);
  const V = det.view, L = V.levels;
  const lv = [];
  const inv = L.invalid ? L.invalid.price : null;
  (L.resistance || []).forEach((z) => { if (z.price !== inv) lv.push({ p: z.price, t: '壓', cls: 'glacier' }); });
  (L.support || []).forEach((z) => { if (z.price !== inv) lv.push({ p: z.price, t: '撐', cls: 'glacier' }); });
  if (inv != null) lv.push({ p: inv, t: '作廢', cls: 'amber' });
  if (isNum(row.dl)) lv.push({ p: row.dl, t: '防守', cls: 'amber', dot: true });
  if (x && isNum(x.h.avg) && !settings.privacy) lv.push({ p: x.h.avg, t: '成本', cls: 'aurora' });
  const W = 360, Ht = 230, pl = 6, pr = 76, pt = 12, pb = 22;
  const vals = [...C, ...Hh, ...Lo, ...M20, ...M60, ...M120].filter(isNum);
  const last = C[C.length - 1];
  lv.forEach((z) => { if (Math.abs(z.p / last - 1) < 0.25) vals.push(z.p); });
  let mn = Math.min(...vals), mx = Math.max(...vals);
  const padY = (mx - mn) * 0.06 || last * 0.01;
  mn -= padY; mx += padY;
  const X = (i) => pl + (i / Math.max(1, C.length - 1)) * (W - pl - pr);
  const Y = (v) => pt + (1 - (v - mn) / (mx - mn)) * (Ht - pt - pb);
  const path = (arr) => { let d = '', pen = false; arr.forEach((v, i) => { if (!isNum(v)) { pen = false; return; } d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); pen = true; }); return d; };
  const step = niceStep((mx - mn) / 4);
  const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  const fa = (v) => v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  let grid = '';
  for (let g = Math.ceil(mn / step) * step; g <= mx; g += step) {
    grid += `<line x1="${pl}" x2="${W - pr}" y1="${Y(g).toFixed(1)}" y2="${Y(g).toFixed(1)}"/><text x="${W - 4}" y="${(Y(g) + 3).toFixed(1)}" text-anchor="end" class="ax">${fa(g)}</text>`;
  }
  let xlab = '';
  let lastM = null;
  D.forEach((d, i) => {
    const m = Math.floor(d / 100) % 100;
    if (m !== lastM && i > 2 && i < D.length - 3) xlab += `<text x="${X(i).toFixed(1)}" y="${Ht - 6}" text-anchor="middle" class="ax">${m}月</text>`;
    lastM = m;
  });
  const vis = lv.filter((z) => z.p >= mn && z.p <= mx).sort((a, b) => b.p - a.p);
  let prevY = -1e9;
  vis.forEach((z) => { z.ly = Math.max(Y(z.p), prevY + 15); prevY = z.ly; });
  const over = vis.length ? vis[vis.length - 1].ly - (Ht - pb - 6) : 0;
  if (over > 0) vis.forEach((z) => { z.ly -= over; });
  vis.forEach((z) => { z.ly = Math.max(pt + 6, z.ly); });
  const fl2 = (v) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const lvls = vis.map((z) => `<line x1="${pl}" x2="${W - pr}" y1="${Y(z.p).toFixed(1)}" y2="${Y(z.p).toFixed(1)}" stroke="var(--${z.cls})" stroke-width="${z.cls === 'glacier' ? 1.1 : 1.5}" stroke-dasharray="${z.dot ? '1.5 3' : '4 3'}" stroke-linecap="round" opacity=".95"/><rect x="${W - pr + 2}" y="${(z.ly - 7.5).toFixed(1)}" width="${pr - 2}" height="15" rx="3" fill="var(--hull)"/><text class="lvl-lab" x="${W - 3}" y="${(z.ly + 3.5).toFixed(1)}" text-anchor="end" fill="var(--${z.cls})">${z.t} ${fl2(z.p)}</text>`).join('');
  const area = path(C) + `L${X(C.length - 1).toFixed(1)} ${Ht - pb}L${X(0).toFixed(1)} ${Ht - pb}Z`;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${Ht}" role="img" aria-label="近 ${C.length} 個交易日收盤價與均線">
    <defs><linearGradient id="ga" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--frost)" stop-opacity=".10"/><stop offset="1" stop-color="var(--frost)" stop-opacity="0"/></linearGradient></defs>
    <g class="grid">${grid}</g><g>${xlab}</g>
    <path d="${area}" fill="url(#ga)"/>
    <path d="${path(M120)}" fill="none" stroke="var(--ma120)" stroke-width="1.4" opacity=".9"/>
    <path d="${path(M60)}" fill="none" stroke="var(--ma60)" stroke-width="1.5"/>
    <path d="${path(M20)}" fill="none" stroke="var(--ma20)" stroke-width="1.4"/>
    <path d="${path(C)}" fill="none" stroke="var(--frost)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${lvls}
    <circle cx="${X(C.length - 1).toFixed(1)}" cy="${Y(last).toFixed(1)}" r="4" fill="var(--frost)" stroke="var(--hull)" stroke-width="2"/>
    <g id="xh" opacity="0"><line id="xhl" y1="${pt}" y2="${Ht - pb}" stroke="var(--frost-3)" stroke-width="1"/><circle id="xhc" r="4.5" fill="var(--frost)" stroke="var(--hull)" stroke-width="2"/></g>
    <rect x="${pl}" y="${pt}" width="${W - pl - pr}" height="${Ht - pt - pb}" fill="transparent" id="hit"/>
  </svg><div class="tip" id="tip" hidden></div>`;
  const svg = $('svg', el), tip = $('#tip', el), xh = $('#xh', el);
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) * (W / r.width);
    const i = clamp(Math.round(((px - pl) / (W - pl - pr)) * (C.length - 1)), 0, C.length - 1);
    if (!isNum(C[i])) return;
    xh.setAttribute('opacity', 1);
    $('#xhl', el).setAttribute('x1', X(i)); $('#xhl', el).setAttribute('x2', X(i));
    $('#xhc', el).setAttribute('cx', X(i)); $('#xhc', el).setAttribute('cy', Y(C[i]));
    tip.hidden = false;
    tip.innerHTML = `<div class="d num">${fmt.dy(D[i])}</div><div class="row"><span>收盤</span><b class="num">${fmt.px(C[i])}</b></div><div class="row"><span>月線</span><span class="num">${fmt.px(M20[i])}</span></div><div class="row"><span>季線</span><span class="num">${fmt.px(M60[i])}</span></div><div class="row"><span>半年線</span><span class="num">${fmt.px(M120[i])}</span></div>`;
    const left = (X(i) / W) * r.width;
    tip.style.left = clamp(left + 12, 4, r.width - tip.offsetWidth - 4) + 'px';
    tip.style.top = '8px';
  };
  const leave = () => { xh.setAttribute('opacity', 0); tip.hidden = true; };
  const hit = $('#hit', el);
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', leave);
  hit.addEventListener('touchmove', move, { passive: true });
  hit.addEventListener('touchend', () => setTimeout(leave, 1200));
}
