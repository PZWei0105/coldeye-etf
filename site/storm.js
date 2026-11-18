/* 冷眼 — 歷史風暴重演（2026/11/18，PZ：「超級大更新，超專業」）
   把真的發生過的四次大跌（案例教室裡的 2020 疫情、2022 升息、2024/8/5、2025/4 關稅），
   用當時每一檔真的跌了多少（含息報酬指數），套在你「現在」的部位比例上：總資產最多跌多少、哪一檔拖最多、多久回到原點。
   不是預測，也不改任何建議；計算是 calc.js 的 stormRun（純函式，tests/storm_test.mjs）。
   持股只在手機上算，不送出去。 */
import { $, $$, esc, isNum, S, fmt, money, ICON, ensureHist, settings, reduceMotion, isPaper } from './core.js';
import { stormRun, stormProxyOf, STORM_TAIL } from './calc.js';
import { CASES, openCase } from './cases.js';
import { linesSVG, bindLines } from './viz.js';
import { closeDetail } from './sheet.js';
import * as FX from './fx.js';

const BENCH = '0050';
/** 四場風暴：期間照案例教室（找下跌的範圍），名字短一點放得進分頁按鈕 */
export const STORMS = [
  { id: 'covid2020', n: '疫情崩跌', y: '2020' },
  { id: 'bear2022', n: '升息熊市', y: '2022' },
  { id: 'crash20240805', n: '黑色星期一', y: '2024' },
  { id: 'tariff2025', n: '關稅震撼', y: '2025' },
].map((s) => {
  const c = CASES.find((x) => x.id === s.id) || {};
  return { ...s, from: c.from, to: c.to, title: c.t || s.n, src: c.src || [] };
}).filter((s) => s.from);

const anim = () => settings.fx !== false && !reduceMotion();
const pctS = (x, d = 1) => (isNum(x) ? (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x * 100).toFixed(d) + '%' : '—');
const dCls = (x) => (isNum(x) ? (x > 0 ? 'up' : x < 0 ? 'down' : 'flat') : 'flat');

/** 現在的部位（真實部位或模擬倉，看目前顯示哪一本）：每一檔占總資產的比例、現金比例 */
function pfInput(P) {
  if (!P || !(P.totals.T > 0)) return null;
  const holds = P.holdings.filter((x) => isNum(x.w) && x.w > 0).map((x) => ({ code: x.code, name: x.name, k: x.row ? x.row.k : null, w: x.w }));
  if (!holds.length) return null;
  return { holds, cashW: P.totals.cash > 0 ? P.totals.cash / P.totals.T : 0 };
}
const keyOf = (inp) => (inp ? inp.holds.map((h) => `${h.code}:${h.w.toFixed(4)}`).join('|') + `|c${inp.cashW.toFixed(4)}|${S.summary ? S.summary.asof : ''}` : '');
/** 要用到的歷史檔：持股、每一檔的同類代替、基準 */
function codesFor(inp) {
  const set = new Set([BENCH]);
  for (const h of inp.holds) { set.add(h.code); const px = stormProxyOf(h.code, h.k); if (px) set.add(px); }
  return [...set];
}
const cache = new Map();   // keyOf → { 風暴 id: 結果 }
async function runAll(inp) {
  const key = keyOf(inp);
  if (cache.has(key)) return cache.get(key);
  const codes = codesFor(inp);
  const got = await Promise.all(codes.map((c) => ensureHist(c).catch(() => null)));
  const hists = {};
  codes.forEach((c, i) => { if (got[i]) hists[c] = got[i]; });
  const out = {};
  for (const s of STORMS) out[s.id] = stormRun(s, hists[BENCH], inp.holds, inp.cashW, hists);
  if (hists[BENCH]) { if (cache.size > 6) cache.clear(); cache.set(key, out); }
  return out;
}

