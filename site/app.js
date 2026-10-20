/* 冷眼 ColdEye — PZ 的 ETF 指揮台。
   資料：同網站的 data/*.json（GitHub Actions 定時從官方來源產生）。
   持股、交易、提醒：只存在這支手機（localStorage），不會上傳。 */
import {
  $, $$, esc, clamp, isNum, reduceMotion, store, settings, saveSettings, book, alerts, saveAlerts, S, bus, fmt, money, sharesOf, cash3,
  dirCls, arrow, twParts, CAT, catName, POS, ST, ICON, getJSON, loadCore, useCache, ensureTrack, ensureDivs, quote,
  computePF, hasBook, heldOf, slotVar, stanceChip, posChip, actChip, gaugeSVG, animateNeedles, sparkSVG, toast, countUp,
  today, PF, premBand, DEFAULT_RULES,
} from './core.js';
import { openDetail, closeDetail, renderDetail, refreshDetailQuote } from './sheet.js';
import { openTradeForm, openCashForm, openBackup, checkAlerts, closeModal, modalOpen, wipeBook } from './forms.js';

// ------------------------------------------------------------------ 分頁
const TABS = [
  { id: 'home', t: '指揮台', svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.3" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 1.8v3M12 19.2v3M1.8 12h3M19.2 12h3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>' },
  { id: 'pf', t: '部位', svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6a8.4 8.4 0 1 0 8.4 8.4H12z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M14.6 2.4a7.6 7.6 0 0 1 7 7H14.6z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>' },
  { id: 'radar', t: '雷達', svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="4.4" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".7"/><path d="M12 12 18 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="15.6" cy="15" r="1.4" fill="currentColor"/></svg>' },
  { id: 'news', t: '情報', svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4.5" width="16" height="15" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 9h8M8 12.5h8M8 16h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>' },
  { id: 'track', t: '戰績', svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 19.5h15M7 16v-4.5M12 16V7.5M17 16v-7" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>' },
];

// ------------------------------------------------------------------ 外框
function renderShell() {
  document.body.innerHTML = `
    <div class="aurora" aria-hidden="true"></div>
    <header class="top" id="top">
      <button class="seal" id="seal" aria-label="冷眼：回到指揮台"><span>冷</span><span>眼</span></button>
      <div class="hello"><div class="hi" id="hi"></div><button class="status" id="status" aria-label="重新整理資料"><i></i><span>載入中</span></button></div>
      <button class="icon-btn" id="privacy" aria-pressed="${settings.privacy}" aria-label="${settings.privacy ? '顯示金額' : '隱藏金額'}">${settings.privacy ? ICON.eyeOff : ICON.eye}</button>
      <button class="avatar" id="prefs" aria-label="設定">${esc(avatarText())}</button>
    </header>
    <main id="view" aria-live="polite"></main>
    <nav class="dock" aria-label="主要分頁"><div class="in">${TABS.map((t) => `<button data-tab="${t.id}">${t.svg}<span>${t.t}</span></button>`).join('')}</div></nav>
    <section class="sheet" id="sheet" hidden aria-modal="true" role="dialog"></section>
    <div class="modal" id="modal" hidden></div>`;
  $$('.dock button').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));
  $('#status').addEventListener('click', manualRefresh);
  $('#seal').addEventListener('click', () => go('home'));
  $('#prefs').addEventListener('click', () => openSettings());
  $('#privacy').addEventListener('click', () => {
    settings.privacy = !settings.privacy;
    saveSettings();
    paintPrivacy();
    render();
    if (S.openCode && S.openCode !== '__prefs') renderDetail(S.openCode);
    toast(settings.privacy ? '已隱藏金額與股數' : '已顯示金額');
  });
  window.addEventListener('scroll', () => $('#top').classList.toggle('scrolled', window.scrollY > 4), { passive: true });
}
function avatarText() {
  const n = (settings.name || 'PZ').trim();
  if (/^[A-Za-z0-9]+$/.test(n)) return n.slice(0, 2).toUpperCase();
  return n.slice(-1);
}
function paintPrivacy() {
  const b = $('#privacy');
  if (!b) return;
  b.setAttribute('aria-pressed', settings.privacy);
  b.setAttribute('aria-label', settings.privacy ? '顯示金額' : '隱藏金額');
  b.innerHTML = settings.privacy ? ICON.eyeOff : ICON.eye;
}
function greeting() {
  const { h } = twParts();
  const word = h >= 5 && h < 11 ? '早安' : h >= 11 && h < 18 ? '午安' : '晚安';
  return `${settings.name || 'PZ'}，${word}`;
}
/** 資料新鮮度：後台每一輪都會重寫 live.json，所以它的時間就是「後台最後一次活著」的時間 */
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' }) : '—');
const minsAgo = (iso) => { const t = iso ? new Date(iso).getTime() : NaN; return isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 60000)) : null; };
const agoShort = (m) => (m == null ? '' : m < 1 ? '剛剛' : m < 60 ? `${m} 分前` : m < 1440 ? `${Math.round(m / 60)} 小時前` : `${Math.round(m / 1440)} 天前`);
const durShort = (m) => (m == null ? '' : m < 60 ? `${m} 分鐘` : m < 1440 ? `${Math.round(m / 60)} 小時` : `${Math.round(m / 1440)} 天`);
const LAG_MIN = 20;       // 盤中資料超過幾分鐘算「延遲」
const STALL_MIN = 54 * 60; // 後台超過幾分鐘完全沒動靜算「停擺」（週六 09:20 到週一 09:00 約 48 小時，留一點餘裕）
function freshness() {
  const L = S.live;
  const { wd, h, min } = twParts();
  const hm = h * 100 + min;
  const weekday = wd >= 1 && wd <= 5;
  const session = weekday && hm >= 900 && hm <= 1335;
  const age = L ? minsAgo(L.at) : null;
  const gen = S.summary ? S.summary.generated : null;
  const newest = [L && L.at, gen].filter(Boolean).sort().pop() || null;
  const stall = newest ? minsAgo(newest) >= STALL_MIN : false;
  const liveToday = L && L.date === today();
  if (session && liveToday && L.open) {
    const lag = age != null && age > LAG_MIN;
    return { key: lag ? 'lag' : 'live', txt: `盤中　${hhmm(L.at)} 資料・${agoShort(age)}`, stall };
  }
  if (session && L && !liveToday && age != null && age <= LAG_MIN && hm >= 915) {
    return { key: 'idle', txt: `今天休市　資料到 ${fmt.d(S.summary.asof)}`, stall };
  }
  if (session) {
    return { key: hm >= 915 ? 'lag' : 'wait', txt: hm >= 915 ? `開盤了，後台還沒送來盤中資料` : '開盤了，等第一筆盤中資料', stall };
  }
  if (S.summary.asof === today()) return { key: 'idle', txt: `${fmt.d(S.summary.asof)} 收盤　${agoShort(minsAgo(gen))}更新`, stall };
  if (!weekday) return { key: 'idle', txt: `休市　資料到 ${fmt.d(S.summary.asof)}`, stall };
  if (hm < 900) return { key: 'idle', txt: `開盤前　資料到 ${fmt.d(S.summary.asof)}`, stall };
  return { key: 'idle', txt: `資料到 ${fmt.d(S.summary.asof)}　${agoShort(minsAgo(gen))}更新`, stall };
}
function renderHeader() {
  const hi = $('#hi');
  if (hi) hi.textContent = greeting();
  const el = $('#status');
  if (!el || !S.summary) return;
  const f = freshness();
  el.className = `status ${f.key === 'live' ? 'open' : f.key === 'lag' ? 'stale' : ''}${el.classList.contains('busy') ? ' busy' : ''}`;
  el.innerHTML = `<i></i><span>${f.txt}</span>`;
  el.setAttribute('aria-label', `${f.txt}。點一下重新整理`);
}
async function manualRefresh() {
  const el = $('#status');
  if (el.classList.contains('busy')) return;
  el.classList.add('busy');
  const before = [S.live && S.live.at, S.summary && S.summary.generated].join('|');
  try {
    await loadCore();
    S.news = null;
    S.track = null;
    S.detail = {};
    await Promise.all([ensureTrack(), ensureDivs(true)]);
    diffSeen();
    computePF();
    el.classList.remove('busy');
    render();
    if (S.openCode && S.openCode !== '__prefs') renderDetail(S.openCode);
    const after = [S.live && S.live.at, S.summary && S.summary.generated].join('|');
    const f = freshness();
    if (after !== before) toast(f.key === 'live' || f.key === 'lag' ? `已更新到 ${hhmm(S.live.at)} 的資料` : '已更新到最新資料');
    else if (f.key === 'live' || f.key === 'lag') toast(`後台還沒有新資料（目前是 ${hhmm(S.live.at)} 的），通常每 5 分鐘一輪`);
    else toast('已經是最新的資料');
  } catch {
    toast('暫時連不上，顯示的是上次的資料');
  } finally {
    el.classList.remove('busy');
  }
}

function go(tab) {
  if (S.openCode) closeDetail(false);
  S.animUntil = 0;
  S.tab = tab;
  store.set('tab', tab);
  render();
  window.scrollTo({ top: 0 });
}
function render() {
  $$('.dock button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === S.tab ? 'page' : 'false'));
  renderHeader();
  // 開場動畫進行中就先不要重畫指揮台，等動畫結束再更新數字
  if (S.tab === 'home' && S.animUntil && performance.now() < S.animUntil) {
    clearTimeout(S.animTimer);
    S.animTimer = setTimeout(render, S.animUntil - performance.now() + 40);
    return;
  }
  const v = $('#view');
  if (!S.summary) { v.innerHTML = '<div class="skeleton tall"></div><div class="skeleton"></div><div class="skeleton"></div>'; return; }
  ({ home: renderHome, pf: renderPF, radar: renderRadar, news: renderNews, track: renderTrack }[S.tab] || renderHome)();
}

// ------------------------------------------------------------------ 規則訊號的變化（自上次資料更新後）
function diffSeen() {
  if (!S.summary) return;
  const prev = store.get('seen', null);
  const codes = new Set([...settings.watch, ...book.lots.map((l) => l.c)]);
  const m = {};
  for (const c of codes) { const r = S.rows.get(c); if (r && r.st != null) m[c] = [r.st, r.ps]; }
  const asof = S.summary.asof;
  if (!prev || !prev.asof) { store.set('seen', { asof, m, changes: [] }); S.changes = []; return; }
  if (prev.asof === asof) {
    for (const c of Object.keys(m)) if (!prev.m[c]) prev.m[c] = m[c];
    store.set('seen', prev);
    S.changes = prev.changes || [];
    return;
  }
  if (prev.asof < asof) {
    const changes = [];
    for (const [c, now] of Object.entries(m)) {
      const was = prev.m[c];
      if (was && (was[0] !== now[0] || was[1] !== now[1])) changes.push({ c, from: was, to: now });
    }
    store.set('seen', { asof, m, changes, from: prev.asof });
    S.changes = changes;
  }
}

// ------------------------------------------------------------------ 指揮台
function renderHome() {
  const v = $('#view');
  const P = S.P;
  let html = stallHTML() + heroHTML(P);
  html += installCard();
  const acts = buildActions(P);
  html += `<div class="sec-h"><h2>今日行動</h2><span class="aside">${acts.length ? `${acts.length} 件` : ''}</span></div>`;
  if (acts.length) {
    html += `<section class="panel list acts">${acts.map((a) => `<button class="act-row" data-code="${a.code}"><span class="a-chip">${a.chip}</span><span class="a-body"><b>${esc(a.title)}</b><span>${a.text}</span></span><span class="chev">${ICON.chev}</span></button>`).join('')}</section>`;
  } else {
    html += `<section class="panel pad calm"><b>今天沒有需要動作的事。</b><span class="muted">${hasBook() ? '持股都在續抱狀態，照紀律放著就好。' : '輸入持股之後，加碼、減碼、除息、到價提醒都會集中在這裡。'}</span></section>`;
  }
  html += marketHTML();
  const rows = settings.watch.map((c) => S.rows.get(c)).filter(Boolean);
  html += `<div class="sec-h"><h2>關注</h2><span class="aside">${rows.length} 檔　觀點尺度約 1 個月</span></div>`;
  html += rows.length ? `<section class="panel list watch">${rows.map(watchRow).join('')}</section>` : '<section class="panel empty">還沒有關注的 ETF。到「雷達」點任一檔，按右上角星號加入。</section>';
  html += `<p class="disclaim">資料來自證交所、櫃買中心、集保結算所等官方發布；觀點與建議由固定規則計算，不保證報酬，買賣請自行判斷。</p>`;
  v.innerHTML = html;
  $$('[data-code]', v).forEach((b) => b.addEventListener('click', () => openDetail(b.dataset.code)));
  bindHero(v, P);
  bindInstall(v);
  animateNeedles(v);
}

function heroHTML(P) {
  const has = P && (P.holdings.length || P.totals.cash > 0);
  const segs = [];
  if (has) {
    for (const x of P.holdings) if (x.mv > 0) segs.push({ v: x.mv, col: slotVar(x.slot), name: x.name, code: x.code });
    if (P.totals.cash > 0) segs.push({ v: P.totals.cash, col: 'var(--s-cash)', name: '現金', code: null });
  }
  const t = has ? P.totals : null;
  const anim = S.firstPaint && !reduceMotion();
  const center = has
    ? `<div class="ic-k">總資產</div>
       <div class="ic-v" id="ic-v">${money(t.T)}</div>
       <div class="ic-d num ${dirCls(t.day)}">${arrow(t.day)} ${money(Math.abs(t.day))}<small>今日 ${fmt.r(t.dayPct, 2)}</small></div>
       <div class="ic-r">${t.cost > 0 ? `報酬 <b class="num ${dirCls(t.pnl)}">${fmt.r(t.pct)}</b>` : ''}${t.divRecv > 0 ? `<span>已領息 <b class="num">${money(t.divRecv)}</b></span>` : ''}</div>`
    : `<div class="ic-k">還沒有持股</div><button class="btn primary small" id="first-trade">${ICON.plus}記第一筆</button><button class="link small" id="first-cash">或先設定可投入現金</button>`;
  const legend = has ? `<ul class="iris-legend">${segs.map((s) => `<li${s.code ? ` data-code="${s.code}"` : ''}><i style="background:${s.col}"></i><span class="nm">${esc(s.code ? s.name : s.name)}</span><b class="num">${fmt.r(s.v / t.T, 0, false)}</b></li>`).join('')}</ul>` : `<p class="iris-hint">輸入持股，冷眼會算出成本、損益、已領配息，並依你的紀律給加碼與減碼建議。資料只存在這支手機。</p>`;
  return `<section class="iris${anim ? ' anim' : ''}" aria-label="我的資產">
    <div class="iris-box">${irisSVG(segs, anim)}<div class="sweep" aria-hidden="true"></div><div class="iris-c">${center}</div></div>
    ${legend}
  </section>`;
}
function irisSVG(segs, anim) {
  const C = 160, R = 124;
  const tot = segs.reduce((a, s) => a + s.v, 0);
  let ticks = '';
  for (let k = 0; k < 120; k++) {
    const a = (k / 120) * Math.PI * 2 - Math.PI / 2;
    const major = k % 10 === 0;
    const r1 = major ? 141 : 145, r2 = 151;
    ticks += `<line class="${major ? 'tk mj' : 'tk'}" x1="${(C + r1 * Math.cos(a)).toFixed(2)}" y1="${(C + r1 * Math.sin(a)).toFixed(2)}" x2="${(C + r2 * Math.cos(a)).toFixed(2)}" y2="${(C + r2 * Math.sin(a)).toFixed(2)}"/>`;
  }
  let arcs = '';
  if (tot > 0 && segs.length === 1) {
    arcs = `<circle class="seg${anim ? ' draw' : ''}" cx="${C}" cy="${C}" r="${R}" stroke="${segs[0].col}" pathLength="1" style="--d:0s"/>`;
  } else if (tot > 0) {
    let a0 = -Math.PI / 2;
    const gap = 3 / R;
    segs.forEach((s, i) => {
      const ang = (s.v / tot) * Math.PI * 2;
      const st = a0 + gap / 2;
      const en = a0 + ang - gap / 2;
      a0 += ang;
      if (en <= st) return;
      const large = en - st > Math.PI ? 1 : 0;
      const d = `M${(C + R * Math.cos(st)).toFixed(2)} ${(C + R * Math.sin(st)).toFixed(2)}A${R} ${R} 0 ${large} 1 ${(C + R * Math.cos(en)).toFixed(2)} ${(C + R * Math.sin(en)).toFixed(2)}`;
      arcs += `<path class="seg${anim ? ' draw' : ''}" d="${d}" stroke="${s.col}" pathLength="1" style="--d:${(0.15 + i * 0.12).toFixed(2)}s"><title>${esc(s.name)} ${(s.v / tot * 100).toFixed(1)}%</title></path>`;
    });
  } else {
    arcs = `<circle class="seg empty" cx="${C}" cy="${C}" r="${R}"/>`;
  }
  const cross = [0, 90, 180, 270].map((deg) => {
    const a = (deg * Math.PI) / 180;
    return `<line class="cr" x1="${(C + 104 * Math.cos(a)).toFixed(2)}" y1="${(C + 104 * Math.sin(a)).toFixed(2)}" x2="${(C + 96 * Math.cos(a)).toFixed(2)}" y2="${(C + 96 * Math.sin(a)).toFixed(2)}"/>`;
  }).join('');
  return `<svg class="iris-svg" viewBox="0 0 320 320" role="img" aria-label="資產配置環">
    <defs><radialGradient id="glow" cx="50%" cy="45%" r="55%"><stop offset="0" stop-color="var(--glow-1)"/><stop offset=".55" stop-color="var(--glow-2)"/><stop offset="1" stop-color="transparent"/></radialGradient></defs>
    <circle cx="${C}" cy="${C}" r="158" fill="url(#glow)"/>
    <g class="bezel">${ticks}</g>
    <path class="north" d="M${C} 4l5 8h-10z"/>
    <circle class="ring-track" cx="${C}" cy="${C}" r="${R}"/>
    ${arcs}
    <circle class="reticle" cx="${C}" cy="${C}" r="104"/>${cross}
  </svg>`;
}
function bindHero(v, P) {
  const ft = $('#first-trade', v);
  if (ft) ft.addEventListener('click', () => openTradeForm({}));
  const fc = $('#first-cash', v);
  if (fc) fc.addEventListener('click', () => openCashForm());
  $$('.iris-legend li[data-code]', v).forEach((li) => li.addEventListener('click', () => openDetail(li.dataset.code)));
  const box = $('.iris-box', v);
  if (box && P && P.holdings.length) box.addEventListener('click', (e) => { if (!e.target.closest('button')) go('pf'); });
  if (S.firstPaint && P && P.totals.T > 0) {
    const el = $('#ic-v', v);
    countUp(el, P.totals.T, (z) => money(z));
  }
  if (S.firstPaint && !reduceMotion()) S.animUntil = performance.now() + 1700;
  S.firstPaint = false;
}

function chip(t, cls) { return `<span class="chip act ${cls}">${t}</span>`; }
function buildActions(P) {
  const out = [];
  for (const h of checkAlerts()) {
    out.push({ pri: 0, code: h.row.c, chip: chip('到價', 'alert'), title: h.row.n, text: `${h.a.op === 'le' ? '跌到' : '漲到'}你設定的 <b class="num">${fmt.px(h.a.px)}</b>，現價 <b class="num">${fmt.px(h.q.px)}</b>` });
  }
  if (P) {
    for (const x of P.holdings) {
      const a = S.adv.get(x.code);
      if (!a) continue;
      if (a.key === 'trim' || a.key === 'rebalance') {
        out.push({ pri: 0, code: x.code, chip: chip(a.label, 'warn2'), title: x.name, text: a.sell ? `建議賣出 ${sharesOf(a.sell.n)}：${esc(a.sell.why)}` : esc((a.lines.find((l) => l.kind === 'con') || a.lines[0] || {}).text || '') });
      } else if (a.key === 'pause' || a.key === 'hold_off') {
        const why = a.lines.find((l) => l.kind === 'con');
        out.push({ pri: 2, code: x.code, chip: chip(a.label, 'warn'), title: x.name, text: esc(why ? why.text : '規則建議先觀察') });
      } else if (a.key === 'add') {
        const p = a.plan;
        out.push({ pri: 1, code: x.code, chip: chip(a.label, 'go'), title: x.name, text: p && p.n > 0 ? `這次最多 ${sharesOf(p.n)}，分 3 批；出場線 <b class="num">${fmt.px(p.stop)}</b>` : `訊號可加碼，但${p && p.limit === 'cash' ? (p.cash > 0 ? '分到的現金不夠' : '還沒設定可投入現金') : '比重或風險預算已滿'}` });
      }
      if (x.nextDiv && PF.daysBetween(today(), x.nextDiv.d) <= PF.DIV_SOON_DAYS) {
        out.push({ pri: 2, code: x.code, chip: chip('除息', 'info'), title: x.name, text: `${fmt.d(x.nextDiv.d)} 除息${x.nextDiv.cash ? `，每單位 ${cash3(x.nextDiv.cash)} 元，預估領 <b class="num">${money(x.nextDiv.amt)}</b> 元` : '，金額待公告'}` });
      }
    }
  }
  for (const c of S.changes || []) {
    const r = S.rows.get(c.c);
    if (!r) continue;
    const t = (z) => `${ST[String(z[0])] ? ST[String(z[0])].t : '—'}${z[1] && POS[z[1]] ? '／' + POS[z[1]].t : ''}`;
    out.push({ pri: 1, code: c.c, chip: chip('變化', 'info'), title: r.n, text: `規則訊號：${t(c.from)} → <b>${t(c.to)}</b>` });
  }
  const held = new Set(P ? P.holdings.map((x) => x.code) : []);
  for (const code of settings.watch) {
    if (held.has(code)) continue;
    const r = S.rows.get(code);
    if (!r) continue;
    const q = quote(r);
    const fl = r.fl || [];
    if (fl.includes('disposal') || fl.includes('notice')) out.push({ pri: 1, code, chip: chip('注意', 'warn'), title: r.n, text: `被列為${fl.includes('disposal') ? '處置' : '注意'}標的，交易受限` });
    const [w] = premBand(r);
    if (isNum(q.prem) && q.prem > w) out.push({ pri: 2, code, chip: chip('溢價', 'warn'), title: r.n, text: `溢價 <b class="num">${q.prem.toFixed(2)}%</b>，現在買等於多付錢` });
    if (r.dv && r.dv.d >= today() && PF.daysBetween(today(), r.dv.d) <= 10) out.push({ pri: 3, code, chip: chip('除息', 'info'), title: r.n, text: `${fmt.d(r.dv.d)} 除息${r.dv.cash ? `，每單位 ${cash3(r.dv.cash)} 元` : ''}` });
  }
  const seen = new Set();
  return out.sort((a, b) => a.pri - b.pri).filter((a) => { const k = a.code + a.chip; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 9);
}

function marketHTML() {
  const m = S.summary.market;
  if (!m) return '';
  const tx = S.live && S.live.taiex && S.live.open && isNum(S.live.taiex.z) ? S.live.taiex : null;
  const px = tx ? tx.z : m.close;
  const ch = tx ? tx.z - tx.y : m.chg;
  const pc = tx ? (tx.z / tx.y - 1) * 100 : m.pct;
  const above = isNum(m.ma60) ? px >= m.ma60 : null;
  const ins = m.insti;
  return `<div class="sec-h"><h2>大盤</h2><span class="aside">${tx ? `盤中 ${esc(tx.t || '')}` : `${fmt.d(m.d)} 收盤`}</span></div>
    <section class="panel market">
      <div class="mk-l"><div class="mk-n">加權指數</div><div class="mk-p num">${fmt.n(px, 2)}</div><div class="mk-c num ${dirCls(ch)}">${arrow(ch)} ${fmt.n(Math.abs(ch ?? NaN), 2)}　${fmt.pct(pc)}</div></div>
      <div class="mk-r">${sparkSVG(m.spark, 120, 44, ch)}<div class="small muted">${above == null ? '' : above ? `季線 ${fmt.n(m.ma60, 0)} 之上` : `跌破季線 ${fmt.n(m.ma60, 0)}`}</div></div>
      ${ins ? `<div class="mk-f">${[['外資', ins.f], ['投信', ins.t], ['自營商', ins.d]].map(([k, z]) => `<span>${k}<b class="num ${dirCls(z)}">${z > 0 ? '+' : ''}${fmt.big(z)}</b></span>`).join('')}<span class="muted small">${fmt.d(ins.date)} 買賣超</span></div>` : ''}
    </section>`;
}

function watchRow(row) {
  const q = quote(row);
  const held = !!heldOf(row.c);
  return `<button class="w-row" data-code="${row.c}" aria-label="${esc(row.n)} 詳情">
    <span class="w-id"><span class="w-name">${esc(row.n)}${held ? '<i class="mine-dot" title="持有中"></i>' : ''}</span><span class="w-code num">${row.c}<span>${esc(catName(row.k))}</span></span></span>
    ${sparkSVG(row.sp, 58, 26, q.pc)}
    <span class="w-px"><span class="p num">${fmt.px(q.px)}</span><span class="c num ${dirCls(q.pc)}">${arrow(q.pc)}${isNum(q.pc) ? Math.abs(q.pc).toFixed(2) + '%' : '—'}</span></span>
    <span class="w-sig">${stanceChip(row.st)}${posChip(row.ps)}${row.cf != null ? `<span class="small muted">信心 <b class="num">${row.cf}</b></span>` : ''}</span>
    <span class="w-g">${gaugeSVG(row.sc, row.st)}</span>
  </button>`;
}

function stallHTML() {
  const f = freshness();
  if (!f.stall) return '';
  const newest = [S.live && S.live.at, S.summary.generated].filter(Boolean).sort().pop();
  return `<section class="panel pad stall" role="alert"><b>後台已經 ${durShort(minsAgo(newest))}沒有更新了</b><span>正常情況下交易日每 5 分鐘、週末至少一次。可能是 GitHub 的排程停了；畫面上是 ${fmt.d(S.summary.asof)} 的資料。請找 Claude 檢查「冷眼的後台」。</span></section>`;
}
function installCard() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone || settings.installHidden) return '';
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const msg = ios ? '在 Safari 點下方「分享」→「加入主畫面」，之後就像 App 一樣從主畫面開啟。' : '加到主畫面，之後像 App 一樣一鍵開啟。';
  return `<section class="panel install"><p>${msg}</p><div class="row-btns">${!ios && S.deferredInstall ? '<button class="btn primary small" id="doInstall">加入</button>' : ''}<button class="btn ghost small" id="hideInstall">知道了</button></div></section>`;
}
function bindInstall(v) {
  const h = $('#hideInstall', v);
  if (h) h.addEventListener('click', () => { settings.installHidden = true; saveSettings(); render(); });
  const d = $('#doInstall', v);
  if (d) d.addEventListener('click', async () => { try { S.deferredInstall.prompt(); await S.deferredInstall.userChoice; } catch { /* 取消 */ } S.deferredInstall = null; render(); });
}

// ------------------------------------------------------------------ 部位
function renderPF() {
  const v = $('#view');
  const P = S.P;
  if (!P || (!P.holdings.length && !P.closed.length && !(P.totals.cash > 0))) {
    v.innerHTML = `<div class="sec-h"><h2>我的部位</h2></div>
      <section class="panel pad onboard">
        <p class="lead">記下你的持股，冷眼會幫你：</p>
        <ul class="ticks"><li>用移動平均法算成本，扣掉手續費與證交稅算出真實損益</li><li>依除息紀錄算出已經領到的配息、預估一年領多少</li><li>依你的紀律（比重上限、單筆最多虧多少）算出加碼、減碼的股數</li><li>每天提醒除息、到價、訊號變化</li></ul>
        <div class="row-btns"><button class="btn primary" id="pf-add">${ICON.plus}記一筆交易</button><button class="btn ghost" id="pf-cash">設定可投入現金</button><button class="btn ghost" id="pf-bk">從備份還原</button></div>
        <p class="small muted">已經有持股？「記一筆」時勾選「不記得日期」，輸入目前股數與平均成本就可以。資料只存在這支手機，不會上傳。</p>
      </section>`;
    $('#pf-add', v).addEventListener('click', () => openTradeForm({}));
    $('#pf-cash', v).addEventListener('click', () => openCashForm());
    $('#pf-bk', v).addEventListener('click', () => openBackup());
    return;
  }
  const t = P.totals;
  let html = `<div class="sec-h"><h2>我的部位</h2><button class="btn primary small" id="pf-add">${ICON.plus}記一筆</button></div>
    <section class="panel pf-top">
      <div class="pt-main"><div class="k">總資產</div><div class="pt-v">${money(t.T)}</div>
        <div class="pt-sub">持股市值 <b class="num">${money(t.mv)}</b>　＋　現金 <button class="link num" id="pf-cash">${money(t.cash)}</button></div></div>
      <div class="pt-grid">
        <div><span>未實現損益</span><b class="num ${dirCls(t.pnl)}">${money(t.pnl, true)}</b><small class="num ${dirCls(t.pnl)}">${fmt.r(t.pct)}</small></div>
        <div><span>今日</span><b class="num ${dirCls(t.day)}">${money(t.day, true)}</b><small class="num ${dirCls(t.day)}">${fmt.r(t.dayPct, 2)}</small></div>
        <div><span>已領配息</span><b class="num">${money(t.divRecv)}</b>${t.undated ? '<small class="muted">只算有日期的交易</small>' : ''}</div>
        <div><span>含息總報酬</span><b class="num ${dirCls(t.total)}">${money(t.total, true)}</b><small class="muted">損益＋已實現＋配息</small></div>
        ${Math.abs(t.realized) >= 1 ? `<div><span>已實現損益</span><b class="num ${dirCls(t.realized)}">${money(t.realized, true)}</b></div>` : ''}
        <div><span>預估一年配息</span><b class="num">${money(t.annual)}</b><small class="muted">依近 12 個月</small></div>
      </div>
      <p class="small muted">損益已扣掉賣出時的手續費與證交稅估計值。${settings.fee.disc < 1 ? `手續費以 ${(settings.fee.disc * 10).toFixed(1).replace(/\.0$/, '')} 折計算。` : '手續費以原價計算，可在設定改成你的折扣。'}</p>
    </section>`;
  html += allocHTML(P);
  html += `<div class="sec-h"><h2>持股</h2><span class="aside">${P.holdings.length} 檔　依市值排序</span></div>
    <section class="panel list holds">${P.holdings.map(holdRow).join('')}</section>`;
  html += divCalHTML(P);
  html += riskHTML(P);
  if (P.closed.length) {
    html += `<div class="sec-h"><h2>已出清</h2></div><section class="panel list">${P.closed.map((x) => `<button class="w-row closed" data-code="${x.code}"><span class="w-id"><span class="w-name">${esc(x.name)}</span><span class="w-code num">${x.code}</span></span><span class="w-px"><span class="small muted">已實現</span><span class="p num ${dirCls(x.h.realized)}">${money(x.h.realized, true)}</span></span></button>`).join('')}</section>`;
  }
  html += txHTML();
  html += `<section class="panel pad row-between"><div><b>備份與搬家</b><div class="small muted">持股只存在這支手機，換手機前先備份。</div></div><button class="btn ghost small" id="pf-bk">備份</button></section>`;
  v.innerHTML = html;
  $('#pf-add', v).addEventListener('click', () => openTradeForm({}));
  $('#pf-cash', v).addEventListener('click', () => openCashForm());
  $('#pf-bk', v).addEventListener('click', () => openBackup());
  $$('[data-code]', v).forEach((b) => b.addEventListener('click', () => openDetail(b.dataset.code)));
  $$('[data-lot]', v).forEach((b) => b.addEventListener('click', () => { const lot = book.lots.find((l) => l.id === b.dataset.lot); if (lot) openTradeForm({ lot }); }));
  const more = $('#tx-more', v);
  if (more) more.addEventListener('click', () => { S.txAll = true; renderPF(); });
}

function allocHTML(P) {
  const t = P.totals;
  if (!(t.T > 0)) return '';
  const segs = P.holdings.filter((x) => x.mv > 0).map((x) => ({ v: x.mv, col: slotVar(x.slot), name: x.name, code: x.code, cat: x.cat, w: x.w }));
  if (t.cash > 0) segs.push({ v: t.cash, col: 'var(--s-cash)', name: '現金', code: null, w: t.cash / t.T });
  const bar = segs.map((s) => `<span style="flex:${s.v.toFixed(0)} 1 0;background:${s.col}" title="${esc(s.name)} ${(s.w * 100).toFixed(1)}%"></span>`).join('');
  const rows = segs.map((s) => {
    if (!s.code) return `<li><i style="background:${s.col}"></i><span class="nm">現金</span><span class="cap"></span><b class="num">${fmt.r(s.w, 1, false)}</b></li>`;
    const cap = PF.capOf(settings.risk, s.cat);
    const over = s.w > cap + PF.OVER_TOL;
    return `<li data-code="${s.code}"><i style="background:${s.col}"></i><span class="nm">${esc(s.name)}<small>${esc(catName(s.cat))}</small></span>
      <span class="cap${over ? ' over' : ''}" role="img" aria-label="比重 ${(s.w * 100).toFixed(1)}%，上限 ${(cap * 100).toFixed(0)}%"><span class="fill" style="width:${clamp(s.w / Math.max(cap, s.w) * 100, 0, 100).toFixed(1)}%"></span><span class="lim" style="left:${clamp(cap / Math.max(cap, s.w) * 100, 0, 100).toFixed(1)}%"></span></span>
      <b class="num${over ? ' over' : ''}">${fmt.r(s.w, 1, false)}<small> / ${(cap * 100).toFixed(0)}%</small></b></li>`;
  }).join('');
  return `<div class="sec-h"><h2>配置</h2><span class="aside">${esc(PF.PROFILES[settings.risk].name)}型上限</span></div>
    <section class="panel pad alloc"><div class="a-bar" role="img" aria-label="資產配置">${bar}</div><ul class="a-list">${rows}</ul></section>`;
}

function holdRow(x) {
  const a = S.adv.get(x.code);
  const q = x.q || {};
  return `<button class="h-row" data-code="${x.code}">
    <span class="h-top"><i class="h-dot" style="background:${slotVar(x.slot)}"></i><span class="h-name">${esc(x.name)}<small class="num">${x.code}</small></span>${actChip(a)}</span>
    <span class="h-mid"><span>${sharesOf(x.h.sh)}　均價 <b class="num">${settings.privacy ? '••••' : fmt.px(x.h.avg)}</b></span><span>現價 <b class="num">${fmt.px(x.px)}</b> <span class="num ${dirCls(q.pc)}">${fmt.pct(q.pc)}</span></span></span>
    <span class="h-bot"><span class="num ${dirCls(x.pnl)}">${money(x.pnl, true)}<small>${fmt.r(x.pct)}</small></span><span class="muted">${x.divRecv > 0 ? `已領息 <span class="num">${money(x.divRecv)}</span>　` : ''}比重 <span class="num">${fmt.r(x.w, 1, false)}</span></span></span>
  </button>`;
}

function divCalHTML(P) {
  const t = P.totals;
  if (!(t.annual > 0)) return '';
  const hs = P.holdings.filter((x) => x.annual > 0);
  const mx = Math.max(...t.months, 1);
  const W = 336, H = 132, pb = 18, pt = 16, bw = 16;
  const step = W / 12;
  const { m: curM } = twParts();
  let cols = '';
  for (let k = 0; k < 12; k++) {
    let y = H - pb;
    const x0 = k * step + (step - bw) / 2;
    let stack = '';
    const parts = hs.map((x) => ({ x, v: x.months[k] })).filter((z) => z.v > 0);
    parts.forEach((z, i) => {
      const hgt = (z.v / mx) * (H - pb - pt);
      const top = y - hgt;
      const last = i === parts.length - 1;
      stack += `<rect x="${x0.toFixed(1)}" y="${top.toFixed(1)}" width="${bw}" height="${Math.max(1, hgt - (last ? 0 : 2)).toFixed(1)}" rx="${last ? 4 : 0}" fill="${slotVar(z.x.slot)}"><title>${z.x.name} ${Math.round(z.v)} 元</title></rect>`;
      y = top;
    });
    const total = t.months[k];
    cols += `<g class="dm${k + 1 === curM ? ' now' : ''}">${stack}${total > 0 && !settings.privacy ? `<text x="${(x0 + bw / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" class="ax">${total >= 10000 ? (total / 10000).toFixed(1) + '萬' : Math.round(total).toLocaleString('en-US')}</text>` : ''}<text x="${(x0 + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle" class="ax${k + 1 === curM ? ' cur' : ''}">${k + 1}</text></g>`;
  }
  const next = P.holdings.filter((x) => x.nextDiv).sort((a, b) => a.nextDiv.d - b.nextDiv.d);
  return `<div class="sec-h"><h2>領息月曆</h2><span class="aside">依過去 12 個月的除息月份</span></div>
    <section class="panel pad divcal">
      <div class="dc-h">預估一年 <b class="num">${money(t.annual)}</b> 元<small>　平均每月 ${money(t.annual / 12)} 元</small></div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="各月份預估配息"><line x1="0" x2="${W}" y1="${H - pb}" y2="${H - pb}" class="base"/>${cols}</svg>
      ${hs.length > 1 ? `<ul class="dc-leg">${hs.map((x) => `<li><i style="background:${slotVar(x.slot)}"></i><span class="nm">${esc(x.name)}</span><b class="num">${money(x.annual)}</b></li>`).join('')}</ul>` : ''}
      ${next.length ? `<div class="dc-next">${next.map((x) => `<button data-code="${x.code}">${ICON.cal}<span><b>${fmt.d(x.nextDiv.d)}</b> ${esc(x.name)} 除息${x.nextDiv.cash ? `，預估領 <b class="num">${money(x.nextDiv.amt)}</b> 元` : '，金額待公告'}</span></button>`).join('')}</div>` : ''}
      <p class="small muted">實際入帳通常在除息後 2～4 週。單次 2 萬元以上，股利所得部分會先扣 2.11% 二代健保補充保費。</p>
    </section>`;
}

function riskHTML(P) {
  const s = PF.stressToStops(P.holdings, { T: P.totals.T });
  const past = P.holdings.filter((x) => x.row && isNum(x.row.dl) && isNum(x.px) && x.px < x.row.dl && !s.items.some((z) => z.code === x.code));
  if (!s.items.length && !past.length) return '';
  const mx = Math.max(...s.items.map((z) => Math.abs(z.drop)), 1);
  return `<div class="sec-h"><h2>風險地圖</h2><span class="aside">如果每一檔都跌到出場線</span></div>
    <section class="panel pad risk">
      <div class="rk-h">最多約 <b class="num down">${money(s.loss)}</b> 元<small>　總資產 ${fmt.r(s.pct, 2)}</small></div>
      <ul class="rk-list">${s.items.map((z) => `<li data-code="${z.code}"><span class="nm">${esc(z.name)}<small class="num">出場線 ${fmt.px(z.stop)}（${fmt.r(z.pct, 1)}）</small></span><span class="rk-bar"><i style="width:${(Math.abs(z.drop) / mx * 100).toFixed(1)}%"></i></span><b class="num">${money(z.drop)}</b></li>`).join('')}
      ${past.map((x) => `<li data-code="${x.code}" class="past"><span class="nm">${esc(x.name)}<small class="num">已在移動防守線 ${fmt.px(x.row.dl)} 之下</small></span><span class="rk-note">${esc((S.adv.get(x.code) || {}).label || '')}</span><b></b></li>`).join('')}</ul>
      <p class="small muted">出場線：偏多時用作廢線，其他用移動防守線。這是「照紀律出場時」的最壞情況，不是預測；跳空大跌時實際虧損可能更多。</p>
    </section>`;
}

function txHTML() {
  const lots = book.lots.slice().sort((a, b) => (b.d || 0) - (a.d || 0) || String(b.at || '').localeCompare(String(a.at || '')));
  if (!lots.length) return '';
  const show = S.txAll ? lots : lots.slice(0, 12);
  return `<div class="sec-h"><h2>交易紀錄</h2><span class="aside">${lots.length} 筆</span></div>
    <section class="panel list journal">${show.map((l) => {
    const r = S.rows.get(l.c);
    return `<button class="j-row" data-lot="${l.id}"><span class="j-d num">${l.d ? fmt.dy(l.d) : '未填日期'}</span><span class="j-m"><span class="j-l1"><b class="${l.side === 'sell' ? 'sell' : 'buy'}">${l.side === 'sell' ? '賣出' : '買進'}</b> ${esc(r ? r.n : l.c)}</span><span class="j-l2">${sharesOf(l.sh)} × <span class="num">${fmt.px(l.px)}</span></span>${l.note ? `<span class="j-note">${esc(l.note)}</span>` : ''}</span><span class="chev">${ICON.chev}</span></button>`;
  }).join('')}${lots.length > show.length ? `<button class="more" id="tx-more">顯示全部 ${lots.length} 筆</button>` : ''}</section>`;
}

// ------------------------------------------------------------------ 雷達（全部 ETF）
function renderRadar() {
  const v = $('#view');
  const cats = ['*', 'broad', 'div', 'theme', 'overseas', 'bond', 'active', 'lev', 'inv', 'fut'];
  const sigs = [['*', '全部訊號'], ['add', '可加碼'], ['wait', '漲多分批'], ['hold', '續抱'], ['caution', '先不加碼'], ['trim', '減碼']];
  v.innerHTML = `
    <div class="toolbar">
      <label class="search">${ICON.search}<input id="q" type="search" inputmode="search" placeholder="搜尋代號或名稱，例如 0050、高股息" value="${esc(S.all.q)}" autocomplete="off"></label>
      <div class="hscroll" id="cats">${cats.map((c) => `<button class="pill" data-cat="${c}" aria-pressed="${S.all.cat === c}">${c === '*' ? '全部類型' : CAT[c]}</button>`).join('')}</div>
      <div class="hscroll" id="sigs">${sigs.map(([k, t]) => `<button class="pill${k !== '*' ? ' sig-' + k : ''}" data-sig="${k}" aria-pressed="${S.all.sig === k}">${t}</button>`).join('')}</div>
      <div class="sortrow"><span>排序</span><select id="sort" aria-label="排序方式">
        ${[['score', '觀點分數（高→低）'], ['score_r', '觀點分數（低→高）'], ['chg', '今日漲跌'], ['val', '成交值'], ['yield', '殖利率'], ['prem', '溢價（高→低）'], ['code', '代號']].map(([k, t]) => `<option value="${k}"${S.all.sort === k ? ' selected' : ''}>${t}</option>`).join('')}
      </select><span id="cnt" class="cnt"></span></div>
    </div>
    <section class="panel list" id="list"></section>`;
  $('#q', v).addEventListener('input', (e) => { S.all.q = e.target.value; renderRadarList(); });
  $$('#cats .pill', v).forEach((b) => b.addEventListener('click', () => { S.all.cat = b.dataset.cat; $$('#cats .pill', v).forEach((z) => z.setAttribute('aria-pressed', z === b)); renderRadarList(); }));
  $$('#sigs .pill', v).forEach((b) => b.addEventListener('click', () => { S.all.sig = b.dataset.sig; $$('#sigs .pill', v).forEach((z) => z.setAttribute('aria-pressed', z === b)); renderRadarList(); }));
  $('#sort', v).addEventListener('change', (e) => { S.all.sort = e.target.value; renderRadarList(); });
  renderRadarList();
}
function renderRadarList() {
  const list = $('#list');
  if (!list) return;
  const q = S.all.q.trim().toLowerCase();
  let rows = S.summary.etfs.filter((r) => (S.all.cat === '*' || r.k === S.all.cat) && (S.all.sig === '*' || r.ps === S.all.sig) && (!q || r.c.toLowerCase().includes(q) || (r.n || '').toLowerCase().includes(q)));
  const key = {
    score: (r) => (r.sc ?? -99), score_r: (r) => -(r.sc ?? 99), chg: (r) => (quote(r).pc ?? -99), val: (r) => (r.val ?? 0),
    yield: (r) => (r.y ?? -1), prem: (r) => (quote(r).prem ?? -99), code: null,
  }[S.all.sort];
  rows = key ? rows.sort((a, b) => key(b) - key(a)) : rows.sort((a, b) => a.c.localeCompare(b.c));
  $('#cnt').textContent = `${rows.length} 檔`;
  if (!rows.length) { list.innerHTML = '<div class="empty">找不到符合的 ETF</div>'; return; }
  list.innerHTML = rows.slice(0, 400).map((r) => {
    const qq = quote(r);
    const extra = S.all.sort === 'yield' && isNum(r.y) ? `殖利率 ${r.y.toFixed(2)}%` : S.all.sort === 'prem' && isNum(qq.prem) ? `${qq.prem >= 0 ? '溢價' : '折價'} ${Math.abs(qq.prem).toFixed(2)}%` : S.all.sort === 'val' && isNum(r.val) ? `${fmt.big(r.val)}元` : '';
    const held = !!heldOf(r.c);
    return `<button class="l-row" data-code="${r.c}"><span class="nm"><b>${esc(r.n)}${held ? '<i class="mine-dot" title="持有中"></i>' : ''}</b><span class="meta"><span class="num">${r.c}</span><span>${esc(catName(r.k))}</span>${extra ? `<span>${extra}</span>` : ''}</span></span><span class="sig">${stanceChip(r.st)}${posChip(r.ps)}</span><span class="pxc"><span class="p num">${fmt.px(qq.px)}</span><span class="c num ${dirCls(qq.pc)}">${fmt.pct(qq.pc)}</span></span></button>`;
  }).join('');
  $$('.l-row', list).forEach((b) => b.addEventListener('click', () => openDetail(b.dataset.code)));
}

// ------------------------------------------------------------------ 情報
async function renderNews() {
  const v = $('#view');
  if (!S.news) {
    v.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    try { S.news = await getJSON('news.json'); } catch { v.innerHTML = '<section class="panel empty">情報暫時載入失敗，稍後再試。</section>'; return; }
    if (S.tab !== 'news') return;
  }
  const N = S.news;
  const tabs = [['official', '官方公告'], ['fact', '事實新聞'], ['divs', '除息行事曆'], ['risk', '風險名單']];
  const SRCN = { twse_news: '證交所', fsc: '金管會', cbc: '中央銀行', cna: '中央社' };
  let body = '';
  if (S.newsTab === 'official' || S.newsTab === 'fact') {
    const want = S.newsTab;
    const items = N.items.filter((x) => (want === 'official' ? x.kind === 'official' : x.kind === 'fact' || (settings.opinion && x.kind === 'opinion')));
    const hidden = want === 'fact' ? N.items.filter((x) => x.kind === 'opinion').length : 0;
    body = `<section class="panel list news">${items.length ? items.slice(0, 120).map((x) => `<a class="n-item${x.kind === 'opinion' ? ' op' : ''}" href="${esc(x.url)}" target="_blank" rel="noopener"><span class="n-meta"><span class="tag${x.kind === 'official' ? ' off' : x.kind === 'opinion' ? ' op' : ''}">${SRCN[x.src] || esc(x.src)}${x.kind === 'opinion' ? '・含評論或情緒用語' : ''}</span><span class="num">${fmt.d(x.d)}</span>${(x.codes || []).map((c) => `<span class="num code">${c}</span>`).join('')}</span><span class="n-t">${esc(x.t)}</span></a>`).join('') : '<div class="empty">近三週沒有資料</div>'}</section>`;
    if (want === 'fact') body = `<p class="disclaim">只收中央社的財經即時新聞。標題含預測、推薦、情緒性用語的 ${hidden} 則${settings.opinion ? '以淡色顯示' : '已先藏起來，可在設定打開'}。</p>` + body;
    else body = '<p class="disclaim">證交所最新消息、金管會與中央銀行新聞稿，全部是官方原文連結。</p>' + body;
  } else if (S.newsTab === 'divs') {
    const watch = new Set(settings.watch);
    const held = new Set(S.P ? S.P.holdings.map((x) => x.code) : []);
    body = `<p class="disclaim">證交所與櫃買中心的除權息預告。你持有的標成紫色，關注的標成藍色。</p><section class="panel tbl-wrap"><table class="t"><thead><tr><th>除息日</th><th>ETF</th><th class="r">每單位</th></tr></thead><tbody>${N.divs.length ? N.divs.map((x) => `<tr class="${held.has(x.c) ? 'mine' : watch.has(x.c) ? 'hl' : ''}"><td class="num">${fmt.d(x.d)}</td><td><b>${esc(x.n)}</b> <span class="muted num">${x.c}</span></td><td class="r num">${x.cash ? cash3(x.cash) + ' 元' : '<span class="muted">待公告</span>'}</td></tr>`).join('') : '<tr><td colspan="3" class="muted">目前沒有預告</td></tr>'}</tbody></table></section>`;
  } else {
    body = `<p class="disclaim">證交所與櫃買中心公布的注意、處置名單。今天全市場共 ${N.risk_total} 筆，以下只列 ETF。</p><section class="panel list news">${N.risk.length ? N.risk.map((x) => `<div class="n-item"><span class="n-meta"><span class="tag op">${x.kind === 'disposal' ? '處置' : '注意'}</span><span class="num">${x.code}</span></span><span class="n-t">${esc(x.name)}　${esc(x.period || x.text || '')}</span></div>`).join('') : '<div class="empty">目前沒有 ETF 被列入注意或處置</div>'}</section>`;
  }
  v.innerHTML = `<div class="hscroll"><div class="seg" role="tablist">${tabs.map(([k, t]) => `<button data-nt="${k}" aria-pressed="${S.newsTab === k}">${t}</button>`).join('')}</div></div>${body}`;
  $$('[data-nt]', v).forEach((b) => b.addEventListener('click', () => { S.newsTab = b.dataset.nt; renderNews(); }));
}

// ------------------------------------------------------------------ 戰績
async function renderTrack() {
  const v = $('#view');
  if (!S.track) {
    v.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    await ensureTrack();
    if (S.tab !== 'track') return;
    if (!S.track) { v.innerHTML = '<section class="panel empty">戰績暫時載入失敗，稍後再試。</section>'; return; }
  }
  const T = S.track;
  const o = T.overall;
  if (!o) { v.innerHTML = '<section class="panel empty">歷史資料還在回補中，完成後這裡會顯示回測結果。</section>'; return; }
  const adj = T.overall_adj || { bull: o.base_up, bear: 1 - o.base_up };
  const pc = (z, d = 1) => (isNum(z) ? (z * 100).toFixed(d) + '%' : '—');
  const delta = (a, b) => (isNum(a) && isNum(b) ? `<b class="${a - b >= 0.02 ? 'good' : a - b > -0.02 ? 'meh' : 'bad'}">${a >= b ? '高' : '低'} ${Math.abs((a - b) * 100).toFixed(1)} 點</b>` : '');
  let html = `<div class="sec-h"><h2>規則觀點的戰績</h2><span class="aside num">${fmt.dy(o.start)}–${fmt.dy(o.end)}</span></div>
    <section class="big2">
      <div class="panel stat"><div class="k">偏多之後 20 日上漲</div><div class="v">${pc(o.bull.hit)}</div><div class="s">同類基準 ${pc(adj.bull)}，${delta(o.bull.hit, adj.bull)}<br><span class="muted">${fmt.n(o.bull.n)} 次</span></div></div>
      <div class="panel stat"><div class="k">偏空之後 20 日下跌</div><div class="v">${pc(o.bear.hit)}</div><div class="s">同類基準 ${pc(adj.bear)}，${delta(o.bear.hit, adj.bear)}<br><span class="muted">${fmt.n(o.bear.n)} 次</span></div></div>
    </section>
    <p class="disclaim">「同類基準」：同一類 ETF 每次都看多（看空）會對幾次，依訊號在各類別的次數加權。直接拿全部 ETF 混在一起比，會因為債券 ETF 偏多訊號少、上漲比例低，而高估規則的優勢（混在一起的基準是 ${pc(o.base_up)}）。</p>`;
  html += posTrackHTML(T);
  html += `<div class="sec-h"><h2>信心分數準不準</h2><span class="aside">方向正確率－同類亂猜</span></div>
    <section class="panel pad vs">${calibRows(T.calib)}<p class="disclaim tight">每一列是該信心區間的方向正確率，減去「同類別、同樣多空比例下亂猜」的正確率。往右越多代表越有參考價值；次數少的區間看看就好。</p></section>`;
  const cats = Object.entries(T.by_cat || {}).filter(([, s]) => s && s.n >= 30).sort((a, b) => b[1].n - a[1].n);
  if (cats.length) {
    const dd = (hit, base, n) => (isNum(hit) && n >= 30 ? `<span class="num">${pc(hit, 0)}</span><br><small class="${hit - base >= 0.02 ? 'good' : 'meh'}">${hit - base >= 0 ? '+' : '−'}${Math.abs((hit - base) * 100).toFixed(1)} 點</small>` : '<span class="muted">—</span>');
    html += `<div class="sec-h"><h2>各類 ETF</h2><span class="aside">差距＝命中率－同類一直看多／看空</span></div><section class="panel tbl-wrap"><table class="t"><thead><tr><th>類別</th><th class="r">偏多命中</th><th class="r">偏空命中</th><th class="r">一直看多</th></tr></thead><tbody>${cats.map(([k, s]) => `<tr><td>${esc(catName(k))}<br><small class="muted">${fmt.n(s.n)} 次</small></td><td class="r">${dd(s.bull.hit, s.base_up, s.bull.n)}</td><td class="r">${dd(s.bear.hit, 1 - s.base_up, s.bear.n)}</td><td class="r num muted">${pc(s.base_up, 0)}</td></tr>`).join('')}</tbody></table></section>
      <p class="disclaim">冰藍色代表比基準準 2 個百分點以上；灰色代表沒有明顯優勢，這類 ETF 的觀點會自動降低信心並標示提醒。</p>`;
  }
  html += '<div class="sec-h"><h2>上線後的實際紀錄</h2></div>';
  if (T.live && T.live.n) {
    const la = T.live_adj || { bull: T.live.base_up, bear: 1 - T.live.base_up };
    html += `<section class="big2"><div class="panel stat"><div class="k">偏多後上漲</div><div class="v">${pc(T.live.bull.hit)}</div><div class="s">同類基準 ${pc(la.bull)}，${delta(T.live.bull.hit, la.bull)}<br><span class="muted">${fmt.n(T.live.bull.n)} 次</span></div></div><div class="panel stat"><div class="k">偏空後下跌</div><div class="v">${pc(T.live.bear.hit)}</div><div class="s">同類基準 ${pc(la.bear)}，${delta(T.live.bear.hit, la.bear)}<br><span class="muted">${fmt.n(T.live.bear.n)} 次</span></div></div></section>`;
  } else {
    html += `<section class="panel pad prose"><p>每天收盤後的觀點都會記錄下來，20 個交易日後自動對答案。目前有 ${fmt.n(T.live_pending)} 筆觀點等待驗證，第一批結果約一個月後出現。</p></section>`;
  }
  html += `<section class="panel pad prose"><p><b>怎麼算的：</b>${esc(T.method.note)}</p><p>命中的定義：偏多之後 20 個交易日含息報酬大於 0；偏空之後小於 0。中性不算命中。回測是用過去資料檢查規則，不代表未來一樣準；這段期間台股大漲，偏多容易對、偏空容易太早。</p></section>`;
  v.innerHTML = html;
  const sel = $('#pos-cat', v);
  if (sel) sel.addEventListener('change', (e) => { S.posCat = e.target.value; renderTrack(); });
}
function posTrackHTML(T) {
  if (!T.pos || !T.pos['*']) return '';
  const cat = S.posCat || '*';
  const st = T.pos[cat] || T.pos['*'];
  const base = (k) => (cat === '*' ? (T.pos_adj || {})[k] : st.all);
  const keys = ['add', 'wait', 'hold', 'caution', 'trim'];
  const pc = (z, d = 0) => (isNum(z) ? (z * 100).toFixed(d) + '%' : '—');
  const rows = keys.filter((k) => st[k] && st[k].n).map((k) => {
    const s = st[k], b = base(k) || {};
    const d = isNum(s.up) && isNum(b.up) ? s.up - b.up : null;
    return `<tr><td>${posChip(k)}<br><small class="muted">${fmt.n(s.n)} 次</small></td><td class="r"><span class="num">${pc(s.up)}</span><br><small class="${d == null ? '' : d >= 0.02 ? 'good' : d > -0.02 ? 'meh' : 'bad'}">${d == null ? '' : `${d >= 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(1)} 點`}</small></td><td class="r num muted">${pc(b.up)}</td><td class="r"><span class="num">${fmt.r(s.p10)}</span><br><small class="muted num">同類 ${fmt.r(b.p10)}</small></td></tr>`;
  }).join('');
  const add = st.add, trim = st.trim;
  const ba = base('add') || {}, bt = base('trim') || {};
  const lines = [];
  if (add && add.n >= 60 && isNum(ba.up)) {
    const d = add.up - ba.up;
    lines.push(Math.abs(d) < 0.02 ? '「可加碼」之後的表現和任何一天差不多：加碼的時機沒有明顯優勢，紀律、分批與比重控制比挑時機重要。' : d > 0 ? '「可加碼」之後的上漲比例比任何一天高一些。' : '「可加碼」之後的表現反而比任何一天差，挑時機加碼在這段期間沒有幫助。');
  }
  if (trim && trim.n >= 60 && isNum(bt.up)) {
    lines.push(trim.up < bt.up - 0.02 && trim.p10 < bt.p10 ? `「減碼」訊號之後上漲比例明顯較低、最差 10% 的跌幅也更大（${fmt.r(trim.p10)} 對 ${fmt.r(bt.p10)}）：規則最有參考價值的地方是提醒風險。` : '「減碼」訊號之後的表現和任何一天差異不大，請當參考就好。');
  }
  const cats = Object.keys(T.pos).filter((k) => k !== '*' && T.pos[k] && T.pos[k].all && T.pos[k].all.n >= 200);
  return `<div class="sec-h"><h2>加碼／減碼訊號的戰績</h2><select id="pos-cat" class="sel" aria-label="類別"><option value="*">全部（同類基準）</option>${cats.map((k) => `<option value="${k}"${cat === k ? ' selected' : ''}>${esc(catName(k))}</option>`).join('')}</select></div>
    <section class="panel tbl-wrap"><table class="t"><thead><tr><th>部位訊號</th><th class="r">20 日上漲</th><th class="r">${cat === '*' ? '同類基準' : '任何一天'}</th><th class="r">最差 10%</th></tr></thead><tbody>${rows}</tbody></table></section>
    ${lines.length ? `<section class="panel pad prose">${lines.map((l) => `<p>${esc(l)}</p>`).join('')}</section>` : ''}`;
}
function calibRows(cal) {
  const b = { 20: '20–49', 50: '50–64', 65: '65–79', 80: '80 以上' };
  const ds = cal.map((z) => (isNum(z.hit) && isNum(z.base) ? (z.hit - z.base) * 100 : null));
  const m = Math.max(2, ...ds.filter(isNum).map(Math.abs));
  return cal.map((z, i) => {
    const d = ds[i];
    const w = isNum(d) ? (Math.abs(d) / m) * 50 : 0;
    return `<div class="bar"><span>信心 ${b[z.lo] || z.lo}<br><small class="muted">${fmt.n(z.n)} 次</small></span><span class="track"><span class="mid"></span><span class="fill ${isNum(d) && d >= 0 ? 'pos' : 'neg'}" style="${isNum(d) && d >= 0 ? 'left:50%' : 'right:50%'};width:${w}%"></span></span><span class="num r">${isNum(d) ? (d >= 0 ? '+' : '') + d.toFixed(1) + ' 點' : '—'}</span></div>`;
  }).join('');
}

// ------------------------------------------------------------------ 設定（全螢幕頁）
function openSettings(push = true) {
  S.openCode = '__prefs';
  if (push && location.hash !== '#settings') history.pushState({ prefs: 1 }, '', '#settings');
  const sh = $('#sheet');
  sh.hidden = false;
  document.body.classList.add('locked');
  drawSettings();
  sh.scrollTop = 0;
}
function drawSettings() {
  const sh = $('#sheet');
  const prof = PF.PROFILES[settings.risk];
  const wl = settings.watch.map((c, i) => {
    const r = S.rows.get(c);
    return `<div class="wl-row"><span><b>${esc(r ? r.n : c)}</b> <span class="muted num">${c}</span></span>
      <button class="mini-btn" data-mv="${i}" data-d="-1" aria-label="往上移" ${i === 0 ? 'disabled' : ''}>${ICON.upA}</button>
      <button class="mini-btn" data-mv="${i}" data-d="1" aria-label="往下移" ${i === settings.watch.length - 1 ? 'disabled' : ''}>${ICON.downA}</button>
      <button class="mini-btn" data-rm="${c}" aria-label="移除">${ICON.x}</button></div>`;
  }).join('');
  const src = Object.entries((S.summary && S.summary.sources) || {});
  const capRows = Object.keys(CAT).map((k) => `<tr><td>${esc(CAT[k])}</td>${['cons', 'mid', 'aggr'].map((p) => `<td class="r num${p === settings.risk ? ' on' : ''}">${(PF.PROFILES[p].caps[k] * 100).toFixed(0)}%</td>`).join('')}</tr>`).join('');
  sh.innerHTML = `<div class="sheet-top"><button class="icon-btn" id="back" aria-label="返回">${ICON.back}</button><span class="ttl">設定</span></div>
  <div class="sheet-body prefs">
    <div class="sec-h"><h2>個人化</h2></div>
    <section class="panel set">
      <div class="srow"><div><div class="h">怎麼稱呼你</div><div class="d">指揮台的問候語</div></div><input class="input short" id="s-name" maxlength="8" value="${esc(settings.name || '')}" placeholder="PZ"></div>
      <div class="srow"><div><div class="h">隱藏金額與股數</div><div class="d">錄影、截圖、給別人看畫面時用；百分比照常顯示</div></div><button class="switch" role="switch" id="s-priv" aria-checked="${settings.privacy}" aria-label="隱藏金額"></button></div>
      <div class="srow col"><div class="h">外觀</div><div class="seg">${[['system', '跟隨系統'], ['dark', '深色'], ['light', '淺色']].map(([k, t]) => `<button data-theme="${k}" aria-pressed="${settings.theme === k}">${t}</button>`).join('')}</div></div>
    </section>

    <div class="sec-h"><h2>投資紀律</h2></div>
    <section class="panel set">
      <div class="srow col"><div><div class="h">風險屬性</div><div class="d">單筆最多虧總資產 ${(prof.loss * 100).toFixed(1)}%；各類型單檔上限如下表</div></div>
        <div class="seg">${Object.entries(PF.PROFILES).map(([k, p]) => `<button data-risk="${k}" aria-pressed="${settings.risk === k}">${p.name}</button>`).join('')}</div></div>
      <div class="tbl-wrap"><table class="t caps"><thead><tr><th>類型</th><th class="r">保守</th><th class="r">穩健</th><th class="r">積極</th></tr></thead><tbody>${capRows}</tbody></table></div>
      <div class="srow col"><div><div class="h">我的紀律</div><div class="d">加碼試算時會列出來，下單前對一次</div></div>
        <ul class="rules-ed">${(settings.rules || []).map((r, i) => `<li><span>${esc(r)}</span><button class="mini-btn" data-rr="${i}" aria-label="刪除這條">${ICON.x}</button></li>`).join('')}</ul>
        <div class="addrow"><input class="input" id="s-rule" maxlength="40" placeholder="新增一條，例如：除息前不追高"><button class="btn small" id="s-rule-add">新增</button></div>
        ${JSON.stringify(settings.rules) !== JSON.stringify(DEFAULT_RULES) ? '<button class="link small" id="s-rule-reset">恢復預設紀律</button>' : ''}</div>
    </section>

    <div class="sec-h"><h2>交易成本</h2></div>
    <section class="panel set">
      <div class="srow"><div><div class="h">手續費折扣</div><div class="d">例如 6 折填 0.6、2.8 折填 0.28；原價填 1</div></div><input class="input short num" id="s-disc" inputmode="decimal" value="${settings.fee.disc}"></div>
      <div class="srow"><div><div class="h">整股最低手續費</div><div class="d">多數券商 20 元</div></div><input class="input short num" id="s-min" inputmode="numeric" value="${settings.fee.min}"></div>
      <div class="srow"><div><div class="h">零股最低手續費</div><div class="d">多數券商 1 元，依你的券商為準</div></div><input class="input short num" id="s-minodd" inputmode="numeric" value="${settings.fee.minOdd}"></div>
      <p class="small muted pad-x">ETF 賣出證交稅 0.1%；債券 ETF 停徵到 2026 年底。整股與零股分開計算手續費。</p>
    </section>

    <div class="sec-h"><h2>我的關注</h2><span class="aside">${settings.watch.length} 檔</span></div>
    <section class="panel set"><div class="wl">${wl || '<div class="empty">還沒有關注的 ETF</div>'}</div>
      <div class="addbox"><input class="input" id="addq" placeholder="輸入代號或名稱加入，例如 006208" autocomplete="off"><div class="sugg" id="sugg"></div></div></section>

    <div class="sec-h"><h2>到價提醒</h2><span class="aside">${alerts.length} 個</span></div>
    <section class="panel set">${alerts.length ? alerts.map((a) => { const r = S.rows.get(a.c); return `<div class="wl-row"><span><b>${esc(r ? r.n : a.c)}</b> <span class="muted">${a.op === 'le' ? '跌到' : '漲到'}</span> <b class="num">${fmt.px(a.px)}</b></span><span></span><span></span><button class="mini-btn" data-ra="${a.id}" aria-label="刪除提醒">${ICON.x}</button></div>`; }).join('') : '<div class="empty small">在單檔頁右上角的鈴鐺設定</div>'}</section>

    <div class="sec-h"><h2>資料</h2></div>
    <section class="panel set">
      <div class="srow"><div><div class="h">備份與搬家</div><div class="d">持股、交易、提醒只存在這支手機</div></div><button class="btn small ghost" id="s-bk">開啟</button></div>
      <div class="srow"><div><div class="h">清除我的部位</div><div class="d">刪除這支手機裡的全部交易、現金與提醒</div></div><button class="btn small danger ghost" id="s-wipe">清除</button></div>
    </section>

    <div class="sec-h"><h2>顯示</h2></div>
    <section class="panel set">
      <div class="srow"><div><div class="h">定期定額視角</div><div class="d">在每檔詳情加上長期扣款的提醒</div></div><button class="switch" role="switch" id="s-dca" aria-checked="${settings.dca}" aria-label="定期定額視角"></button></div>
      <div class="srow"><div><div class="h">顯示評論與情緒用語新聞</div><div class="d">預設隱藏標題含預測、推薦、渲染字眼的新聞</div></div><button class="switch" role="switch" id="s-op" aria-checked="${settings.opinion}" aria-label="顯示評論新聞"></button></div>
    </section>

    <div class="sec-h"><h2>規則與來源</h2></div>
    <section class="panel">
      <details class="rules"><summary>觀點怎麼算</summary><div class="in prose">${rulesHTML()}</div></details>
      <details class="rules"><summary>加碼、減碼建議怎麼算</summary><div class="in prose">${posRulesHTML()}</div></details>
    </section>
    <section class="panel tbl-wrap"><table class="t"><thead><tr><th>官方來源</th><th class="r">最後成功</th></tr></thead><tbody>${src.map(([, s]) => `<tr><td><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a></td><td class="r muted">${s.ok_at ? fmt.ago(s.ok_at) : '—'}</td></tr>`).join('')}</tbody></table></section>
    <section class="panel pad prose"><p><b>關於冷眼</b>　規則版本 ${esc(S.summary ? S.summary.engine : '')}，資料更新 ${S.summary ? fmt.ago(S.summary.generated) : '—'}。盤中約每 5 分鐘更新價格與預估淨值（GitHub 忙時會晚一點），收盤後陸續補上法人、融資、淨值。</p>
      <p>這是 ${esc(settings.name || 'PZ')} 個人使用的資料整理與規則化分析工具，不是投顧服務。觀點與建議不保證報酬，任何買賣決定請自行判斷並承擔風險。</p></section>
  </div>`;
  bindSettings();
}
function bindSettings() {
  const sh = $('#sheet');
  $('#back', sh).addEventListener('click', () => closeDetail());
  $('#s-name', sh).addEventListener('change', (e) => { settings.name = e.target.value.trim().slice(0, 8) || 'PZ'; saveSettings(); $('#prefs').textContent = avatarText(); renderHeader(); toast('已更新稱呼'); });
  $('#s-priv', sh).addEventListener('click', (e) => { settings.privacy = !settings.privacy; saveSettings(); e.currentTarget.setAttribute('aria-checked', settings.privacy); paintPrivacy(); render(); });
  $$('[data-theme]', sh).forEach((b) => b.addEventListener('click', () => { settings.theme = b.dataset.theme; saveSettings(); applyTheme(); $$('[data-theme]', sh).forEach((z) => z.setAttribute('aria-pressed', z === b)); }));
  $$('[data-risk]', sh).forEach((b) => b.addEventListener('click', () => { settings.risk = b.dataset.risk; saveSettings(); computePF(); render(); drawSettings(); toast(`已改為${PF.PROFILES[settings.risk].name}型`); }));
  $$('[data-rr]', sh).forEach((b) => b.addEventListener('click', () => { settings.rules.splice(+b.dataset.rr, 1); saveSettings(); drawSettings(); }));
  const addRule = () => { const el = $('#s-rule', sh); const t = el.value.trim(); if (!t) return; settings.rules = (settings.rules || []).concat(t.slice(0, 40)); saveSettings(); drawSettings(); toast('已新增紀律'); };
  $('#s-rule-add', sh).addEventListener('click', addRule);
  $('#s-rule', sh).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addRule(); } });
  const rr = $('#s-rule-reset', sh);
  if (rr) rr.addEventListener('click', () => { settings.rules = DEFAULT_RULES.slice(); saveSettings(); drawSettings(); });
  const numSet = (id, key, ok) => $(id, sh).addEventListener('change', (e) => {
    const n = Number(String(e.target.value).replace(/[^0-9.]/g, ''));
    if (ok(n)) { settings.fee[key] = n; saveSettings(); computePF(); render(); toast('交易成本已更新'); }
    e.target.value = settings.fee[key];
  });
  numSet('#s-disc', 'disc', (n) => n > 0 && n <= 1);
  numSet('#s-min', 'min', (n) => n >= 0 && n <= 100);
  numSet('#s-minodd', 'minOdd', (n) => n >= 0 && n <= 100);
  $$('[data-mv]', sh).forEach((b) => b.addEventListener('click', () => { const i = +b.dataset.mv, d = +b.dataset.d, w = settings.watch; [w[i], w[i + d]] = [w[i + d], w[i]]; saveSettings(); drawSettings(); render(); }));
  $$('[data-rm]', sh).forEach((b) => b.addEventListener('click', () => { settings.watch = settings.watch.filter((c) => c !== b.dataset.rm); saveSettings(); drawSettings(); render(); }));
  $$('[data-ra]', sh).forEach((b) => b.addEventListener('click', () => { const k = alerts.findIndex((a) => a.id === b.dataset.ra); if (k >= 0) alerts.splice(k, 1); saveAlerts(); drawSettings(); render(); }));
  $('#s-bk', sh).addEventListener('click', () => openBackup());
  $('#s-wipe', sh).addEventListener('click', (e) => {
    const b = e.currentTarget;
    if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = '確定清除？'; return; }
    wipeBook();
    toast('已清除這支手機裡的部位資料');
    drawSettings();
  });
  $('#s-dca', sh).addEventListener('click', (e) => { settings.dca = !settings.dca; saveSettings(); e.currentTarget.setAttribute('aria-checked', settings.dca); });
  $('#s-op', sh).addEventListener('click', (e) => { settings.opinion = !settings.opinion; saveSettings(); e.currentTarget.setAttribute('aria-checked', settings.opinion); });
  const addq = $('#addq', sh), sugg = $('#sugg', sh);
  addq.addEventListener('input', () => {
    const q = addq.value.trim().toLowerCase();
    if (!q) { sugg.innerHTML = ''; return; }
    const hits = S.summary.etfs.filter((r) => !settings.watch.includes(r.c) && (r.c.toLowerCase().includes(q) || (r.n || '').toLowerCase().includes(q))).slice(0, 8);
    sugg.innerHTML = hits.map((r) => `<button data-add="${r.c}">${esc(r.n)} <span class="num">${r.c}</span></button>`).join('') || '<span class="muted small">找不到</span>';
    $$('[data-add]', sugg).forEach((b) => b.addEventListener('click', () => { settings.watch.push(b.dataset.add); saveSettings(); toast('已加入關注'); drawSettings(); render(); }));
  });
}
function rulesHTML() {
  return `<p>時間尺度：約 1 個月（20 個交易日）。每個面向給 −2 到 +2 分，依權重平均成總分：總分 ≥ +0.5 為偏多、≤ −0.5 為偏空，其餘中性。資料不足的面向不計分，權重自動重新分配。</p>
    <p><b>趨勢（30%）</b>收盤與季線、半年線的位置，月線與季線的相對位置，季線 20 日斜率。</p>
    <p><b>動能（20%）</b>近 20 日、60 日報酬（以自身波動度衡量是否顯著），MACD 柱狀體正負。RSI ≥ 75 或 ≤ 25 只當作警示。</p>
    <p><b>籌碼（15%）</b>外資＋投信近 20 日買賣超占成交量的比例（±3%、±10% 為門檻）；融資餘額 20 日增加 15% 以上但價格下跌扣分，減少 10% 以上而價格上漲加分。</p>
    <p><b>大環境（10%）</b>台股 ETF 看加權指數與其季線；債券 ETF 看美國 20 年期公債殖利率一個月與三個月的變化；反向型方向相反。</p>
    <p><b>折溢價（10%）</b>台股 ETF 溢價超過 0.5% 扣 1 分、超過 1% 扣 2 分；海外、債券、期貨型門檻放寬為 1% 與 2%。折價加 1 分。</p>
    <p><b>殖利率位階（15%）</b>近 12 個月配息除以股價，和自己近兩年的分布比：前 10% 加 2 分、前 30% 加 1 分，後 30% 扣 1 分、後 10% 扣 2 分。</p>
    <p><b>信心</b>＝35 ＋ 35×訊號強度 ＋ 30×面向一致的比例；短線過熱、超賣、資料不足、注意／處置會扣分。中性不給信心。</p>
    <p><b>作廢線</b>偏多時取離現價至少 1 個 ATR 的第一個支撐，偏空時取至少 1 個 ATR 的第一個壓力。收盤跌破（站上）就代表觀點失效。</p>
    <p><b>類別回測把關</b>如果某一類 ETF 在回測中，同方向訊號的命中率沒有比同類「一直看多／一直看空」高 2 個百分點以上，該類的觀點會標示「回測無明顯優勢」並把信心扣 15 分。</p>`;
}
function posRulesHTML() {
  const P = PF.PROFILES;
  return `<p><b>移動防守線</b>近 22 個交易日最高收盤，減 3 倍 ATR（平均真實波幅）。價格創高就跟著上移，下跌時不動；收盤跌破代表前一段上漲已經中斷。</p>
    <p><b>部位訊號</b>依序判斷，先符合先決定：① 觀點偏空且收盤跌破防守線 → 減碼；② 觀點偏空、跌破防守線、注意／處置中、或溢價超過警戒 → 先不加碼；③ 觀點偏多但短線漲多（RSI ≥ 75、爆量上漲、或比月線高出 2 倍 ATR）→ 漲多分批；④ 觀點偏多 → 可加碼；⑤ 其他 → 續抱。</p>
    <p><b>加上你的部位</b>先看注意／處置，再看減碼訊號，接著檢查比重：超過該類型上限 2 個百分點以上就建議調節。可加碼時，股數取這三個的最小值：單筆最多虧損（${P.cons.name} ${(P.cons.loss * 100).toFixed(1)}%、${P.mid.name} ${(P.mid.loss * 100).toFixed(0)}%、${P.aggr.name} ${(P.aggr.loss * 100).toFixed(0)}% 的總資產）÷ 每股到出場線的距離、單檔上限剩下的空間、分到的可用現金（現金分 ${PF.CASH_SLICES} 份，同時超過 ${PF.CASH_SLICES} 檔可加碼時平均分）。觀點中性、或信心不到 ${PF.CONF_FULL}，股數再減半。</p>
    <p><b>分三批</b>第一批現價附近；第二、三批等拉回價，沒等到就一週、兩週後照時間買——回測顯示挑時機的優勢很小，這樣可以避免一直追不到。</p>
    <p><b>出場線</b>偏多時用作廢線，其他用移動防守線。<b>減碼幅度</b>市值型、高股息、海外、債券先減三分之一；產業主題、主動式、期貨先減一半；槓桿與反向全部出場。</p>
    <p><b>成本不影響方向</b>平均成本只用來算損益、損益兩平與「跌到防守線還剩多少獲利」，不會讓規則變成攤平建議。</p>
    <p><b>交易成本</b>手續費＝成交金額 × 0.1425% × 你的折扣，無條件捨去，整股與零股分開計算並各有最低收費；ETF 賣出證交稅 0.1%，債券 ETF 停徵到 2026 年底。</p>
    <p><b>配息</b>除息日前一天（含）以前買進、而且除息日前沒有賣出才領得到；分割前的交易會自動換算股數。單次 2 萬元以上的股利所得部分會扣 2.11% 二代健保補充保費。</p>`;
}
function applyTheme() {
  const r = document.documentElement;
  if (settings.theme === 'system') r.removeAttribute('data-theme');
  else r.setAttribute('data-theme', settings.theme);
  // 狀態列顏色：跟隨系統時各用各的；指定深色／淺色時兩個都改成同一色
  for (const m of $$('meta[name="theme-color"]')) {
    const forDark = (m.getAttribute('media') || '').includes('dark');
    const dark = settings.theme === 'system' ? forDark : settings.theme === 'dark';
    m.content = dark ? '#07101e' : '#edf2f8';
  }
}

