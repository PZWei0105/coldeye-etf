/* 冷眼 — 副官（PZ 的投資小秘書）的畫面：
   副官分頁（待辦、我的戰績、部位巡檢、本週復盤、決策日記）、記下想法＋副官檢查、冷靜期、
   帶去問 Claude（打包、分享、複製）、日記詳情（貼回 Claude 的結論、設到價提醒、復盤）、首頁卡片、單檔頁入口。
   計算都在 aide.js；這裡只負責畫面與儲存。日記只存在這支手機（coldeye.journal）。 */
import {
  $, $$, esc, isNum, clamp, S, PF, settings, saveSettings, book, isPaper, store, journal, saveJournal, alerts, saveAlerts, newId,
  fmt, money, sharesOf, dirCls, catName, ICON, quote, ensureHist, ensureDetail, ensureTrack, heldOf, adviceFor, today, twParts,
  toast, bus, taiexNow,
} from './core.js';
import { openModal, closeModal } from './forms.js';
import * as A from './aide.js';
import * as FX from './fx.js';
import { benchValue } from './calc.js';

const STI = { bull: ICON.up, bear: ICON.down, wait: ICON.flat, swap: ICON.swap };
const nameOf = (c) => (S.rows.get(c) || {}).n || c;
const pad = (n) => String(n).padStart(2, '0');
const pctS = (x, d = 1) => (isNum(x) ? `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(d)}%` : '—');
const pctU = (x, d = 0) => (isNum(x) ? `${(x * 100).toFixed(d)}%` : '—');
const twDay = (iso) => PF.twToday(Date.parse(iso) || Date.now());
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' }) : '');
const openDetailLazy = (code) => import('./sheet.js').then((m) => m.openDetail(code));

// ------------------------------------------------------------------ 小元件
/** 副官的核心：六角形瞳孔＋兩圈會轉的刻度環（think：檢查中轉快） */
export function coreSVG(cls = '') {
  const C = 60;
  const ticks = Array.from({ length: 48 }, (_, k) => {
    const a = (k / 48) * Math.PI * 2;
    const r1 = k % 4 === 0 ? 47 : 50, r2 = 53;
    return `<line x1="${(C + r1 * Math.cos(a)).toFixed(1)}" y1="${(C + r1 * Math.sin(a)).toFixed(1)}" x2="${(C + r2 * Math.cos(a)).toFixed(1)}" y2="${(C + r2 * Math.sin(a)).toFixed(1)}"/>`;
  }).join('');
  const hex = (r) => Array.from({ length: 6 }, (_, k) => { const a = -Math.PI / 2 + k * Math.PI / 3; return `${(C + r * Math.cos(a)).toFixed(1)},${(C + r * Math.sin(a)).toFixed(1)}`; }).join(' ');
  return `<svg class="core ${cls}" viewBox="0 0 120 120" aria-hidden="true">
    <circle class="c-glow" cx="${C}" cy="${C}" r="58"/>
    <g class="c-r1">${ticks}</g>
    <g class="c-r2"><circle cx="${C}" cy="${C}" r="41" pathLength="120"/></g>
    <polygon class="c-hex" points="${hex(29)}"/>
    <polygon class="c-hex2" points="${hex(22)}"/>
    <circle class="c-iris" cx="${C}" cy="${C}" r="11"/>
    <circle class="c-pupil" cx="${C}" cy="${C}" r="4.2"/>
  </svg>`;
}
export function stanceTag(st) {
  if (!A.STANCE[st]) return '';
  return `<span class="jt-st st-${st}">${STI[st]}${A.STANCE[st].s}</span>`;
}
function pips(c) {
  if (!c) return '';
  return `<span class="pips" role="img" aria-label="信心 ${c}／5">${[1, 2, 3, 4, 5].map((k) => `<i class="${k <= c ? 'on' : ''}"></i>`).join('')}</span>`;
}
function srcTag(e) {
  if (e.src === 'trade') return `<span class="jt-src ${e.book === 'paper' ? 'paper' : 'real'}">${e.book === 'paper' ? '模擬交易' : '交易'}</span>`;
  return '<span class="jt-src idea">想法</span>';
}
function marketNow() {
  const t = taiexNow();
  if (!t) return null;
  return { px: t.px, pc: t.pc, ma60: t.ma60, insti: t.insti, br: S.breadth };
}
const statsOf = (row) => (S.track && S.track.pos && row ? S.track.pos[row.k] || null : null);
function rankOf(row) {
  if (!row || !isNum(row.aum) || !S.summary) return null;
  const xs = S.summary.etfs.map((r) => r.aum).filter(isNum);
  return xs.length ? xs.filter((x) => x < row.aum).length / xs.length : null;
}
function holdInfo(code) {
  const x = heldOf(code);
  if (!x || !(x.h.sh > 0)) return null;
  return { sh: x.h.sh, avg: x.h.avg, cost: x.h.cost, w: x.w, pnlPct: x.pct, mv: x.mv, cap: PF.capOf(settings.risk, x.cat) };
}
function snapOf(row) {
  const q = quote(row);
  return {
    n: row.n, k: row.k, d: q.date || row.d, px: q.px, live: !!q.live, t: q.live ? q.time || null : null,
    st: row.st ?? null, ps: row.ps || null, sc: row.sc ?? null, cf: row.cf ?? null, prem: isNum(q.prem) ? q.prem : null, dl: row.dl ?? null, pc: isNum(q.pc) ? q.pc : null,
  };
}
const bookName = () => (isPaper() ? '模擬倉' : '真實部位');
function whenText() {
  const { y, m, day, h, min } = twParts();
  const L = S.live;
  const live = L && L.open && L.date === today();
  return `${y}/${pad(m)}/${pad(day)} ${pad(h)}:${pad(min)}；價格是${live ? `盤中 ${hhmm(L.at)}` : `${fmt.d(S.summary.asof)} 收盤`}`;
}

// ------------------------------------------------------------------ 決策日記：讀寫
const byId = (id) => journal.items.find((e) => e.id === id) || null;
function addEntry(e) {
  journal.items.push(e);
  if (journal.items.length > 2000) journal.items.splice(0, journal.items.length - 2000);
  const ok = saveJournal();
  bus.emit('journal');
  return ok;
}
function updEntry(e) { saveJournal(); bus.emit('journal'); return e; }
/** 交易存檔後由 forms.js 發出：自動記一筆「實際的決定」（只記今天的交易，價格是成交價） */
export function onTrade({ lot, tags = [], paper = false }) {
  if (!settings.autoJ || !lot) return;
  const row = S.rows.get(lot.c);
  if (!row) return;
  if (!paper && lot.d !== today()) return;
  const snap = { ...snapOf(row), px: lot.px, d: lot.d || today(), live: false, t: null };
  addEntry({
    id: newId(), at: lot.at || new Date().toISOString(), src: 'trade', book: paper ? 'paper' : 'real', lot: lot.id, c: lot.c,
    stance: lot.side === 'sell' ? 'bear' : 'bull', conf: null, tags: tags.slice(0, 6), text: lot.note || '', snap,
  });
}
/** 交易被刪掉（真實部位刪除、模擬倉撤銷）：日記裡那一筆也拿掉；交易被修改：跟著改價格與方向 */
export function onLotDel({ id }) {
  const k = journal.items.findIndex((e) => e.src === 'trade' && e.lot === id);
  if (k >= 0) { journal.items.splice(k, 1); saveJournal(); bus.emit('journal'); }
}
export function onLotEdit({ lot }) {
  const e = journal.items.find((x) => x.src === 'trade' && x.lot === lot.id);
  if (!e) return;
  e.stance = lot.side === 'sell' ? 'bear' : 'bull';
  e.c = lot.c;
  if (e.snap && lot.px > 0) { e.snap.px = lot.px; if (lot.d) e.snap.d = lot.d; }
  e.text = lot.note || e.text;
  delete e.res;
  saveJournal();
  bus.emit('journal');
}