// ------------------------------------------------------------------ 部位分頁的卡片
export function stormCardHTML(P) {
  const inp = pfInput(P);
  if (!inp) return '';
  const res = cache.get(keyOf(inp));
  return `<div class="sec-h"><h2>歷史風暴重演</h2><span class="aside">真的發生過的大跌，套在你現在的部位</span></div>
    <section class="panel pad storm-card">
      <div class="sc-grid">${STORMS.map((s) => {
    const r = res && res[s.id];
    const v = r && isNum(r.drop) ? `<b class="num ${dCls(r.drop)}">${pctS(r.drop)}</b><small>${r.back ? `${r.backN} 個交易日回來` : '還沒回到原點'}</small>` : '<b class="sc-go">重演</b><small>點一下開始</small>';
    return `<button class="sc-tile" data-storm="${s.id}"><span class="sc-y num">${s.y}</span><span class="sc-n">${esc(s.n)}</span><span class="sc-v" data-sv="${s.id}">${v}</span><i class="sc-bolt" aria-hidden="true">${BOLT}</i></button>`;
  }).join('')}</div>
      <p class="small muted">不是預測：用當時每一檔真的跌了多少（含息），照你現在的比例算總資產會怎樣。${isPaper() ? '目前算的是模擬倉。' : ''}</p>
    </section>`;
}
export function bindStormCard(v) {
  $$('[data-storm]', v).forEach((b) => b.addEventListener('click', () => openStorm(b.dataset.storm)));
  const inp = pfInput(S.P);
  if (!inp || cache.has(keyOf(inp)) || S.offline) return;
  // 背景先算好，卡片直接寫結果（歷史檔資產走勢多半已經抓過了）
  runAll(inp).then((res) => {
    for (const s of STORMS) {
      const el = $(`[data-sv="${s.id}"]`, v);
      const r = res[s.id];
      if (el && r && isNum(r.drop)) el.innerHTML = `<b class="num ${dCls(r.drop)}">${pctS(r.drop)}</b><small>${r.back ? `${r.backN} 個交易日回來` : '還沒回到原點'}</small>`;
    }
  }).catch(() => {});
}

// ------------------------------------------------------------------ 全螢幕頁
const BOLT = '<svg viewBox="0 0 20 20"><path d="M11.5 1.5 4 11h5l-1.5 7.5L16 8.5h-5.2z" fill="currentColor"/></svg>';
let cur = STORMS[0] ? STORMS[0].id : null;
export function openStorm(id = null, push = true) {
  if (id && STORMS.some((s) => s.id === id)) cur = id;
  if (S.openCode !== '__storm') FX.cue('open');
  S.openCode = '__storm';
  if (push && location.hash !== '#storm') history.pushState({ tool: 'storm' }, '', '#storm');
  const sh = $('#sheet');
  sh.hidden = false;
  document.body.classList.add('locked');
  sh.scrollTop = 0;
  drawStorm(true);
}

function topHTML() {
  return `<div class="sheet-top"><button class="icon-btn" id="back" aria-label="返回">${ICON.back}</button><span class="ttl"><b class="ttl-b">歷史風暴重演</b><span>真的發生過的大跌 × 你現在的部位</span></span></div>`;
}
function tabsHTML() {
  return `<div class="seg st-tabs" role="tablist" aria-label="哪一場風暴">${STORMS.map((s) => `<button role="tab" data-sid="${s.id}" aria-pressed="${s.id === cur}"><span class="num">${s.y}</span>${esc(s.n)}</button>`).join('')}</div>`;
}
const ymdS = (d) => (d ? fmt.dy(d) : '—');

