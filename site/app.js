/* 冷眼 ColdEye — PZ 的 ETF 指揮台（機甲 HUD 版）。
   資料：同網站的 data/*.json（GitHub Actions 定時從官方來源產生）。
   持股、交易、模擬倉、提醒：只存在這支手機（localStorage），不會上傳。 */
import {
  $, $$, esc, clamp, isNum, reduceMotion, store, settings, saveSettings, book, alerts, saveAlerts, S, bus, fmt, money, sharesOf, cash3,
  dirCls, arrow, twParts, CAT, catName, POS, ST, ICON, getJSON, loadCore, useCache, ensureTrack, ensureDivs, ensureCal, marketClosedOn, ensureHist, quote,
  computePF, hasBook, heldOf, slotVar, stanceChip, posChip, actChip, gaugeSVG, animateNeedles, sparkSVG, toast, countUp,
  today, PF, premBand, DEFAULT_RULES, isPaper, switchMode, reloadBook, isBookKey, journal, saveJournal, reloadJournal, isJournalKey, taiexNow,
  reloadPlans, dayTag, ensureNews, NEWS_MAX_AGE, invalidateBatch, ensureDetail, plainText,
} from './core.js';
import { openDetail, closeDetail, renderDetail, refreshDetailQuote } from './sheet.js';
import { openTradeForm, openCashForm, openBackup, checkAlerts, closeModal, modalOpen, wipeBook, openPaperStart, PAPER_FRESH_MIN, openModal } from './forms.js';
import { installExplain, setExplain, explainOn, glossaryHTML, bindGlossary, openTerm } from './learn.js';
import { irisSVG, heatHTML, heatLegend, heatColor, linesSVG, bindLines } from './viz.js';
import { brief, benchValue, equityCurve } from './calc.js';
import { runPlans, onDcaLotDel, dcaActions, plansHTML, dcaStripHTML, bindPlans, openConfirm, openPending, dcaTagsHTML, dcaAfterWipe } from './dca.js';
import { openDuel, openTM } from './tools.js';
import {
  renderAide, aideHomeHTML, bindAideHome, aideBadge, aideSpeech, refreshEvals, onTrade, onLotDel, onLotEdit, openIdea, openAsk,
  projectText, rulesHTML as aideRulesHTML, hooks as aideHooks, coreSVG,
} from './desk.js';
import * as FX from './fx.js';
import { UPDATES } from './updates.js';
import { lessonHomeHTML, bindLessonHome, openLessonList, LESSONS, seenCount } from './lessons.js';
import { openCase, casesCardHTML } from './cases.js';
import { openCoach, hooks as coachHooks, coachRulesHTML, coachPacket } from './coach.js';
import { xrayPfHTML, bindXrayPf, searchStocks, openStock, coachXray, xrayRulesHTML, refreshStockq } from './xray.js';
import { openLesson } from './lessons.js';
import { AIDE } from './aide.js';
const AIDE_BIG = AIDE.bigMarket;   // 大盤單日漲跌 2% 以上：今日行動請判斷教練帶你看

// 打開之前手機上就有冷眼的資料（老用戶）：有新功能要提示；全新的人不跳
const HAD_SAVE = (() => { try { return Object.keys(localStorage).some((k) => k.startsWith('coldeye.') && k !== 'coldeye.settings'); } catch { return false; } })();