// ------------------------------------------------------------------ 對答案（到期的去抓歷史資料計算，算完存起來）
let evalBusy = false;
export async function refreshEvals() {
  if (evalBusy || !S.summary) return;
  evalBusy = true;
  try {
    await ensureTrack();
    const td = today();
    const due = journal.items.filter((e) => !(e.res && (e.res.state === 'done' || e.res.state === 'na')) && e.snap && e.snap.d && A.weekdaysBetween(e.snap.d, td) >= A.HORIZON);
    if (!due.length) return;
    const codes = [...new Set(due.flatMap((e) => [e.c, e.c2].filter(Boolean)))];
    const hs = {};
    for (const c of codes) hs[c] = await ensureHist(c);
    let changed = false;
    for (const e of due) {
      const h = hs[e.c];
      if (!h) {
        // 歷史檔抓不到：這檔可能已經下市；過了很久還是抓不到才標示，不然只是網路問題
        if (S.rows.get(e.c) == null && A.weekdaysBetween(e.snap.d, td) > A.AIDE.naDays) { e.res = { state: 'na', why: '這檔已經不在冷眼的資料裡（可能下市了）' }; changed = true; }
        continue;
      }
      const r = A.evalEntry(e, h, e.c2 ? hs[e.c2] : null);
      if (r.state === 'done') {
        const cs = S.track && S.track.by_cat && S.track.by_cat[e.snap.k];
        r.bu = cs ? cs.base_up : null;
        r.ba = cs ? cs.base_avg : null;
        if (e.c2 && hs[e.c2]) { const pb = A.pairBase(h, hs[e.c2]); if (pb) { r.pb = pb.up; r.pa = pb.avg; } }
        r.at = new Date().toISOString();
        e.res = r;
        changed = true;
      } else if (r.state === 'na' || A.weekdaysBetween(e.snap.d, td) > A.AIDE.naDays) {
        e.res = { state: 'na', why: r.why || '超過兩個月還沒有新的成交價格' };
        changed = true;
      }
    }
    if (changed) { saveJournal(); bus.emit('journal'); }
  } finally {
    evalBusy = false;
  }
}
/** 還沒到期的進度與到目前為止的報酬 */
function progressOf(e) {
  const td = today();
  const n = clamp(A.weekdaysBetween(e.snap.d, td), 0, A.HORIZON);
  const r1 = S.rows.get(e.c);
  const dv = (c) => (S.divs && S.divs[c]) || { d: [], s: [] };
  let ret = null, ret2 = null;
  if (r1) { const q = quote(r1); ret = A.interimRet(e.snap, q.px, q.date || td, dv(e.c).d, dv(e.c).s); }
  if (e.c2 && e.snap2) { const r2 = S.rows.get(e.c2); if (r2) { const q2 = quote(r2); ret2 = A.interimRet(e.snap2, q2.px, q2.date || td, dv(e.c2).d, dv(e.c2).s); } }
  return { n, ret, ret2, due: A.addWeekdays(e.snap.d, A.HORIZON) };
}
const coolDue = (e) => e.cool && !e.cool.res && today() >= e.cool.due;
const matured = (e) => e.res && e.res.state === 'done' && !e.seen;
const awaitingPaste = (e) => e.asked && !e.after && !(e.res && e.res.state === 'done') && A.weekdaysBetween(twDay(e.asked), today()) <= 3;
/** 需要 PZ 處理的：冷靜期到了、對完答案還沒看 */
export function aidePending() {
  return {
    cool: journal.items.filter(coolDue),
    done: journal.items.filter(matured),
    paste: journal.items.filter(awaitingPaste),
  };
}
export function aideBadge() { const p = aidePending(); return p.cool.length + p.done.length; }
/** 開機語音播報用的一句話 */
export function aideSpeech() {
  const p = aidePending();
  const out = [];
  if (p.cool.length) out.push(`有 ${p.cool.length} 個放進冷靜期的想法，要再確認一次。`);
  if (p.done.length) out.push(`有 ${p.done.length} 筆決定到了對答案的日子。`);
  return out.length ? `副官提醒：${out.join('')}` : '';
}

// ------------------------------------------------------------------ 結果的顯示
function statusHTML(e) {
  if (e.res && e.res.state === 'na') return `<span class="js-na">無法對答案</span>`;
  if (e.res && e.res.state === 'done') {
    const st = A.finalStance(e);
    const hit = A.hitOf(st, e.res);
    const r = st === 'swap' && isNum(e.res.ret2) ? e.res.ret2 - e.res.ret : e.res.ret;
    const lab = A.nonView(e) ? '<b class="muted">不計分</b>' : hit == null ? '<b class="muted">觀望</b>' : hit ? '<b class="good">對了</b>' : '<b class="bad">錯了</b>';
    return `<span class="lab2">${lab}${!e.seen ? '<i class="new-dot" aria-label="新結果"></i>' : ''}</span><small class="num ${dirCls(r)}">${st === 'swap' ? '差 ' : ''}${pctS(r)}</small>`;
  }
  const p = progressOf(e);
  const r = e.c2 && isNum(p.ret2) && isNum(p.ret) ? p.ret2 - p.ret : p.ret;
  return `<span class="jr-prog" role="img" aria-label="大約第 ${p.n} 個交易日"><i style="width:${(p.n / A.HORIZON * 100).toFixed(0)}%"></i></span><small class="num"><span class="muted">${p.n}/${A.HORIZON}</span> <span class="${dirCls(r)}">${pctS(r)}</span></small>`;
}
function rowHTML(e) {
  const flags = [];
  if (coolDue(e)) flags.push('<span class="chip act alert">冷靜期到了</span>');
  else if (e.cool && !e.cool.res) flags.push('<span class="chip act info">冷靜期</span>');
  if (awaitingPaste(e)) flags.push('<span class="chip act go2">等貼回結論</span>');
  return `<button class="jr" data-j="${esc(e.id)}">
    <span class="jr-d num">${fmt.d(twDay(e.at))}</span>
    <span class="jr-m">
      <span class="jr-l1"><b>${esc(e.snap ? e.snap.n || nameOf(e.c) : nameOf(e.c))}</b>${e.c2 ? `<span class="muted">→</span><b>${esc(e.snap2 ? e.snap2.n : nameOf(e.c2))}</b>` : ''}</span>
      <span class="jr-l2">${stanceTag(A.finalStance(e))}${srcTag(e)}${pips(e.conf)}${flags.join('')}</span>
    </span>
    <span class="jr-s">${statusHTML(e)}</span>
  </button>`;
}
function filtered() {
  const f = settings.jf || 'all';
  return journal.items.filter((e) => (f === 'all' ? true : f === 'idea' ? e.src !== 'trade' : e.src === 'trade'));
}