async function drawStorm(animate = false) {
  const sh = $('#sheet');
  const inp = pfInput(S.P);
  const sc = STORMS.find((s) => s.id === cur) || STORMS[0];
  if (!inp) {
    sh.innerHTML = topHTML() + `<div class="sheet-body tool storm"><section class="panel pad"><h3>還沒有部位可以重演</h3><p class="muted">先在「部位」記一筆交易（或打開模擬倉），冷眼才知道你現在每一檔占多少。</p></section></div>`;
    $('#back', sh).addEventListener('click', () => closeDetail());
    return;
  }
  const key = keyOf(inp);
  if (!cache.has(key)) {
    sh.innerHTML = topHTML() + `<div class="sheet-body tool storm">${tabsHTML()}<section class="st-hero loading"><div class="st-sky" aria-hidden="true"></div><div class="st-load"><span class="st-spin" aria-hidden="true"></span>正在調出 ${STORMS.length} 場風暴的官方歷史資料…</div></section><div class="skeleton" style="height:220px"></div></div>`;
    $('#back', sh).addEventListener('click', () => closeDetail());
  }
  let res;
  try { res = await runAll(inp); } catch { res = null; }
  if (S.openCode !== '__storm') return;
  const r = res && res[sc.id];
  const y = sh.scrollTop;
  sh.innerHTML = topHTML() + `<div class="sheet-body tool storm">${tabsHTML()}${r && r.port ? bodyHTML(sc, r, inp) : `<section class="panel pad"><p class="muted">這一場的歷史資料還拿不到（網路斷了或 0050 的歷史檔還沒載入），等一下再打開一次。</p></section>`}</div>`;
  if (!animate) sh.scrollTop = y;
  $('#back', sh).addEventListener('click', () => closeDetail());
  $$('[data-sid]', sh).forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.sid === cur) return;
    cur = b.dataset.sid;
    FX.sfx('nav');
    drawStorm(true);
  }));
  const cs = $('#st-case', sh);
  if (cs) cs.addEventListener('click', () => { S.openCode = null; history.replaceState(history.state == null ? null : { tool: 'cases' }, '', '#cases'); openCase(sc.id, false); });
  bindLines(sh);
  if (r && r.port) play(sh, r, animate);
}