// ------------------------------------------------------------------ 分頁
const TABS = [
  { id: 'home', t: '指揮台', svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.3" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 1.8v3M12 19.2v3M1.8 12h3M19.2 12h3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>' },
  { id: 'pf', t: '部位', svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6a8.4 8.4 0 1 0 8.4 8.4H12z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M14.6 2.4a7.6 7.6 0 0 1 7 7H14.6z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>' },
  { id: 'radar', t: '雷達', svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="4.4" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".7"/><path d="M12 12 18 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="15.6" cy="15" r="1.4" fill="currentColor"/></svg>' },
  { id: 'aide', t: '副官', svg: ICON.aide, core: true },
  { id: 'news', t: '情報', svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h11l5 5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 11h8M8 14.5h8M8 18h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>' },
  { id: 'track', t: '戰績', svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 19.5h15M7 16v-4.5M12 16V7.5M17 16v-7" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>' },
];
const TOOL_ICON = {
  duel: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4l9.5 9.5M4 4h3.5M4 4v3.5M20 4l-9.5 9.5M20 4h-3.5M20 4v3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M6.5 15.5l2 2M17.5 15.5l-2 2M5 19l2.5-2.5M19 19l-2.5-2.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  tm: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.6 12a8.4 8.4 0 1 0 2.5-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M3.2 3.6v4.2h4.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};

// ------------------------------------------------------------------ 外框
function renderShell() {
  document.body.innerHTML = `
    <div class="bg" aria-hidden="true"></div>
    <header class="top" id="top">
      <button class="seal" id="seal" aria-label="冷眼：回到指揮台"><span>冷</span><span>眼</span></button>
      <div class="hello"><div class="hi"><span id="hi"></span><span class="mode-tag" id="mode-tag" hidden>模擬倉</span></div><button class="status" id="status" aria-label="重新整理資料"><i></i><span>載入中</span></button></div>
      <button class="icon-btn explain-btn" id="explain" aria-pressed="${explainOn()}" aria-label="看懂模式：點術語看解釋"><span>解</span></button>
      <button class="icon-btn" id="privacy" aria-pressed="${settings.privacy}" aria-label="${settings.privacy ? '顯示金額' : '隱藏金額'}">${settings.privacy ? ICON.eyeOff : ICON.eye}</button>
      <button class="avatar" id="prefs" aria-label="設定">${esc(avatarText())}</button>
    </header>
    <nav class="dock" aria-label="主要分頁"><div class="in">${TABS.map((t) => `<button data-tab="${t.id}"${t.core ? ' class="core-tab"' : ''}>${t.svg}<span>${t.t}</span>${t.core ? '<i class="badge num" hidden></i>' : ''}</button>`).join('')}</div></nav>
    <main id="view" aria-live="polite"></main>
    <section class="sheet" id="sheet" hidden aria-modal="true" role="dialog"></section>
    <div class="modal" id="modal" hidden></div>
    <div class="boot" id="boot" hidden></div>`;
  $$('.dock button').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));
  $('#status').addEventListener('click', manualRefresh);
  $('#seal').addEventListener('click', () => go('home'));
  $('#prefs').addEventListener('click', () => openSettings());
  $('#privacy').addEventListener('click', () => {
    settings.privacy = !settings.privacy;
    saveSettings();
    paintPrivacy();
    render();
    if (S.openCode && !S.openCode.startsWith('__')) renderDetail(S.openCode);
    toast(settings.privacy ? '已隱藏金額與股數' : '已顯示金額');
  });
  $('#explain').addEventListener('click', () => {
    setExplain(!explainOn());
    paintExplain();
    toast(explainOn() ? '看懂模式：有虛線底線的字，點一下就有解釋' : '已關閉看懂模式');
  });
  window.addEventListener('scroll', () => $('#top').classList.toggle('scrolled', window.scrollY > 4), { passive: true });
  paintMode();
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
function paintExplain() {
  const b = $('#explain');
  if (b) b.setAttribute('aria-pressed', explainOn());
}
function paintMode() {
  document.body.classList.toggle('paper', isPaper());
  document.body.classList.toggle('nofx', settings.fx === false);
  const t = $('#mode-tag');
  if (t) t.hidden = !isPaper();
}
/** 熱力圖、排序的「漲跌」標籤：報價是今天的才叫今日漲跌，休市或開盤前寫那一天 */
function chgLabel() {
  const t = dayTag([S.live && S.live.date, S.summary && S.summary.asof]);
  return t === '今日' ? '今日漲跌' : `${t} 漲跌`;
}
function greeting() {
  const { h } = twParts();
  const word = h >= 5 && h < 11 ? '早安' : h >= 11 && h < 18 ? '午安' : '晚安';
  return `${settings.name || 'PZ'}，${word}`;
}

// ------------------------------------------------------------------ 資料新鮮度
// 後台每一輪都會重寫 live.json，所以它的時間就是「後台最後一次活著」的時間
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' }) : '—');
const minsAgo = (iso) => { const t = iso ? new Date(iso).getTime() : NaN; return isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 60000)) : null; };
const agoShort = (m) => (m == null ? '' : m < 1 ? '剛剛' : m < 60 ? `${m} 分前` : m < 1440 ? `${Math.round(m / 60)} 小時前` : `${Math.round(m / 1440)} 天前`);
const durShort = (m) => (m == null ? '' : m < 60 ? `${m} 分鐘` : m < 1440 ? `${Math.round(m / 60)} 小時` : `${Math.round(m / 1440)} 天`);
const LAG_MIN = 12;        // 盤中資料超過幾分鐘算「延遲」（後台盤中約 5 分鐘一輪）
const STALL_MIN = 54 * 60; // 後台超過幾分鐘完全沒動靜算「停擺」（週六 09:20 到週一 09:00 約 48 小時，留一點餘裕）
// 後台寫的時間一律是台灣時間（+08:00），直接取字串就是台灣的日期與時分
const isoD = (iso) => (iso ? +String(iso).slice(0, 10).replace(/-/g, '') : 0);
const isoHm = (iso) => (iso ? +String(iso).slice(11, 13) * 100 + +String(iso).slice(14, 16) : 0);
function inSession() { const { wd, h, min } = twParts(); const hm = h * 100 + min; return wd >= 1 && wd <= 5 && hm >= 900 && hm <= 1335; }
function freshness() {
  const L = S.live;
  const { wd, h, min } = twParts();
  const hm = h * 100 + min;
  const td = today();
  const weekday = wd >= 1 && wd <= 5;
  const session = weekday && hm >= 900 && hm <= 1335;
  const age = L ? minsAgo(L.at) : null;
  const gen = S.summary ? S.summary.generated : null;
  const newest = [L && L.at, gen].filter(Boolean).sort().pop() || null;
  if (S.offline) return { key: 'lag', txt: `離線　顯示上次存下的資料（${L && L.at ? `${fmt.d(isoD(L.at))} ${hhmm(L.at)}` : fmt.d(S.summary.asof)}）`, stall: false, offline: true };
  const stall = newest ? minsAgo(newest) >= STALL_MIN : false;
  const liveToday = !!(L && L.date === td);
  // 後台今天開盤後跑過，證交所的即時資料卻停在之前的日期 → 今天休市（颱風假也一樣）
  const ranToday = !!(L && isoD(L.at) === td && isoHm(L.at) >= 905);
  // 證交所的開休市日期表說今天休市（國定假日、補假）：不用等後台開盤後跑過才知道
  const closedToday = (ranToday && L.date != null && L.date < td) || (weekday && !liveToday && marketClosedOn(td));
  if (session && liveToday && L.open) {
    const lag = age != null && age > LAG_MIN;
    return { key: lag ? 'lag' : 'live', txt: `盤中　${hhmm(L.at)} 資料・${agoShort(age)}`, stall };
  }
  if (weekday && closedToday && S.summary.asof !== td) return { key: 'idle', txt: `今天休市　資料到 ${fmt.d(S.summary.asof)}`, stall };
  if (session) {
    if (ranToday && L.date == null) return { key: 'lag', txt: `後台 ${hhmm(L.at)} 有跑，但沒拿到盤中價格`, stall };
    return { key: hm >= 915 ? 'lag' : 'wait', txt: hm >= 915 ? '開盤了，後台還沒送來今天的盤中資料' : '開盤了，等今天第一筆盤中資料', stall };
  }
  if (S.summary.asof === td) return { key: 'idle', txt: `${fmt.d(S.summary.asof)} 收盤　${agoShort(minsAgo(gen))}更新`, stall };
  // 收盤後到晚上的完整計算跑完之前：畫面上已經是今天的收盤價，只是分析還是昨天的
  if (weekday && liveToday && hm > 1335) {
    if (isoHm(L.at) >= 1330) return { key: 'idle', txt: `今天收盤　${hhmm(L.at)} 的價格・完整分析${hm < 1500 ? '約 14:30 ' : '稍晚'}更新`, stall };
    return { key: 'lag', txt: `今天 ${hhmm(L.at)} 的價格・收盤價還沒送來`, stall };
  }
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
  // 盤中掃描線：資料新鮮時是冰藍，延遲時變琥珀，收盤後停下來
  const box = $('.iris-box');
  if (box) { box.classList.toggle('live', f.key === 'live'); box.classList.toggle('lag', f.key === 'lag'); }
}
async function manualRefresh() {
  const el = $('#status');
  if (el.classList.contains('busy')) return;
  el.classList.add('busy');
  const before = [S.live && S.live.at, S.summary && S.summary.generated].join('|');
  try {
    await newBatch({ force: true });
    el.classList.remove('busy');
    const after = [S.live && S.live.at, S.summary && S.summary.generated].join('|');
    const f = freshness();
    const liveNow = (f.key === 'live' || f.key === 'lag') && S.live;
    if (S.offline) toast('連不上網路，顯示的是上次存下的資料');
    else if (after !== before) toast(liveNow ? `已更新到 ${hhmm(S.live.at)} 的資料` : '已更新到最新資料');
    else if (liveNow) toast(`後台還沒有新資料（目前是 ${hhmm(S.live.at)} 的），盤中大約每 5 分鐘一輪`);
    else toast('已經是最新的資料');
  } catch {
    toast('暫時連不上，顯示的是上次的資料');
  } finally {
    el.classList.remove('busy');
  }
}

function go(tab) {
  if (S.openCode) closeDetail(false);
  const changed = tab !== S.tab;
  S.animUntil = 0;
  S.tab = tab;
  store.set('tab', tab);
  render();
  window.scrollTo({ top: 0 });
  if (changed) { FX.cue('nav'); FX.pulse($('#view'), 'fx-swap', 520); }
}
function paintBadge() {
  const n = aideBadge();
  const b = $('.dock .core-tab .badge');
  if (!b) return;
  b.hidden = !n;
  b.textContent = n > 9 ? '9+' : String(n);
  $('.dock .core-tab').setAttribute('aria-label', n ? `副官（${n} 件待辦）` : '副官');
}
function render() {
  $$('.dock button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === S.tab ? 'page' : 'false'));
  renderHeader();
  paintMode();
  paintBadge();
  // 開場動畫進行中就先不要重畫指揮台，等動畫結束再更新數字
  if (S.tab === 'home' && S.animUntil && performance.now() < S.animUntil) {
    clearTimeout(S.animTimer);
    S.animTimer = setTimeout(render, S.animUntil - performance.now() + 40);
    return;
  }
  const v = $('#view');
  v.dataset.tab = S.tab;
  if (!S.summary) { v.innerHTML = '<div class="skeleton tall"></div><div class="skeleton"></div><div class="skeleton"></div>'; return; }
  ({ home: renderHome, pf: renderPF, radar: renderRadar, aide: () => renderAide(v), news: renderNews, track: renderTrack }[S.tab] || renderHome)();
  flashPrices(v);
}

// ------------------------------------------------------------------ 盤中跳動：價格和上次畫面不同就閃一下
function flashPrices(root) {
  const els = $$('[data-pxc]', root);
  const now = new Map();
  for (const el of els) now.set(el.dataset.pxc, +el.dataset.px);
  const changed = new Map();
  for (const [c, v] of now) {
    const was = S.pxSeen.get(c);
    if (isNum(was) && isNum(v) && Math.abs(was - v) > 1e-9) changed.set(c, v > was ? 'fl-up' : 'fl-down');
    if (isNum(v)) S.pxSeen.set(c, v);
  }
  if (!changed.size) return;
  // 跳動的聲音：漲的多就是上揚的嗶、跌的多就是下沉的嗶（一次更新只響一聲）
  const ups = [...changed.values()].filter((k) => k === 'fl-up').length;
  FX.sfx(ups >= changed.size - ups ? 'pxUp' : 'pxDown');
  if (reduceMotion()) return;
  for (const el of els) { const k = changed.get(el.dataset.pxc); if (k) el.classList.add(k); }
}
const pxAttr = (code, px) => (isNum(px) ? ` data-pxc="${code}" data-px="${px}"` : '');

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

// ================================================================== 指揮台
const liveTaiex = () => taiexNow();
function renderHome() {
  const v = $('#view');
  const P = S.P;
  const has = !!(P && (P.holdings.length || P.totals.cash > 0));
  // 手機上依序排成一欄；寬螢幕（筆電、電視）變成三欄戰情室：左「大盤之瞳＋晨報」、中「行動＋關注」、右「熱力圖」
  v.innerHTML = `<div class="home">
    ${stallHTML()}
    <div class="col c1"><div class="h-eye">${eyeHTML(P, has)}</div><div class="h-brief">${briefHTML()}</div><div class="h-lesson">${lessonHomeHTML()}</div><div class="h-aide">${aideHomeHTML()}</div></div>
    <div class="col c2"><div class="h-acts">${actionsHTML(P)}</div><div class="h-watch">${watchHTML()}</div></div>
    <div class="col c3"><div class="h-heat">${heatCardHTML(true)}</div><div class="h-news">${newsMiniHTML()}</div></div>
    <div class="h-foot">${installCard()}<p class="disclaim">資料來自證交所、櫃買中心、集保結算所等官方發布；觀點與建議由固定規則計算，不保證報酬，買賣請自行判斷。</p></div>
  </div>`;
  $$('[data-code]', v).forEach((b) => { if (!b.closest('.hm')) b.addEventListener('click', () => openDetail(b.dataset.code)); });
  $$('[data-act="dca"]', v).forEach((b) => b.addEventListener('click', () => openPending()));
  $$('[data-act^="coach-"]', v).forEach((b) => b.addEventListener('click', () => openCoach(b.dataset.act.slice(6))));
  bindHero(v, P);
  bindInstall(v);
  bindHeat(v);
  bindBrief(v);
  bindLessonHome(v, lessonNav);
  bindAideHome(v, go);
  animateNeedles(v);
  const more = $('#heat-more', v);
  if (more) more.addEventListener('click', () => { settings.radarView = 'heat'; saveSettings(); go('radar'); });
  const nm = $('#news-more', v);
  if (nm) nm.addEventListener('click', () => go('news'));
  // 戰情室（寬螢幕）才顯示的官方快訊：沒有、或超過 5 分鐘就重抓
  if (window.innerWidth >= 1100 && (!S.news || Date.now() - S.newsAt > NEWS_MAX_AGE)) {
    const had = S.news;
    ensureNews().then(() => { if (S.news !== had) paintNewsMini(); });
  }
}
function paintNewsMini() {
  const box = $('.h-news');
  if (!box || S.tab !== 'home' || S.openCode) return;
  box.innerHTML = newsMiniHTML();
  const b2 = $('#news-more', box);
  if (b2) b2.addEventListener('click', () => go('news'));
}
const SRC_NAME = { twse_news: '證交所', fsc: '金管會', cbc: '中央銀行', cna: '中央社' };
function newsMiniHTML() {
  const head = '<div class="sec-h"><h2>官方快訊</h2><button class="link small" id="news-more">全部情報</button></div>';
  if (!S.news) return head + '<section class="panel pad"><div class="skeleton" style="height:120px"></div></section>';
  const items = S.news.items.filter((x) => x.kind === 'official' || x.kind === 'fact').slice(0, 7);
  return head + `<section class="panel list news mini">${items.map((x) => `<a class="n-item" href="${esc(x.url)}" target="_blank" rel="noopener"><span class="n-meta"><span class="tag${x.kind === 'official' ? ' off' : ''}">${SRC_NAME[x.src] || esc(x.src)}</span><span class="num">${fmt.d(x.d)}</span></span><span class="n-t">${esc(x.t)}</span></a>`).join('') || '<div class="empty">近三週沒有資料</div>'}</section>`;
}
function stallHTML() {
  const f = freshness();
  if (!f.stall) return '';
  const newest = [S.live && S.live.at, S.summary.generated].filter(Boolean).sort().pop();
  return `<section class="panel pad stall hazard" role="alert"><b>後台已經 ${durShort(minsAgo(newest))}沒有更新了</b><span>正常情況下交易日每 5 分鐘、週末至少一次。可能是 GitHub 的排程停了；畫面上是 ${fmt.d(S.summary.asof)} 的資料。請找 Claude 檢查「冷眼的後台」。</span></section>`;
}
function breadthSegs() {
  const b = S.breadth;
  if (!b || !b.n) return [];
  return [
    { v: b.bull, col: 'var(--up)', name: '偏多' },
    { v: b.neu, col: 'var(--ring-neu)', name: '中性' },
    { v: b.bear, col: 'var(--down)', name: '偏空' },
  ].filter((s) => s.v > 0);
}
function eyeHTML(P, has) {
  const anim = S.firstPaint && !reduceMotion();
  const tx = liveTaiex();
  const f = freshness();
  const sweep = f.key === 'live' ? ' live' : f.key === 'lag' ? ' lag' : '';
  const b = S.breadth;
  let main, outer = null, center, legend;
  if (has) {
    const t = P.totals;
    main = [];
    for (const x of P.holdings) if (x.mv > 0) main.push({ v: x.mv, col: slotVar(x.slot), name: x.name, code: x.code });
    if (t.cash > 0) main.push({ v: t.cash, col: 'var(--s-cash)', name: '現金', code: null });
    outer = breadthSegs();
    center = `<div class="ic-k">${isPaper() ? '模擬倉總資產' : '總資產'}</div>
      <div class="ic-v num" id="ic-v">${money(t.T)}</div>
      <div class="ic-d num ${dirCls(t.day)}"><span>${arrow(t.day)} ${money(Math.abs(t.day))}</span><small>${dayTag(P.holdings.map((x) => x.q && x.q.date))} ${fmt.r(t.dayPct, 2)}</small></div>
      <div class="ic-r">${t.cost > 0 ? `<span data-term="upnl">報酬 <b class="num ${dirCls(t.pnl)}">${fmt.r(t.pct)}</b></span>` : ''}${t.divRecv > 0 ? `<span data-term="div">已領息 <b class="num">${money(t.divRecv)}</b></span>` : ''}</div>`;
    legend = `<ul class="iris-legend">${main.map((s) => `<li${s.code ? ` data-code="${s.code}"` : ''}><i style="background:${s.col}"></i><span class="nm">${esc(s.name)}</span><b class="num">${fmt.r(s.v / t.T, 0, false)}</b></li>`).join('')}</ul>`;
  } else {
    main = breadthSegs();
    center = tx ? `<div class="ic-k">加權指數・${esc(tx.when)}</div>
      <div class="ic-v num"${pxAttr('TAIEX', tx.px)}>${fmt.n(tx.px, 2)}</div>
      <div class="ic-d num ${dirCls(tx.ch)}">${arrow(tx.ch)} ${fmt.n(Math.abs(tx.ch ?? NaN), 2)}<small>${fmt.pct(tx.pc)}</small></div>
      <div class="ic-r">${isNum(tx.ma60) ? `<span data-term="ma">${tx.px >= tx.ma60 ? '站上季線' : '跌破季線'} <b class="num">${fmt.n(tx.ma60, 0)}</b></span>` : ''}</div>`
      : '<div class="ic-k">大盤資料準備中</div>';
    legend = b && b.n ? `<ul class="iris-legend br" data-term="breadth">${[['偏多', b.bull, 'var(--up)'], ['中性', b.neu, 'var(--ring-neu)'], ['偏空', b.bear, 'var(--down)']].map(([k, n, c]) => `<li><i style="background:${c}"></i><span class="nm">${k}</span><b class="num">${n}</b><small class="num">${Math.round((n / b.n) * 100)}%</small></li>`).join('')}</ul>
      <p class="iris-cap">圓環：全市場 ${b.n} 檔 ETF 最近一次收盤的規則判讀（不含反向型）</p>` : '';
  }
  const label = has ? '我的資產配置與市場溫度' : '大盤之瞳：全市場 ETF 規則判讀';
  const strip = tx ? `<div class="mk-strip">
      ${has ? `<span class="mk-tx">加權 <b class="num">${fmt.n(tx.px, 0)}</b> <b class="num ${dirCls(tx.ch)}">${fmt.pct(tx.pc)}</b></span>` : ''}
      ${tx.insti ? `<span data-term="insti" class="mk-in">${[['外資', tx.insti.f], ['投信', tx.insti.t], ['自營', tx.insti.d]].map(([k, z]) => `<span>${k}<b class="num ${dirCls(z)}">${z > 0 ? '+' : ''}${fmt.big(z)}</b></span>`).join('')}<small class="num">${fmt.d(tx.insti.date)}</small></span>` : ''}
      ${has && b && b.n ? `<span class="mk-br" data-term="breadth">外圈：ETF <b class="num up">${Math.round(b.pBull * 100)}%</b> 偏多</span>` : ''}
    </div>` : '';
  const cta = has ? '' : `<div class="eye-cta">${isPaper() && !book.start
    ? `<button class="btn primary" id="paper-start">${ICON.plus}開始模擬倉</button>`
    : `<button class="btn primary" id="first-trade">${ICON.plus}${isPaper() ? '模擬下單' : '記第一筆持股'}</button><button class="btn ghost" id="first-cash">${isPaper() ? '重設模擬倉' : '設定可投入現金'}</button>`}</div>`;
  return `<section class="iris${anim ? ' anim' : ''}${has ? ' own' : ' market'}" aria-label="${label}">
    <div class="iris-box${sweep}">${irisSVG({ main, outer, anim, label })}<div class="sweep" aria-hidden="true"></div><div class="iris-c">${center}</div></div>
    ${legend}${strip}${cta}
  </section>`;
}
function bindHero(v, P) {
  const ft = $('#first-trade', v);
  if (ft) ft.addEventListener('click', () => openTradeForm({}));
  const fc = $('#first-cash', v);
  if (fc) fc.addEventListener('click', () => openCashForm());
  const ps = $('#paper-start', v);
  if (ps) ps.addEventListener('click', () => openPaperStart());
  $$('.iris-legend li[data-code]', v).forEach((li) => li.addEventListener('click', () => openDetail(li.dataset.code)));
  const box = $('.iris.own .iris-box', v);
  if (box) box.addEventListener('click', (e) => { if (!e.target.closest('button,[data-term]')) go('pf'); });
  if (S.firstPaint && P && P.totals.T > 0) countUp($('#ic-v', v), P.totals.T, (z) => money(z));
  if (S.firstPaint && !reduceMotion()) S.animUntil = performance.now() + 1700;
  S.firstPaint = false;
}

/** 今日一課裡的「看戰績」「開存股時光機」這類連結：切分頁或開工具頁 */
function lessonNav(tab, sheet) {
  if (sheet === 'tm') { swapSheet('tm', (push) => openTM(push)); return; }
  if (sheet === 'duel') { swapSheet('duel', (push) => openDuel(push)); return; }
  if (sheet === 'cases') { swapSheet('cases', (push) => openCase(null, push)); return; }
  if (sheet === 'coach') { swapSheet('coach', (push) => openCoach(null, push)); return; }
  if (tab && TABS.some((t) => t.id === tab)) { if (S.openCode) closeDetail(); go(tab); }
}
/** 已經開著一個全螢幕頁（例如設定）時換成另一頁：直接換掉網址，不要先 back 再 push（會和瀏覽器的歷史搶） */
function swapSheet(hash, open) {
  if (S.openCode) { S.openCode = null; history.replaceState(history.state == null ? null : { tool: hash }, '', '#' + hash); open(false); } else open(true);
}
const md = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
const BR_ICON = {
  market: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 15.5l4.5-5 3.5 3 6.5-8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  watch: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="10" cy="10" r="2" fill="currentColor"/></svg>',
  cal: ICON.cal,
};
function briefItems() {
  const tx = liveTaiex();
  return brief({
    market: tx ? { px: tx.px, pc: tx.pc, ma60: tx.ma60, insti: tx.insti } : null,
    br: S.breadth,
    watch: settings.watch.map((c) => S.rows.get(c)).filter(Boolean),
    held: new Set(S.P ? S.P.holdings.map((x) => x.code) : []),
    adv: S.adv, changes: S.changes, q: quote, today: today(),
    names: { st: { 1: '偏多', 0: '中性', '-1': '偏空' }, ps: Object.fromEntries(Object.entries(POS).map(([k, v]) => [k, v.t])) },
    premWarn: (r) => premBand(r)[0], rowOf: (c) => S.rows.get(c),
  });
}
const briefName = () => { const { h } = twParts(); return h < 12 ? '冷眼晨報' : h < 18 ? '冷眼午報' : '冷眼晚報'; };
/** 語音播報的稿子：問候＋晨報三句＋今日行動件數＋副官待辦 */
function briefSpeech(withHello = true) {
  const { h } = twParts();
  const word = h >= 5 && h < 11 ? '早安' : h >= 11 && h < 18 ? '午安' : '晚安';
  const acts = buildActions(S.P).length;
  const parts = [];
  if (withHello) parts.push(`${word}，${settings.name || 'PZ'}。冷眼系統上線。`);
  parts.push(`${briefName()}。`);
  for (const it of briefItems()) parts.push(it.t);
  parts.push(acts ? `今天有 ${acts} 件需要你看一下的事，在今日行動。` : '今天沒有需要動作的事。');
  const a = aideSpeech();
  if (a) parts.push(a);
  return parts.join('');
}
function briefHTML() {
  const tx = liveTaiex();
  const items = briefItems();
  return `<section class="panel brief"><div class="br-h"><span class="br-t">${briefName()}</span><span class="br-s num">${tx ? esc(tx.when) : ''}</span>
      ${FX.hasVoice() ? `<button class="icon-btn br-say" id="br-say" aria-label="念給我聽">${ICON.speaker}</button>` : ''}</div>
    <ul class="br-list">${items.map((it) => `<li class="br-${it.k}"${it.code ? ` data-code="${it.code}"` : ''}><span class="br-ic">${BR_ICON[it.k] || ''}</span><span class="br-x">${md(it.t)}</span></li>`).join('')}</ul>
    <button class="link small br-ask" id="br-ask">${ICON.comms}帶今天的市場去問 Claude</button></section>`;
}
function bindBrief(v) {
  const say = $('#br-say', v);
  if (say) say.addEventListener('click', () => {
    if (FX.isSpeaking()) { FX.stopSpeak(); return; }
    FX.sfx('comms');
    if (!FX.speak(briefSpeech(false), { force: true })) toast(FX.voiceWhy());
  });
  const ask = $('#br-ask', v);
  if (ask) ask.addEventListener('click', () => openAsk('market'));
}

function chip(t, cls) { return `<span class="chip act ${cls}">${t}</span>`; }
function buildActions(P) {
  const out = [];
  const hits = checkAlerts();
  if (hits.some((h) => h.fresh)) setTimeout(() => FX.cue('alert'), 400);   // 今天第一次碰到：響一下
  for (const h of hits) {
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
  // 定期定額：今天扣款、自動記的預估待核對（國泰規則，dca.js）
  out.push(...dcaActions(chip));
  // 大盤大波動的日子：判斷教練帶你一步一步看（只在有意義的時候出現）
  const tx = taiexNow();
  if (tx && isNum(tx.pc) && Math.abs(tx.pc) >= AIDE_BIG) {
    const down = tx.pc < 0;
    out.push({ pri: 1, code: 'TAIEX', act: down ? 'coach-crash' : 'coach-rally', chip: chip('教練', 'info'), title: `大盤${down ? '大跌' : '大漲'} ${fmt.pct(tx.pc)}`, text: down ? '先別急著動作：判斷教練帶你看該看什麼、哪裡是陷阱' : '怕錯過？判斷教練帶你看漲多之後的歷史與你的比重' });
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
    if (isNum(q.prem) && q.prem > w) out.push({ pri: 2, code, chip: chip('溢價', 'warn'), title: r.n, text: `<span data-term="prem">溢價</span> <b class="num">${q.prem.toFixed(2)}%</b>，現在買等於多付錢` });
    if (r.dv && r.dv.d >= today() && PF.daysBetween(today(), r.dv.d) <= 10) out.push({ pri: 3, code, chip: chip('除息', 'info'), title: r.n, text: `${fmt.d(r.dv.d)} <span data-term="div">除息</span>${r.dv.cash ? `，每單位 ${cash3(r.dv.cash)} 元` : ''}` });
  }
  const seen = new Set();
  return out.sort((a, b) => a.pri - b.pri).filter((a) => { const k = a.code + a.chip; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 9);
}
function actionsHTML(P) {
  const acts = buildActions(P);
  let html = `<div class="sec-h"><h2>今日行動</h2><span class="aside">${acts.length ? `${acts.length} 件` : ''}</span></div>`;
  if (acts.length) {
    html += `<section class="panel list acts">${acts.map((a) => `<button class="act-row" ${a.act ? `data-act="${a.act}"` : `data-code="${a.code}"`}><span class="a-chip">${a.chip}</span><span class="a-body"><b>${esc(a.title)}</b><span>${a.text}</span></span><span class="chev">${ICON.chev}</span></button>`).join('')}</section>`;
  } else {
    html += `<section class="panel pad calm"><b>今天沒有需要動作的事。</b><span class="muted">${hasBook() ? '持股都在續抱狀態，照紀律放著就好。' : '輸入持股之後，加碼、減碼、除息、到價提醒都會集中在這裡。'}</span></section>`;
  }
  return html;
}

// ------------------------------------------------------------------ 熱力圖（指揮台的小張、雷達的大張）
function heatRows(filter) {
  return S.summary.etfs.filter((r) => r.val > 0 && (!filter || filter(r))).map((r) => {
    const q = quote(r);
    return { c: r.c, n: r.n, k: r.k, val: r.val, vv: settings.heatMode === 'score' ? r.sc : q.pc };
  });
}
function heatCardHTML(mini) {
  const mode = settings.heatMode;
  return `<div class="sec-h"><h2>盤面熱力</h2><div class="seg mini" role="tablist">${[['chg', chgLabel()], ['score', '規則分數']].map(([k, t]) => `<button data-hmode="${k}" aria-pressed="${mode === k}">${t}</button>`).join('')}</div></div>
    <section class="panel heat-card"><div class="heat-wrap"><div class="heat" data-heat="${mini ? 'mini' : 'full'}"></div><div class="hm-clock" hidden><span class="k">盤中縮時</span><b class="num">09:00</b><i><s></s></i></div></div>
      <div class="heat-foot">${heatLegend(mode)}<span class="heat-acts">${mode === 'chg' ? `<button class="link small" data-replay>${ICON.play || '▶'} 盤中縮時</button>` : ''}${mini ? '<button class="link small" id="heat-more">看全部</button>' : ''}</span></div>
      <p class="small muted heat-cap">格子大小＝<span data-term="val">成交值</span>，${mode === 'chg' ? '顏色＝今天漲跌（紅漲綠跌）' : '顏色＝<span data-term="sc">規則分數</span>（紅偏多、綠偏空）'}。${mini ? '只放成交值前 60 檔；' : ''}點格子看那一檔。</p></section>`;
}
function drawHeats(root, filter) {
  for (const box of $$('[data-heat]', root)) {
    const mini = box.dataset.heat === 'mini';
    const w = Math.floor(box.clientWidth);
    if (!w) continue;
    let rows = heatRows(filter);
    if (mini) rows = rows.sort((a, b) => b.val - a.val).slice(0, 60);
    const desk = window.innerWidth >= 1100;
    const h = Math.round(mini ? clamp(w * 0.62, 200, desk ? 420 : 300) : clamp(w * (desk ? 0.6 : 1.15), 320, desk ? 640 : 620));
    box.innerHTML = rows.length ? heatHTML(rows, { w, h, mode: settings.heatMode, groups: CAT, mini }) : '<div class="empty">沒有符合的 ETF</div>';
    $$('.hm-t', box).forEach((b) => b.addEventListener('click', () => openDetail(b.dataset.code)));
  }
}
// 盤中縮時：用後台每一輪記下的盤中走勢（data/spark.json），把熱力圖從開盤快轉到現在。只換顏色、不動格子，純顯示。
let heatRP = null;
function stopHeatReplay(redraw = true) {
  const rp = heatRP;
  if (!rp) return;
  heatRP = null;
  cancelAnimationFrame(rp.raf);
  clearTimeout(rp.end);
  if (rp.clock) rp.clock.hidden = true;
  if (rp.btn) rp.btn.innerHTML = `${ICON.play || '▶'} 盤中縮時`;
  if (redraw && rp.root && rp.root.isConnected) drawHeats(rp.root, rp.filter);
}
async function heatReplay(btn, root, filter) {
  if (heatRP) { stopHeatReplay(); return; }
  const card = btn.closest('.heat-card');
  const boxes = $$('[data-heat]', card);
  let sp;
  try { sp = await getJSON('spark.json'); } catch { sp = null; }
  if (!sp || !sp.s || !sp.d) { toast('還沒有今天的盤中走勢（開盤後幾分鐘就有）'); return; }
  // 每一格：這一天的走勢點＋那天的參考價（和格子上的漲跌用同一個參考價，播完剛好接上現在的顏色）
  const tiles = [];
  let tMax = 0;
  for (const box of boxes) {
    for (const el of $$('.hm-t', box)) {
      const row = S.rows.get(el.dataset.code);
      const a = sp.s[el.dataset.code];
      if (!row || !a || a.length < 2) continue;
      const q = quote(row);
      if (q.date !== sp.d || !isNum(q.px) || !isNum(q.ch)) continue;
      const ref = q.px - q.ch;
      if (!(ref > 0)) continue;
      const pts = [];
      for (let i = 0; i + 1 < a.length; i += 2) pts.push([a[i], a[i + 1]]);
      tiles.push({ el, num: el.querySelector('.num'), big: el.classList.contains('big'), pts, ref, i: -1 });
      tMax = Math.max(tMax, pts[pts.length - 1][0]);
    }
  }
  if (!tiles.length || tMax < 5) { toast('還沒有今天的盤中走勢（開盤後幾分鐘就有）'); return; }
  tMax = Math.min(tMax, 285);
  const dur = Math.max(8000, Math.min(16000, (tMax / 270) * 16000));
  const clock = $('.hm-clock', card);
  const t0 = performance.now();
  heatRP = { raf: 0, end: 0, clock, btn, root, filter };
  btn.innerHTML = `${ICON.stopSq || '■'} 停止`;
  clock.hidden = false;
  $('.k', clock).textContent = `盤中縮時 ${Math.floor(sp.d / 100) % 100}/${sp.d % 100}`;
  FX.sfx('scan');
  let mark = -1;
  const frame = (now) => {
    if (!heatRP || heatRP.clock !== clock) return;
    if (!card.isConnected) { stopHeatReplay(false); return; }
    const k = Math.min(1, (now - t0) / dur);
    const t = tMax * k;
    for (const x of tiles) {
      while (x.i + 1 < x.pts.length && x.pts[x.i + 1][0] <= t) x.i++;
      const pc = ((x.i >= 0 ? x.pts[x.i][1] : x.ref) / x.ref - 1) * 100;   // 第一筆成交之前：還在昨收
      x.el.style.background = heatColor(pc, 3);
      if (x.big && x.num) x.num.textContent = `${pc > 0 ? '+' : ''}${pc.toFixed(2)}%`;
    }
    const mm = Math.min(270, Math.round(t));
    $('b', clock).textContent = `${String(9 + Math.floor(mm / 60)).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`;
    $('s', clock).style.width = `${(k * 100).toFixed(1)}%`;
    const m30 = Math.floor(t / 30);
    if (m30 !== mark) { mark = m30; if (k < 1 && m30 > 0) FX.sfx('tick'); }
    if (k < 1) { heatRP.raf = requestAnimationFrame(frame); return; }
    FX.sfx('ok');
    heatRP.end = setTimeout(() => { if (heatRP && heatRP.clock === clock) stopHeatReplay(); }, 1600);
  };
  heatRP.raf = requestAnimationFrame(frame);
}
function bindHeat(v, filter) {
  drawHeats(v, filter);
  $$('[data-replay]', v).forEach((b) => b.addEventListener('click', () => heatReplay(b, v, filter)));
  $$('[data-hmode]', v).forEach((b) => b.addEventListener('click', () => {
    settings.heatMode = b.dataset.hmode;
    saveSettings();
    $$('[data-hmode]', v).forEach((z) => z.setAttribute('aria-pressed', z === b));
    const card = b.closest('.sec-h').nextElementSibling;
    if (card) {
      $('.heat-foot', card).firstElementChild.outerHTML = heatLegend(settings.heatMode);
      const cap = $('.heat-cap', card);
      if (cap) cap.innerHTML = `格子大小＝<span data-term="val">成交值</span>，${settings.heatMode === 'chg' ? '顏色＝今天漲跌（紅漲綠跌）' : '顏色＝<span data-term="sc">規則分數</span>（紅偏多、綠偏空）'}。點格子看那一檔。`;
    }
    drawHeats(v, filter);
  }));
}

function watchHTML() {
  const rows = settings.watch.map((c) => S.rows.get(c)).filter(Boolean);
  return `<div class="sec-h"><h2>關注</h2><span class="aside">${rows.length} 檔　觀點尺度約 1 個月</span></div>` +
    (rows.length ? `<section class="panel list watch">${rows.map(watchRow).join('')}</section>` : '<section class="panel empty">還沒有關注的 ETF。到「雷達」點任一檔，按右上角星號加入。</section>');
}
function watchRow(row) {
  const q = quote(row);
  const held = !!heldOf(row.c);
  return `<button class="w-row" data-code="${row.c}" aria-label="${esc(row.n)} 詳情">
    <span class="w-id"><span class="w-name">${esc(row.n)}${held ? '<i class="mine-dot" title="持有中"></i>' : ''}</span><span class="w-code num">${row.c}<span>${esc(catName(row.k))}</span></span></span>
    ${sparkSVG(row.sp, 58, 26, q.pc)}
    <span class="w-px"><span class="p num"${pxAttr(row.c, q.px)}>${fmt.px(q.px)}</span><span class="c num ${dirCls(q.pc)}">${arrow(q.pc)}${isNum(q.pc) ? Math.abs(q.pc).toFixed(2) + '%' : '—'}</span></span>
    <span class="w-sig">${stanceChip(row.st)}${posChip(row.ps)}${row.cf != null ? `<span class="small muted" data-term="cf">信心 <b class="num">${row.cf}</b></span>` : ''}</span>
    <span class="w-g" data-term="sc">${gaugeSVG(row.sc, row.st)}</span>
  </button>`;
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

// ================================================================== 部位（真實／模擬倉）
function modeSwitchHTML() {
  return `<div class="seg wide mode-sw" role="tablist" aria-label="真實部位或模擬倉"><button data-mode="real" aria-pressed="${!isPaper()}">真實部位</button><button data-mode="paper" aria-pressed="${isPaper()}">模擬倉</button></div>`;
}
function bindModeSwitch(v) {
  $$('[data-mode]', v).forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.mode === settings.mode) return;
    switchMode(b.dataset.mode);
    S.txAll = false;
    diffSeen();
    computePF();
    render();
    toast(isPaper() ? '切到模擬倉：下單、建議、指揮台都改用模擬的部位' : '切回真實部位');
  }));
}
function paperHeadHTML(P) {
  const st = book.start;
  const t = P.totals;
  const dv = S.divs && S.divs[st.code || '0050'];
  const br = S.rows.get(st.code || '0050');
  const bqq = br ? quote(br) : null;
  // 除息、分割只算到「價格的日期」為止：開盤前價格還是昨收，當天的除息還不能算
  const bench = benchValue(st, dv ? dv.d : [], dv ? dv.s : [], bqq ? bqq.px : null, (bqq && bqq.date) || today());
  const ret = t.T / st.cash0 - 1;
  const days = PF.daysBetween(st.d, today());
  return `<section class="panel paper-head hazard-soft">
    <div class="ph-top"><span class="ph-k" data-term="paper">模擬倉</span><span class="muted small">${fmt.dy(st.d)} 開始・第 ${days + 1} 天・起始 ${money(st.cash0)} 元</span></div>
    <div class="ph-grid">
      <div><span>模擬總資產</span><b class="num">${money(t.T)}</b><small class="num ${dirCls(ret)}">${fmt.r(ret, 2)}</small></div>
      <div><span>同期全買 0050</span><b class="num">${bench ? money(bench.value) : '—'}</b><small class="num ${bench ? dirCls(bench.ret) : ''}">${bench ? fmt.r(bench.ret, 2) : ''}</small></div>
    </div>
    ${bench ? `<p class="ph-v">${ret - bench.ret >= 0 ? '目前<b class="good">贏過</b>' : '目前<b class="bad">落後</b>'}同期全買 0050 <b class="num">${Math.abs((ret - bench.ret) * 100).toFixed(2)}</b> 個百分點。${days < 60 ? '時間還短，看個幾個月再下結論。' : ''}</p>` : ''}
    <div class="row-btns"><button class="btn primary small" id="pf-add">${ICON.plus}模擬下單</button><button class="btn ghost small" id="pf-reset">重設模擬倉</button></div>
  </section>`;
}
function renderPF() {
  const v = $('#view');
  const P = S.P;
  const head = `<div class="pf-head">${modeSwitchHTML()}</div>`;
  if (isPaper() && !book.start) {
    v.innerHTML = `${head}<section class="panel pad onboard paper-on hazard-soft">
        <p class="lead">先用模擬倉練習</p>
        <ul class="ticks"><li>給你一筆虛擬資金，在交易時間用當下的真實價格「假裝」買賣，成交後不能改</li><li>手續費、證交稅、配息、加碼減碼建議全部照真的算</li><li>隨時和「同一天全部買 0050」比較，看你的判斷（或冷眼的建議）有沒有比較好</li><li>和真實部位分開存，一鍵切換</li></ul>
        <div class="row-btns"><button class="btn primary" id="paper-start">${ICON.plus}開始模擬倉</button></div>
      </section>`;
    bindModeSwitch(v);
    $('#paper-start', v).addEventListener('click', () => openPaperStart());
    return;
  }
  if (!P || (!P.holdings.length && !P.closed.length && !(P.totals.cash > 0) && !isPaper())) {
    v.innerHTML = `${head}<div class="sec-h"><h2>我的部位</h2></div>
      <section class="panel pad onboard">
        <p class="lead">記下你的持股，冷眼會幫你：</p>
        <ul class="ticks"><li>用移動平均法算成本，扣掉手續費與證交稅算出真實損益</li><li>依除息紀錄算出已經領到的配息、預估一年領多少</li><li>依你的紀律（比重上限、單筆最多虧多少）算出加碼、減碼的股數</li><li>每天提醒除息、到價、訊號變化</li></ul>
        <div class="row-btns"><button class="btn primary" id="pf-add">${ICON.plus}記一筆交易</button><button class="btn ghost" id="pf-cash">設定可投入現金</button><button class="btn ghost" id="pf-bk">從備份還原</button></div>
        <p class="small muted">已經有持股？「記一筆」時勾選「不記得日期」，輸入目前股數與平均成本就可以。資料只存在這支手機，不會上傳。想先練習，切到上面的「模擬倉」。</p>
      </section>${dcaStripHTML()}`;
    bindModeSwitch(v);
    bindPlans(v, () => renderPF());
    $('#pf-add', v).addEventListener('click', () => openTradeForm({}));
    $('#pf-cash', v).addEventListener('click', () => openCashForm());
    $('#pf-bk', v).addEventListener('click', () => openBackup());
    return;
  }
  const t = P.totals;
  let html = head;
  if (isPaper()) html += paperHeadHTML(P);
  html += `<div class="sec-h"><h2>${isPaper() ? '模擬部位' : '我的部位'}</h2>${isPaper() ? '' : `<button class="btn primary small" id="pf-add">${ICON.plus}記一筆</button>`}</div>
    <section class="panel pf-top">
      <div class="pt-main"><div class="k">總資產</div><div class="pt-v num">${money(t.T)}</div>
        <div class="pt-sub">持股市值 <b class="num">${money(t.mv)}</b>　＋　現金 ${isPaper() ? `<b class="num">${money(t.cash)}</b><small class="muted">（自動計算）</small>` : `<button class="link num" id="pf-cash">${money(t.cash)}</button>`}</div></div>
      <div class="pt-grid">
        <div><span data-term="upnl">未實現損益</span><b class="num ${dirCls(t.pnl)}">${money(t.pnl, true)}</b><small class="num ${dirCls(t.pnl)}">${fmt.r(t.pct)}</small></div>
        <div><span>${dayTag(P.holdings.map((x) => x.q && x.q.date))}</span><b class="num ${dirCls(t.day)}">${money(t.day, true)}</b><small class="num ${dirCls(t.day)}">${fmt.r(t.dayPct, 2)}</small></div>
        <div><span data-term="div">已領配息</span><b class="num">${money(t.divRecv)}</b>${t.undated ? '<small class="muted">只算有日期的交易</small>' : ''}</div>
        <div><span data-term="total">含息總報酬</span><b class="num ${dirCls(t.total)}">${money(t.total, true)}</b><small class="muted">損益＋已實現＋配息</small></div>
        ${Math.abs(t.realized) >= 1 ? `<div><span data-term="rpnl">已實現損益</span><b class="num ${dirCls(t.realized)}">${money(t.realized, true)}</b></div>` : ''}
        <div><span data-term="annual">預估一年配息</span><b class="num">${money(t.annual)}</b><small class="muted">依近 12 個月</small></div>
      </div>
      <p class="small muted">損益已扣掉賣出時的<span data-term="fee">手續費</span>與<span data-term="tax">證交稅</span>估計值。${settings.fee.disc < 1 ? `手續費以 ${(settings.fee.disc * 10).toFixed(1).replace(/\.0$/, '')} 折計算。` : '手續費以原價計算，可在設定改成你的折扣。'}</p>
    </section>`;
  html += eqHTML();
  html += allocHTML(P);
  html += xrayPfHTML();
  if (P.holdings.length) html += `<section class="panel pad aide-strip slim"><div class="as-h"><span class="ac-core">${coreSVG('mini')}</span><div><b>想討論整體配置？</b><span class="small muted">副官巡檢在「副官」分頁；也可以把配置（預設只寫比例）帶去問 Claude。</span></div></div><div class="row-btns"><button class="btn small ghost" id="pf-aide">${ICON.aide}看副官巡檢</button><button class="btn small ghost" id="pf-ask">${ICON.comms}帶配置去問 Claude</button></div></section>`;
  if (P.holdings.length) {
    html += `<div class="sec-h"><h2>持股</h2><span class="aside">${P.holdings.length} 檔　依市值排序</span></div>
    <section class="panel list holds">${P.holdings.map(holdRow).join('')}</section>`;
    html += dcaStripHTML();
  } else if (isPaper()) {
    html += '<section class="panel pad calm"><b>模擬倉還是空的。</b><span class="muted">到「雷達」挑一檔，在單檔頁按「記一筆」就能模擬下單；也可以照冷眼的加碼建議買買看。</span></section>';
  }
  html += divCalHTML(P);
  html += riskHTML(P);
  if (P.closed.length) {
    html += `<div class="sec-h"><h2>已出清</h2></div><section class="panel list">${P.closed.map((x) => `<button class="w-row closed" data-code="${x.code}"><span class="w-id"><span class="w-name">${esc(x.name)}</span><span class="w-code num">${x.code}</span></span><span class="w-px"><span class="small muted" data-term="rpnl">已實現</span><span class="p num ${dirCls(x.h.realized)}">${money(x.h.realized, true)}</span></span></button>`).join('')}</section>`;
  }
  html += txHTML();
  if (!isPaper()) html += `<section class="panel pad row-between"><div><b>備份與搬家</b><div class="small muted">持股只存在這支手機，換手機前先備份（模擬倉會一起備份）。</div></div><button class="btn ghost small" id="pf-bk">備份</button></section>`;
  v.innerHTML = `<div class="pf">${html}</div>`;
  bindModeSwitch(v);
  bindPlans(v, () => renderPF());
  const add = $('#pf-add', v);
  if (add) add.addEventListener('click', () => openTradeForm({}));
  const cash = $('#pf-cash', v);
  if (cash) cash.addEventListener('click', () => openCashForm());
  const reset = $('#pf-reset', v);
  if (reset) reset.addEventListener('click', () => openPaperStart());
  const bk = $('#pf-bk', v);
  if (bk) bk.addEventListener('click', () => openBackup());
  $$('[data-code]', v).forEach((b) => b.addEventListener('click', () => openDetail(b.dataset.code)));
  $$('[data-act="dca"]', v).forEach((b) => b.addEventListener('click', () => openPending()));
  // 定期定額自動記的預估：點開是「核對」；核對過的和自己記的：一般的編輯
  $$('[data-lot]', v).forEach((b) => b.addEventListener('click', () => {
    const lot = book.lots.find((l) => l.id === b.dataset.lot);
    if (!lot) return;
    if (!isPaper() && lot.dca && lot.dca.est === true) openConfirm(lot.id); else openTradeForm({ lot });
  }));
  const more = $('#tx-more', v);
  if (more) more.addEventListener('click', () => { S.txAll = true; renderPF(); });
  const pa = $('#pf-ask', v);
  if (pa) pa.addEventListener('click', () => openAsk('pf'));
  const pd = $('#pf-aide', v);
  if (pd) pd.addEventListener('click', () => go('aide'));
  drawEq(v);
  bindXrayPf(v);
}

// ------------------------------------------------------------------ 資產走勢：用交易紀錄＋官方收盤價重算每一天
const EQ_RANGES = [[60, '3 月'], [250, '1 年'], [0, '全部']];
function eqHTML() {
  const dated = book.lots.filter((l) => l.d);
  if (!dated.length) return '';
  const r = settings.eqRange ?? 250;
  return `<div class="sec-h"><h2>資產走勢</h2><div class="seg mini" role="tablist" aria-label="期間">${EQ_RANGES.map(([n, t]) => `<button data-eq="${n}" aria-pressed="${r === n}">${t}</button>`).join('')}</div></div>
    <section class="panel chart-card eq-card"><div class="chart" id="eqchart"><div class="skeleton" style="height:210px"></div></div><div class="legend" id="eqleg"></div><p class="small muted eq-note" id="eqnote"></p></section>`;
}
let eqSeq = 0;
async function drawEq(v) {
  const box = $('#eqchart', v);
  if (!box) return;
  const my = ++eqSeq;
  $$('[data-eq]', v).forEach((b) => b.addEventListener('click', () => {
    settings.eqRange = +b.dataset.eq;
    saveSettings();
    $$('[data-eq]', v).forEach((z) => z.setAttribute('aria-pressed', z === b));
    drawEq(v);
  }));
  const paper = isPaper();
  const lots = book.lots.filter((l) => l.d);
  const codes = [...new Set(lots.map((l) => l.c).concat(paper && book.start ? [book.start.code || '0050'] : []))];
  const hists = {};
  await Promise.all(codes.map(async (c) => { hists[c] = await ensureHist(c); }));
  if (my !== eqSeq || !box.isConnected) return;
  const r = equityCurve(lots, hists, paper && book.start ? { cash0: book.start.cash0, from: book.start.d } : {});
  if (r.d.length < 3) { box.innerHTML = '<div class="empty small">交易日還太少，過幾天就畫得出走勢</div>'; return; }
  let series, fmtV, ref = null, note;
  if (paper && book.start) {
    const st = book.start;
    const bc = st.code || '0050';
    const bench = equityCurve([{ c: bc, side: 'buy', d: st.pxd || st.d, sh: st.cash0 / st.px0, px: st.px0, fee: 0, at: '0' }], { [bc]: hists[bc] }, { from: st.d });
    const bm = new Map(bench.d.map((d, i) => [d, bench.mv[i] + bench.div[i]]));
    series = [
      { name: '模擬總資產', col: 'var(--aurora)', vals: r.d.map((d, i) => r.cash[i] + r.mv[i]), width: 2.2 },
      { name: `同期全買 ${bc}`, col: 'var(--frost-2)', vals: r.d.map((d) => bm.get(d) ?? null), dash: '5 4', width: 1.6 },
    ];
    ref = st.cash0;
    fmtV = (x) => money(x);
    note = `虛線是開倉那天把起始資金全部買 ${bc}（含配息）；水平虛線是起始資金 ${money(st.cash0)} 元。`;
  } else {
    series = [
      { name: '持股市值＋已領配息', col: 'var(--frost)', vals: r.d.map((d, i) => r.mv[i] + r.div[i]), width: 2.2 },
      { name: '淨投入', col: 'var(--frost-3)', vals: r.inv.slice(), dash: '4 4', width: 1.6 },
    ];
    fmtV = (x) => money(x);
    const undated = book.lots.length - lots.length;
    note = `淨投入＝買進花的錢減掉賣出拿回的錢；兩條線的差距大約就是含息總報酬。不含可投入現金${undated ? `；${undated} 筆沒填日期的交易沒算進來` : ''}。`;
  }
  if (r.missing.length) note += ` ${r.missing.join('、')} 沒有歷史價格，沒算進來。`;
  const n = settings.eqRange ?? 250;
  const k0 = n > 0 ? Math.max(0, r.d.length - n) : 0;
  const step = Math.max(1, Math.floor((r.d.length - k0) / 280));
  const idx = [];
  for (let i = k0; i < r.d.length; i += step) idx.push(i);
  if (idx[idx.length - 1] !== r.d.length - 1) idx.push(r.d.length - 1);
  const dates = idx.map((i) => r.d[i]);
  const sv = series.map((s) => ({ ...s, vals: idx.map((i) => s.vals[i]) }));
  box.innerHTML = linesSVG({ dates, series: sv, fmtY: (x) => (settings.privacy ? '' : Math.abs(x) >= 1e4 ? `${(x / 1e4).toFixed(Math.abs(x) >= 1e6 ? 0 : 1)}萬` : x.toFixed(0)), ref, h: 210, w: box.clientWidth });
  bindLines(box, { dates, series: sv, fmtV });
  $('#eqleg', v).innerHTML = sv.map((s) => `<span><i class="${s.dash ? 'dash' : ''}" style="border-color:${s.col}"></i>${esc(s.name)}</span>`).join('') + `<span class="muted num">到 ${fmt.d(r.d[r.d.length - 1])} 收盤</span>`;
  $('#eqnote', v).textContent = note;
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
  return `<div class="sec-h"><h2>配置</h2><span class="aside" data-term="risk">${esc(PF.PROFILES[settings.risk].name)}型上限</span></div>
    <section class="panel pad alloc"><div class="a-bar" role="img" aria-label="資產配置">${bar}</div><ul class="a-list">${rows}</ul></section>`;
}

function holdRow(x) {
  const a = S.adv.get(x.code);
  const q = x.q || {};
  return `<button class="h-row" data-code="${x.code}">
    <span class="h-top"><i class="h-dot" style="background:${slotVar(x.slot)}"></i><span class="h-name">${esc(x.name)}<small class="num">${x.code}</small></span>${actChip(a)}</span>
    <span class="h-mid"><span>${sharesOf(x.h.sh)}　均價 <b class="num">${settings.privacy ? '••••' : fmt.px(x.h.avg)}</b></span><span>現價 <b class="num"${pxAttr(x.code, x.px)}>${fmt.px(x.px)}</b> <span class="num ${dirCls(q.pc)}">${fmt.pct(q.pc)}</span></span></span>
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
      stack += `<rect x="${x0.toFixed(1)}" y="${top.toFixed(1)}" width="${bw}" height="${Math.max(1, hgt - (last ? 0 : 2)).toFixed(1)}" rx="${last ? 3 : 0}" fill="${slotVar(z.x.slot)}"><title>${z.x.name} ${Math.round(z.v)} 元</title></rect>`;
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
      <p class="small muted">實際入帳通常在除息後約一個月（3～5 週）。單次 2 萬元以上，股利與利息所得的部分會先扣 2.11% 二代健保補充保費。</p>
    </section>`;
}

function riskHTML(P) {
  const s = PF.stressToStops(P.holdings, { T: P.totals.T });
  const past = P.holdings.filter((x) => x.row && isNum(x.row.dl) && isNum(x.px) && x.px < x.row.dl && !s.items.some((z) => z.code === x.code));
  if (!s.items.length && !past.length) return '';
  const mx = Math.max(...s.items.map((z) => Math.abs(z.drop)), 1);
  return `<div class="sec-h"><h2>風險地圖</h2><span class="aside">如果每一檔都跌到<span data-term="stop">出場線</span></span></div>
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
  return `<div class="sec-h"><h2>${isPaper() ? '模擬交易紀錄' : '交易紀錄'}</h2><span class="aside">${lots.length} 筆</span></div>
    <section class="panel list journal">${show.map((l) => {
    const r = S.rows.get(l.c);
    const tags = isPaper() ? '' : dcaTagsHTML(l);
    const dca = !!tags;
    return `<button class="j-row${dca && l.dca.est === true ? ' est' : ''}" data-lot="${esc(l.id)}"><span class="j-d num">${l.d ? fmt.dy(l.d) : '未填日期'}</span><span class="j-m"><span class="j-l1"><b class="${l.side === 'sell' ? 'sell' : 'buy'}">${l.side === 'sell' ? '賣出' : '買進'}</b> ${esc(r ? r.n : l.c)}</span><span class="j-l2">${sharesOf(l.sh)} × <span class="num">${fmt.px(l.px)}</span>${tags}</span>${l.note && !dca ? `<span class="j-note">${esc(l.note)}</span>` : ''}</span><span class="chev">${ICON.chev}</span></button>`;
  }).join('')}${lots.length > show.length ? `<button class="more" id="tx-more">顯示全部 ${lots.length} 筆</button>` : ''}</section>`;
}

// ================================================================== 雷達（全部 ETF：清單／熱力圖）
function radarFilter() {
  const q = S.all.q.trim().toLowerCase();
  return (r) => (S.all.cat === '*' || r.k === S.all.cat) && (S.all.sig === '*' || r.ps === S.all.sig) && (!q || r.c.toLowerCase().includes(q) || (r.n || '').toLowerCase().includes(q));
}
function renderRadar() {
  const v = $('#view');
  const cats = ['*', 'broad', 'div', 'theme', 'overseas', 'bond', 'active', 'lev', 'inv', 'fut'];
  const sigs = [['*', '全部訊號'], ['add', '可加碼'], ['wait', '漲多分批'], ['hold', '續抱'], ['caution', '先不加碼'], ['trim', '減碼']];
  const heat = settings.radarView === 'heat';
  v.innerHTML = `
    <div class="radar-tools">
      <button class="tool-btn" id="to-duel">${TOOL_ICON.duel}<span><b>ETF 對決</b><small>挑 2～3 檔比屬性</small></span></button>
      <button class="tool-btn" id="to-tm">${TOOL_ICON.tm}<span><b>存股時光機</b><small>如果當初每月買</small></span></button>
    </div>
    <div class="toolbar">
      <label class="search">${ICON.search}<input id="q" type="search" inputmode="search" placeholder="搜尋代號或名稱，例如 0050、高股息" value="${esc(S.all.q)}" autocomplete="off"></label>
      <div class="hscroll" id="cats">${cats.map((c) => `<button class="pill" data-cat="${c}" aria-pressed="${S.all.cat === c}">${c === '*' ? '全部類型' : CAT[c]}</button>`).join('')}</div>
      <div class="hscroll" id="sigs">${sigs.map(([k, t]) => `<button class="pill${k !== '*' ? ' sig-' + k : ''}" data-sig="${k}" aria-pressed="${S.all.sig === k}">${t}</button>`).join('')}</div>
      <div class="sortrow"><div class="seg mini" role="tablist" aria-label="顯示方式">${[['list', '清單'], ['heat', '熱力圖']].map(([k, t]) => `<button data-view="${k}" aria-pressed="${settings.radarView === k}">${t}</button>`).join('')}</div>
        ${heat ? '' : `<select id="sort" aria-label="排序方式">${[['score', '觀點分數（高→低）'], ['score_r', '觀點分數（低→高）'], ['chg', chgLabel()], ['val', '成交值'], ['yield', '殖利率'], ['r1y', '近一年報酬'], ['prem', '溢價（高→低）'], ['code', '代號']].map(([k, t]) => `<option value="${k}"${S.all.sort === k ? ' selected' : ''}>${t}</option>`).join('')}</select>`}
        <span id="cnt" class="cnt"></span></div>
    </div>
    <div id="stk-hits" class="stk-hits" hidden></div>
    ${heat ? `<div id="rheat">${heatCardHTML(false)}</div>` : '<section class="panel list" id="list"></section>'}`;
  const refresh = () => (settings.radarView === 'heat' ? renderRadarHeat() : renderRadarList());
  $('#q', v).addEventListener('input', (e) => { S.all.q = e.target.value; refresh(); stockHits(); });
  $$('#cats .pill', v).forEach((b) => b.addEventListener('click', () => { S.all.cat = b.dataset.cat; $$('#cats .pill', v).forEach((z) => z.setAttribute('aria-pressed', z === b)); refresh(); }));
  $$('#sigs .pill', v).forEach((b) => b.addEventListener('click', () => { S.all.sig = b.dataset.sig; $$('#sigs .pill', v).forEach((z) => z.setAttribute('aria-pressed', z === b)); refresh(); }));
  const sort = $('#sort', v);
  if (sort) sort.addEventListener('change', (e) => { S.all.sort = e.target.value; renderRadarList(); });
  $$('[data-view]', v).forEach((b) => b.addEventListener('click', () => { settings.radarView = b.dataset.view; saveSettings(); renderRadar(); }));
  $('#to-duel', v).addEventListener('click', () => openDuel());
  $('#to-tm', v).addEventListener('click', () => openTM());
  refresh();
  stockHits();
}
/** 雷達搜尋打的是公司名稱（例如台積電、輝達）：列出這家公司，點開看哪些 ETF 持有它 */
let stkT = null, stkSeq = 0;
function stockHits() {
  clearTimeout(stkT);
  const box = $('#stk-hits');
  if (!box) return;
  const q = S.all.q.trim();
  if (q.length < 2 || /^\d{2,4}[A-Z]?$/i.test(q) && S.rows.has(q.toUpperCase())) { box.hidden = true; box.innerHTML = ''; return; }
  const my = ++stkSeq;
  stkT = setTimeout(async () => {
    const hits = await searchStocks(q);
    if (my !== stkSeq || !box.isConnected) return;
    if (!hits.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = `<div class="stk-h"><span class="xr-eye" aria-hidden="true"></span>成分股：哪些 ETF 有它</div>${hits.map((h) => `<button class="stk-row" data-stk="${esc(h.key)}" data-kind="${esc(h.kind || '')}"><b>${esc(h.name)}</b><span class="num muted">${esc(h.key.length <= 6 ? h.key : '國外')}</span><span class="stk-n">${h.n} 檔 ETF 持有</span><span class="chev">${ICON.chev}</span></button>`).join('')}`;
    $$('[data-stk]', box).forEach((b) => b.addEventListener('click', () => openStock(b.dataset.stk, b.dataset.kind || null)));
  }, 260);
}
function renderRadarHeat() {
  const box = $('#rheat');
  if (!box) return;
  const f = radarFilter();
  const n = S.summary.etfs.filter((r) => r.val > 0 && f(r)).length;
  $('#cnt').textContent = `${n} 檔`;
  bindHeat(box, f);
}
function renderRadarList() {
  const list = $('#list');
  if (!list) return;
  let rows = S.summary.etfs.filter(radarFilter());
  const key = {
    score: (r) => (r.sc ?? -99), score_r: (r) => -(r.sc ?? 99), chg: (r) => (quote(r).pc ?? -99), val: (r) => (r.val ?? 0),
    yield: (r) => (r.y ?? -1), r1y: (r) => (r.r1y ?? -99), prem: (r) => (quote(r).prem ?? -99), code: null,
  }[S.all.sort];
  rows = key ? rows.sort((a, b) => key(b) - key(a)) : rows.sort((a, b) => a.c.localeCompare(b.c));
  $('#cnt').textContent = `${rows.length} 檔`;
  if (!rows.length) { list.innerHTML = `<div class="empty">找不到符合的 ETF${S.all.q.trim().length >= 2 ? '。打的是公司名稱的話，上面的「成分股」會列出持有它的 ETF。' : ''}</div>`; return; }
  list.innerHTML = rows.slice(0, 400).map((r) => {
    const qq = quote(r);
    const extra = S.all.sort === 'yield' && isNum(r.y) ? `殖利率 ${r.y.toFixed(2)}%` : S.all.sort === 'prem' && isNum(qq.prem) ? `${qq.prem >= 0 ? '溢價' : '折價'} ${Math.abs(qq.prem).toFixed(2)}%` : S.all.sort === 'val' && isNum(r.val) ? `${fmt.big(r.val)}元` : S.all.sort === 'r1y' && isNum(r.r1y) ? `近一年 ${fmt.r(r.r1y)}` : '';
    const held = !!heldOf(r.c);
    return `<button class="l-row" data-code="${r.c}"><span class="nm"><b>${esc(r.n)}${held ? '<i class="mine-dot" title="持有中"></i>' : ''}</b><span class="meta"><span class="num">${r.c}</span><span>${esc(catName(r.k))}</span>${extra ? `<span>${extra}</span>` : ''}</span></span><span class="sig">${stanceChip(r.st)}${posChip(r.ps)}</span><span class="pxc"><span class="p num"${pxAttr(r.c, qq.px)}>${fmt.px(qq.px)}</span><span class="c num ${dirCls(qq.pc)}">${fmt.pct(qq.pc)}</span></span></button>`;
  }).join('');
  $$('.l-row', list).forEach((b) => b.addEventListener('click', () => openDetail(b.dataset.code)));
  flashPrices(list);
}

// ================================================================== 情報
async function renderNews() {
  const v = $('#view');
  if (!S.news || Date.now() - S.newsAt > NEWS_MAX_AGE) {
    if (!S.news) v.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    await ensureNews();
    if (!S.news) { v.innerHTML = '<section class="panel empty">情報暫時載入失敗，稍後再試。</section>'; return; }
    if (S.tab !== 'news' || S.openCode) return;
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
    body = `<p class="disclaim">證交所與櫃買中心的除權息預告。你持有的標成紫色，關注的標成藍色。</p><section class="panel tbl-wrap"><table class="t"><thead><tr><th><span data-term="div">除息日</span></th><th>ETF</th><th class="r">每單位</th></tr></thead><tbody>${N.divs.length ? N.divs.map((x) => `<tr class="${held.has(x.c) ? 'mine' : watch.has(x.c) ? 'hl' : ''}"><td class="num">${fmt.d(x.d)}</td><td><b>${esc(x.n)}</b> <span class="muted num">${x.c}</span></td><td class="r num">${x.cash ? cash3(x.cash) + ' 元' : '<span class="muted">待公告</span>'}</td></tr>`).join('') : '<tr><td colspan="3" class="muted">目前沒有預告</td></tr>'}</tbody></table></section>`;
  } else {
    body = `<p class="disclaim">證交所與櫃買中心公布的<span data-term="notice">注意、處置</span>名單。今天全市場共 ${N.risk_total} 筆，以下只列 ETF。</p><section class="panel list news">${N.risk.length ? N.risk.map((x) => `<div class="n-item"><span class="n-meta"><span class="tag op">${x.kind === 'disposal' ? '處置' : '注意'}</span><span class="num">${x.code}</span></span><span class="n-t">${esc(x.name)}　${esc(x.period || x.text || '')}</span></div>`).join('') : '<div class="empty">目前沒有 ETF 被列入注意或處置</div>'}</section>`;
  }
  v.innerHTML = `<div class="news-wrap"><div class="hscroll"><div class="seg" role="tablist">${tabs.map(([k, t]) => `<button data-nt="${k}" aria-pressed="${S.newsTab === k}">${t}</button>`).join('')}</div></div>${body}</div>`;
  $$('[data-nt]', v).forEach((b) => b.addEventListener('click', () => { S.newsTab = b.dataset.nt; renderNews(); }));
}

// ================================================================== 戰績
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
  const tmCard = `<button class="panel tool-card" id="to-tm">${TOOL_ICON.tm}<span><b>存股時光機</b><span>如果當初每月固定買，現在會怎樣？和「只在冷眼說可加碼時才買」比一比。</span></span><span class="chev">${ICON.chev}</span></button>` + casesCardHTML();
  const bindTools = () => { $('#to-tm', v).addEventListener('click', () => openTM()); $('#to-cases', v).addEventListener('click', () => openCase()); };
  if (!o) { v.innerHTML = tmCard + '<section class="panel empty">歷史資料還在回補中，完成後這裡會顯示回測結果。</section>'; bindTools(); return; }
  const adj = T.overall_adj || { bull: o.base_up, bear: 1 - o.base_up };
  const pc = (z, d = 1) => (isNum(z) ? (z * 100).toFixed(d) + '%' : '—');
  const delta = (a, b) => (isNum(a) && isNum(b) ? `<b class="${a - b >= 0.02 ? 'good' : a - b > -0.02 ? 'meh' : 'bad'}">${a >= b ? '高' : '低'} ${Math.abs((a - b) * 100).toFixed(1)} 點</b>` : '');
  let html = tmCard + `<div class="sec-h"><h2>規則觀點的戰績</h2><span class="aside num" data-term="bt">${fmt.dy(o.start)}–${fmt.dy(o.end)}</span></div>
    <section class="big2">
      <div class="panel stat"><div class="k">偏多之後 20 日上漲</div><div class="v num">${pc(o.bull.hit)}</div><div class="s"><span data-term="base">同類基準</span> ${pc(adj.bull)}，${delta(o.bull.hit, adj.bull)}<br><span class="muted">${fmt.n(o.bull.n)} 次</span></div></div>
      <div class="panel stat"><div class="k">偏空之後 20 日下跌</div><div class="v num">${pc(o.bear.hit)}</div><div class="s"><span data-term="base">同類基準</span> ${pc(adj.bear)}，${delta(o.bear.hit, adj.bear)}<br><span class="muted">${fmt.n(o.bear.n)} 次</span></div></div>
    </section>
    <p class="disclaim">「同類基準」：同一類 ETF 每次都看多（看空）會對幾次，依訊號在各類別的次數加權。直接拿全部 ETF 混在一起比，會因為債券 ETF 偏多訊號少、上漲比例低，而高估規則的優勢（混在一起的基準是 ${pc(o.base_up)}）。${T.delisted_n ? `回測也包含 ${T.delisted_n} 檔已經下市的 ETF，避免只看活下來的。` : ''}</p>`;
  html += posTrackHTML(T);
  html += `<div class="sec-h"><h2>信心分數準不準</h2><span class="aside">方向正確率－同類亂猜</span></div>
    <section class="panel pad vs">${calibRows(T.calib)}<p class="disclaim tight">每一列是該<span data-term="cf">信心</span>區間的方向正確率，減去「同類別、同樣多空比例下亂猜」的正確率。往右越多代表越有參考價值；次數少的區間看看就好。</p></section>`;
  const cats = Object.entries(T.by_cat || {}).filter(([, s]) => s && s.n >= 30).sort((a, b) => b[1].n - a[1].n);
  if (cats.length) {
    const dd = (hit, base, n) => (isNum(hit) && n >= 30 ? `<span class="num">${pc(hit, 0)}</span><br><small class="${hit - base >= 0.02 ? 'good' : 'meh'}">${hit - base >= 0 ? '+' : '−'}${Math.abs((hit - base) * 100).toFixed(1)} 點</small>` : '<span class="muted">—</span>');
    html += `<div class="sec-h"><h2>各類 ETF</h2><span class="aside">差距＝命中率－同類一直看多／看空</span></div><section class="panel tbl-wrap"><table class="t"><thead><tr><th>類別</th><th class="r">偏多命中</th><th class="r">偏空命中</th><th class="r">一直看多</th></tr></thead><tbody>${cats.map(([k, s]) => `<tr><td>${esc(catName(k))}<br><small class="muted">${fmt.n(s.n)} 次</small></td><td class="r">${dd(s.bull.hit, s.base_up, s.bull.n)}</td><td class="r">${dd(s.bear.hit, 1 - s.base_up, s.bear.n)}</td><td class="r num muted">${pc(s.base_up, 0)}</td></tr>`).join('')}</tbody></table></section>
      <p class="disclaim">冰藍色代表比基準準 2 個百分點以上；灰色代表沒有明顯優勢，這類 ETF 的觀點會自動降低信心並標示提醒。</p>`;
  }
  html += '<div class="sec-h"><h2>上線後的實際紀錄</h2></div>';
  if (T.live && T.live.n) {
    const la = T.live_adj || { bull: T.live.base_up, bear: 1 - T.live.base_up };
    html += `<section class="big2"><div class="panel stat"><div class="k">偏多後上漲</div><div class="v num">${pc(T.live.bull.hit)}</div><div class="s">同類基準 ${pc(la.bull)}，${delta(T.live.bull.hit, la.bull)}<br><span class="muted">${fmt.n(T.live.bull.n)} 次</span></div></div><div class="panel stat"><div class="k">偏空後下跌</div><div class="v num">${pc(T.live.bear.hit)}</div><div class="s">同類基準 ${pc(la.bear)}，${delta(T.live.bear.hit, la.bear)}<br><span class="muted">${fmt.n(T.live.bear.n)} 次</span></div></div></section>`;
  } else {
    html += `<section class="panel pad prose"><p>每天收盤後的觀點都會記錄下來，20 個交易日後自動對答案。目前有 ${fmt.n(T.live_pending)} 筆觀點等待驗證，第一批結果約一個月後出現。</p></section>`;
  }
  html += `<section class="panel pad prose"><p><b>怎麼算的：</b>${esc(T.method.note)}</p><p>命中的定義：偏多之後 20 個交易日含息報酬大於 0；偏空之後小於 0。中性不算命中。回測是用過去資料檢查規則，不代表未來一樣準。</p></section>`;
  v.innerHTML = `<div class="track">${html}</div>`;
  bindTools();
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
    <section class="panel tbl-wrap"><table class="t"><thead><tr><th><span data-term="ps">部位訊號</span></th><th class="r">20 日上漲</th><th class="r">${cat === '*' ? '同類基準' : '任何一天'}</th><th class="r"><span data-term="p10">最差 10%</span></th></tr></thead><tbody>${rows}</tbody></table></section>
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

// ================================================================== 設定（全螢幕頁）
function openSettings(push = true) {
  if (S.openCode !== '__prefs') FX.cue('open');
  S.openCode = '__prefs';
  if (push && location.hash !== '#settings') history.pushState({ prefs: 1 }, '', '#settings');
  const sh = $('#sheet');
  sh.hidden = false;
  document.body.classList.add('locked');
  drawSettings();
  sh.scrollTop = 0;
}
/** 設定頁：用哪一個語音（台灣口音優先；粵語、網路語音不列）。語音清單晚一點才載入時，載入後會重畫這一列 */
function voiceRowHTML() {
  const list = FX.voiceList();
  if (!list.length) {
    const st = FX.voiceStatus();
    if (st === 'none') return '';
    return `<div class="srow col" id="s-vrow"><div><div class="h">語音</div><div class="d">${esc(st === 'unknown' ? '語音清單還在載入，等一下會出現。' : FX.voiceWhy())}</div></div></div>`;
  }
  const info = FX.voiceInfo();
  const hint = FX.voiceHint();
  const cur = settings.voiceName && list.some((v) => v.name === settings.voiceName) ? settings.voiceName : '';
  return `<div class="srow col" id="s-vrow"><div><div class="h">語音</div><div class="d">${info ? `現在用：<b>${esc(info.name)}</b>（${info.tw ? '台灣國語' : '其他地區的普通話'}）` : ''}${hint ? `<br><span class="v-warn">${esc(hint)}</span>` : ''}</div></div>
    <select class="input" id="s-vname" aria-label="語音"><option value="">自動（台灣口音優先）</option>${list.map((v) => `<option value="${esc(v.name)}"${v.name === cur ? ' selected' : ''}>${esc(v.name)}（${v.tw ? '台灣' : '普通話'}）</option>`).join('')}</select></div>`;
}
function bindVoiceRow(sh) {
  const sel = $('#s-vname', sh);
  if (!sel) return;
  sel.addEventListener('change', () => {
    settings.voiceName = sel.value || '';
    saveSettings();
    const row = $('#s-vrow', sh);
    if (row) { row.outerHTML = voiceRowHTML(); bindVoiceRow(sh); }
    const v = FX.voiceInfo();
    FX.speak(`這是冷眼的語音播報，現在用的是${v && v.tw ? '台灣國語' : '普通話'}。`, { force: true });
  });
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
  sh.innerHTML = `<div class="sheet-top"><button class="icon-btn" id="back" aria-label="返回">${ICON.back}</button><span class="ttl"><b class="ttl-b">設定</b></span></div>
  <div class="sheet-body prefs">
    <div class="sec-h"><h2>更新紀錄</h2><span class="aside">${UPDATES.length ? fmt.dy(UPDATES[0].d) : ''}</span></div>
    <section class="panel set"><div class="srow"><div><div class="h">${UPDATES.length ? esc(UPDATES[0].title) : '—'}</div><div class="d">冷眼最近加了什麼、怎麼用</div></div><button class="btn small ghost" id="s-upd">打開</button></div></section>

    <div class="sec-h"><h2>個人化</h2></div>
    <section class="panel set">
      <div class="srow"><div><div class="h">怎麼稱呼你</div><div class="d">指揮台的問候語、開機畫面的駕駛員名稱</div></div><input class="input short" id="s-name" maxlength="8" value="${esc(settings.name || '')}" placeholder="PZ"></div>
      <div class="srow"><div><div class="h">每日開機畫面</div><div class="d">每天第一次打開時，點名官方資料來源的連線狀態</div></div><button class="switch" role="switch" id="s-boot" aria-checked="${settings.boot !== false}" aria-label="每日開機畫面"></button></div>
      <div class="srow"><div><div class="h">看懂模式</div><div class="d">有虛線底線的術語點一下就有白話解釋（右上角「解」也能開關）</div></div><button class="switch" role="switch" id="s-explain" aria-checked="${explainOn()}" aria-label="看懂模式"></button></div>
      <div class="srow"><div><div class="h">隱藏金額與股數</div><div class="d">錄影、截圖、給別人看畫面時用；百分比照常顯示</div></div><button class="switch" role="switch" id="s-priv" aria-checked="${settings.privacy}" aria-label="隱藏金額"></button></div>
      <div class="srow col"><div class="h">外觀</div><div class="seg">${[['system', '跟隨系統'], ['dark', '夜戰（深色）'], ['light', '日間（淺色）']].map(([k, t]) => `<button data-theme="${k}" aria-pressed="${settings.theme === k}">${t}</button>`).join('')}</div></div>
    </section>

    <div class="sec-h"><h2>副官與聲光</h2></div>
    <section class="panel set">
      <div class="srow"><div><div class="h">音效</div><div class="d">點按、切換、檢查、上鎖、到價警報都有聲音（iPhone 側邊靜音開關打開時不出聲）</div></div><button class="switch" role="switch" id="s-sfx" aria-checked="${settings.sfx !== false}" aria-label="音效"></button></div>
      <div class="srow"><div><div class="h">音量</div></div><div class="seg mini">${[[1, '小'], [2, '中'], [3, '大']].map(([k, t]) => `<button data-vol="${k}" aria-pressed="${settings.vol === k}">${t}</button>`).join('')}</div></div>
      <div class="srow"><div><div class="h">語音播報</div><div class="d">${FX.hasVoice() ? '每天開機時，副官把晨報念給你聽（只用裝置內建的國語語音，台灣口音優先、不用粵語；不連網，只有網路語音的裝置不會念）' : esc(FX.voiceWhy())}</div></div><span class="row-btns"><button class="btn small ghost" id="s-say"${FX.hasVoice() ? '' : ' disabled'}>${ICON.speaker}試聽</button><button class="switch" role="switch" id="s-voice" aria-checked="${settings.voice !== false}" aria-label="語音播報"></button></span></div>
      ${voiceRowHTML()}
      <div class="srow"><div><div class="h">開機要點一下啟動</div><div class="d">手機規定要先點一下才能出聲。打開：每天第一次開啟時按「啟動」，有完整的點火音效和語音；關掉：自動開機、不出聲</div></div><button class="switch" role="switch" id="s-ignite" aria-checked="${settings.ignite !== false}" aria-label="開機要點一下啟動"></button></div>
      <div class="srow"><div><div class="h">畫面特效</div><div class="d">切換分頁的掃描、副官檢查的逐條鎖定、蓋章與結果揭曉（手機設定「減少動態效果」時自動關閉）</div></div><button class="switch" role="switch" id="s-fx" aria-checked="${settings.fx !== false}" aria-label="畫面特效"></button></div>
      <div class="srow"><div><div class="h">震動回饋</div><div class="d">Android 手機有效（iPhone 的網頁不支援震動）</div></div><button class="switch" role="switch" id="s-haptic" aria-checked="${settings.haptic !== false}" aria-label="震動回饋"></button></div>
      <div class="srow"><div><div class="h">交易自動記進決策日記</div><div class="d">在冷眼記今天的交易（含模擬倉）時，副官自動記下這個決定，20 個交易日後對答案</div></div><button class="switch" role="switch" id="s-autoj" aria-checked="${settings.autoJ !== false}" aria-label="交易自動記進決策日記"></button></div>
      <div class="srow col"><div><div class="h">Claude 專案指示（貼一次就好）</div><div class="d">在 Claude 建一個專案叫「冷眼參謀」，把這段貼進專案指示。之後「帶去問 Claude」可以打開「已經在 Claude 專案設好指示」，打包會比較短。</div></div>
        <div class="row-btns"><button class="btn small" id="s-proj">${ICON.copy}複製專案指示</button><a class="btn small ghost" href="https://claude.ai/projects" target="_blank" rel="noopener">${ICON.ext}開啟 Claude 專案</a></div></div>
      <div class="srow"><div><div class="h">整本決策日記歸零</div><div class="d">刪除這支手機裡的全部決策紀錄，包含已經對完答案的，戰績從零開始（只能整本歸零，不能只挑錯的刪；交易本身不受影響）。目前 ${journal.items.length} 筆</div></div><button class="btn small danger ghost" id="s-jwipe">清除</button></div>
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
      ${plansHTML()}
    </section>

    <div class="sec-h"><h2>交易成本</h2></div>
    <section class="panel set">
      <div class="srow"><div><div class="h">手續費折扣</div><div class="d">例如 6 折填 0.6、2.8 折填 0.28；原價填 1</div></div><input class="input short num" id="s-disc" inputmode="decimal" value="${settings.fee.disc}"></div>
      <div class="srow"><div><div class="h">整股最低手續費</div><div class="d">多數券商 20 元</div></div><input class="input short num" id="s-min" inputmode="numeric" value="${settings.fee.min}"></div>
      <div class="srow"><div><div class="h">零股最低手續費</div><div class="d">多數券商 1 元，依你的券商為準</div></div><input class="input short num" id="s-minodd" inputmode="numeric" value="${settings.fee.minOdd}"></div>
      <p class="small muted pad-x">ETF 賣出證交稅 0.1%；被動式債券 ETF 停徵到 2026 年底，主動式債券 ETF（代號尾碼 D）照課。整股與零股分開計算手續費。</p>
    </section>

    <div class="sec-h"><h2>我的關注</h2><span class="aside">${settings.watch.length} 檔</span></div>
    <section class="panel set"><div class="wl">${wl || '<div class="empty">還沒有關注的 ETF</div>'}</div>
      <div class="addbox"><input class="input" id="addq" placeholder="輸入代號或名稱加入，例如 006208" autocomplete="off"><div class="sugg" id="sugg"></div></div></section>

    <div class="sec-h"><h2>到價提醒</h2><span class="aside">${alerts.length} 個</span></div>
    <section class="panel set">${alerts.length ? alerts.map((a) => { const r = S.rows.get(a.c); return `<div class="wl-row"><span><b>${esc(r ? r.n : a.c)}</b> <span class="muted">${a.op === 'le' ? '跌到' : '漲到'}</span> <b class="num">${fmt.px(a.px)}</b></span><span></span><span></span><button class="mini-btn" data-ra="${a.id}" aria-label="刪除提醒">${ICON.x}</button></div>`; }).join('') : '<div class="empty small">在單檔頁右上角的鈴鐺設定</div>'}</section>

    <div class="sec-h"><h2>資料</h2></div>
    <section class="panel set">
      <div class="srow"><div><div class="h">目前使用</div><div class="d">${isPaper() ? '模擬倉：下單、建議、指揮台都是模擬的部位' : '真實部位'}</div></div><button class="btn small ghost" id="s-mode">切到${isPaper() ? '真實部位' : '模擬倉'}</button></div>
      <div class="srow"><div><div class="h">備份與搬家</div><div class="d">持股、交易、模擬倉、提醒只存在這支手機</div></div><button class="btn small ghost" id="s-bk">開啟</button></div>
      <div class="srow"><div><div class="h">清除真實部位</div><div class="d">刪除這支手機裡的真實交易、現金與提醒（模擬倉不受影響）。${(settings.plans || []).length ? '定期定額計畫會留著，明天起的扣款照樣自動記，以前的不會補回來；已經停扣的計畫一起刪掉。' : ''}</div></div><button class="btn small danger ghost" id="s-wipe">清除</button></div>
    </section>

    <div class="sec-h"><h2>顯示</h2></div>
    <section class="panel set">
      <div class="srow"><div><div class="h">定期定額視角</div><div class="d">在每檔詳情加上長期扣款的提醒</div></div><button class="switch" role="switch" id="s-dca" aria-checked="${settings.dca}" aria-label="定期定額視角"></button></div>
      <div class="srow"><div><div class="h">顯示評論與情緒用語新聞</div><div class="d">預設隱藏標題含預測、推薦、渲染字眼的新聞</div></div><button class="switch" role="switch" id="s-op" aria-checked="${settings.opinion}" aria-label="顯示評論新聞"></button></div>
    </section>

    <div class="sec-h"><h2>學習</h2><span class="aside num">已上 ${seenCount()}／${LESSONS.length} 課</span></div>
    <section class="panel set">
      <div class="srow"><div><div class="h">今日一課</div><div class="d">每天一課，基礎觀念、陷阱提醒、看盤判斷輪流；內容固定、附官方出處，也能從這裡看全部課程</div></div><button class="btn small ghost" id="s-lessons">全部課程</button></div>
      <div class="srow"><div><div class="h">案例教室</div><div class="d">用真實的歷史走勢講 2020 疫情、2022 升息、2024/8/5、2025 關稅、0050 分割、00940 這些事當時該怎麼看</div></div><button class="btn small ghost" id="s-cases">打開</button></div>
      <div class="srow"><div><div class="h">判斷教練</div><div class="d">大盤大跌、想追漲、看到新聞、除息、熱門新 ETF、部位在虧：選一種狀況，教練一步一步帶你看該看什麼、哪裡是陷阱</div></div><button class="btn small ghost" id="s-coach">打開</button></div>
    </section>

    <div class="sec-h"><h2>規則與來源</h2></div>
    <section class="panel">
      <details class="rules"><summary>冷眼小辭典</summary><div class="in">${glossaryHTML()}</div></details>
      <details class="rules"><summary>觀點怎麼算</summary><div class="in prose">${rulesHTML()}</div></details>
      <details class="rules"><summary>加碼、減碼建議怎麼算</summary><div class="in prose">${posRulesHTML()}</div></details>
      <details class="rules"><summary>副官怎麼檢查、怎麼對答案</summary><div class="in prose">${aideRulesHTML()}</div></details>
      <details class="rules"><summary>判斷教練怎麼判斷</summary><div class="in prose">${coachRulesHTML()}</div></details>
      <details class="rules"><summary>透視（成分股）怎麼算</summary><div class="in prose">${xrayRulesHTML()}</div></details>
    </section>
    <section class="panel tbl-wrap"><table class="t"><thead><tr><th>官方來源</th><th class="r">最後成功</th></tr></thead><tbody>${src.map(([, s]) => `<tr><td><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a></td><td class="r muted">${s.ok_at ? fmt.ago(s.ok_at) : '—'}</td></tr>`).join('')}</tbody></table></section>
    <section class="panel pad prose"><p><b>關於冷眼</b>　規則版本 ${esc(S.summary ? S.summary.engine : '')}，資料更新 ${S.summary ? fmt.ago(S.summary.generated) : '—'}。盤中約每 5 分鐘更新價格與預估淨值（GitHub 忙時會晚一點），收盤後陸續補上法人、融資、淨值。App 開著時每分鐘檢查一次，後台有新資料就自己換上，不用手動重新整理。</p>
      <p>這是 ${esc(settings.name || 'PZ')} 個人使用的資料整理與規則化分析工具，不是投顧服務。觀點與建議不保證報酬，任何買賣決定請自行判斷並承擔風險。</p></section>
  </div>`;
  bindSettings();
}
function bindSettings() {
  const sh = $('#sheet');
  $('#back', sh).addEventListener('click', () => closeDetail());
  $('#s-name', sh).addEventListener('change', (e) => { settings.name = e.target.value.trim().slice(0, 8) || 'PZ'; saveSettings(); $('#prefs').textContent = avatarText(); renderHeader(); toast('已更新稱呼'); });
  $('#s-boot', sh).addEventListener('click', (e) => { settings.boot = settings.boot === false; saveSettings(); e.currentTarget.setAttribute('aria-checked', settings.boot !== false); });
  $('#s-explain', sh).addEventListener('click', (e) => { setExplain(!explainOn()); paintExplain(); e.currentTarget.setAttribute('aria-checked', explainOn()); });
  $('#s-priv', sh).addEventListener('click', (e) => { settings.privacy = !settings.privacy; saveSettings(); e.currentTarget.setAttribute('aria-checked', settings.privacy); paintPrivacy(); render(); });
  $$('[data-theme]', sh).forEach((b) => b.addEventListener('click', () => { settings.theme = b.dataset.theme; saveSettings(); applyTheme(); $$('[data-theme]', sh).forEach((z) => z.setAttribute('aria-pressed', z === b)); }));
  $$('[data-risk]', sh).forEach((b) => b.addEventListener('click', () => { settings.risk = b.dataset.risk; saveSettings(); computePF(); render(); drawSettings(); toast(`已改為${PF.PROFILES[settings.risk].name}型`); }));
  $$('[data-rr]', sh).forEach((b) => b.addEventListener('click', () => { settings.rules.splice(+b.dataset.rr, 1); saveSettings(); drawSettings(); }));
  const addRule = () => { const el = $('#s-rule', sh); const t = el.value.trim(); if (!t) return; settings.rules = (settings.rules || []).concat(t.slice(0, 40)); saveSettings(); drawSettings(); toast('已新增紀律'); };
  $('#s-rule-add', sh).addEventListener('click', addRule);
  $('#s-rule', sh).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addRule(); } });
  bindPlans(sh, () => { drawSettings(); render(); });
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
  $('#s-mode', sh).addEventListener('click', () => { switchMode(isPaper() ? 'real' : 'paper'); diffSeen(); computePF(); render(); drawSettings(); toast(isPaper() ? '切到模擬倉' : '切回真實部位'); });
  $('#s-bk', sh).addEventListener('click', () => openBackup());
  $('#s-upd', sh).addEventListener('click', () => showUpdates(UPDATES.slice(0, 12), '更新紀錄'));
  $('#s-lessons', sh).addEventListener('click', () => openLessonList());
  $('#s-cases', sh).addEventListener('click', () => swapSheet('cases', (push) => openCase(null, push)));
  $('#s-coach', sh).addEventListener('click', () => swapSheet('coach', (push) => openCoach(null, push)));
  $('#s-wipe', sh).addEventListener('click', (e) => {
    const b = e.currentTarget;
    if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = '確定清除？'; return; }
    wipeBook();
    dcaAfterWipe();
    toast('已清除這支手機裡的真實部位資料');
    drawSettings();
  });
  // 副官與聲光
  const flip = (id, key, after) => $(id, sh).addEventListener('click', (e) => {
    settings[key] = settings[key] === false;
    saveSettings();
    e.currentTarget.setAttribute('aria-checked', settings[key] !== false);
    if (after) after(settings[key] !== false);
  });
  flip('#s-sfx', 'sfx', (on) => { if (on) { FX.unlock(); FX.sfx('online'); } });
  flip('#s-voice', 'voice', (on) => { if (!on) FX.stopSpeak(); });
  flip('#s-ignite', 'ignite');
  flip('#s-fx', 'fx', (on) => { paintMode(); if (on) FX.stamp('特效開啟', 'glacier'); });
  flip('#s-haptic', 'haptic', (on) => { if (on) FX.haptic('lock'); });
  flip('#s-autoj', 'autoJ');
  $$('[data-vol]', sh).forEach((b) => b.addEventListener('click', () => {
    settings.vol = +b.dataset.vol;
    saveSettings();
    $$('[data-vol]', sh).forEach((z) => z.setAttribute('aria-pressed', z === b));
    FX.unlock();
    FX.sfx('ok');
  }));
  $('#s-say', sh).addEventListener('click', () => {
    if (FX.isSpeaking()) { FX.stopSpeak(); return; }
    FX.sfx('comms');
    if (!FX.speak(briefSpeech(true), { force: true })) toast(FX.voiceWhy());
  });
  bindVoiceRow(sh);
  $('#s-proj', sh).addEventListener('click', async () => {
    const t = projectText();
    try { await navigator.clipboard.writeText(t); FX.cue('ok'); toast('已複製專案指示，到 Claude 的專案「指示」貼上', null); } catch {
      openModal(`<div class="form"><h2 class="m-title">Claude 專案指示</h2><p class="m-desc">沒辦法自動複製，請長按下面的文字全選複製。</p><textarea class="input area" rows="12" readonly>${esc(t)}</textarea><div class="m-actions"><button type="button" class="btn ghost" data-close>關閉</button></div></div>`, { label: 'Claude 專案指示' });
    }
  });
  $('#s-jwipe', sh).addEventListener('click', (e) => {
    const b = e.currentTarget;
    if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = '確定整本歸零？'; FX.sfx('warn'); return; }
    journal.items.splice(0, journal.items.length);
    saveJournal();
    bus.emit('journal');
    toast('決策日記已經整本歸零');
    drawSettings();
  });
  $('#s-dca', sh).addEventListener('click', (e) => { settings.dca = !settings.dca; saveSettings(); e.currentTarget.setAttribute('aria-checked', settings.dca); });
  $('#s-op', sh).addEventListener('click', (e) => { settings.opinion = !settings.opinion; saveSettings(); e.currentTarget.setAttribute('aria-checked', settings.opinion); });
  bindGlossary(sh);
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
    <p><b>類別回測把關</b>如果某一類 ETF 在回測中，同方向訊號的命中率沒有比同類「一直看多／一直看空」高 2 個百分點以上，該類的觀點會標示「回測無明顯優勢」並把信心扣 15 分。</p>
    <p><b>大盤之瞳</b>指揮台的圓環是全部 ETF（不含反向型）今天的觀點分布；記了持股後移到外圈細環。</p>`;
}
function posRulesHTML() {
  const P = PF.PROFILES;
  return `<p><b>移動防守線</b>近 22 個交易日最高收盤，減 3 倍 ATR（平均真實波幅）。價格創高就跟著上移；下跌時多半停在原地，但波動變大、或高點超過 22 個交易日時也會往下移；收盤跌破代表前一段上漲已經中斷。</p>
    <p><b>部位訊號</b>依序判斷，先符合先決定：① 觀點偏空且收盤跌破防守線 → 減碼；② 觀點偏空、跌破防守線、注意／處置中、或溢價超過警戒 → 先不加碼；③ 觀點偏多但短線漲多（RSI ≥ 75、爆量上漲、或比月線高出 2 倍 ATR）→ 漲多分批；④ 觀點偏多 → 可加碼；⑤ 其他 → 續抱。</p>
    <p><b>加上你的部位</b>先看注意／處置，再看減碼訊號，接著檢查比重：超過該類型上限 2 個百分點以上就建議調節。可加碼時，股數取這三個的最小值：單筆最多虧損（${P.cons.name} ${(P.cons.loss * 100).toFixed(1)}%、${P.mid.name} ${(P.mid.loss * 100).toFixed(0)}%、${P.aggr.name} ${(P.aggr.loss * 100).toFixed(0)}% 的總資產）÷ 每股到出場線的最壞虧損（含來回手續費與證交稅）、單檔上限剩下的空間、分到的可用現金（現金分 ${PF.CASH_SLICES} 份；同時有超過 ${PF.CASH_SLICES} 檔會拿到加碼計畫時平均分）。觀點中性、或信心不到 ${PF.CONF_FULL}，股數再減半。</p>
    <p><b>分三批</b>第一批現價附近（除不盡的零頭放這批）；第二、三批等拉回價，沒等到就一週、兩週後照時間買——回測顯示挑時機的優勢很小，這樣可以避免一直追不到。「跌到出場線約虧多少」用三批都以現價成交的最壞情況計算。</p>
    <p><b>出場線</b>偏多時用作廢線，其他用移動防守線。<b>減碼幅度</b>市值型、高股息、海外、債券先減三分之一；產業主題、主動式、期貨先減一半；槓桿與反向全部出場。</p>
    <p><b>成本不影響方向</b>平均成本只用來算損益、損益兩平與「跌到防守線還剩多少獲利」，不會讓規則變成攤平建議。</p>
    <p><b>交易成本</b>手續費＝成交金額 × 0.1425% × 你的折扣，無條件捨去，整股與零股分開計算並各有最低收費；ETF 賣出證交稅 0.1%，被動式債券 ETF 停徵到 2026 年底，主動式債券 ETF（代號尾碼 D）照課。</p>
    <p><b>配息</b>除息日前一天（含）以前買進、而且除息日前沒有賣出才領得到；分割前的交易會自動換算股數。單次 2 萬元以上，股利與利息所得的部分會扣 2.11% 二代健保補充保費。</p>
    <p><b>模擬倉</b>跟真的下單一樣：只在交易日 09:00–14:30 用「現在」的價格成交（盤中即時價，盤中價格超過 ${PAPER_FRESH_MIN} 分鐘沒更新就先不成交；13:25–13:30 收盤集合競價不成交；13:30 以後用收盤價），價格與手續費不能自己填，成交後不能修改，只有最新一筆在價格更新前可以撤銷。現金由起始資金、買賣金額與已領股息自動計算；成績和「開倉那天把錢全買 0050（含配息）」比較。</p>`;
}
function applyTheme() {
  const r = document.documentElement;
  if (settings.theme === 'system') r.removeAttribute('data-theme');
  else r.setAttribute('data-theme', settings.theme);
  for (const m of $$('meta[name="theme-color"]')) {
    const forDark = (m.getAttribute('media') || '').includes('dark');
    const dark = settings.theme === 'system' ? forDark : settings.theme === 'dark';
    m.content = dark ? '#050b15' : '#eef3f8';
  }
}

// ================================================================== 每日開機畫面
const BOOT_GROUPS = [
  ['證交所', '收盤・法人・融資', ['twse_daily', 'twse_flows', 'twse_margin']],
  ['證交所 MIS', '盤中淨值與折溢價', ['mis_etf']],
  ['櫃買中心', '上櫃 ETF 行情與籌碼', ['tpex_daily', 'tpex_flows', 'tpex_margin']],
  ['集保結算所', '受益人數', ['tdcc']],
  ['美國財政部', '公債殖利率', ['ust']],
  ['中央社・金管會・央行', '新聞與公告', ['cna', 'fsc', 'cbc', 'twse_news']],
];
function bootLines() {
  const src = (S.summary && S.summary.sources) || {};
  const rows = BOOT_GROUPS.map(([k, v, keys]) => {
    const ss = keys.map((x) => src[x]).filter(Boolean);
    if (!ss.length) return { k, v, ok: null, t: '連線中' };
    const ok = ss.every((s) => s.ok_at && (!s.err_at || s.err_at <= s.ok_at));
    const last = ss.map((s) => s.ok_at).filter(Boolean).sort().pop();
    return { k, v, ok, t: ok ? `連線 ${last ? fmt.d(Number(last.slice(0, 10).replace(/-/g, ''))) + ' ' + last.slice(11, 16) : ''}` : '部分異常' };
  });
  const bt = S.track && S.track.overall && S.track.overall.start;
  rows.push({ k: '規則引擎', v: `v${S.summary ? S.summary.engine : '—'}・${bt ? `回測從 ${Math.floor(bt / 10000)} 年${bt <= 20220101 ? '起，含 2022 年大跌' : ' ' + (Math.floor(bt / 100) % 100) + ' 月起'}` : '固定規則、可重現'}`, ok: true, t: '就緒' });
  rows.push({ k: '駕駛員', v: settings.name || 'PZ', ok: true, t: '認證', me: true });
  return rows;
}
/**
 * 每天第一次打開的開機畫面。
 * 「開機要點一下啟動」打開時（預設）：先停在待命畫面，按「啟動」才點火——手機規定要先點一下才能出聲，
 * 所以點火音效、每一行的連線聲、最後的語音晨報都從這一下開始；不想要聲音可以按「直接進入」。
 */
function maybeBoot() {
  if (settings.boot === false) return;
  const d = today();
  if (store.get('bootDay', 0) === d) return;
  store.set('bootDay', d);
  const el = $('#boot');
  const tx = S.summary ? liveTaiex() : null;
  const lines = bootLines();
  const gate = settings.ignite !== false && (settings.sfx !== false || settings.voice !== false);
  el.innerHTML = `<div class="bt-in">
      <div class="bt-mark"><span>冷</span><span>眼</span></div>
      <div class="bt-name">冷眼　台股 ETF 指揮系統</div>
      ${gate ? `<button class="bt-ign" type="button" aria-label="啟動冷眼"><span class="bt-ring" aria-hidden="true"></span><span class="bt-ign-in"><b>啟動</b><small class="num">IGNITION</small></span></button>
      <div class="bt-hint">駕駛員 ${esc(settings.name || 'PZ')}，系統待命中</div>` : ''}
      <ol class="bt-log">${lines.map((l, i) => `<li style="--i:${i}" class="${l.ok === false ? 'warn' : ''}${l.me ? ' me' : ''}"><span class="bt-k">${esc(l.k)}</span><span class="bt-v">${esc(l.v)}</span><span class="bt-s">${esc(l.t)}</span></li>`).join('')}</ol>
      <div class="bt-hi" style="--i:${lines.length}">歡迎回來，${esc(settings.name || 'PZ')}${tx ? `<small>加權 <b class="num">${fmt.n(tx.px, 0)}</b> <b class="num ${dirCls(tx.ch)}">${fmt.pct(tx.pc)}</b>・${esc(tx.when)}</small>` : ''}</div>
      <button class="bt-skip" type="button">${gate ? '不用聲音，直接進入' : '點一下略過'}</button>
    </div>`;
  el.hidden = false;
  el.classList.toggle('standby', gate);
  document.body.classList.add('booting');
  let voiced = false;
  const done = () => {
    if (el.hidden || el.classList.contains('out')) return;
    S.bootDone = null;
    el.classList.add('out');
    setTimeout(() => {
      el.hidden = true; el.classList.remove('out', 'go', 'standby'); el.innerHTML = '';
      document.body.classList.remove('booting');
      S.firstPaint = true; S.animUntil = 0;
      if (S.tab === 'home' && !S.openCode) render();
      if (voiced && settings.voice !== false) setTimeout(() => { FX.sfx('comms'); FX.speak(briefSpeech(true)); }, 450);
    }, reduceMotion() ? 0 : 380);
  };
  S.bootDone = done;
  const total = reduceMotion() ? 900 : 650 + lines.length * 150 + 1100;
  const run = (withSound) => {
    el.classList.remove('standby');
    el.classList.add('go');
    voiced = withSound;
    const sk = $('.bt-skip', el);
    if (sk) sk.textContent = '點一下略過';
    if (withSound) {
      FX.unlock();
      if (settings.voice !== false) FX.primeSpeech();
      FX.cue('ignite');
      lines.forEach((l, i) => setTimeout(() => FX.sfx(l.ok === false ? 'warn' : 'tick'), 450 + i * 150));
      setTimeout(() => FX.cue('online'), 600 + lines.length * 150);
    }
    setTimeout(done, total + (withSound ? 500 : 0));
  };
  if (gate) {
    $('.bt-ign', el).addEventListener('click', (ev) => { ev.stopPropagation(); run(true); }, { once: true });
    $('.bt-skip', el).addEventListener('click', (ev) => { ev.stopPropagation(); done(); });
  } else {
    el.addEventListener('click', done, { once: true });
    run(false);
  }
}
function speakPill() {
  let p = $('#speak-pill');
  if (!p) {
    p = document.createElement('button');
    p.id = 'speak-pill';
    p.className = 'speak-pill';
    p.type = 'button';
    p.hidden = true;
    p.innerHTML = `<span class="sp-wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span>副官播報中</span><b>${ICON.stopSq}停止</b>`;
    p.addEventListener('click', () => FX.stopSpeak());
    document.body.appendChild(p);
  }
  FX.onSpeak((on) => { p.hidden = !on; const s = $('#br-say'); if (s) s.classList.toggle('on', on); });
}

// ================================================================== 事件
bus.on((what, data) => {
  if (what === 'trade') {
    onTrade(data);
    // 真實部位剛記了一筆：如果剛好是定期定額扣款那幾天的同一檔，馬上比對、問是不是同一筆（避免記兩次）
    if (data && !data.paper && (settings.plans || []).some((p) => data.lot && p.c === data.lot.c)) runPlans();
    return;
  }
  // 你說「自己記的那筆就是定期定額」：那筆如果進了決策日記、還沒定案，就拿掉（定期定額不是在猜漲跌）
  if (what === 'dcalink') { onLotDel(data); return; }
  if (what === 'dcarun') { runPlans(); return; }
  if (what === 'lotdel') { onLotDel(data); onDcaLotDel(data); return; }
  if (what === 'lotedit') { onLotEdit(data); return; }
  if (what === 'book' || what === 'watch' || what === 'alerts') {
    if (what !== 'alerts') diffSeen();
    computePF();
    render();
    if (S.openCode === '__prefs') drawSettings();
    else if (S.openCode && !S.openCode.startsWith('__')) renderDetail(S.openCode);
  }
  // 全螢幕頁開著時有新資料進來：關掉之後把底下的畫面換新
  if (what === 'closed') { if (S.viewStale) { S.viewStale = false; render(); } return; }
  if (what === 'journal') {
    // 決策日記變了：首頁卡片、副官分頁、徽章、單檔頁的紀錄跟著更新（彈出視窗是另一層，不受影響）
    paintBadge();
    if (S.tab === 'aide' || S.tab === 'home') render();
    if (S.openCode === '__prefs') drawSettings();
    else if (S.openCode && !S.openCode.startsWith('__')) renderDetail(S.openCode);
  }
});
window.addEventListener('popstate', () => {
  const h = location.hash.replace('#', '');
  if (modalOpen()) closeModal();
  if (h === 'settings') { if (S.openCode !== '__prefs') openSettings(false); return; }
  if (h === 'duel') { if (S.openCode !== '__duel') openDuel(false); return; }
  if (h === 'tm') { if (S.openCode !== '__tm') openTM(false); return; }
  if (h === 'cases') { if (S.openCode !== '__cases') openCase(S.caseId || null, false); return; }
  if (h === 'coach') { if (S.openCode !== '__coach') openCoach(S.coachId || null, false); return; }
  if (h && S.rows.has(h)) { openDetail(h, false); return; }
  if (S.openCode) closeDetail(true);
});
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.deferredInstall = e; if (S.tab === 'home' && S.summary) render(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.summary) { syncTick().then(() => { refreshEvals(); runPlans(); }); }
  if (document.visibilityState === 'hidden') FX.stopSpeak();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#boot').hidden) { if (S.bootDone) S.bootDone(); return; }
  if (FX.isSpeaking()) FX.stopSpeak();
  if (modalOpen()) closeModal();
  else if (S.openCode) closeDetail();
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
let resizeT = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => { if (!S.openCode && (S.tab === 'home' || (S.tab === 'radar' && settings.radarView === 'heat'))) drawHeats($('#view'), S.tab === 'radar' ? radarFilter() : null); }, 180);
});