// ================================================================== 副官分頁
export function renderAide(v) {
  const p = aidePending();
  const items = filtered().slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const showAll = S.jAll;
  const list = showAll ? items : items.slice(0, 15);
  const P = S.P;
  const audit = P && P.totals.T > 0 && P.holdings.length ? A.auditPf(P, settings.risk, today(), PF.stressToStops(P.holdings, { T: P.totals.T })) : [];
  v.innerHTML = `<div class="aide">
    <div class="col a1">
      ${heroHTML()}
      ${pendingHTML(p)}
      ${auditHTML(audit)}
      ${weekHTML()}
    </div>
    <div class="col a2">
      ${statsHTML()}
      <div class="sec-h"><h2>決策日記</h2><span class="aside">${items.length} 筆</span></div>
      ${items.length ? `<section class="panel list jlist">${list.map(rowHTML).join('')}${items.length > list.length ? `<button class="more" id="j-more">顯示全部 ${items.length} 筆</button>` : ''}</section>`
        : `<section class="panel pad calm"><b>日記還是空的。</b><span class="muted">按上面的「我有想法」記下第一個想法${settings.autoJ ? '；之後在冷眼記的每一筆今天的交易（含模擬倉）也會自動記進來' : ''}。每一筆都會在 ${A.HORIZON} 個交易日後自動對答案。</span></section>`}
    </div>
  </div>`;
  bindAide(v);
}
function heroHTML() {
  const { h } = twParts();
  const word = h >= 5 && h < 11 ? '早安' : h >= 11 && h < 18 ? '午安' : '晚安';
  return `<section class="aide-hero" aria-label="副官">
    <div class="ah-core">${coreSVG('idle')}</div>
    <div class="ah-txt">
      <div class="ah-k">冷眼副官・你的投資小秘書</div>
      <h1 class="ah-h">${esc(settings.name || 'PZ')}，${word}。有什麼想法？</h1>
      <p class="ah-s">說出你的想法，副官用固定規則幫你檢查、幫你記下來，${A.HORIZON} 個交易日後自動對答案。想深入討論，一鍵帶去問 Claude。</p>
    </div>
    <div class="ah-quick" role="group" aria-label="快速開始">${Object.entries(A.STANCE).map(([k, s]) => `<button class="qk st-${k}" data-quick="${k}">${STI[k]}<span>${s.t}</span></button>`).join('')}</div>
    <div class="row-btns ah-btns"><button class="btn primary" id="a-idea">${ICON.aide}我有想法</button><button class="btn ghost" id="a-ask">${ICON.comms}問 Claude 今天的市場</button></div>
  </section>`;
}
function pendingHTML(p) {
  const rows = [];
  for (const e of p.cool) rows.push({ e, chip: '<span class="chip act alert">冷靜期到了</span>', t: `你想「${A.STANCE[e.stance].t}」${esc(nameOf(e.c))}${e.c2 ? ` → ${esc(nameOf(e.c2))}` : ''}。冷靜一晚之後，還是這麼想嗎？` });
  for (const e of p.done) {
    const st = A.finalStance(e);
    const hit = A.hitOf(st, e.res);
    rows.push({ e, chip: '<span class="chip act go">對答案了</span>', t: `${esc(nameOf(e.c))}（${fmt.d(twDay(e.at))}「${A.STANCE[st].t}」）${A.nonView(e) || hit == null ? '的結果出來了' : '：點開揭曉'}` });
  }
  for (const e of p.paste) rows.push({ e, chip: '<span class="chip act go2">等貼回結論</span>', t: `和 Claude 討論完 ${esc(nameOf(e.c))} 了嗎？把【冷眼結論】貼回來，${A.HORIZON} 個交易日後一起對答案。` });
  if (!rows.length) return '';
  return `<div class="sec-h"><h2>副官待辦</h2><span class="aside">${rows.length} 件</span></div>
    <section class="panel list acts">${rows.map((r) => `<button class="act-row" data-j="${esc(r.e.id)}"><span class="a-chip">${r.chip}</span><span class="a-body"><span>${r.t}</span></span><span class="chev">${ICON.chev}</span></button>`).join('')}</section>`;
}
function checksListHTML(items, anim = false) {
  const IC = { ok: ICON.ok, info: ICON.dot, warn: ICON.bang, stop: ICON.no };
  return `<ul class="ck-list${anim ? ' anim' : ''}">${items.map((i, k) => `<li class="ck ${i.lvl}" style="--i:${k}"><span class="ic">${IC[i.lvl]}</span><span>${esc(i.t)}</span></li>`).join('')}</ul>`;
}
function auditHTML(items) {
  if (!items.length) return '';
  const w = items.filter((i) => i.lvl === 'warn' || i.lvl === 'stop').length;
  return `<div class="sec-h"><h2>部位巡檢</h2><span class="aside">${bookName()}・${w ? `${w} 項要注意` : '沒有紅旗'}</span></div>
    <section class="panel pad audit">${checksListHTML(items)}<div class="row-btns"><button class="btn small ghost" id="a-ask-pf">${ICON.comms}帶配置去問 Claude</button></div></section>`;
}
function weekInfo() {
  const td = today();
  const { wd } = twParts();
  const from = PF.addDays(td, -(wd === 0 ? 6 : wd - 1));
  const made = journal.items.filter((e) => twDay(e.at) >= from);
  const done = journal.items.filter((e) => e.res && e.res.state === 'done' && e.res.at && twDay(e.res.at) >= from);
  const pending = journal.items.filter((e) => !e.res).length;
  const cool = journal.items.filter((e) => e.cool && !e.cool.res).length;
  return { from, made, done, pending, cool };
}
function weekHTML() {
  const w = weekInfo();
  if (!w.made.length && !w.done.length && !w.pending) return '';
  const hits = w.done.filter((e) => A.hitOf(A.finalStance(e), e.res) === true && !A.nonView(e)).length;
  const scorable = w.done.filter((e) => A.hitOf(A.finalStance(e), e.res) != null && !A.nonView(e)).length;
  const emo = w.made.filter((e) => (e.tags || []).some((t) => A.EMO_TAGS.includes(t))).length;
  const lines = [
    `這週記了 <b class="num">${w.made.length}</b> 筆決定${w.made.length ? `（想法 ${w.made.filter((e) => e.src !== 'trade').length}、交易 ${w.made.filter((e) => e.src === 'trade').length}）` : ''}${emo ? `，其中 <b class="num">${emo}</b> 筆的理由偏情緒` : ''}。`,
    w.done.length ? `對完答案 <b class="num">${w.done.length}</b> 筆${scorable ? `：對 <b class="num">${hits}</b>／${scorable}` : ''}。` : '這週沒有到期的決定。',
    `還在等對答案 <b class="num">${w.pending}</b> 筆${w.cool ? `；冷靜期待確認 <b class="num">${w.cool}</b> 筆` : ''}。`,
  ];
  return `<div class="sec-h"><h2>本週復盤</h2><span class="aside num">${fmt.d(w.from)} 起</span></div>
    <section class="panel pad week"><ul class="wk">${lines.map((l) => `<li>${l}</li>`).join('')}</ul>
      <div class="row-btns">${FX.hasVoice() ? `<button class="btn small ghost" id="a-wk-say">${ICON.speaker}念給我聽</button>` : ''}<button class="btn small ghost" id="a-ask-wk">${ICON.comms}帶這週去問 Claude</button></div></section>`;
}
function weekSpeech() {
  const w = weekInfo();
  const hits = w.done.filter((e) => A.hitOf(A.finalStance(e), e.res) === true && !A.nonView(e)).length;
  const scorable = w.done.filter((e) => A.hitOf(A.finalStance(e), e.res) != null && !A.nonView(e)).length;
  const s = A.journalStats(journal.items);
  return `本週復盤。這週記了 ${w.made.length} 筆決定。${w.done.length ? `對完答案 ${w.done.length} 筆${scorable ? `，對了 ${hits} 筆` : ''}。` : '這週沒有到期的決定。'}還在等對答案的有 ${w.pending} 筆。${s.all.n ? `累積命中率 ${Math.round(s.all.rate * 100)}%，同類任何一天大約 ${Math.round(s.all.base * 100)}%。` : ''}`;
}
function vsBar(label, rate, base, n) {
  const w = (x) => clamp((x || 0) * 100, 0, 100).toFixed(1);
  return `<div class="vs2" role="img" aria-label="${esc(label)} ${pctU(rate)}，基準 ${pctU(base)}">
    <div class="vs2-r me"><span>${esc(label)}</span><span class="vs2-t"><i style="width:${w(rate)}%"></i></span><b class="num">${pctU(rate)}</b></div>
    <div class="vs2-r base"><span data-term="base">同類任何一天</span><span class="vs2-t"><i style="width:${w(base)}%"></i></span><b class="num">${pctU(base)}</b></div>
    ${n != null ? `<div class="vs2-n">${n} 次</div>` : ''}</div>`;
}
function statsHTML() {
  const items = filtered();
  const s = A.journalStats(items);
  const f = settings.jf || 'all';
  const seg = `<div class="seg mini" role="tablist" aria-label="篩選">${[['all', '全部'], ['idea', '想法'], ['trade', '交易']].map(([k, t]) => `<button data-jf="${k}" aria-pressed="${f === k}">${t}</button>`).join('')}</div>`;
  const head = `<div class="sec-h"><h2>我的戰績</h2>${seg}</div>`;
  const waiting = items.filter((e) => !e.res).length;
  if (!s.all.n) {
    return `${head}<section class="panel pad jstats empty-st">
      <div class="es-n"><b class="num">${items.length}</b><span>筆決定</span></div><div class="es-n"><b class="num">${waiting}</b><span>等對答案</span></div><div class="es-n"><b class="num">${s.done}</b><span>已對答案</span></div>
      <p class="small muted">每一筆決定在 ${A.HORIZON} 個交易日後自動對答案，和「同類 ETF 任何一天照同樣方向做」比。累積 ${A.AIDE.minN} 筆以上，就看得出你的判斷是真的有料，還是剛好遇到大多頭。</p></section>`;
  }
  const a = s.all;
  const d = a.rate - a.base;
  const cls = d >= 0.02 ? 'good' : d > -0.02 ? 'meh' : 'bad';
  const rows = [];
  const r = (k, v) => rows.push(`<div class="js-row"><span>${k}</span><b>${v}</b></div>`);
  // 每一列都和同類任何一天的基準並列（依那幾筆決定的類別與方向加權）
  const hr = (g) => (g.n ? `${g.hits}／${g.n} 對（${pctU(g.rate)}）<small class="muted">同類任何一天 ${pctU(g.base)}</small>` : '—');
  if (s.vsRule.same.n) r('跟冷眼規則同方向', hr(s.vsRule.same));
  if (s.vsRule.opp.n) r('跟冷眼規則唱反調', `${s.vsRule.opp.n} 次：你對 ${s.vsRule.opp.hits}、規則對 ${s.vsRule.opp.ruleHits}<small class="muted">你的方向，同類任何一天 ${pctU(s.vsRule.opp.base)}</small>`);
  if (s.vsRule.neu.n) r('冷眼規則中性的時候', hr(s.vsRule.neu));
  if (s.byConf.hi.n) r('很有把握（信心 4～5）', hr(s.byConf.hi));
  if (s.byConf.lo.n) r('沒那麼有把握（1～3）', hr(s.byConf.lo));
  if (isNum(a.edge)) r('依你的方向，20 日平均報酬', `<span class="num ${dirCls(a.edge)}">${pctS(a.edge, 2)}</span><small class="muted">同類任何一天 ${pctS(a.bedge, 2)}</small>`);
  if (s.cooled.n) r('冷靜一晚後改變主意', `${s.cooled.n} 次：原本的想法對 ${s.cooled.origRight} 次`);
  if (s.disc.n) r('和 Claude 討論後改變主意', `${s.disc.n} 次：討論前對 ${s.disc.beforeRight}、討論後對 ${s.disc.afterRight}`);
  if (s.waited.n) r(`選擇觀望（${s.waited.n} 次）之後 20 日平均`, `<span class="num ${dirCls(s.waited.avg)}">${pctS(s.waited.avg, 2)}</span><small class="muted">同類任何一天 ${pctS(s.waited.base, 2)}</small>`);
  const tags = Object.entries(s.byTag).filter(([, g]) => g.n >= 3).sort((x, y) => y[1].n - x[1].n);
  return `${head}<section class="panel jstats">
    <div class="js-top"><div class="js-big"><span>你的命中率</span><b class="num">${pctU(a.rate)}</b><small>${a.hits}／${a.n} 次</small></div>
      ${vsBar('你', a.rate, a.base, null)}</div>
    <p class="js-verdict">比同類任何一天照同樣方向做 <b class="${cls}">${d >= 0 ? '高' : '低'} ${Math.abs(d * 100).toFixed(1)} 個百分點</b>。${s.enough ? '' : `樣本還少（不到 ${A.AIDE.minN} 筆），先看看就好。`}</p>
    ${rows.length ? `<div class="js-rows">${rows.join('')}</div>` : ''}
    ${tags.length ? `<div class="js-tags"><span class="small muted">各種理由的命中率（3 次以上）</span><div class="chips">${tags.map(([k, g]) => `<span class="chip ghost" title="${g.n} 次，同類任何一天 ${pctU(g.base)}">${esc(A.TAGS[k])} <b class="num">${pctU(g.rate)}</b><small class="num">／基準 ${pctU(g.base)}・${g.n} 次</small></span>`).join('')}</div></div>` : ''}
    <p class="disclaim">只算已經對答案、而且是在猜漲跌的決定；理由是「長期紀律、調整比重、要用錢」的照樣對答案，但不算命中率。基準依你每筆決定的類別加權。</p>
  </section>`;
}
function bindAide(v) {
  $('#a-idea', v).addEventListener('click', () => openIdea({}));
  $('#a-ask', v).addEventListener('click', () => openAsk('market'));
  $$('[data-quick]', v).forEach((b) => b.addEventListener('click', () => openIdea({ stance: b.dataset.quick })));
  $$('[data-j]', v).forEach((b) => b.addEventListener('click', () => openEntry(b.dataset.j)));
  $$('[data-jf]', v).forEach((b) => b.addEventListener('click', () => { settings.jf = b.dataset.jf; saveSettings(); renderAide(v); }));
  const more = $('#j-more', v);
  if (more) more.addEventListener('click', () => { S.jAll = true; renderAide(v); });
  const apf = $('#a-ask-pf', v);
  if (apf) apf.addEventListener('click', () => openAsk('pf'));
  const awk = $('#a-ask-wk', v);
  if (awk) awk.addEventListener('click', () => openAsk('week'));
  const say = $('#a-wk-say', v);
  if (say) say.addEventListener('click', () => { FX.sfx('comms'); if (!FX.speak(weekSpeech(), { force: true })) toast('這個瀏覽器不支援語音播報'); });
}