// ------------------------------------------------------------------ 事件
bus.on((what) => {
  if (what === 'book' || what === 'watch' || what === 'alerts') {
    if (what !== 'alerts') diffSeen();
    computePF();
    render();
    if (S.openCode === '__prefs') drawSettings();
    else if (S.openCode) renderDetail(S.openCode);
  }
});
window.addEventListener('popstate', () => {
  const h = location.hash.replace('#', '');
  if (modalOpen()) closeModal();
  if (h === 'settings') { if (S.openCode !== '__prefs') openSettings(false); return; }
  if (h && S.rows.has(h)) { openDetail(h, false); return; }
  if (S.openCode) closeDetail(true);
});
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.deferredInstall = e; if (S.tab === 'home' && S.summary) render(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.summary) refreshLive(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (modalOpen()) closeModal();
  else if (S.openCode) closeDetail();
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

async function refreshLive() {
  try {
    S.live = await getJSON('live.json');
    store.set('cache.live', S.live);
    computePF();
    renderHeader();
    if (!S.openCode && (S.tab === 'home' || S.tab === 'pf' || S.tab === 'radar')) render();
    refreshDetailQuote();
  } catch { /* 下次再試 */ }
}

async function boot() {
  applyTheme();
  renderShell();
  if (useCache()) { computePF(); render(); } else render();
  try {
    await loadCore();
  } catch {
    if (!S.summary) { $('#view').innerHTML = '<section class="panel empty">資料還在準備中，請稍後再開。</section>'; return; }
    toast('連不上伺服器，顯示的是上次的資料');
  }
  await Promise.all([ensureTrack(), ensureDivs(true)]);
  diffSeen();
  computePF();
  render();
  const h = location.hash.replace('#', '');
  if (h === 'settings') openSettings(false);
  else if (h && S.rows.has(h)) openDetail(h, false);
  // 盤中（以手機時間判斷，不靠舊的 live.json）每分鐘看一次後台有沒有新資料
  const inSession = () => { const { wd, h, min } = twParts(); const hm = h * 100 + min; return wd >= 1 && wd <= 5 && hm >= 900 && hm <= 1340; };
  setInterval(() => { if (document.visibilityState === 'visible' && ((S.live && S.live.open) || inSession())) refreshLive(); }, 60000);
  setInterval(() => { if (document.visibilityState === 'visible') renderHeader(); }, 30000);
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    Promise.all([loadCore(), ensureDivs(true)]).then(() => { diffSeen(); computePF(); if (!S.openCode) render(); }).catch(() => {});
  }, 15 * 60000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