async function refreshLive(v) {
  try {
    S.live = await getJSON('live.json', { v });
    store.set('cache.live', S.live);
    computePF();
    renderHeader();
    if (S.tab === 'home' || S.tab === 'pf' || S.tab === 'radar') viewRender();
    refreshDetailQuote();
  } catch { /* 下次再試 */ }
}
/** 資料更新後重畫主畫面：有全螢幕頁開著就不動；正在搜尋框打字時只更新清單（不把你打到一半的字和游標洗掉） */
function viewRender() {
  if (S.openCode) { S.viewStale = true; return; }
  const ae = document.activeElement;
  if (ae && ae.closest && ae.closest('#view') && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) {
    if (S.tab === 'radar' && settings.radarView !== 'heat') renderRadarList();
    return;
  }
  render();
}

// ================================================================== 資料同步
// 後台每一輪（盤中約 5 分鐘一輪、收盤後幾輪）都會寫 version.json：每一份資料自己的時間。
// 畫面開著時每分鐘看一次（很小的檔），哪一份變了就只重抓那一份——收盤資料換批時，單檔分析、戰績、歷史、成分股的快取一起換新，
// 不會一頁新一頁舊；新聞、成分股行情也在幾分鐘內跟上。後台是舊版（沒有 files）或離線時，照舊：盤中每分鐘看即時價、其他每 15 分鐘。
const SYNC_MS = 60000;
const RETRY_MS = 2 * 60000;
let syncBusy = false;
let lastBatch = Date.now();
const tried = {};
/** 同一個時間戳抓過了卻還是舊的（網站的快取還沒換）：2 分鐘後再試，不要每分鐘猛抓大檔 */
function tryStamp(k, stamp) {
  const t = tried[k];
  if (t && t.s === stamp && Date.now() - t.at < RETRY_MS) return false;
  tried[k] = { s: stamp, at: Date.now() };
  return true;
}
async function syncTick() {
  if (syncBusy || !S.summary) return;
  syncBusy = true;
  try {
    let v = null;
    try { v = await getJSON('version.json'); } catch { v = null; }
    const F = v && !S.verOffline && v.files && typeof v.files === 'object' ? v.files : null;
    if (!F) {
      if ((S.live && S.live.open) || inSession()) await refreshLive();
      if (Date.now() - lastBatch > 15 * 60000) await newBatch();
      return;
    }
    // 開 App 時沒有網路（用的是上次存下的資料），現在連得上了：整批重抓一次，「離線」的標示才會消失
    if (S.offline && tryStamp('offline', F.summary || '')) await newBatch({ v: F.summary, lv: F.live });
    else if (F.summary && F.summary !== (S.summary && S.summary.generated) && tryStamp('summary', F.summary)) await newBatch({ notify: true, v: F.summary, lv: F.live });
    else if (F.live && F.live !== (S.live && S.live.at) && tryStamp('live', F.live)) await refreshLive(F.live);
    if (S.news && F.news && F.news !== S.news.generated && tryStamp('news', F.news)) await refreshNews(F.news);
    if (S.stockq && F.stockq && F.stockq !== S.stockq.at && tryStamp('stockq', F.stockq)) await refreshStockq(F.stockq);
    if ((S.stocks && F.stocks && F.stocks !== S.stocks.at && tryStamp('stocks', F.stocks))
      || (S.holdIdx && F.hold && F.hold !== S.holdIdx.at && tryStamp('hold', F.hold))) {
      bus.emit('holddata');
      if (S.tab === 'pf') viewRender();
    }
  } catch { /* 連不上：下一分鐘再試 */ } finally {
    syncBusy = false;
  }
}
/**
 * 收盤資料換了一批（或手動重新整理）：summary、即時價、配息、戰績一起重抓，單檔分析、歷史、成分股的快取作廢。
 * 主畫面直接換新；開著的單檔頁重抓它的分析再畫（保留捲動位置）；其他全螢幕頁（時光機、對決、教練…）是打開時算的，提醒重新打開。
 */