// ================================================================== 首頁卡片、單檔頁入口
export function aideHomeHTML() {
  const p = aidePending();
  const n = p.cool.length + p.done.length + p.paste.length;
  const s = A.journalStats(journal.items);
  const waiting = journal.items.filter((e) => !e.res).length;
  let body;
  if (n) {
    const lines = [];
    if (p.cool.length) lines.push(`<li data-j="${esc(p.cool[0].id)}"><span class="chip act alert">冷靜期到了</span><span>${esc(nameOf(p.cool[0].c))}：「${A.STANCE[p.cool[0].stance].t}」還是這麼想嗎？</span></li>`);
    if (p.done.length) lines.push(`<li data-j="${esc(p.done[0].id)}"><span class="chip act go">對答案了</span><span>${p.done.length} 筆決定的結果出來了，點開揭曉。</span></li>`);
    if (p.paste.length) lines.push(`<li data-j="${esc(p.paste[0].id)}"><span class="chip act go2">等貼回結論</span><span>和 Claude 討論完 ${esc(nameOf(p.paste[0].c))}，把結論貼回來。</span></li>`);
    body = `<ul class="ac-list">${lines.join('')}</ul>`;
  } else if (s.all.n) {
    body = `<p class="ac-calm">你的決定已經對答案 <b class="num">${s.all.n}</b> 筆：命中 <b class="num">${pctU(s.all.rate)}</b>，<span data-term="base">同類任何一天</span>約 <b class="num">${pctU(s.all.base)}</b>。${waiting ? `還有 ${waiting} 筆在等。` : ''}</p>`;
  } else if (journal.items.length) {
    body = `<p class="ac-calm">已經記了 <b class="num">${journal.items.length}</b> 筆決定，最早一筆約 ${fmt.d(A.addWeekdays(journal.items.reduce((m, e) => Math.min(m, e.snap ? e.snap.d : 99999999), 99999999), A.HORIZON))} 對答案。</p>`;
  } else {
    body = '<p class="ac-calm">看完資料有想法？說給副官聽：用規則幫你檢查、記下來、一個月後自動對答案；想討論就帶去問 Claude。</p>';
  }
  return `<section class="panel aide-card${n ? ' has' : ''}" aria-label="副官">
    <div class="ac-h"><span class="ac-core">${coreSVG('mini')}</span><b>副官</b><span class="muted small">你的投資小秘書</span>${n ? `<span class="badge num">${n}</span>` : ''}</div>
    ${body}
    <div class="row-btns"><button class="btn primary small" data-aide="idea">${ICON.aide}我有想法</button><button class="btn ghost small" data-aide="ask">${ICON.comms}問 Claude 今天的市場</button></div>
  </section>`;
}
export function bindAideHome(root, go) {
  $$('[data-aide="idea"]', root).forEach((b) => b.addEventListener('click', () => openIdea({})));
  $$('[data-aide="ask"]', root).forEach((b) => b.addEventListener('click', () => openAsk('market')));
  $$('.aide-card [data-j]', root).forEach((b) => b.addEventListener('click', () => openEntry(b.dataset.j)));
  $$('.aide-card .ac-h', root).forEach((b) => b.addEventListener('click', () => go && go('aide')));
}
export function aideDetailHTML(code) {
  const mine = journal.items.filter((e) => e.c === code || e.c2 === code).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return `<section class="panel aide-strip" aria-label="副官">
    <div class="as-h"><span class="ac-core">${coreSVG('mini')}</span><div><b>對這檔有想法？</b><span class="small muted">副官用規則幫你檢查、記下來；也可以帶這檔的資料去問 Claude。</span></div></div>
    <div class="row-btns"><button class="btn small primary" id="as-idea">${ICON.aide}我有想法</button><button class="btn small ghost" id="as-ask">${ICON.comms}帶去問 Claude</button></div>
    ${mine.length ? `<div class="list as-list">${mine.slice(0, 4).map(rowHTML).join('')}</div>${mine.length > 4 ? `<p class="small muted">還有 ${mine.length - 4} 筆在「副官」分頁。</p>` : ''}` : ''}
  </section>`;
}
export function bindAideDetail(root, code) {
  const a = $('#as-idea', root);
  if (a) a.addEventListener('click', () => openIdea({ code }));
  const b = $('#as-ask', root);
  if (b) b.addEventListener('click', () => openAsk('etf', { code }));
  $$('.aide-strip [data-j]', root).forEach((x) => x.addEventListener('click', () => openEntry(x.dataset.j)));
}

// ================================================================== 記下想法＋副官檢查
function pickerHTML(id, ph) {
  return `<div class="picker"><input class="input" id="${id}" placeholder="${esc(ph)}" autocomplete="off"><div class="sugg" id="${id}-s"></div></div>`;
}
function bindPick(root, id, onPick) {
  const q = $('#' + id, root), sugg = $(`#${id}-s`, root);
  if (!q) return;
  q.addEventListener('input', () => {
    const s = q.value.trim().toLowerCase();
    if (!s) { sugg.innerHTML = ''; return; }
    const hits = S.summary.etfs.filter((r) => r.c.toLowerCase().includes(s) || (r.n || '').toLowerCase().includes(s)).slice(0, 8);
    sugg.innerHTML = hits.map((r) => `<button type="button" data-pick="${r.c}">${esc(r.n)} <span class="num">${r.c}</span></button>`).join('') || '<span class="muted small">找不到這檔 ETF</span>';
    $$('[data-pick]', sugg).forEach((b) => b.addEventListener('click', () => onPick(b.dataset.pick)));
  });
}
/**
 * 記下想法。o：{ code, code2, stance }
 * 流程：選 ETF、立場、信心、理由、寫想法 → 副官檢查（逐條鎖定的動畫）→ 記進日記／冷靜一晚／帶去問 Claude
 */