function bodyHTML(sc, r, inp) {
  const T = S.P.totals.T;
  const loss = isNum(r.drop) ? T * r.drop : null;
  const lowN = r.lowN;
  const lastI = r.backPk != null ? Math.min(r.dates.length - 1, r.backPk + 40) : Math.min(r.dates.length - 1, Math.max(lowN + 120, 0));
  const cut = (a) => a.slice(0, lastI + 1);
  const w = Math.max(320, Math.min(1100, (($('#sheet') || {}).clientWidth || 380) - 40));
  const marks = [{ i: lowN, t: `谷底 ${fmt.d(r.lowAt)}` }];
  if (r.backPk != null && r.backPk <= lastI) marks.push({ i: r.backPk, t: `回到原點 ${fmt.d(r.back)}` });
  const chart = linesSVG({
    dates: cut(r.dates), w, h: 220, ref: 100, marks,
    series: [
      { vals: cut(r.bench), col: 'var(--glacier)', width: 1.6, dash: '5 4' },
      { vals: cut(r.port), col: 'var(--aurora)', width: 2.6 },
    ],
    fmtY: (v) => fmt.n(v, 0),
  });
  const worst = r.items[0];
  const mx = Math.max(...r.items.map((x) => Math.abs(x.contrib)), 0.0001);
  const recov = r.back
    ? `谷底之後 <b class="num">${r.backN}</b> 個交易日，<b class="num">${ymdS(r.back)}</b> 回到原點`
    : `到 <b class="num">${ymdS(r.until)}</b>（谷底後 ${STORM_TAIL} 個交易日內）都還沒回到原點`;
  const vs = `同一段時間只抱 0050：<b class="num ${dCls(r.bDrop)}">${pctS(r.bDrop)}</b>，${r.bBack ? `谷底後 ${r.bBackN} 個交易日回來` : '一直到資料最後都還沒回來'}`;
  const proxies = r.items.filter((x) => x.proxy);
  const notes = [];
  if (r.cashW > 0.0005) notes.push(`現金占 ${pctS(r.cashW).replace('+', '')}，這段期間不會跌，是你的緩衝。`);
  if (proxies.length) notes.push(`${proxies.map((x) => `${esc(x.name)}當時還沒上市（或歷史不夠早），用同類的 ${esc(x.src)} 代替`).join('；')}。`);
  if (r.skipped.length) notes.push(`${r.skipped.map((x) => esc(x.name)).join('、')} 沒有夠早、又能代替的同類資料，沒有算進去（其他照比例放大，這次算到總資產的 ${Math.round(r.coverage * 100)}%）。`);
  return `<section class="st-hero">
      <div class="st-sky" aria-hidden="true"><i class="st-rain"></i><i class="st-flash"></i></div>
      <div class="st-hd"><span class="st-yr num">${sc.y}</span><h2>${esc(sc.n)}</h2></div>
      <p class="st-span">0050 從 <b class="num">${ymdS(r.peakD)}</b> 的高點，跌到 <b class="num">${ymdS(r.lowD)}</b> 的低點</p>
      <div class="st-big"><span class="st-lbl">你現在的部位，總資產最多</span><b class="num ${dCls(r.drop)}" data-drop="${r.drop}">${pctS(r.drop)}</b>${isNum(loss) ? `<span class="st-amt">約 <b class="num ${dCls(loss)}">${money(loss, true)}</b> 元</span>` : ''}</div>
      <p class="st-rec">${recov}</p>
      <p class="st-vs">${vs}</p>
    </section>
    <div class="sec-h"><h2>走勢重演</h2><span class="aside"><i class="st-key you"></i>你的部位　<i class="st-key b"></i>0050　起點＝100</span></div>
    <section class="panel pad st-chart chart">${chart}</section>
    <div class="sec-h"><h2>誰拖最多</h2><span class="aside">到你部位的谷底那天（${fmt.d(r.lowAt)}）</span></div>
    <section class="panel list st-items">${r.items.map((x) => `<div class="st-it${x === worst && x.contrib < 0 ? ' worst' : ''}"><span class="st-nm"><b>${esc(x.name)}</b><small class="num">${esc(x.code)}・占 ${(x.w * 100).toFixed(1)}%${x.proxy ? `・用 ${esc(x.src)} 代替` : ''}</small></span><span class="st-bar"><i class="${x.contrib < 0 ? 'neg' : 'pos'}" style="--w:${(Math.abs(x.contrib) / mx * 100).toFixed(1)}%"></i></span><span class="st-v"><b class="num ${dCls(x.ret)}">${pctS(x.ret)}</b><small class="num">拖累 ${pctS(x.contrib)}</small></span></div>`).join('')}</section>
    ${notes.length ? `<section class="panel pad st-notes">${notes.map((t) => `<p>${t}</p>`).join('')}</section>` : ''}
    <section class="panel pad st-how">
      <p><b>怎麼算</b>：起點是 0050 在這段期間最大跌幅開始的那天（高點）。每一檔用它自己的官方收盤與配息算含息報酬，照你現在占總資產的比例加起來（現金不跌）。「回到原點」是部位又回到起點那天的水準。</p>
      <p><b>這不是預測</b>：下一次的風暴不會和這次一樣，跌的順序、幅度、回來的時間都會不同。它只回答一個問題——<b>如果那種事再來一次，你現在這樣配，撐不撐得住？</b>撐不住的話，該想的是比重和現金，不是猜哪天會跌。</p>
      <button class="btn ghost small" id="st-case">${ICON.cases || ICON.chev}看這段歷史怎麼發生的（案例教室）</button>
      <div class="ls-src"><span>出處</span>${sc.src.map((s) => `<a href="${esc(s.u)}" target="_blank" rel="noopener">${ICON.ext}${esc(s.n)}</a>`).join('')}<a href="https://www.twse.com.tw/zh/trading/historical/mi-index.html" target="_blank" rel="noopener">${ICON.ext}證交所：每日收盤行情（各檔歷史收盤）</a></div>
    </section>`;
}

/** 揭曉：閃電一閃、雷聲、數字從 0 往下跑到最大跌幅（減少動態效果或關掉特效時直接顯示） */
function play(sh, r, animate) {
  const hero = $('.st-hero', sh);
  if (!hero) return;
  if (!animate || !anim()) { hero.classList.add('done'); return; }
  hero.classList.add('go');
  FX.cue('storm');
  const el = $('[data-drop]', hero);
  const to = r.drop;
  if (el && isNum(to)) {
    const t0 = performance.now(), ms = 1300;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = pctS(to * e);
      if (k < 1 && S.openCode === '__storm') requestAnimationFrame(step);
      else { el.textContent = pctS(to); hero.classList.add('done'); if (S.openCode === '__storm') FX.sfx(to < -0.2 ? 'stop' : 'warn'); }
    };
    requestAnimationFrame(step);
  }
  $$('.st-bar i', sh).forEach((b, i) => { b.style.animationDelay = `${0.35 + i * 0.08}s`; });
}
export const stormOpen = () => S.openCode === '__storm';