async function newBatch(o = {}) {
  lastBatch = Date.now();
  const before = S.summary && S.summary.generated;
  await loadCore({ v: o.v, lv: o.lv });
  const changed = o.force || (S.summary && S.summary.generated !== before);
  // 先作廢、再抓戰績與配息：網址帶的是新的這一批，網站的快取不會給舊的
  if (changed) invalidateBatch();
  const [track] = await Promise.all([changed || !S.track ? getJSON('track.json', { batch: true }).catch(() => null) : null, ensureDivs(true), ensureCal(true)]);
  if (track) S.track = track;
  if (changed && S.news) refreshNews();
  diffSeen();
  computePF();
  viewRender();
  if (changed && S.openCode && !S.openCode.startsWith('__')) {
    const code = S.openCode;
    const row = S.rows.get(code);
    const det = row && row.st != null ? await ensureDetail(code) : null;
    if (S.openCode === code) renderDetail(code, det);
  } else if (changed && S.openCode && o.notify && S.openCode !== '__prefs') {
    toast(`收盤資料已更新到 ${fmt.d(S.summary.asof)}。這一頁是更新前算的，重新打開就會用新的`);
  } else {
    refreshDetailQuote();
  }
  refreshEvals();
  runPlans();
}
async function refreshNews(v) {
  let n;
  try { n = await getJSON('news.json', { v }); } catch { return; }
  S.news = n;
  S.newsAt = Date.now();
  // 情報分頁：直接換新（有全螢幕頁開著就等關掉再換）；指揮台的官方快訊（寬螢幕）也一樣
  if (S.tab === 'news') viewRender();
  else if (S.tab === 'home') { if (S.openCode) S.viewStale = true; else paintNewsMini(); }
}