export function openIdea(o = {}) {
  if (!S.summary) return;
  const f = { code: o.code || null, code2: o.code2 || null, stance: o.stance || null, conf: 0, tags: [], text: '' };
  let checked = null;
  FX.sfx('open');
  const card = openModal(`<div class="form idea">
      <div class="idea-h"><span class="idea-core">${coreSVG('idle')}</span><div><h2 class="m-title">我有想法</h2><p class="m-desc">說說你的想法，副官用固定規則幫你檢查、幫你記下來。副官不替你決定。</p></div></div>
      <div class="field"><span class="lab">立場</span><div class="stance-pick" role="radiogroup" aria-label="立場">${Object.entries(A.STANCE).map(([k, s]) => `<button type="button" class="sp st-${k}" data-st="${k}" aria-pressed="${f.stance === k}">${STI[k]}<span>${s.t}</span></button>`).join('')}</div></div>
      <div id="i-etf"></div>
      <div class="field"><span class="lab">有多確定</span><div class="conf-pick" role="radiogroup" aria-label="信心">${[1, 2, 3, 4, 5].map((k) => `<button type="button" data-cf="${k}" aria-pressed="false"><b class="num">${k}</b><small>${A.CONF[k]}</small></button>`).join('')}</div></div>
      <div class="field"><span class="lab">為什麼（可以多選）</span><div class="tag-pick">${Object.entries(A.TAGS).map(([k, t]) => `<button type="button" class="tg${A.EMO_TAGS.includes(k) ? ' emo' : ''}" data-tg="${k}" aria-pressed="false">${esc(t)}</button>`).join('')}</div></div>
      <label class="field"><span class="lab">想法（選填）</span><textarea class="input area" id="i-text" rows="3" maxlength="500" placeholder="你看到了什麼、為什麼這樣想？例如：跌到季線附近，想分批加碼一張。可以用鍵盤上的麥克風直接說。"></textarea></label>
      <div id="i-out" class="ck-box" aria-live="polite"></div>
      <div class="f-err" id="i-err" role="alert"></div>
      <div class="m-actions" id="i-act"></div>
    </div>`, { label: '我有想法' });

  const etfBox = $('#i-etf', card);
  function drawEtf() {
    const one = (code, key, ph, label) => {
      if (code) {
        const r = S.rows.get(code);
        return `<div class="field"><span class="lab">${label}</span><div class="picked"><b>${esc(r ? r.n : code)}</b><span class="num muted">${esc(code)}</span>${r ? `<span class="muted">${esc(catName(r.k))}</span>` : ''}<button type="button" class="link" data-chg="${key}">更換</button></div></div>`;
      }
      return `<div class="field"><span class="lab">${label}</span>${pickerHTML('ip-' + key, ph)}</div>`;
    };
    etfBox.innerHTML = f.stance === 'swap'
      ? `<div class="swap2">${one(f.code, 'a', '要換掉哪一檔？例如 0056', '換出')}<span class="sw-ar">${ICON.swap}</span>${one(f.code2, 'b', '要換成哪一檔？例如 00878', '換入')}</div>`
      : one(f.code, 'a', '輸入代號或名稱，例如 0050、高股息', 'ETF');
    $$('[data-chg]', etfBox).forEach((b) => b.addEventListener('click', () => { if (b.dataset.chg === 'a') f.code = null; else f.code2 = null; drawEtf(); changed(); const inp = $(`#ip-${b.dataset.chg}`, etfBox); if (inp) inp.focus(); }));
    bindPick(etfBox, 'ip-a', (c) => { f.code = c; drawEtf(); changed(); });
    bindPick(etfBox, 'ip-b', (c) => { f.code2 = c; drawEtf(); changed(); });
  }
  drawEtf();
  const act = $('#i-act', card), out = $('#i-out', card), err = $('#i-err', card);
  function valid() {
    if (!f.stance) return '先選立場';
    if (!f.code) return f.stance === 'swap' ? '選要換掉的那一檔' : '選一檔 ETF';
    if (f.stance === 'swap' && !f.code2) return '選要換過去的那一檔';
    if (f.stance === 'swap' && f.code2 === f.code) return '換出和換入不能是同一檔';
    const r = S.rows.get(f.code);
    if (!r || !isNum(quote(r).px)) return '這檔目前沒有價格，沒辦法記錄';
    if (f.stance === 'swap') { const r2 = S.rows.get(f.code2); if (!r2 || !isNum(quote(r2).px)) return '換過去的那檔目前沒有價格'; }
    return '';
  }
  function drawActions() {
    const v = valid();
    if (!checked) {
      act.innerHTML = `<button type="button" class="btn ghost" data-close>取消</button><button type="button" class="btn primary" id="i-check"${v ? ' disabled' : ''}>${ICON.aide}副官檢查</button>`;
      $('#i-check', act).addEventListener('click', () => runCheck(true));
    } else {
      const cool = checked.cool;
      act.innerHTML = `<button type="button" class="btn ghost" id="i-ask">${ICON.comms}帶去問 Claude</button>${cool ? '<button type="button" class="btn" id="i-cool">冷靜一晚再決定</button>' : '<button type="button" class="btn ghost" id="i-cool">明天再確認</button>'}<button type="button" class="btn primary" id="i-save">記進決策日記</button>`;
      $('#i-save', act).addEventListener('click', () => save(false));
      $('#i-cool', act).addEventListener('click', () => save(true));
      $('#i-ask', act).addEventListener('click', () => { const e = save(false, true); if (e) { FX.cue('lock'); openAsk('idea', { id: e.id, saved: true }); } });
    }
    $$('[data-close]', act).forEach((b) => b.addEventListener('click', () => closeModal()));
  }
  function ctxNow() {
    const P = S.P;
    return { T: P ? P.totals.T : 0, cash: P ? P.totals.cash : 0, profile: settings.risk, fee: settings.fee, today: today() };
  }
  function compute() {
    const row = S.rows.get(f.code);
    const row2 = f.code2 && f.stance === 'swap' ? S.rows.get(f.code2) : null;
    return A.aideCheck({
      stance: f.stance, conf: f.conf, tags: f.tags, row, q: quote(row), row2, q2: row2 ? quote(row2) : null,
      hold: holdInfo(f.code), hold2: row2 ? holdInfo(row2.c) : null, adv: adviceFor(f.code), stats: statsOf(row), stats2: row2 ? statsOf(row2) : null,
      market: marketNow(), ctx: ctxNow(), aumRank: rankOf(row), aumRank2: row2 ? rankOf(row2) : null, privacy: settings.privacy, bookName: bookName(),
    });
  }
  function drawResult(ck, anim) {
    const tone = ck.stop ? 'stop' : ck.warn >= A.AIDE.warnCool ? 'warn' : ck.warn ? 'mid' : 'ok';
    out.innerHTML = `<div class="ck-head tone-${tone}"><span class="ck-core">${coreSVG(anim ? 'think' : 'idle')}</span><div><span class="ck-k">副官檢查</span><b class="ck-v">${esc(ck.verdict)}</b><span class="ck-n num">✓ ${ck.ok}　⚠ ${ck.warn}${ck.stop ? `　⛔ ${ck.stop}` : ''}</span></div></div>
      ${checksListHTML(ck.items, anim)}
      ${ck.cool ? `<div class="cool-box">${ICON.clock}<span><b>建議冷靜一晚</b>（${esc(ck.coolWhy.join('、'))}）。按「冷靜一晚再決定」，副官明天（${fmt.d(A.coolDue(today()))}）開盤前會問你一次：還是這麼想嗎？</span></div>` : ''}
      <p class="small muted ck-foot">副官只做固定規則的檢查，不替你決定；檢查的規則在設定頁「副官怎麼檢查」。</p>`;
    if (anim && FX.fxOn()) {
      const lis = $$('.ck-list li', out);
      lis.forEach((li, k) => setTimeout(() => {
        li.classList.add('on');
        FX.sfx(li.classList.contains('warn') ? 'warn' : li.classList.contains('stop') ? 'stop' : 'good');
      }, 380 + k * 120));
      setTimeout(() => { const c = $('.ck-core .core', out); if (c) c.classList.replace('think', 'idle'); FX.cue(ck.stop ? 'stop' : ck.warn ? 'warn' : 'ok'); }, 420 + lis.length * 120);
    } else $$('.ck-list li', out).forEach((li) => li.classList.add('on'));
  }
  function runCheck(anim) {
    const v = valid();
    err.textContent = v;
    if (v) { FX.sfx('err'); return; }
    checked = compute();
    if (anim) { FX.sfx('scan'); FX.haptic('lock'); }
    drawResult(checked, anim);
    drawActions();
    if (anim) setTimeout(() => out.scrollIntoView({ behavior: FX.fxOn() ? 'smooth' : 'auto', block: 'start' }), 60);
  }
  function changed() {
    err.textContent = '';
    if (checked) { if (valid()) { checked = null; out.innerHTML = ''; } else { checked = compute(); drawResult(checked, false); } }
    drawActions();
  }
  function save(cool, quiet = false) {
    const v = valid();
    if (v) { err.textContent = v; FX.sfx('err'); return null; }
    const row = S.rows.get(f.code);
    const row2 = f.stance === 'swap' ? S.rows.get(f.code2) : null;
    const ck = checked || compute();
    const e = {
      id: newId(), at: new Date().toISOString(), src: 'idea', book: isPaper() ? 'paper' : 'real', c: f.code, ...(row2 ? { c2: row2.c } : {}),
      stance: f.stance, conf: f.conf || null, tags: f.tags.slice(), text: $('#i-text', card).value.trim().slice(0, 500),
      snap: snapOf(row), ...(row2 ? { snap2: snapOf(row2) } : {}),
      checks: { verdict: ck.verdict, ok: ck.ok, warn: ck.warn, stop: ck.stop, cool: ck.cool, items: ck.items.slice(0, 16).map((i) => ({ lvl: i.lvl, t: i.t })) },
      ...(cool ? { cool: { due: A.coolDue(today()), res: null } } : {}),
    };
    if (!addEntry(e)) { err.textContent = '這個瀏覽器不允許儲存資料（可能是私密瀏覽模式）'; return null; }
    if (!quiet) {
      closeModal();
      FX.cue('lock');
      FX.stamp(cool ? '冷靜一晚' : '已記錄', cool ? 'glacier' : 'aurora', cool ? `${fmt.d(e.cool.due)} 開盤前再確認` : `${fmt.d(A.addWeekdays(e.snap.d, A.HORIZON))} 左右對答案`);
      toast(cool ? '已放進冷靜期，明天再問你一次' : `已記進決策日記，${A.HORIZON} 個交易日後自動對答案`, null);
    }
    return e;
  }
  $$('[data-st]', card).forEach((b) => b.addEventListener('click', () => {
    f.stance = b.dataset.st;
    $$('[data-st]', card).forEach((z) => z.setAttribute('aria-pressed', z === b));
    FX.sfx('tap');
    drawEtf();
    changed();
  }));
  $$('[data-cf]', card).forEach((b) => b.addEventListener('click', () => {
    f.conf = +b.dataset.cf === f.conf ? 0 : +b.dataset.cf;
    $$('[data-cf]', card).forEach((z) => z.setAttribute('aria-pressed', +z.dataset.cf <= f.conf && f.conf > 0 ? 'true' : 'false'));
    FX.sfx('tap');
    changed();
  }));
  $$('[data-tg]', card).forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.tg;
    f.tags = f.tags.includes(k) ? f.tags.filter((x) => x !== k) : f.tags.concat(k);
    b.setAttribute('aria-pressed', f.tags.includes(k));
    FX.sfx('tap');
    changed();
  }));
  drawActions();
  if (!f.code && f.stance !== 'swap') setTimeout(() => { const i = $('#ip-a', card); if (i && f.stance) i.focus({ preventScroll: true }); }, 80);
}

// ================================================================== 冷靜期：隔天再確認
function coolAnswer(e, res) {
  e.cool.res = res;
  e.cool.at = new Date().toISOString();
  updEntry(e);
  FX.cue(res === 'kept' ? 'ok' : 'lock');
  toast(res === 'kept' ? '記下了：冷靜之後還是這麼想' : '記下了：冷靜之後改變主意。原本的想法照樣會對答案，看看冷靜有沒有幫到你', null);
}

// ================================================================== 日記詳情
export function openEntry(id) {
  const e = byId(id);
  if (!e) return;
  const row = S.rows.get(e.c);
  const st = A.finalStance(e);
  const done = e.res && e.res.state === 'done';
  const reveal = done && !e.seen;
  if (reveal) { e.seen = true; saveJournal(); bus.emit('journal'); }
  else FX.sfx('open');
  const name = e.snap ? e.snap.n || nameOf(e.c) : nameOf(e.c);
  const name2 = e.c2 ? (e.snap2 ? e.snap2.n : nameOf(e.c2)) : '';
  const hit = done ? A.hitOf(st, e.res) : null;
  const base = done ? A.baseOf(st, e.res) : null;
  let outcome;
  if (done) {
    const r = e.res;
    const diff = st === 'swap' && isNum(r.ret2) ? r.ret2 - r.ret : null;
    outcome = `<div class="oc done tone-${A.nonView(e) || hit == null ? 'mute' : hit ? 'hit' : 'miss'}">
      <div class="oc-k">${A.HORIZON} 個交易日後・${fmt.dy(r.d)}</div>
      <div class="oc-v"><b class="num ${dirCls(diff ?? r.ret)}" id="oc-n">${pctS(diff ?? r.ret, 2)}</b><span class="oc-tag">${A.nonView(e) ? '不計分' : hit == null ? '觀望不算對錯' : hit ? '對了' : '錯了'}</span></div>
      <div class="oc-s">${e.c2 ? `${esc(name)} ${pctS(r.ret, 2)}、${esc(name2)} ${pctS(r.ret2, 2)}（含息）` : `含息報酬，當時 ${fmt.px(e.snap.px)} → ${fmt.px(r.px)}`}</div>
      ${isNum(base) && !A.nonView(e) ? `<div class="oc-b"><span data-term="base">同類任何一天</span>照同樣方向做，會對的機率約 <b class="num">${pctU(base)}</b>。${hit != null ? (hit ? '這次你對了，但單一次可能是運氣，累積多筆才看得出判斷力。' : '這次錯了，但單一次不代表判斷差，看累積的戰績。') : ''}</div>` : ''}
    </div>`;
  } else if (e.res && e.res.state === 'na') {
    outcome = `<div class="oc na"><b>沒辦法對答案</b><span class="small muted">${esc(e.res.why || '')}</span></div>`;
  } else {
    const p = progressOf(e);
    const r = e.c2 && isNum(p.ret2) && isNum(p.ret) ? p.ret2 - p.ret : p.ret;
    outcome = `<div class="oc wait"><div class="oc-k">等待對答案・大約第 ${p.n}／${A.HORIZON} 個交易日・預計 ${fmt.d(p.due)} 左右</div>
      <div class="jr-prog big"><i style="width:${(p.n / A.HORIZON * 100).toFixed(0)}%"></i></div>
      <div class="oc-s">到目前為止 <b class="num ${dirCls(r)}">${pctS(r, 2)}</b>${e.c2 ? `（${esc(name2)} ${pctS(p.ret2, 2)} − ${esc(name)} ${pctS(p.ret, 2)}）` : '（含息）'}</div></div>`;
  }
  const coolBox = e.cool ? (e.cool.res
    ? `<div class="cool-box done">${ICON.clock}<span>冷靜期：${e.cool.res === 'kept' ? '隔天還是這麼想' : '隔天改變主意了'}（${fmt.d(twDay(e.cool.at))}）</span></div>`
    : `<div class="cool-box">${ICON.clock}<span><b>${coolDue(e) ? '冷靜期到了' : `冷靜期：${fmt.d(e.cool.due)} 開盤前再確認`}</b>　冷靜一晚之後，還是這麼想嗎？</span><span class="row-btns"><button class="btn small" id="e-kept">還是這麼想</button><button class="btn small ghost" id="e-changed">改變主意了</button></span></div>`) : '';
  const ck = e.checks;
  const after = e.after;
  const exits = after && after.exit ? A.parseExit(after.exit, row ? quote(row).px : e.snap.px) : [];
  let noteEl = null;
  // 關閉（或重新打開）之前，把復盤筆記存起來
  const saveNote = () => {
    if (!noteEl) return;
    const v = noteEl.value.trim().slice(0, 400);
    if (v !== (e.note || '')) { e.note = v; updEntry(e); }
  };
  const reopen = () => { saveNote(); noteEl = null; openEntry(e.id); };
  const card = openModal(`<div class="form entry">
      <div class="en-h"><span class="en-d num">${fmt.dy(twDay(e.at))} ${hhmm(e.at)}</span>${srcTag(e)}</div>
      <h2 class="m-title"><button type="button" class="link en-n" data-open="${esc(e.c)}">${esc(name)}</button>${e.c2 ? `<span class="muted"> → </span><button type="button" class="link en-n" data-open="${esc(e.c2)}">${esc(name2)}</button>` : ''}</h2>
      <div class="chips">${stanceTag(e.stance)}${after && after.stance && st !== e.stance ? `<span class="muted small">討論後 →</span>${stanceTag(st)}` : ''}${pips(e.conf)}${(e.tags || []).map((t) => `<span class="chip ghost">${esc(A.TAGS[t] || t)}</span>`).join('')}</div>
      ${e.text ? `<blockquote class="en-q">${esc(e.text)}</blockquote>` : ''}
      ${outcome}
      ${coolBox}
      <div class="kv en-kv">
        <div><div class="k">當時價格</div><div class="v num">${fmt.px(e.snap.px)}${e.snap2 ? ` / ${fmt.px(e.snap2.px)}` : ''}<small> ${e.snap.live ? `盤中 ${esc(String(e.snap.t || '').slice(0, 5))}` : fmt.d(e.snap.d)}</small></div></div>
        <div><div class="k" data-term="st">當時冷眼規則</div><div class="v">${e.snap.st == null ? '<small>資料不足</small>' : `${['偏空', '中性', '偏多'][e.snap.st + 1]}${e.snap.ps ? `／${({ add: '可加碼', wait: '漲多分批', hold: '續抱', caution: '先不加碼', trim: '減碼' })[e.snap.ps]}` : ''}`}</div></div>
      </div>
      ${ck ? `<details class="en-ck"><summary>${ICON.aide}副官當時說：${esc(ck.verdict)}<small class="num">✓ ${ck.ok}　⚠ ${ck.warn}${ck.stop ? `　⛔ ${ck.stop}` : ''}</small></summary>${checksListHTML(ck.items || [])}</details>` : ''}
      <div class="en-sec"><div class="en-st">${ICON.comms}和 Claude 討論後的結論</div>
        ${after ? `<div class="after">${after.stance ? `<div><span>立場</span><b>${A.STANCE[after.stance] ? A.STANCE[after.stance].t : '—'}</b></div>` : ''}${after.conf ? `<div><span>信心</span><b>${after.conf}／5</b></div>` : ''}${after.why ? `<div><span>理由</span><p>${esc(after.why)}</p></div>` : ''}${after.risk ? `<div><span>風險</span><p>${esc(after.risk)}</p></div>` : ''}${after.exit ? `<div><span>復盤條件</span><p>${esc(after.exit)}</p></div>` : ''}</div>
          ${exits.length ? `<div class="quick">${exits.map((x, k) => `<button type="button" class="pill" data-alert="${k}">${ICON.bell}設到價提醒：${x.op === 'le' ? '跌到' : '漲到'} ${fmt.px(x.px)}</button>`).join('')}</div>` : ''}
          <button type="button" class="link small" id="e-repaste">重新貼上</button>`
    : `<p class="small muted">在 Claude 討論完，請它給你【冷眼結論】，整段貼到這裡。副官會認出立場、信心、理由、風險與復盤條件；復盤條件裡的價位可以一鍵設成到價提醒。</p>`}
        <div id="e-paste"${after ? ' hidden' : ''}><textarea class="input area" id="e-concl" rows="4" placeholder="貼上【冷眼結論】……"></textarea>
          <div class="seg mini" id="e-pst" hidden>${Object.entries(A.STANCE).map(([k, s]) => `<button type="button" data-pst="${k}">${s.t}</button>`).join('')}</div>
          <div class="f-err" id="e-err" role="alert"></div>
          <div class="m-actions left"><button type="button" class="btn small" id="e-parse">存下結論</button></div></div>
      </div>
      <label class="field en-sec"><span class="en-st">${ICON.chart}復盤筆記</span><textarea class="input area" id="e-note" rows="2" maxlength="400" placeholder="${done ? '這次學到什麼？下次遇到類似情況要怎麼做？' : '對完答案後，回來寫下學到的事'}">${esc(e.note || '')}</textarea></label>
      <div class="m-actions">
        <button type="button" class="btn danger ghost" id="e-del">刪除${e.src === 'trade' ? '紀錄' : ''}</button>
        <button type="button" class="btn ghost" id="e-ask">${ICON.comms}${done ? '帶去復盤' : '帶去問 Claude'}</button>
        <button type="button" class="btn primary" data-close>完成</button>
      </div>
      ${e.src === 'trade' ? '<p class="small muted">這筆是交易自動記下的；刪除紀錄不會刪掉交易本身。</p>' : ''}
    </div>`, {
    label: '決策紀錄',
    onClose: () => saveNote(),
  });
  noteEl = $('#e-note', card);
  if (reveal) {
    const sound = A.nonView(e) || hit == null ? 'online' : hit ? 'hit' : 'miss';
    setTimeout(() => { FX.cue(sound); FX.stamp(A.nonView(e) ? '結果揭曉' : hit == null ? '觀望' : hit ? '對了' : '錯了', hit === false ? 'amber' : hit ? 'glacier' : 'aurora', `${A.HORIZON} 個交易日後 ${pctS(e.res.ret2 != null && st === 'swap' ? e.res.ret2 - e.res.ret : e.res.ret, 2)}`); FX.pulse($('.oc', card), 'fx-reveal', 900); }, 120);
  }
  $$('[data-open]', card).forEach((b) => b.addEventListener('click', () => { closeModal(); openDetailLazy(b.dataset.open); }));
  const kept = $('#e-kept', card);
  if (kept) kept.addEventListener('click', () => { coolAnswer(e, 'kept'); reopen(); });
  const ch = $('#e-changed', card);
  if (ch) ch.addEventListener('click', () => { coolAnswer(e, 'changed'); reopen(); });
  const rp = $('#e-repaste', card);
  if (rp) rp.addEventListener('click', () => { $('#e-paste', card).hidden = false; $('#e-concl', card).focus(); });
  let pendingStance = null;
  const parseBtn = $('#e-parse', card);
  parseBtn.addEventListener('click', () => {
    const txt = $('#e-concl', card).value;
    const r = A.parseConclusion(txt);
    const er = $('#e-err', card);
    if (!r) { er.textContent = '看不出結論的內容。請貼上 Claude 給的【冷眼結論】整段。'; FX.sfx('err'); return; }
    if (!r.stance && !pendingStance) {
      er.textContent = `看不出「立場」${r.stanceRaw ? `（「${r.stanceRaw}」）` : ''}，請點一個：`;
      $('#e-pst', card).hidden = false;
      FX.sfx('warn');
      return;
    }
    e.after = { ...r, stance: r.stance || pendingStance, at: new Date().toISOString() };
    delete e.after.stanceRaw;
    updEntry(e);
    FX.cue('lock');
    toast('已存下討論後的結論', null);
    reopen();
  });
  $$('[data-pst]', card).forEach((b) => b.addEventListener('click', () => {
    pendingStance = b.dataset.pst;
    $$('[data-pst]', card).forEach((z) => z.setAttribute('aria-pressed', z === b));
    parseBtn.click();
  }));
  $$('[data-alert]', card).forEach((b) => b.addEventListener('click', () => {
    const x = exits[+b.dataset.alert];
    if (!x) return;
    const c = e.c;
    if (alerts.some((a) => a.c === c && a.op === x.op && Math.abs(a.px - x.px) < 1e-9)) { toast('這個提醒已經設過了'); return; }
    alerts.push({ id: newId(), c, op: x.op, px: x.px, at: new Date().toISOString(), hit: null });
    saveAlerts();
    bus.emit('alerts');
    FX.cue('ok');
    toast(`已設提醒：${nameOf(c)} ${x.op === 'le' ? '跌到' : '漲到'} ${fmt.px(x.px)}`, null);
    b.disabled = true;
  }));
  $('#e-ask', card).addEventListener('click', () => { saveNote(); noteEl = null; openAsk(done ? 'review' : 'idea', { id: e.id }); });
  $('#e-del', card).addEventListener('click', (ev) => {
    const b = ev.currentTarget;
    if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = '確定刪除？'; FX.sfx('warn'); return; }
    const k = journal.items.findIndex((x) => x.id === e.id);
    if (k >= 0) journal.items.splice(k, 1);
    saveJournal();
    noteEl = null;
    closeModal();
    bus.emit('journal');
    FX.sfx('close');
    toast('已刪除這筆紀錄', null);
  });
}