async function boot() {
  applyTheme();
  FX.bind(() => settings);
  FX.onVoices(() => {
    if (S.openCode !== '__prefs') return;
    const sh = $('#sheet');
    const row = sh && $('#s-vrow', sh);
    if (row) { row.outerHTML = voiceRowHTML(); bindVoiceRow(sh); }
  });
  renderShell();
  installExplain();
  speakPill();
  // 手機要先點一下才能出聲：任何一次點擊或按鍵都順便喚醒音效引擎
  for (const ev of ['pointerdown', 'keydown', 'touchend']) document.addEventListener(ev, () => FX.unlock(), { capture: true, passive: true });
  // 一般按鈕的「喀」一聲＋輕震動（分頁列、對話框有自己的聲音）
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button, a.btn, a.n-item, [role="switch"]');
    if (!b || b.disabled || b.closest('.dock') || b.closest('.boot')) return;
    FX.sfx('tap');
    FX.haptic('tap');
  }, true);
  aideHooks.brief = () => briefItems().map((it) => it.t.replace(/\*\*/g, ''));
  coachHooks.idea = (o) => openIdea(o);
  coachHooks.lesson = (id) => openLesson(id);
  coachHooks.kase = (id) => swapSheet('cases', (push) => openCase(id, push));
  coachHooks.term = (k) => openTerm(k, null);
  coachHooks.ask = (id, ctx, subject) => openAsk('coach', { coach: (amt) => coachPacket(id, ctx, subject, amt) });
  coachHooks.xray = (code) => coachXray(code);
  aideHooks.actions = () => buildActions(S.P).map((a) => `${plainText(a.title, '')}：${plainText(a.text)}`);
  const cached = useCache();
  if (cached) { computePF(); maybeBoot(); render(); } else render();
  const gen0 = S.summary && S.summary.generated;
  try {
    await loadCore();
    // 上次存下的是舊的一批：開機這段時間用舊資料抓過的單檔分析、歷史一起作廢
    if (gen0 && S.summary && S.summary.generated !== gen0) invalidateBatch();
  } catch {
    if (!S.summary) { $('#view').innerHTML = '<section class="panel empty">資料還在準備中，請稍後再開。</section>'; return; }
    toast('連不上伺服器，顯示的是上次的資料');
  }
  await Promise.all([ensureTrack(), ensureDivs(true), ensureCal(true)]);
  diffSeen();
  computePF();
  if (!cached) maybeBoot();
  render();
  refreshEvals();
  runPlans();   // 定期定額：到期的每一期自動記一筆預估（國泰規則）
  const h = location.hash.replace('#', '');
  if (h === 'settings') openSettings(false);
  else if (h === 'duel') openDuel(false);
  else if (h === 'tm') openTM(false);
  else if (h === 'cases') openCase(null, false);
  else if (h === 'coach') openCoach(null, false);
  else if (h && S.rows.has(h)) openDetail(h, false);
  // 畫面開著時每分鐘看一次後台的版本檔，哪一份資料變了就重抓那一份（見 syncTick）；網路恢復時馬上看一次
  setInterval(() => { if (document.visibilityState === 'visible') syncTick(); }, SYNC_MS);
  window.addEventListener('online', () => { if (document.visibilityState === 'visible') syncTick(); });
  setInterval(() => { if (document.visibilityState === 'visible') renderHeader(); }, 30000);
  // 對答案、定期定額：每 15 分鐘再檢查一次（例如 13:25 定案、收盤後到期）
  setInterval(() => { if (document.visibilityState === 'visible') { refreshEvals(); runPlans(); } }, 15 * 60000);
  // 同一支手機開了兩個冷眼分頁：另一邊記了交易或提醒，這邊馬上重讀，免得用舊的內容蓋回去
  window.addEventListener('storage', (e) => {
    if (!e.key) return;
    if (isBookKey(e.key)) { reloadBook(); bus.emit('book'); }
    else if (e.key === 'coldeye.alerts') { alerts.splice(0, alerts.length, ...store.get('alerts', [])); bus.emit('alerts'); }
    else if (isJournalKey(e.key)) { reloadJournal(); bus.emit('journal'); }
    else if (e.key === 'coldeye.settings') {
      // 另一個分頁改了定期定額計畫（或刪了某一期）：重讀，免得這邊用舊的蓋回去（其他設定維持這個分頁自己的）
      const before = JSON.stringify([settings.plans, settings.dcaSkip, settings.dcaNoAsk]);
      reloadPlans();
      if (JSON.stringify([settings.plans, settings.dcaSkip, settings.dcaNoAsk]) !== before) bus.emit('book');
    }
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  setTimeout(() => announceUpdates(8), 2500);
}

// ------------------------------------------------------------------ 更新紀錄：有沒看過的新功能，開機畫面結束後提示一次
function updatesHTML(list) {
  return list.map((u) => `<div class="upd"><div class="upd-h"><b>${esc(u.title)}</b><span class="num muted">${fmt.dy(u.d)}</span></div><ul>${u.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('');
}
function showUpdates(list, title) {
  openModal(`<div class="form"><h2 class="m-title">${esc(title)}</h2><div class="upd-list">${updatesHTML(list)}</div><div class="m-actions"><button type="button" class="btn" data-close>知道了</button></div></div>`, { label: title });
}
function announceUpdates(tries) {
  if (!UPDATES.length) return;
  // 開機畫面、對話框、單檔頁開著的時候先不打擾，等一下再看
  if (document.body.classList.contains('booting') || modalOpen() || S.openCode) { if (tries > 0) setTimeout(() => announceUpdates(tries - 1), 4000); return; }
  const seen = store.get('seenUpd', null);
  const latest = UPDATES[0].id;
  store.set('seenUpd', latest);
  if (seen === latest || (!seen && !HAD_SAVE)) return;
  const k = seen ? UPDATES.findIndex((u) => u.id === seen) : 1;
  showUpdates(UPDATES.slice(0, Math.max(1, Math.min(3, k < 0 ? 1 : k))), '冷眼更新了');
}
boot();