// ================================================================== 帶去問 Claude
/** kind：idea（一筆想法）、etf（單檔）、pf（整體配置）、market（今日市場）、review（復盤一筆）、week（每週復盤）、duel（ETF 比較） */
export const hooks = { brief: null, actions: null };   // app.js 提供：今日晨報、今日行動的文字
export function openAsk(kind, o = {}) {
  if (!S.summary) return;
  if (!o.saved) FX.sfx('open');
  const e = o.id ? byId(o.id) : null;
  const code = o.code || (e && e.c) || null;
  // 單檔的各面向分析在 etf/{代號}.json：有快取就直接用，沒有就先打開視窗、抓到再補上
  let det = (kind === 'etf' || kind === 'idea') && code ? S.detail[code] || null : null;
  let det2 = kind === 'idea' && e && e.c2 ? S.detail[e.c2] || null : null;
  const hasHold = kind === 'pf' || ((kind === 'etf' || kind === 'idea') && code && !!holdInfo(code));
  const titles = { idea: '帶這個想法去問 Claude', etf: '帶這檔去問 Claude', pf: '帶我的配置去問 Claude', market: '帶今天的市場去問 Claude', review: '帶這筆決定去復盤', week: '帶這週去問 Claude', duel: '帶這場對決去問 Claude' };
  const ph = { idea: '例如：我這樣想合理嗎？有什麼沒想到的？', etf: '例如：現在適合開始定期定額嗎？', pf: '例如：我的配置會不會太集中？', market: '例如：今天大跌，我需要做什麼嗎？', review: '例如：這次是運氣還是判斷？', week: '例如：我這週有沒有太衝動？', duel: '例如：我想存退休金，哪一檔比較適合我？' };
  const st = { q: o.question || '', amt: !!settings.askAmt, short: !!settings.askShort };
  const build = () => {
    const P = S.P;
    const td = today();
    if (kind === 'idea' || kind === 'etf') {
      const row = S.rows.get(code);
      if (!row) return '';
      const row2 = e && e.c2 ? S.rows.get(e.c2) : null;
      const idea = e ? { stance: e.stance, conf: e.conf, tags: e.tags, text: e.text, from: nameOf(e.c), to: e.c2 ? nameOf(e.c2) : '' } : null;
      const ck = e && e.checks ? { verdict: e.checks.verdict, items: e.checks.items || [] } : null;
      return A.packEtf({
        kind, short: st.short, when: whenText(), row, q: quote(row), det, stats: statsOf(row), today: td, market: marketNow(),
        hold: holdInfo(code), showAmt: st.amt, profileName: PF.PROFILES[settings.risk].name, bookName: bookName(), adv: adviceFor(code),
        row2, q2: row2 ? quote(row2) : null, det2, stats2: row2 ? statsOf(row2) : null, hold2: row2 ? holdInfo(row2.c) : null,
        checks: ck, idea, question: st.q.trim(),
      });
    }
    if (kind === 'pf') {
      if (!P) return '';
      const stress = PF.stressToStops(P.holdings, { T: P.totals.T });
      const holdings = P.holdings.map((x) => ({ name: x.name, code: x.code, cat: x.cat, w: x.w, cap: PF.capOf(settings.risk, x.cat), pnlPct: x.pct, label: (S.adv.get(x.code) || {}).label, st: x.row ? x.row.st : null, ps: x.row ? x.row.ps : null, sh: x.h.sh, avg: x.h.avg, mv: x.mv }));
      let bench = null;
      if (isPaper() && book.start) {
        const dv = S.divs && S.divs[book.start.code || '0050'];
        const br = S.rows.get(book.start.code || '0050');
        const bq = br ? quote(br) : null;
        const b = benchValue(book.start, dv ? dv.d : [], dv ? dv.s : [], bq ? bq.px : null, (bq && bq.date) || td);
        if (b) bench = { ret: P.totals.T / book.start.cash0 - 1, b: b.ret, days: PF.daysBetween(book.start.d, td) + 1 };
      }
      return A.packPf({
        short: st.short, when: whenText(), profileName: PF.PROFILES[settings.risk].name, profileLoss: PF.PROFILES[settings.risk].loss,
        totals: P.totals, holdings, stress, audit: A.auditPf(P, settings.risk, td, stress), showAmt: st.amt, question: st.q.trim(), bookName: bookName(), bench, market: marketNow(),
      });
    }
    if (kind === 'market') {
      const held = new Set(P ? P.holdings.map((x) => x.code) : []);
      const codes = [...new Set([...held, ...settings.watch])];
      const watch = codes.map((c) => S.rows.get(c)).filter(Boolean).map((row) => ({ row, q: quote(row), held: held.has(row.c) }));
      const changes = (S.changes || []).map((c) => { const r = S.rows.get(c.c); const t = (z) => `${['偏空', '中性', '偏多'][z[0] + 1] || '—'}`; return r ? `${r.n} ${t(c.from)}→${t(c.to)}` : ''; }).filter(Boolean);
      const brief = hooks.brief ? hooks.brief() : [];
      const actions = hooks.actions ? hooks.actions() : [];
      return A.packMarket({ short: st.short, when: whenText(), market: marketNow(), watch, changes, brief, actions, question: st.q.trim() });
    }
    if (kind === 'review' && e) {
      return A.packReview({ entry: e, name: nameOf(e.c), name2: e.c2 ? nameOf(e.c2) : '', now: e.res && e.res.state === 'done' ? null : progressOf(e), question: st.q.trim(), short: st.short });
    }
    if (kind === 'week') {
      const w = weekInfo();
      return A.packWeek({
        short: st.short, when: whenText(), from: w.from,
        made: w.made.map((x) => ({ name: nameOf(x.c) + (x.c2 ? ` → ${nameOf(x.c2)}` : ''), stance: x.stance, src: x.src, tags: x.tags, verdict: x.checks && x.checks.verdict })),
        done: w.done.map((x) => { const s2 = A.finalStance(x); return { name: nameOf(x.c), stance: s2, ret: x.res.ret, hit: A.nonView(x) ? null : A.hitOf(s2, x.res), base: A.baseOf(s2, x.res) }; }),
        stats: A.journalStats(journal.items), pending: w.pending, cool: w.cool, question: st.q.trim(),
      });
    }
    if (kind === 'duel') {
      const rows = (o.codes || []).map((c) => S.rows.get(c)).filter(Boolean).map((row) => ({ row, q: quote(row) }));
      return A.packDuel({ short: st.short, when: whenText(), rows, market: marketNow(), question: st.q.trim() });
    }
    return '';
  };
  const canShare = typeof navigator.share === 'function';
  const card = openModal(`<div class="form ask">
      <div class="ask-h"><span class="ask-ic">${ICON.comms}</span><div><h2 class="m-title">${titles[kind] || '帶去問 Claude'}</h2>
        <p class="m-desc">冷眼把官方資料、規則判讀${kind === 'idea' ? '、你的想法和副官的檢查' : ''}整理成一段文字。按「分享」選 Claude App，或「複製」後到 Claude 貼上。資料只有在你按下去的時候才會離開這支手機。</p></div></div>
      ${o.saved ? `<div class="saved-note">${ICON.ok}<span>這個想法已經記進決策日記，${A.HORIZON} 個交易日後自動對答案。</span></div>` : ''}
      <label class="field"><span class="lab">我想問（選填，會放在最後面）</span><textarea class="input area" id="k-q" rows="2" maxlength="400" placeholder="${esc(ph[kind] || '')}">${esc(st.q)}</textarea></label>
      <div class="ask-opts">
        ${hasHold ? `<button type="button" class="switch-row" id="k-amt" aria-pressed="${st.amt}"><span class="switch" role="switch" aria-checked="${st.amt}"></span><span>附上金額、股數與成本<small>（關掉時只寫比例）</small></span></button>` : ''}
        <button type="button" class="switch-row" id="k-short" aria-pressed="${st.short}"><span class="switch" role="switch" aria-checked="${st.short}"></span><span>已經在 Claude 專案設好指示<small>（省略規則段，打包比較短）</small></span></button>
      </div>
      <details class="pk-prev"><summary>預覽要給 Claude 的內容<small class="num" id="k-len"></small></summary><pre class="pk" id="k-pre"></pre></details>
      <div class="m-actions ask-act">
        ${canShare ? `<button type="button" class="btn primary" id="k-share">${ICON.share}分享給 Claude</button>` : ''}
        <button type="button" class="btn${canShare ? '' : ' primary'}" id="k-copy">${ICON.copy}複製</button>
        <a class="btn ghost" id="k-open" href="https://claude.ai/new" target="_blank" rel="noopener">${ICON.ext}開啟 Claude</a>
      </div>
      ${kind === 'idea' || kind === 'etf' || kind === 'duel' ? `<p class="small muted ask-foot">討論完，請 Claude 給你【冷眼結論】，${kind === 'idea' ? '回到「副官 → 決策日記」這一筆貼上' : '再按「我有想法」記下你的決定'}；${A.HORIZON} 個交易日後副官會自動對答案。</p>` : ''}
      <p class="small muted ask-foot">第一次用？在 Claude 建一個專案叫「冷眼參謀」，把設定頁「副官與聲光」裡的專案指示貼進去，之後就能打開上面的「已經在 Claude 專案設好指示」。</p>
    </div>`, { label: titles[kind] || '帶去問 Claude' });
  const pre = $('#k-pre', card);
  const redraw = () => { const t = build(); pre.textContent = t; $('#k-len', card).textContent = `　${t.length.toLocaleString('en-US')} 字`; return t; };
  redraw();
  if ((kind === 'etf' || kind === 'idea') && code && !det) ensureDetail(code).then((d) => { if (d && card.isConnected) { det = d; redraw(); } });
  if (kind === 'idea' && e && e.c2 && !det2) ensureDetail(e.c2).then((d) => { if (d && card.isConnected) { det2 = d; redraw(); } });
  $('#k-q', card).addEventListener('input', (ev) => { st.q = ev.target.value; redraw(); });
  const amt = $('#k-amt', card);
  if (amt) amt.addEventListener('click', () => { st.amt = !st.amt; settings.askAmt = st.amt; saveSettings(); amt.setAttribute('aria-pressed', st.amt); $('.switch', amt).setAttribute('aria-checked', st.amt); FX.sfx('tap'); redraw(); });
  const sh = $('#k-short', card);
  sh.addEventListener('click', () => { st.short = !st.short; settings.askShort = st.short; saveSettings(); sh.setAttribute('aria-pressed', st.short); $('.switch', sh).setAttribute('aria-checked', st.short); FX.sfx('tap'); redraw(); });
  const markAsked = () => { if (e && (kind === 'idea' || kind === 'review') && !e.asked) { e.asked = new Date().toISOString(); updEntry(e); } };
  const copyText = async (t) => {
    try { await navigator.clipboard.writeText(t); return true; } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = t; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
      } catch { return false; }
    }
  };
  $('#k-copy', card).addEventListener('click', async () => {
    const t = redraw();
    if (await copyText(t)) { FX.cue('ok'); markAsked(); toast('已複製。到 Claude 貼上就能開始討論', null); }
    else { $('.pk-prev', card).open = true; toast('沒辦法自動複製，請長按預覽的文字自己複製'); }
  });
  const share = $('#k-share', card);
  if (share) share.addEventListener('click', async () => {
    const t = redraw();
    try { await navigator.share({ text: t }); FX.cue('ok'); markAsked(); } catch (err) {
      if (err && err.name === 'AbortError') return;
      if (await copyText(t)) { markAsked(); toast('這支手機不能直接分享，已改成複製', null); }
    }
  });
  $('#k-open', card).addEventListener('click', () => { FX.sfx('nav'); });
}

/** 設定頁：「副官怎麼檢查」的說明與 Claude 專案指示 */
export function projectText() { return A.projectInstructions(); }
export function rulesHTML() { return A.aideRulesHTML(); }
/** 交易表單用：理由標籤 */
export const TAGS = A.TAGS;
