/* 冷眼 ColdEye — 手機版 App。資料全部來自同一網站的 data/*.json（由 GitHub Actions 定時產生）。 */
'use strict';
(() => {
  // ------------------------------------------------------------ 基本工具
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const isNum = (x) => typeof x === 'number' && isFinite(x);

  const DEFAULT_WATCH = ['0050', '00878', '00662', '0056', '00919', '00679B'];
  const RISK = {
    cons: { name: '保守', loss: 0.005, cap: 0.2, desc: '單筆最多虧本金 0.5%、單檔最多占本金 20%' },
    mid: { name: '穩健', loss: 0.01, cap: 0.3, desc: '單筆最多虧本金 1%、單檔最多占本金 30%' },
    aggr: { name: '積極', loss: 0.02, cap: 0.4, desc: '單筆最多虧本金 2%、單檔最多占本金 40%' },
  };
  const CAT = { broad: '市值型', div: '高股息', theme: '產業主題', overseas: '海外股票', bond: '債券', lev: '槓桿型', inv: '反向型', fut: '期貨／商品', active: '主動式' };
  const ST = {
    '1': { t: '偏多', cls: 's1' },
    '0': { t: '中性', cls: 's0' },
    '-1': { t: '偏空', cls: 's-1' },
  };
  const ICON = {
    up: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 13 9.4H9.6V13H6.4V9.4H3z" fill="currentColor"/></svg>',
    down: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 12.8 3 6.6h3.4V3h3.2v3.6H13z" fill="currentColor"/></svg>',
    flat: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="6.6" width="10" height="2.8" rx="1.2" fill="currentColor"/></svg>',
    warn: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8 15 14H1z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 6v3.6M8 11.4v.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    cal: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M2 6.5h12M5.5 1.6v2.8M10.5 1.6v2.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    line: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8h13" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.4 2"/></svg>',
    refresh: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16.2 7.6A6.6 6.6 0 0 0 4 6.3M3.8 12.4A6.6 6.6 0 0 0 16 13.7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M16.6 3.4v4.4h-4.4M3.4 16.6v-4.4h4.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    back: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4 6.5 10l6 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    star: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 2.6 2.3 4.7 5.1.7-3.7 3.6.9 5.1L10 14.3l-4.6 2.4.9-5.1-3.7-3.6 5.1-.7z" fill="currentColor"/></svg>',
    search: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m13.5 13.5 4 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    upA: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5 12.5 9h-9z" fill="currentColor"/></svg>',
    downA: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 12.5 3.5 7h9z" fill="currentColor"/></svg>',
    x: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  };
  const TABS = [
    { id: 'today', t: '今日', svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3.8 12h4M16.2 12h4M12 12l3.2-4.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/></svg>' },
    { id: 'all', t: 'ETF', svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6.5h14M5 12h14M5 17.5h9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>' },
    { id: 'news', t: '情報', svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4.5" width="16" height="15" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 9h8M8 12.5h8M8 16h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>' },
    { id: 'track', t: '戰績', svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 19.5h15M7 16v-4.5M12 16V7.5M17 16v-7" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>' },
    { id: 'set', t: '設定', svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h9M18 7h1M5 12h3M12 12h7M5 17h11M20 17h-1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="16" cy="7" r="2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="10" cy="12" r="2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="18" cy="17" r="2" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>' },
  ];

  const store = {
    get(k, d) { try { const v = localStorage.getItem('coldeye.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('coldeye.' + k, JSON.stringify(v)); } catch { /* 私密瀏覽等情況不保存 */ } },
  };
  const settings = Object.assign({ watch: DEFAULT_WATCH.slice(), risk: 'mid', capital: 300000, dca: true, opinion: false, theme: 'system', installHidden: false }, store.get('settings', {}));
  const saveSettings = () => store.set('settings', settings);

  const S = { summary: null, live: null, news: null, track: null, detail: {}, tab: store.get('tab', 'today'), all: { q: '', cat: '*', sort: 'score' }, newsTab: 'official', range: 120, rows: new Map(), deferredInstall: null };

  // ------------------------------------------------------------ 格式
  const fmt = {
    px(x) { return isNum(x) ? x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'; },
    n(x, d = 0) { return isNum(x) ? x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—'; },
    pct(x, d = 2, sign = true) { return isNum(x) ? (sign && x > 0 ? '+' : '') + x.toFixed(d) + '%' : '—'; },
    chg(x) { return isNum(x) ? (x > 0 ? '+' : '') + x.toFixed(2) : '—'; },
    big(x) {
      if (!isNum(x)) return '—';
      const a = Math.abs(x);
      if (a >= 1e12) return (x / 1e12).toFixed(2) + ' 兆';
      if (a >= 1e8) return (x / 1e8).toFixed(a >= 1e10 ? 0 : 1) + ' 億';
      if (a >= 1e4) return (x / 1e4).toFixed(0) + ' 萬';
      return x.toFixed(0);
    },
    lots(shares) {
      if (!isNum(shares)) return '—';
      const z = shares / 1000;
      return Math.abs(z) >= 10000 ? (z / 1e4).toFixed(2) + ' 萬張' : Math.round(z).toLocaleString('en-US') + ' 張';
    },
    d(n) { if (!n) return '—'; const s = String(n); return `${+s.slice(4, 6)}/${+s.slice(6, 8)}`; },
    dy(n) { if (!n) return '—'; const s = String(n); return `${s.slice(0, 4)}/${s.slice(4, 6)}/${s.slice(6, 8)}`; },
    ago(iso) {
      if (!iso) return '—';
      const t = new Date(iso).getTime();
      if (!isFinite(t)) return '—';
      const m = Math.round((Date.now() - t) / 60000);
      if (m < 1) return '剛剛';
      if (m < 60) return m + ' 分鐘前';
      const h = Math.round(m / 60);
      if (h < 24) return h + ' 小時前';
      return Math.round(h / 24) + ' 天前';
    },
  };
  const twToday = () => {
    const d = new Date(Date.now() + 8 * 3600e3);
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  };
  const dirCls = (x) => (isNum(x) ? (x > 0 ? 'up' : x < 0 ? 'down' : 'flat') : 'flat');
  const arrow = (x) => (isNum(x) && x !== 0 ? (x > 0 ? '▲' : '▼') : '');
  const catName = (k) => CAT[k] || (S.summary && S.summary.cats && S.summary.cats[k]) || k || '';
  const premBand = (row) => (['overseas', 'bond', 'fut'].includes(row.k) ? [1, 2] : [0.5, 1]);

  function stanceTag(st, extra = '') {
    if (st == null) return `<span class="stance na">資料不足</span>`;
    const s = ST[String(st)];
    const ic = st > 0 ? ICON.up : st < 0 ? ICON.down : ICON.flat;
    return `<span class="stance ${s.cls}">${ic}${s.t}${extra}</span>`;
  }

  // ------------------------------------------------------------ 資料
  async function getJSON(path) {
    const t = Math.floor(Date.now() / 60000);
    const r = await fetch(`data/${path}?t=${t}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${path} ${r.status}`);
    return r.json();
  }

  async function loadCore() {
    const [summary, live] = await Promise.all([getJSON('summary.json'), getJSON('live.json').catch(() => null)]);
    S.summary = summary;
    S.live = live;
    S.rows = new Map(summary.etfs.map((r) => [r.c, r]));
    store.set('cache.summary', summary);
    if (live) store.set('cache.live', live);
  }

  async function refreshLive() {
    try {
      S.live = await getJSON('live.json');
      store.set('cache.live', S.live);
      renderHeader();
      if (S.tab === 'today') renderToday();
      if (S.tab === 'all') renderAllList();
      if (openCode) renderDetailQuote();
    } catch { /* 下次再試 */ }
  }

  function liveOf(code) {
    const L = S.live;
    if (!L || !L.etfs || !L.etfs[code]) return null;
    const x = L.etfs[code];
    return { px: x[0], nav: x[1], prem: x[2], time: x[3], uchg: x[4] };
  }

  // 合併收盤資料與盤中資料：盤中日期比收盤資料新時，用盤中價格
  function quote(row) {
    const lv = liveOf(row.c);
    const L = S.live;
    if (lv && L && L.date && row.d && L.date > row.d && isNum(lv.px)) {
      let ref = row.p;
      if (row.dv && row.dv.d === L.date && isNum(row.dv.cash)) ref = row.p - row.dv.cash;
      return { px: lv.px, ch: lv.px - ref, pc: (lv.px / ref - 1) * 100, prem: lv.prem, live: true, time: lv.time, date: L.date };
    }
    return { px: row.p, ch: row.ch, pc: row.pc, prem: lv && L && L.date === row.d ? (lv.prem ?? row.pr) : row.pr, live: false, time: lv ? lv.time : null, date: row.d };
  }

  // ------------------------------------------------------------ 圖形元件
  function gaugeSVG(score, stance, big = false) {
    const W = 300, H = big ? 54 : 24, x = (v) => 8 + ((clamp(v, -2, 2) + 2) / 4) * 284;
    const base = big ? 30 : 14;
    let ticks = '';
    for (let k = -20; k <= 20; k++) {
      const v = k / 10, major = k % 5 === 0;
      const h = major ? (big ? 11 : 7) : (big ? 5 : 3.5);
      ticks += `<line class="tick${major ? ' major' : ''}" x1="${x(v).toFixed(1)}" x2="${x(v).toFixed(1)}" y1="${base - h}" y2="${base}" stroke-width="${major ? 1.3 : 1}"/>`;
    }
    const zone = `<rect class="zone-bear" x="${x(-2)}" y="${base - (big ? 14 : 9)}" width="${(x(-0.5) - x(-2)).toFixed(1)}" height="${big ? 14 : 9}" rx="2"/>` +
      `<rect class="zone-bull" x="${x(0.5).toFixed(1)}" y="${base - (big ? 14 : 9)}" width="${(x(2) - x(0.5)).toFixed(1)}" height="${big ? 14 : 9}" rx="2"/>`;
    const labs = big
      ? `<text class="lab" x="${x(-2)}" y="${base + 16}" text-anchor="start">偏空</text><text class="lab" x="${x(0)}" y="${base + 16}" text-anchor="middle">中性</text><text class="lab" x="${x(2)}" y="${base + 16}" text-anchor="end">偏多</text>` +
        `<text class="lab" x="${x(-0.5)}" y="${base + 16}" text-anchor="middle">−0.5</text><text class="lab" x="${x(0.5)}" y="${base + 16}" text-anchor="middle">+0.5</text>`
      : '';
    const col = stance > 0 ? 'var(--up)' : stance < 0 ? 'var(--down)' : 'var(--flat)';
    const nx = isNum(score) ? x(score) - x(0) : 0;
    const needle = isNum(score)
      ? `<g class="needle" data-dx="${nx.toFixed(1)}" style="transform:translateX(0px)"><line x1="${x(0)}" x2="${x(0)}" y1="${big ? 6 : 1}" y2="${base + 2}" stroke="${col}"/><circle cx="${x(0)}" cy="${big ? 6 : 2.5}" r="${big ? 4.5 : 3}" fill="${col}"/></g>`
      : '';
    return `<svg class="gauge" viewBox="0 0 ${W} ${H}" role="img" aria-label="規則分數 ${isNum(score) ? score.toFixed(2) : '無'}（-2 偏空到 +2 偏多）">${zone}<line x1="${x(-2)}" x2="${x(2)}" y1="${base}" y2="${base}" stroke="var(--line-2)" stroke-width="1"/>${ticks}${labs}${needle}</svg>`;
  }

  function animateNeedles(root) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      $$('.needle', root).forEach((g) => { g.style.transform = `translateX(${g.dataset.dx}px)`; });
    }));
  }

  function sparkSVG(vals, w = 64, h = 30, dir = 0) {
    const v = (vals || []).filter(isNum);
    if (v.length < 2) return '';
    const mn = Math.min(...v), mx = Math.max(...v), rg = mx - mn || 1;
    const pts = v.map((y, i) => [(i / (v.length - 1)) * (w - 4) + 2, h - 3 - ((y - mn) / rg) * (h - 6)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
    const end = pts[pts.length - 1];
    const col = dir > 0 ? 'var(--up)' : dir < 0 ? 'var(--down)' : 'var(--flat)';
    return `<svg class="w-spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}L${end[0].toFixed(1)} ${h}L2 ${h}Z" fill="var(--fg-3)" opacity=".08"/><path d="${d}" fill="none" stroke="var(--fg-2)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${end[0].toFixed(1)}" cy="${end[1].toFixed(1)}" r="2.6" fill="${col}"/></svg>`;
  }

  // ------------------------------------------------------------ 外框
  function renderShell() {
    document.body.innerHTML = `
      <header class="top" id="top">
        <div class="brand"><b>冷眼</b><small>ETF · 一手資料</small></div>
        <span class="mkt" id="mkt"><i></i><span>載入中</span></span>
        <button class="icon-btn" id="refresh" aria-label="重新整理">${ICON.refresh}</button>
      </header>
      <main id="view" aria-live="polite"></main>
      <nav class="tabs" aria-label="主要分頁"><div class="in">${TABS.map((t) => `<button data-tab="${t.id}">${t.svg}<span>${t.t}</span></button>`).join('')}</div></nav>
      <section class="sheet" id="sheet" hidden aria-modal="true" role="dialog"></section>`;
    $$('.tabs button').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));
    $('#refresh').addEventListener('click', manualRefresh);
    window.addEventListener('scroll', () => $('#top').classList.toggle('scrolled', window.scrollY > 4), { passive: true });
  }

  async function manualRefresh() {
    const b = $('#refresh');
    b.classList.add('spin');
    try {
      await loadCore();
      S.news = null; S.track = null; S.detail = {};
      render();
      toast('已更新到最新資料');
    } catch {
      toast('暫時連不上，顯示的是上次的資料');
    } finally {
      b.classList.remove('spin');
    }
  }

  function renderHeader() {
    const el = $('#mkt');
    if (!el || !S.summary) return;
    const L = S.live;
    let cls = '', txt = '';
    if (L && L.open) {
      cls = 'open';
      txt = `盤中 · ${L.at ? new Date(L.at).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' }) : ''} 更新`;
    } else if (S.summary.asof === twToday()) {
      txt = `收盤 · ${fmt.d(S.summary.asof)}`;
    } else {
      txt = `休市 · 資料 ${fmt.d(S.summary.asof)}`;
    }
    el.className = 'mkt ' + cls;
    el.innerHTML = `<i></i><span>${txt}</span>`;
  }

  function go(tab) {
    S.tab = tab;
    store.set('tab', tab);
    render();
    window.scrollTo({ top: 0 });
  }

  function render() {
    $$('.tabs button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === S.tab ? 'page' : 'false'));
    renderHeader();
    const v = $('#view');
    if (!S.summary) { v.innerHTML = `<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>`; return; }
    ({ today: renderToday, all: renderAll, news: renderNews, track: renderTrack, set: renderSettings }[S.tab] || renderToday)();
  }

  // ------------------------------------------------------------ 今日
  function renderToday() {
    const v = $('#view');
    const m = S.summary.market;
    const rows = settings.watch.map((c) => S.rows.get(c)).filter(Boolean);
    const alerts = buildAlerts(rows);
    let html = '';
    if (m) {
      const tx = S.live && S.live.taiex && S.live.open && isNum(S.live.taiex.z) ? S.live.taiex : null;
      const px = tx ? tx.z : m.close;
      const ch = tx ? tx.z - tx.y : m.chg;
      const pc = tx ? (tx.z / tx.y - 1) * 100 : m.pct;
      const above = isNum(m.ma60) ? px >= m.ma60 : null;
      html += `<section class="card pad market" aria-label="加權指數">
        <div class="lbl">加權指數 · ${tx ? '盤中 ' + esc(tx.t || '') : fmt.d(m.d) + ' 收盤'}</div>
        <div class="px num">${fmt.n(px, 2)}</div>
        <div class="chg num ${dirCls(ch)}">${arrow(ch)} ${fmt.n(Math.abs(ch ?? NaN), 2)}　${fmt.pct(pc)}</div>
        ${sparkSVG(m.spark, 116, 42, ch)}
        <div class="note" style="grid-column:1/-1">${above == null ? '' : above ? `在季線（${fmt.n(m.ma60, 0)}）之上` : `跌破季線（${fmt.n(m.ma60, 0)}）`}${m.val ? ` · 成交 ${fmt.big(m.val)}元` : ''}</div>
      </section>`;
    }
    html += installCard();
    if (alerts.length) {
      html += `<div class="sec-h"><h2>今日提醒</h2><span class="aside">${alerts.length} 則</span></div>
        <section class="card alerts">${alerts.map((a) => `<button class="alert" data-code="${a.code}"><span class="ic ${a.kind}">${a.icon}</span><span class="t">${a.html}</span><span class="go">›</span></button>`).join('')}</section>`;
    }
    html += `<div class="sec-h"><h2>我的關注</h2><span class="aside">觀點時間尺度：約 1 個月</span></div>`;
    if (!rows.length) {
      html += `<section class="card empty">還沒有關注的 ETF。到「ETF」分頁點任一檔，按右上角星號加入。</section>`;
    } else {
      html += `<section class="watch">${rows.map(watchCard).join('')}</section>`;
    }
    html += `<p class="disclaim">資料來自證交所、櫃買中心、集保結算所等官方發布。觀點由固定規則計算，不保證報酬，買賣請自行判斷。最後更新 ${fmt.ago(S.summary.generated)}。</p>`;
    v.innerHTML = html;
    $$('[data-code]', v).forEach((b) => b.addEventListener('click', () => openDetail(b.dataset.code)));
    bindInstall(v);
    animateNeedles(v);
  }

  function watchCard(row) {
    const q = quote(row);
    const conf = row.cf != null ? `信心 <b class="num">${row.cf}</b>` : row.st === 0 ? '訊號分歧' : '';
    const chips = [];
    if (isNum(q.prem)) {
      const [w] = premBand(row);
      chips.push(`<span class="chip${q.prem > w ? ' warn' : ''}">${q.prem >= 0 ? '溢價' : '折價'} <span class="num">${Math.abs(q.prem).toFixed(2)}%</span></span>`);
    }
    if (isNum(row.y)) chips.push(`<span class="chip">殖利率 <span class="num">${row.y.toFixed(2)}%</span></span>`);
    if (row.dv) chips.push(`<span class="chip ice">${ICON.cal.replace('<svg', '<svg width="12" height="12"')} ${fmt.d(row.dv.d)} 除息 ${row.dv.cash ? row.dv.cash.toFixed(3).replace(/0+$/, '').replace(/\.$/, '') + ' 元' : '金額待公告'}</span>`);
    if ((row.fl || []).includes('disposal')) chips.push(`<span class="chip warn">處置中</span>`);
    if ((row.fl || []).includes('notice')) chips.push(`<span class="chip warn">注意股</span>`);
    return `<button class="card wcard" data-code="${row.c}" aria-label="${esc(row.n)} 詳情">
      <div class="w-row1">
        <div class="w-id"><div class="w-code">${row.c} · ${esc(catName(row.k))}${row.m === 'otc' ? ' · 上櫃' : ''}</div><div class="w-name">${esc(row.n)}</div></div>
        ${sparkSVG(row.sp, 64, 30, q.pc)}
        <div class="w-px"><div class="p num">${fmt.px(q.px)}</div><div class="c num ${dirCls(q.pc)}">${arrow(q.pc)}${fmt.pct(q.pc)}</div></div>
      </div>
      <div class="w-gauge">${gaugeSVG(row.sc, row.st)}<div class="conf">${stanceTag(row.st)}<div style="margin-top:3px">${conf}</div></div></div>
      ${row.st != null ? `<div class="w-advice"><b>${esc(row.a || '')}</b>${isNum(row.iv) ? `<span class="muted">作廢線 <span class="num">${fmt.px(row.iv)}</span></span>` : isNum(row.r1) && row.st === 0 ? `<span class="muted">站上 <span class="num">${fmt.px(row.r1)}</span> 轉偏多</span>` : ''}</div>` : `<div class="w-advice muted">上市 ${row.young || 0} 個交易日，資料還不夠計算觀點</div>`}
      ${chips.length ? `<div class="chips">${chips.join('')}</div>` : ''}
    </button>`;
  }

  function buildAlerts(rows) {
    const out = [];
    const today = twToday();
    for (const r of rows) {
      const q = quote(r);
      if (r.dv && r.dv.d >= today && r.dv.d - today <= 20) {
        out.push({ code: r.c, kind: 'info', icon: ICON.cal, pri: 2, html: `<b>${esc(r.n)}</b> ${fmt.d(r.dv.d)} 除息，${r.dv.cash ? `每單位 ${r.dv.cash} 元` : '金額待公告'}` });
      }
      if (isNum(q.prem)) {
        const [w, bad] = premBand(r);
        if (q.prem > w) out.push({ code: r.c, kind: 'warn', icon: ICON.warn, pri: q.prem > bad ? 0 : 1, html: `<b>${esc(r.n)}</b> 溢價 <span class="num">${q.prem.toFixed(2)}%</span>，超過 ${w}% 警戒，現在買等於多付錢` });
      }
      if (q.live && isNum(r.iv) && r.st) {
        if (r.st > 0 && q.px < r.iv) out.push({ code: r.c, kind: 'down', icon: ICON.down, pri: 0, html: `<b>${esc(r.n)}</b> 盤中跌破作廢線 <span class="num">${fmt.px(r.iv)}</span>（以收盤確認）` });
        if (r.st < 0 && q.px > r.iv) out.push({ code: r.c, kind: 'up', icon: ICON.up, pri: 0, html: `<b>${esc(r.n)}</b> 盤中站上作廢線 <span class="num">${fmt.px(r.iv)}</span>（以收盤確認）` });
      }
      for (const f of r.fl || []) {
        if (f === 'disposal' || f === 'notice') out.push({ code: r.c, kind: 'warn', icon: ICON.warn, pri: 0, html: `<b>${esc(r.n)}</b> 被證交所／櫃買中心列為${f === 'disposal' ? '處置' : '注意'}標的` });
        if (f === 'volume_spike') out.push({ code: r.c, kind: 'warn', icon: ICON.warn, pri: 1, html: `<b>${esc(r.n)}</b> 成交量爆增，追價熱度高` });
      }
    }
    return out.sort((a, b) => a.pri - b.pri).slice(0, 8);
  }

  function installCard() {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (standalone || settings.installHidden) return '';
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const msg = ios ? '在 Safari 點下方「分享」→「加入主畫面」，之後就像 App 一樣從主畫面開啟。' : '加到主畫面，之後像 App 一樣一鍵開啟。';
    return `<section class="card install"><p>${msg}</p><div style="display:flex;gap:6px">${!ios && S.deferredInstall ? '<button class="btn" id="doInstall">加入</button>' : ''}<button class="btn ghost" id="hideInstall">知道了</button></div></section>`;
  }

  function bindInstall(v) {
    const h = $('#hideInstall', v);
    if (h) h.addEventListener('click', () => { settings.installHidden = true; saveSettings(); renderToday(); });
    const d = $('#doInstall', v);
    if (d) d.addEventListener('click', async () => { try { S.deferredInstall.prompt(); await S.deferredInstall.userChoice; } catch { /* 使用者取消 */ } S.deferredInstall = null; renderToday(); });
  }

  // ------------------------------------------------------------ 全部 ETF
  function renderAll() {
    const v = $('#view');
    const cats = ['*', 'broad', 'div', 'theme', 'overseas', 'bond', 'active', 'lev', 'inv', 'fut'];
    v.innerHTML = `
      <div class="toolbar">
        <label class="search">${ICON.search}<input id="q" type="search" inputmode="search" placeholder="搜尋代號或名稱，例如 0050、高股息" value="${esc(S.all.q)}" autocomplete="off"></label>
        <div class="hscroll" id="cats">${cats.map((c) => `<button class="pill" data-cat="${c}" aria-pressed="${S.all.cat === c}">${c === '*' ? '全部' : CAT[c]}</button>`).join('')}</div>
        <div class="sortrow"><span>排序</span><select id="sort" aria-label="排序方式">
          ${[['score', '觀點分數（高→低）'], ['score_r', '觀點分數（低→高）'], ['chg', '今日漲跌'], ['val', '成交值'], ['yield', '殖利率'], ['prem', '溢價（高→低）'], ['code', '代號']].map(([k, t]) => `<option value="${k}"${S.all.sort === k ? ' selected' : ''}>${t}</option>`).join('')}
        </select><span id="cnt" style="margin-left:auto"></span></div>
      </div>
      <section class="card list" id="list"></section>`;
    $('#q', v).addEventListener('input', (e) => { S.all.q = e.target.value; renderAllList(); });
    $$('#cats .pill', v).forEach((b) => b.addEventListener('click', () => { S.all.cat = b.dataset.cat; $$('#cats .pill', v).forEach((x) => x.setAttribute('aria-pressed', x === b)); renderAllList(); }));
    $('#sort', v).addEventListener('change', (e) => { S.all.sort = e.target.value; renderAllList(); });
    renderAllList();
  }

  function renderAllList() {
    const list = $('#list');
    if (!list) return;
    const q = S.all.q.trim().toLowerCase();
    let rows = S.summary.etfs.filter((r) => (S.all.cat === '*' || r.k === S.all.cat) && (!q || r.c.toLowerCase().includes(q) || (r.n || '').toLowerCase().includes(q)));
    const key = {
      score: (r) => (r.sc ?? -99), score_r: (r) => -(r.sc ?? 99), chg: (r) => (quote(r).pc ?? -99), val: (r) => (r.val ?? 0),
      yield: (r) => (r.y ?? -1), prem: (r) => (quote(r).prem ?? -99), code: null,
    }[S.all.sort];
    rows = key ? rows.sort((a, b) => key(b) - key(a)) : rows.sort((a, b) => a.c.localeCompare(b.c));
    $('#cnt').textContent = `${rows.length} 檔`;
    if (!rows.length) { list.innerHTML = `<div class="empty">找不到符合的 ETF</div>`; return; }
    list.innerHTML = rows.slice(0, 400).map((r) => {
      const qq = quote(r);
      return `<button class="lrow" data-code="${r.c}"><span class="nm"><b>${esc(r.n)}</b><span class="num">${r.c}</span> · ${esc(catName(r.k))}${isNum(r.y) && r.y > 0 ? ` · 殖利率 ${r.y.toFixed(1)}%` : ''}</span>${stanceTag(r.st)}<span class="pxc"><div class="p num">${fmt.px(qq.px)}</div><div class="c num ${dirCls(qq.pc)}">${fmt.pct(qq.pc)}</div></span></button>`;
    }).join('');
    $$('.lrow', list).forEach((b) => b.addEventListener('click', () => openDetail(b.dataset.code)));
  }

  // ------------------------------------------------------------ 情報
  async function renderNews() {
    const v = $('#view');
    if (!S.news) {
      v.innerHTML = `<div class="skeleton"></div><div class="skeleton"></div>`;
      try { S.news = await getJSON('news.json'); } catch { v.innerHTML = `<section class="card empty">情報暫時載入失敗，稍後再試。</section>`; return; }
      if (S.tab !== 'news') return;
    }
    const N = S.news;
    const tabs = [['official', '官方公告'], ['fact', '事實新聞'], ['divs', '除息行事曆'], ['risk', '風險名單']];
    let body = '';
    const SRCN = { twse_news: '證交所', fsc: '金管會', cbc: '中央銀行', cna: '中央社' };
    if (S.newsTab === 'official' || S.newsTab === 'fact') {
      const want = S.newsTab;
      let items = N.items.filter((x) => (want === 'official' ? x.kind === 'official' : x.kind === 'fact' || (settings.opinion && x.kind === 'opinion')));
      const hidden = want === 'fact' ? N.items.filter((x) => x.kind === 'opinion').length : 0;
      body = `<section class="card news">${items.length ? items.slice(0, 120).map((x) => `<a class="nitem${x.kind === 'opinion' ? ' op' : ''}" href="${esc(x.url)}" target="_blank" rel="noopener"><div class="meta"><span class="tag${x.kind === 'official' ? ' off' : x.kind === 'opinion' ? ' op' : ''}">${SRCN[x.src] || x.src}${x.kind === 'opinion' ? ' · 含評論或情緒用語' : ''}</span><span class="num">${fmt.d(x.d)}</span>${(x.codes || []).map((c) => `<span class="num">${c}</span>`).join('')}</div><div class="tt">${esc(x.t)}</div></a>`).join('') : `<div class="empty">近三週沒有資料</div>`}</section>`;
      if (want === 'fact') body = `<p class="disclaim">只收中央社的財經即時新聞。標題含預測、推薦、情緒性用語的 ${hidden} 則${settings.opinion ? '以淡色顯示' : '已先藏起來，可在設定打開'}。</p>` + body;
      if (want === 'official') body = `<p class="disclaim">證交所最新消息、金管會與中央銀行新聞稿，全部是官方原文連結。</p>` + body;
    } else if (S.newsTab === 'divs') {
      const watch = new Set(settings.watch);
      body = `<p class="disclaim">證交所「除權除息預告表」中的 ETF。金額待公告代表投信尚未公布。</p><section class="card tbl-wrap"><table class="t"><thead><tr><th>除息日</th><th>ETF</th><th class="r">每單位</th></tr></thead><tbody>${N.divs.length ? N.divs.map((x) => `<tr class="${watch.has(x.c) ? 'hl' : ''}"><td class="num">${fmt.d(x.d)}</td><td><b>${esc(x.n)}</b> <span class="muted num">${x.c}</span></td><td class="r num">${x.cash ? x.cash + ' 元' : '<span class="muted">待公告</span>'}</td></tr>`).join('') : `<tr><td colspan="3" class="muted">目前沒有預告</td></tr>`}</tbody></table></section>`;
    } else {
      body = `<p class="disclaim">證交所與櫃買中心公布的注意、處置名單。今天全市場共 ${N.risk_total} 筆，以下只列 ETF。</p><section class="card news">${N.risk.length ? N.risk.map((x) => `<div class="nitem"><div class="meta"><span class="tag op">${x.kind === 'disposal' ? '處置' : '注意'}</span><span class="num">${x.code}</span></div><div class="tt">${esc(x.name)}　${esc(x.period || x.text || '')}</div></div>`).join('') : `<div class="empty">目前沒有 ETF 被列入注意或處置</div>`}</section>`;
    }
    v.innerHTML = `<div class="hscroll"><div class="seg" role="tablist">${tabs.map(([k, t]) => `<button data-nt="${k}" aria-pressed="${S.newsTab === k}">${t}</button>`).join('')}</div></div>${body}`;
    $$('[data-nt]', v).forEach((b) => b.addEventListener('click', () => { S.newsTab = b.dataset.nt; renderNews(); }));
  }

  // ------------------------------------------------------------ 戰績
  async function renderTrack() {
    const v = $('#view');
    if (!S.track) {
      v.innerHTML = `<div class="skeleton"></div><div class="skeleton"></div>`;
      try { S.track = await getJSON('track.json'); } catch { v.innerHTML = `<section class="card empty">戰績暫時載入失敗，稍後再試。</section>`; return; }
      if (S.tab !== 'track') return;
    }
    const T = S.track;
    const o = T.overall;
    if (!o) { v.innerHTML = `<section class="card empty">歷史資料還在回補中，完成後這裡會顯示回測結果。</section>`; return; }
    const pc = (x) => (isNum(x) ? (x * 100).toFixed(1) + '%' : '—');
    const avgs = [o.bull.avg, o.base_avg, o.bear.avg].filter(isNum).map(Math.abs);
    const amax = Math.max(0.002, ...avgs);
    const rbar = (label, val, col) => {
      const w = isNum(val) ? (Math.abs(val) / amax) * 50 : 0;
      const pos = (val || 0) >= 0;
      return `<div class="bar"><span>${label}</span><span class="track" style="position:relative"><span style="position:absolute;left:50%;top:-2px;bottom:-2px;border-left:1px solid var(--line-2)"></span><span class="fill" style="position:absolute;top:0;bottom:0;${pos ? 'left:50%' : 'right:50%'};width:${w}%;background:${col}"></span></span><span class="num r">${fmt.pct((val || 0) * 100)}</span></div>`;
    };
    const baseUp = o.base_up;
    const delta = (a, b) => (isNum(a) && isNum(b) ? `，<b style="color:${a >= b ? 'var(--ice)' : 'var(--warn)'}">${a >= b ? '高' : '低'} ${Math.abs((a - b) * 100).toFixed(1)} 點</b>` : '');
    let html = `<div class="sec-h"><h2>規則的歷史戰績</h2><span class="aside">${fmt.dy(o.start)}–${fmt.dy(o.end)}</span></div>
      <section class="big2">
        <div class="card stat"><div class="k">看多後 20 日上漲的比例</div><div class="v num">${pc(o.bull.hit)}</div><div class="s">一直看多的基準 ${pc(baseUp)}${delta(o.bull.hit, baseUp)} · ${fmt.n(o.bull.n)} 次</div></div>
        <div class="card stat"><div class="k">看空後 20 日下跌的比例</div><div class="v num">${pc(o.bear.hit)}</div><div class="s">基準 ${pc(1 - baseUp)}${delta(o.bear.hit, 1 - baseUp)} · ${fmt.n(o.bear.n)} 次</div></div>
      </section>
      <section class="card pad vs">
        <div class="muted" style="font-size:12.5px">之後 20 個交易日的平均含息報酬</div>
        ${rbar('看多之後', o.bull.avg, 'var(--up)')}
        ${rbar('全部平均', o.base_avg, 'var(--fg-3)')}
        ${rbar('看空之後', o.bear.avg, 'var(--down)')}
        <div class="muted" style="font-size:12px">中性時平均 ${fmt.pct((o.neutral.avg || 0) * 100)}，共 ${fmt.n(o.neutral.n)} 次。</div>
      </section>
      <div class="sec-h"><h2>信心分數準不準</h2><span class="aside">方向正確率－同條件亂猜</span></div>
      <section class="card pad vs">${calibRows(T.calib)}
      <p class="disclaim" style="margin:4px 0 0">每一列是該信心區間的方向正確率，減去「同樣多空比例下亂猜」的正確率。往右越多代表這個區間的判斷越有參考價值；次數少的區間看看就好。</p></section>`;
    const cats = Object.entries(T.by_cat || {}).filter(([, s]) => s && s.n >= 30);
    if (cats.length) {
      html += `<div class="sec-h"><h2>各類 ETF</h2></div><section class="card tbl-wrap"><table class="t"><thead><tr><th>類別</th><th class="r">看多命中</th><th class="r">基準</th><th class="r">看空命中</th><th class="r">樣本</th></tr></thead><tbody>${cats.map(([k, s]) => `<tr><td>${esc(catName(k))}</td><td class="r num">${pc(s.bull.hit)}</td><td class="r num muted">${pc(s.base_up)}</td><td class="r num">${pc(s.bear.hit)}</td><td class="r num muted">${fmt.n(s.n)}</td></tr>`).join('')}</tbody></table></section>`;
    }
    html += `<div class="sec-h"><h2>上線後的實際紀錄</h2></div>`;
    if (T.live && T.live.n) {
      html += `<section class="big2"><div class="card stat"><div class="k">看多後上漲的比例</div><div class="v num">${pc(T.live.bull.hit)}</div><div class="s">基準 ${pc(T.live.base_up)}${delta(T.live.bull.hit, T.live.base_up)} · ${fmt.n(T.live.bull.n)} 次</div></div><div class="card stat"><div class="k">看空後下跌的比例</div><div class="v num">${pc(T.live.bear.hit)}</div><div class="s">基準 ${pc(1 - T.live.base_up)}${delta(T.live.bear.hit, 1 - T.live.base_up)} · ${fmt.n(T.live.bear.n)} 次</div></div></section>`;
    } else {
      html += `<section class="card pad prose"><p>每天收盤後的觀點都會記錄下來，20 個交易日後自動對答案。目前有 ${fmt.n(T.live_pending)} 筆觀點等待驗證，第一批結果約一個月後出現。</p></section>`;
    }
    html += `<section class="card pad prose"><p><b>怎麼算的：</b>${esc(T.method.note)}</p><p>命中的定義：看多之後 20 個交易日含息報酬大於 0；看空之後小於 0。中性不算命中。拿來比較的基準是「每一次都看多」，規則必須贏過它才有意義。</p><p>回測是用過去資料檢查規則，不代表未來一樣準。</p></section>`;
    v.innerHTML = html;
  }

  function calibRows(cal) {
    const ds = cal.map((b) => (isNum(b.hit) && isNum(b.base) ? (b.hit - b.base) * 100 : null));
    const m = Math.max(2, ...ds.filter(isNum).map(Math.abs));
    return cal.map((b, i) => {
      const d = ds[i];
      const w = isNum(d) ? (Math.abs(d) / m) * 50 : 0;
      const col = isNum(d) && d >= 0 ? 'var(--ice-2)' : 'var(--warn)';
      return `<div class="bar"><span>信心 ${bucketText(b.lo)}<br><small class="muted">${fmt.n(b.n)} 次</small></span><span class="track" style="position:relative"><span style="position:absolute;left:50%;top:-2px;bottom:-2px;border-left:1px solid var(--line-2)"></span><span class="fill" style="position:absolute;top:0;bottom:0;${isNum(d) && d >= 0 ? 'left:50%' : 'right:50%'};width:${w}%;background:${col}"></span></span><span class="num r">${isNum(d) ? (d >= 0 ? '+' : '') + d.toFixed(1) + ' 點' : '—'}</span></div>`;
    }).join('');
  }

  // ------------------------------------------------------------ 設定
  function renderSettings() {
    const v = $('#view');
    const wl = settings.watch.map((c, i) => {
      const r = S.rows.get(c);
      return `<div class="wl-row"><span><b>${esc(r ? r.n : c)}</b> <span class="muted num">${c}</span></span>
        <button class="mini-btn" data-mv="${i}" data-d="-1" aria-label="往上移" ${i === 0 ? 'disabled' : ''}>${ICON.upA}</button>
        <button class="mini-btn" data-mv="${i}" data-d="1" aria-label="往下移" ${i === settings.watch.length - 1 ? 'disabled' : ''}>${ICON.downA}</button>
        <button class="mini-btn" data-rm="${c}" aria-label="移除">${ICON.x}</button></div>`;
    }).join('');
    const src = Object.entries(S.summary.sources || {});
    v.innerHTML = `
      <div class="sec-h"><h2>我的關注</h2><span class="aside">${settings.watch.length} 檔</span></div>
      <section class="card set"><div class="wl">${wl || '<div class="empty">還沒有關注的 ETF</div>'}</div>
        <div class="addbox"><input class="input" id="addq" placeholder="輸入代號或名稱加入，例如 006208" autocomplete="off"><div class="sugg" id="sugg"></div></div></section>
      <div class="sec-h"><h2>部位試算</h2></div>
      <section class="card set">
        <div class="srow" style="grid-template-columns:1fr"><div><div class="h">風險承受度</div><div class="d">${esc(RISK[settings.risk].desc)}</div></div>
          <div class="seg" role="radiogroup">${Object.entries(RISK).map(([k, r]) => `<button data-risk="${k}" aria-pressed="${settings.risk === k}">${r.name}</button>`).join('')}</div></div>
        <div class="srow" style="grid-template-columns:1fr"><div><div class="h">投資本金</div><div class="d">只存在這支手機，用來算每檔建議的最大部位</div></div>
          <input class="input num" id="capital" inputmode="numeric" value="${settings.capital}" aria-label="投資本金（元）"></div>
      </section>
      <div class="sec-h"><h2>顯示</h2></div>
      <section class="card set">
        <div class="srow"><div><div class="h">定期定額視角</div><div class="d">在每檔詳情加上長期扣款的提醒</div></div><button class="switch" role="switch" id="sw-dca" aria-checked="${settings.dca}" aria-label="定期定額視角"></button></div>
        <div class="srow"><div><div class="h">顯示評論與情緒用語新聞</div><div class="d">預設隱藏標題含預測、推薦、渲染字眼的新聞</div></div><button class="switch" role="switch" id="sw-op" aria-checked="${settings.opinion}" aria-label="顯示評論新聞"></button></div>
        <div class="srow" style="grid-template-columns:1fr"><div class="h">外觀</div><div class="seg">${[['system', '跟隨系統'], ['dark', '深色'], ['light', '淺色']].map(([k, t]) => `<button data-theme="${k}" aria-pressed="${settings.theme === k}">${t}</button>`).join('')}</div></div>
      </section>
      <div class="sec-h"><h2>規則與來源</h2></div>
      <section class="card">
        <details class="rules"><summary>觀點怎麼算（完整規則）</summary><div class="in prose">${rulesHTML()}</div></details>
      </section>
      <section class="card tbl-wrap"><table class="t"><thead><tr><th>官方來源</th><th class="r">最後成功</th></tr></thead><tbody>${src.map(([, s]) => `<tr><td><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a></td><td class="r muted">${s.ok_at ? fmt.ago(s.ok_at) : '—'}</td></tr>`).join('')}</tbody></table></section>
      <section class="card pad prose"><p><b>關於冷眼</b>　版本 ${esc(S.summary.engine)}，資料更新 ${fmt.ago(S.summary.generated)}。盤中約每 15 分鐘更新價格與預估淨值，收盤後陸續補上法人、融資、淨值。</p>
        <p>這是個人使用的資料整理與規則化分析工具，不是投顧服務。觀點不保證報酬，任何買賣決定請自行判斷並承擔風險。</p></section>`;
    $$('[data-mv]', v).forEach((b) => b.addEventListener('click', () => { const i = +b.dataset.mv, d = +b.dataset.d, w = settings.watch; [w[i], w[i + d]] = [w[i + d], w[i]]; saveSettings(); renderSettings(); }));
    $$('[data-rm]', v).forEach((b) => b.addEventListener('click', () => { settings.watch = settings.watch.filter((c) => c !== b.dataset.rm); saveSettings(); renderSettings(); }));
    $$('[data-risk]', v).forEach((b) => b.addEventListener('click', () => { settings.risk = b.dataset.risk; saveSettings(); renderSettings(); }));
    $$('[data-theme]', v).forEach((b) => b.addEventListener('click', () => { settings.theme = b.dataset.theme; saveSettings(); applyTheme(); renderSettings(); }));
    $('#capital', v).addEventListener('change', (e) => { const n = Math.round(Number(String(e.target.value).replace(/[^0-9.]/g, ''))); if (n > 0) { settings.capital = n; saveSettings(); toast('本金已更新'); } e.target.value = settings.capital; });
    $('#sw-dca', v).addEventListener('click', (e) => { settings.dca = !settings.dca; saveSettings(); e.currentTarget.setAttribute('aria-checked', settings.dca); });
    $('#sw-op', v).addEventListener('click', (e) => { settings.opinion = !settings.opinion; saveSettings(); e.currentTarget.setAttribute('aria-checked', settings.opinion); });
    const addq = $('#addq', v), sugg = $('#sugg', v);
    addq.addEventListener('input', () => {
      const q = addq.value.trim().toLowerCase();
      if (!q) { sugg.innerHTML = ''; return; }
      const hits = S.summary.etfs.filter((r) => !settings.watch.includes(r.c) && (r.c.toLowerCase().includes(q) || (r.n || '').toLowerCase().includes(q))).slice(0, 8);
      sugg.innerHTML = hits.map((r) => `<button data-add="${r.c}">${esc(r.n)} <span class="num">${r.c}</span></button>`).join('') || '<span class="muted" style="font-size:12.5px">找不到</span>';
      $$('[data-add]', sugg).forEach((b) => b.addEventListener('click', () => { settings.watch.push(b.dataset.add); saveSettings(); toast('已加入關注'); renderSettings(); }));
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
      <p><b>作廢線</b>偏多時取離現價至少 1 個 ATR 的第一個支撐，偏空時取至少 1 個 ATR 的第一個壓力。收盤跌破（站上）就代表觀點失效。</p>`;
  }

  function applyTheme() {
    const r = document.documentElement;
    if (settings.theme === 'system') r.removeAttribute('data-theme');
    else r.setAttribute('data-theme', settings.theme);
  }

  // ------------------------------------------------------------ 單檔詳情
  let openCode = null;
  async function openDetail(code, push = true) {
    openCode = code;
    if (push && location.hash !== '#' + code) history.pushState({ etf: code }, '', '#' + code);
    const sh = $('#sheet');
    sh.hidden = false;
    document.body.style.overflow = 'hidden';
    const row = S.rows.get(code);
    sh.innerHTML = sheetTop(code, row) + `<div class="sheet-body"><div class="skeleton" style="height:160px"></div><div class="skeleton" style="height:240px"></div></div>`;
    bindSheetTop(code);
    sh.scrollTop = 0;
    let det = S.detail[code];
    if (!det && row && row.st != null) {
      try { det = await getJSON(`etf/${code}.json`); S.detail[code] = det; } catch { det = null; }
    }
    if (openCode !== code) return;
    sh.innerHTML = sheetTop(code, row) + `<div class="sheet-body">${detailHTML(row, det)}</div>`;
    bindSheetTop(code);
    bindDetail(row, det);
    animateNeedles(sh);
  }

  function closeDetail(fromPop = false) {
    openCode = null;
    const sh = $('#sheet');
    sh.hidden = true;
    sh.innerHTML = '';
    document.body.style.overflow = '';
    if (!fromPop && location.hash) history.back();
  }

  function sheetTop(code, row) {
    const on = settings.watch.includes(code);
    return `<div class="sheet-top"><button class="icon-btn" id="back" aria-label="返回">${ICON.back}</button><span class="ttl">${code}${row ? ' · ' + esc(catName(row.k)) : ''}</span><button class="icon-btn star" id="star" aria-pressed="${on}" aria-label="${on ? '移除關注' : '加入關注'}">${ICON.star}</button></div>`;
  }

  function bindSheetTop(code) {
    $('#back').addEventListener('click', () => closeDetail());
    $('#star').addEventListener('click', (e) => {
      const on = settings.watch.includes(code);
      settings.watch = on ? settings.watch.filter((c) => c !== code) : settings.watch.concat(code);
      saveSettings();
      e.currentTarget.setAttribute('aria-pressed', !on);
      toast(on ? '已移除關注' : '已加入關注');
      if (S.tab === 'today') renderToday();
    });
  }

  function renderDetailQuote() {
    const row = S.rows.get(openCode);
    const el = $('#dq');
    if (!row || !el) return;
    el.outerHTML = quoteLine(row);
  }

  function quoteLine(row) {
    const q = quote(row);
    return `<div class="pxline" id="dq"><span class="p num">${fmt.px(q.px)}</span><span class="c num ${dirCls(q.pc)}">${arrow(q.ch)} ${isNum(q.ch) ? Math.abs(q.ch).toFixed(2) : '—'}　${fmt.pct(q.pc)}</span><span class="live">${q.live ? `盤中 ${esc(q.time || '')}` : `${fmt.d(row.d)} 收盤`}</span></div>`;
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

  function detailHTML(row, det) {
    if (!row) return `<section class="card empty">找不到這檔 ETF</section>`;
    const head = `<section class="hero"><h1>${esc(row.n)}</h1><div class="sub">${row.c} · ${esc(catName(row.k))} · ${row.m === 'otc' ? '上櫃' : '上市'}${isNum(row.aum) ? ` · 規模約 ${fmt.big(row.aum)}元` : ''}</div>${quoteLine(row)}</section>`;
    if (row.st == null || !det) {
      return head + `<section class="card pad prose"><p>${row.st == null ? `這檔上市只有 ${row.young || 0} 個交易日，規則至少需要 70 個交易日的資料才會給觀點。` : '詳細資料暫時載入失敗，稍後再試。'}</p></section>`;
    }
    const V = det.view;
    const st = ST[String(V.stance)];
    const sim = V.similar;
    let h = head;
    h += `<section class="card verdict">
      <div class="verdict-top"><span class="big ${st.cls}">${V.stance > 0 ? ICON.up : V.stance < 0 ? ICON.down : ICON.flat}${st.t}</span>
        <span class="meta">${V.conf != null ? `<span>信心 <b>${V.conf}</b></span>` : '<span>訊號分歧，不給信心</span>'}<span>規則分數 <b>${V.score >= 0 ? '+' : ''}${V.score.toFixed(2)}</b></span></span></div>
      ${gaugeSVG(V.score, V.stance, true)}
      ${sim ? `<div class="src">過去同類訊號（${sim.scope === 'cat' ? catName(row.k) + '、' : '所有 ETF、'}${V.stance > 0 ? '偏多' : '偏空'}、信心 ${bucketText(sim.bucket)}）20 日後方向正確 <b class="num">${(sim.hit * 100).toFixed(0)}%</b>，共 ${fmt.n(sim.n)} 次。</div>` : ''}
      <div class="advice"><div class="act">${esc(V.advice.action)}</div><div class="det">${esc(V.advice.detail)}</div></div>
    </section>`;
    h += `<section class="card pad summary">${esc(V.summary)}</section>`;
    if (V.flags && V.flags.length) h += `<section class="card pad flags">${V.flags.map((f) => `<div class="flag">${ICON.warn}<span>${esc(f.text)}</span></div>`).join('')}</section>`;
    h += `<section class="card chart-card"><div class="chart-head"><h3>價格與關鍵價位</h3><div class="seg">${[[60, '3 月'], [120, '6 月'], [250, '1 年']].map(([n, t]) => `<button data-rg="${n}" aria-pressed="${S.range === n}">${t}</button>`).join('')}</div></div>
      <div class="chart" id="pchart"></div>
      <div class="legend"><span><i style="border-color:var(--fg)"></i>收盤（還原權息）</span><span><i style="border-color:var(--ma20)"></i>月線</span><span><i style="border-color:var(--ma60)"></i>季線</span><span><i style="border-color:var(--ma120)"></i>半年線</span><span><i class="dash" style="border-color:var(--ice)"></i>支撐／壓力</span><span><i class="dash" style="border-color:var(--warn)"></i>作廢線</span></div>
      ${ribbonHTML(det)}</section>`;
    h += levelsHTML(row, V);
    h += `<div class="sec-h"><h2>各面向的理由</h2><span class="aside">資料涵蓋 ${Math.round((V.coverage || 0) * 100)}%</span></div><section class="card comps">${V.components.map((c) => compHTML(c, row)).join('')}</section>`;
    h += profileHTML(row, det, V);
    h += flowsHTML(det, row);
    h += calcHTML(row, V);
    if (settings.dca) h += dcaHTML(row, V);
    h += btHTML(det);
    h += `<p class="disclaim">${esc(det.adjusted_note)}。觀點每天收盤後重新計算一次，盤中只更新價格與預估淨值。規則與資料來源都公開在「設定」分頁。不保證報酬，買賣請自行判斷。</p>`;
    return h;
  }

  function bucketText(lo) {
    const b = { 20: '20–49', 50: '50–64', 65: '65–79', 80: '80 以上' };
    return b[lo] || String(lo);
  }

  function ribbonHTML(det) {
    const hs = (det.hist || []).slice(-120);
    if (hs.length < 10) return '';
    return `<div class="ribbon" aria-label="過去 ${hs.length} 個交易日的規則觀點">${hs.map((x) => `<span class="${ST[String(x[1])].cls}" title="${fmt.d(x[0])} ${ST[String(x[1])].t}"></span>`).join('')}</div>
      <div class="ribbon-cap"><span>${fmt.d(hs[0][0])}</span><span>${fmt.d(hs[hs.length - 1][0])}</span></div>
      <div class="ribbon-note">過去 ${hs.length} 個交易日每天的規則觀點：紅＝偏多、綠＝偏空、灰＝中性</div>`;
  }

  function levelsHTML(row, V) {
    const q = quote(row);
    const L = V.levels;
    const items = [];
    (L.resistance || []).slice().reverse().forEach((x, i, a) => items.push({ k: `壓力 ${a.length - i}`, lab: x.label, p: x.price }));
    items.push({ k: '現價', lab: q.live ? '盤中' : '收盤', p: q.px, now: true });
    (L.support || []).forEach((x, i) => items.push({ k: `支撐 ${i + 1}`, lab: x.label, p: x.price }));
    if (L.invalid) items.push({ k: '作廢線', lab: (V.stance > 0 ? '收盤跌破即失效 · ' : '收盤站上即失效 · ') + L.invalid.label, p: L.invalid.price, inv: true });
    const r = V.risk || {};
    return `<div class="sec-h"><h2>關鍵價位</h2>${isNum(r.rr) ? `<span class="aside">風險報酬比 ${r.rr.toFixed(2)}</span>` : ''}</div>
      <section class="card tbl-wrap"><table class="t levels"><tbody>${items.map((x) => `<tr class="${x.now ? 'now' : ''}${x.inv ? ' inv' : ''}"><td class="k">${x.k}</td><td class="muted" style="font-size:12px">${esc(x.lab)}</td><td class="r num">${fmt.px(x.p)}</td><td class="r num muted" style="font-size:12px">${x.now ? '' : fmt.pct((x.p / q.px - 1) * 100, 1)}</td></tr>`).join('')}</tbody></table></section>`;
  }

  function compHTML(c, row) {
    const cells = [-2, -1, 0, 1, 2].map((k) => {
      if (k === 0) return '<span class="mid"></span>';
      const on = (k < 0 && c.score <= k + 0.5 && c.score < 0) || (k > 0 && c.score >= k - 0.5 && c.score > 0);
      return `<span class="${on ? 'on ' + (k > 0 ? 'pos' : 'neg') : ''}"></span>`;
    }).join('');
    return `<div class="comp"><div class="comp-h"><b>${esc(c.name)}</b><span class="w">權重 ${Math.round(c.weight * 100)}%</span><span class="meter" aria-label="分數 ${c.score.toFixed(1)}">${cells}</span><span class="num" style="font-size:12px;width:38px;text-align:right">${c.score > 0 ? '+' : ''}${c.score.toFixed(1)}</span></div><p>${esc(c.text)}</p><div class="src">來源：${compSource(c, row)}</div></div>`;
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
    const ttm = isNum(row.y) ? row.y : null;
    const cells = [
      ['年化波動', isNum(r.vol_ann) ? `${r.vol_ann.toFixed(1)}<small>%</small>` : '—'],
      ['距一年高點', isNum(r.dd_52w) ? `${r.dd_52w.toFixed(1)}<small>%</small>` : '—'],
      ['一年區間位置', isNum(r.pos_52w) ? `${r.pos_52w.toFixed(0)}<small>%</small>` : '—'],
      ['平均成交值', isNum(r.value20) ? `${fmt.big(r.value20)}<small>元/日</small>` : '—'],
      [q.prem >= 0 ? '溢價' : '折價', isNum(q.prem) ? `${Math.abs(q.prem).toFixed(2)}<small>%</small>` : '—'],
      ['近 12 月殖利率', ttm ? `${ttm.toFixed(2)}<small>%</small>` : '—'],
      ['受益人數', hNow ? `${fmt.n(hNow[1])}<small>${hPrev ? ` 人（週 ${fmt.pct((hNow[1] / hPrev[1] - 1) * 100, 1)}）` : ' 人'}</small>` : '—'],
      ['近 20 日單位數', isNum(u20) ? `${fmt.pct(u20 * 100, 1)}<small> 申購／贖回</small>` : '—'],
    ];
    let h = `<div class="sec-h"><h2>ETF 體檢</h2><span class="aside">${srcLink('tdcc', '受益人數：集保')}</span></div><section class="card kv">${cells.map(([k, val]) => `<div><div class="k">${k}</div><div class="v num">${val}</div></div>`).join('')}</section>`;
    const nav = det.nav || {};
    const prem = (nav.d || []).map((d, i) => (isNum(nav.nav[i]) && isNum(nav.c[i]) ? (nav.c[i] / nav.nav[i] - 1) * 100 : null));
    const pv = prem.filter(isNum);
    if (pv.length >= 5) h += `<section class="card pad"><div class="muted" style="font-size:12.5px;margin-bottom:6px">收盤價相對官方淨值的折溢價（近 ${pv.length} 日）</div>${divBars(prem.slice(-40), (x) => x.toFixed(2) + '%', (x) => x.toFixed(2) + '%')}<div class="src">來源：${srcLink('mis_etf', '投信公告淨值（證交所 MIS）')}</div></section>`;
    if (divs.length) {
      h += `<section class="card tbl-wrap"><table class="t"><thead><tr><th>除息日</th><th class="r">每單位配息</th></tr></thead><tbody>${det.div_next ? `<tr class="hl"><td class="num">${fmt.dy(det.div_next.d)}（預告）</td><td class="r num">${det.div_next.cash ? det.div_next.cash + ' 元' : '待公告'}</td></tr>` : ''}${divs.map((x) => `<tr><td class="num">${fmt.dy(x[0])}</td><td class="r num">${x[1]} 元</td></tr>`).join('')}</tbody></table></section>`;
    }
    return h;
  }

  function divBars(vals, label, axis) {
    const v = vals.map((x) => (isNum(x) ? x : 0));
    const W = 320, H = 70, mid = H / 2, mx = Math.max(0.2, ...v.map((x) => Math.abs(x)));
    const bw = W / v.length;
    const bars = v.map((x, i) => {
      const hgt = (Math.abs(x) / mx) * (mid - 6);
      const y = x >= 0 ? mid - hgt : mid;
      return `<rect x="${(i * bw + 1).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1.5, bw - 2).toFixed(1)}" height="${Math.max(0.8, hgt).toFixed(1)}" rx="1" fill="${x >= 0 ? 'var(--up)' : 'var(--down)'}" opacity=".8"><title>${label(x)}</title></rect>`;
    }).join('');
    const last = v[v.length - 1];
    return `<svg class="bars-mini" viewBox="0 0 ${W} ${H + 14}" role="img" aria-label="最近一筆 ${label(last)}"><line x1="0" x2="${W}" y1="${mid}" y2="${mid}" stroke="var(--line-2)"/>${bars}<text x="${W}" y="${H + 12}" text-anchor="end" fill="var(--fg-3)" style="font:10px var(--f-num)">最新 ${label(last)}</text><text x="0" y="${H + 12}" fill="var(--fg-3)" style="font:10px var(--f-num)">刻度 ±${axis ? axis(mx) : mx.toFixed(2)}</text></svg>`;
  }

  function flowsHTML(det, row) {
    const F = det.flows || {};
    const n = (F.d || []).length;
    if (!n) return '';
    const net = F.d.map((d, i) => (isNum(F.f[i]) || isNum(F.t[i]) ? ((F.f[i] || 0) + (F.t[i] || 0)) / 1000 : null));
    const have = net.filter(isNum).length;
    if (have < 5) return '';
    const last20 = net.slice(-20);
    const sum20 = last20.filter(isNum).reduce((a, b) => a + b, 0);
    const M = det.margin || {};
    const mm = (M.m || []).filter(isNum);
    const mtxt = mm.length > 1 ? `融資餘額 ${fmt.n(mm[mm.length - 1])} 張（${mm.length >= 21 ? '20 日 ' + fmt.pct((mm[mm.length - 1] / mm[mm.length - 21] - 1) * 100, 1) : '近期資料累積中'}）` : '';
    return `<div class="sec-h"><h2>籌碼</h2><span class="aside">外資＋投信，單位：張</span></div><section class="card pad">${divBars(last20, (x) => (x > 0 ? '+' : '') + Math.round(x).toLocaleString('en-US') + ' 張', (x) => Math.round(x).toLocaleString('en-US') + ' 張')}<div class="prose" style="margin-top:6px">近 20 日合計 <b class="num ${dirCls(sum20)}">${sum20 > 0 ? '+' : ''}${Math.round(sum20).toLocaleString('en-US')} 張</b>${mtxt ? '；' + mtxt : ''}。</div><div class="src">來源：${srcLink(row.m === 'otc' ? 'tpex_flows' : 'twse_flows')}、${srcLink(row.m === 'otc' ? 'tpex_margin' : 'twse_margin')}</div></section>`;
  }

  function calcHTML(row, V) {
    return `<div class="sec-h"><h2>部位試算</h2><span class="aside">${RISK[settings.risk].name} · 可在設定調整</span></div><section class="card calc" id="calc"><div class="row2"><label>投資本金（元）<input class="input num" id="cap" inputmode="numeric" value="${settings.capital}"></label><label>進場價<input class="input num" id="entry" inputmode="decimal" value="${quote(row).px ?? ''}"></label></div><div class="out" id="calcOut"></div></section>`;
  }

  function calcOut(row, V) {
    const cap = Number(String($('#cap').value).replace(/[^0-9.]/g, ''));
    const p = Number($('#entry').value);
    const out = $('#calcOut');
    if (!(cap > 0 && p > 0)) { out.textContent = '請輸入本金與價格'; return; }
    const R = RISK[settings.risk];
    if (V.stance < 0) { out.innerHTML = '規則偏空時不建議建立新部位。已持有者可參考上方的減碼條件。'; return; }
    const lv = V.levels;
    const stop = V.stance > 0 && lv.invalid ? lv.invalid.price : (lv.turn_bear ? lv.turn_bear.price : p - 2 * (V.risk.atr || p * 0.02));
    const dist = p - stop;
    if (!(dist > 0)) { out.textContent = '進場價已低於作廢線，觀點不成立。'; return; }
    const capMul = ['lev', 'inv'].includes(row.k) ? 0.5 : 1;
    const byRisk = Math.floor((cap * R.loss) / dist);
    const byCap = Math.floor((cap * R.cap * capMul) / p);
    const sh = Math.max(0, Math.min(byRisk, byCap));
    const lotsN = Math.floor(sh / 1000), odd = sh % 1000;
    const amt = sh * p, loss = sh * dist;
    out.innerHTML = `最多約 <b class="num">${fmt.n(sh)}</b> 股（${lotsN ? lotsN + ' 張' : ''}${lotsN && odd ? '又 ' : ''}${odd ? odd + ' 股零股' : ''}${!sh ? '0 股' : ''}），金額約 <b class="num">${fmt.n(amt)}</b> 元，占本金 ${fmt.pct((amt / cap) * 100, 1, false)}。<br>以 <span class="num">${fmt.px(stop)}</span> ${V.stance > 0 ? '作廢線' : '支撐'}出場時約虧 <b class="num">${fmt.n(loss)}</b> 元（本金 ${fmt.pct((loss / cap) * 100, 2, false)}）。<br><span class="muted">${byRisk < byCap ? '受單筆虧損上限限制' : '受單檔部位上限限制'}；未計手續費與交易稅。${V.stance === 0 ? '中性時建議等條件出現再進場。' : ''}</span>`;
  }

  function dcaHTML(row, V) {
    const r = V.risk || {};
    const q = quote(row);
    const [w] = premBand(row);
    let tip;
    if (['lev', 'inv'].includes(row.k)) tip = '槓桿與反向型每日重新平衡，長期持有會偏離指數，不適合定期定額。';
    else if (V.stance < 0) tip = '定期定額照紀律扣款即可；若另有單筆加碼的打算，等觀點回到中性以上再進。';
    else if (isNum(q.prem) && q.prem > w) tip = `照常扣款；單筆加碼等溢價回到 ${w}% 以內。`;
    else if (V.stance > 0) tip = '照常扣款；想單筆加碼可參考上面的分批建議與作廢線。';
    else tip = '照常扣款；短期方向不明，單筆加碼可以等條件出現。';
    return `<section class="card pad prose"><p><b>定期定額視角</b>　長期扣款看的是紀律，不是短期觀點。目前價格在一年區間的 ${isNum(r.pos_52w) ? r.pos_52w.toFixed(0) + '%' : '—'} 位置${isNum(q.prem) ? `，${q.prem >= 0 ? '溢價' : '折價'} ${Math.abs(q.prem).toFixed(2)}%` : ''}。${tip}</p></section>`;
  }

  function btHTML(det) {
    const b = det.bt;
    if (!b || !b.n) return '';
    const pc = (x) => (isNum(x) ? (x * 100).toFixed(0) + '%' : '—');
    return `<div class="sec-h"><h2>這檔的規則戰績</h2><span class="aside">${fmt.dy(b.start)} 起回測</span></div><section class="card kv">
      <div><div class="k">看多後 20 日上漲</div><div class="v num">${pc(b.bull.hit)}<small> ${fmt.n(b.bull.n)} 次</small></div></div>
      <div><div class="k">一直看多的基準</div><div class="v num">${pc(b.base_up)}<small> 全部 ${fmt.n(b.n)} 次</small></div></div>
      <div><div class="k">看空後 20 日下跌</div><div class="v num">${pc(b.bear.hit)}<small> ${fmt.n(b.bear.n)} 次</small></div></div>
      <div><div class="k">看多與看空的報酬差</div><div class="v num">${isNum(b.bull.avg) && isNum(b.bear.avg) ? fmt.pct((b.bull.avg - b.bear.avg) * 100, 1) : '—'}</div></div>
    </section>`;
  }

  function bindDetail(row, det) {
    if (!det) return;
    const V = det.view;
    drawPriceChart(det, S.range);
    $$('[data-rg]').forEach((b) => b.addEventListener('click', () => { S.range = +b.dataset.rg; $$('[data-rg]').forEach((x) => x.setAttribute('aria-pressed', x === b)); drawPriceChart(det, S.range); }));
    const run = () => calcOut(row, V);
    $('#cap').addEventListener('input', run);
    $('#entry').addEventListener('input', run);
    run();
  }

  // ------------------------------------------------------------ 價格圖
  function drawPriceChart(det, n) {
    const el = $('#pchart');
    if (!el) return;
    const B = det.bars;
    const k0 = Math.max(0, B.d.length - n);
    const D = B.d.slice(k0), C = B.c.slice(k0), H = B.h.slice(k0), Lo = B.l.slice(k0);
    const M20 = det.ma['20'].slice(k0), M60 = det.ma['60'].slice(k0), M120 = det.ma['120'].slice(k0);
    const V = det.view, L = V.levels;
    const lv = [];
    const inv = L.invalid ? L.invalid.price : null;
    (L.resistance || []).forEach((x) => { if (x.price !== inv) lv.push({ p: x.price, t: '壓', cls: 'ice' }); });
    (L.support || []).forEach((x) => { if (x.price !== inv) lv.push({ p: x.price, t: '撐', cls: 'ice' }); });
    if (inv != null) lv.push({ p: inv, t: '作廢', cls: 'warn' });
    const W = 360, Ht = 230, pl = 6, pr = 74, pt = 12, pb = 22;
    const vals = [...C, ...H, ...Lo, ...M20, ...M60, ...M120].filter(isNum);
    const last = C[C.length - 1];
    lv.forEach((x) => { if (Math.abs(x.p / last - 1) < 0.25) vals.push(x.p); });
    let mn = Math.min(...vals), mx = Math.max(...vals);
    const padY = (mx - mn) * 0.06 || last * 0.01;
    mn -= padY; mx += padY;
    const X = (i) => pl + (i / Math.max(1, C.length - 1)) * (W - pl - pr);
    const Y = (v) => pt + (1 - (v - mn) / (mx - mn)) * (Ht - pt - pb);
    const path = (arr) => { let d = '', pen = false; arr.forEach((v, i) => { if (!isNum(v)) { pen = false; return; } d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); pen = true; }); return d; };
    // 格線與刻度（小數位數依刻度間距決定，所有刻度一致）
    const step = niceStep((mx - mn) / 4);
    const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
    const fa = (v) => v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    const fl = (v) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    let grid = '';
    for (let g = Math.ceil(mn / step) * step; g <= mx; g += step) {
      grid += `<line x1="${pl}" x2="${W - pr}" y1="${Y(g).toFixed(1)}" y2="${Y(g).toFixed(1)}"/><text x="${W - 4}" y="${(Y(g) + 3).toFixed(1)}" text-anchor="end" class="axis-t">${fa(g)}</text>`;
    }
    let xlab = '';
    let lastM = null;
    D.forEach((d, i) => {
      const m = Math.floor(d / 100) % 100;
      if (m !== lastM && i > 2 && i < D.length - 3) { xlab += `<text x="${X(i).toFixed(1)}" y="${Ht - 6}" text-anchor="middle">${m}月</text>`; }
      lastM = m;
    });
    // 價位標籤避免互相重疊：依位置排序後往下推開，再整體夾在圖內
    const vis = lv.filter((x) => x.p >= mn && x.p <= mx).sort((a, b) => b.p - a.p);
    let prevY = -1e9;
    vis.forEach((x) => { x.ly = Math.max(Y(x.p), prevY + 15); prevY = x.ly; });
    const over = vis.length ? vis[vis.length - 1].ly - (Ht - pb - 6) : 0;
    if (over > 0) vis.forEach((x) => { x.ly -= over; });
    vis.forEach((x) => { x.ly = Math.max(pt + 6, x.ly); });
    const lvls = vis.map((x) => `<line x1="${pl}" x2="${W - pr}" y1="${Y(x.p).toFixed(1)}" y2="${Y(x.p).toFixed(1)}" stroke="var(--${x.cls})" stroke-width="${x.cls === 'warn' ? 1.6 : 1.2}" stroke-dasharray="4 3" opacity=".9"/><rect x="${W - pr + 2}" y="${(x.ly - 7.5).toFixed(1)}" width="${pr - 2}" height="15" rx="3" fill="var(--card)"/><text class="lvl-lab" x="${W - 3}" y="${(x.ly + 3.5).toFixed(1)}" text-anchor="end" fill="var(--${x.cls})">${x.t} ${fl(x.p)}</text>`).join('');
    const area = path(C) + `L${X(C.length - 1).toFixed(1)} ${Ht - pb}L${X(0).toFixed(1)} ${Ht - pb}Z`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${Ht}" role="img" aria-label="近 ${C.length} 個交易日收盤價與均線">
      <defs><linearGradient id="ga" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--fg)" stop-opacity=".12"/><stop offset="1" stop-color="var(--fg)" stop-opacity="0"/></linearGradient></defs>
      <g class="grid">${grid.replace(/class="axis-t"/g, 'fill="var(--fg-3)" style="font:10px var(--f-num)"')}</g>
      <g class="axis">${xlab}</g>
      <path d="${area}" fill="url(#ga)"/>
      <path d="${path(M120)}" fill="none" stroke="var(--ma120)" stroke-width="1.4" opacity=".9"/>
      <path d="${path(M60)}" fill="none" stroke="var(--ma60)" stroke-width="1.5"/>
      <path d="${path(M20)}" fill="none" stroke="var(--ma20)" stroke-width="1.4"/>
      <path d="${path(C)}" fill="none" stroke="var(--fg)" stroke-width="2" stroke-linejoin="round"/>
      ${lvls}
      <circle cx="${X(C.length - 1).toFixed(1)}" cy="${Y(last).toFixed(1)}" r="3.6" fill="var(--fg)" stroke="var(--card)" stroke-width="2"/>
      <g id="xh" opacity="0"><line id="xhl" y1="${pt}" y2="${Ht - pb}" stroke="var(--fg-3)" stroke-width="1" stroke-dasharray="2 2"/><circle id="xhc" r="4" fill="var(--fg)" stroke="var(--card)" stroke-width="2"/></g>
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
      tip.innerHTML = `<div class="d">${fmt.dy(D[i])}</div><div class="row"><span>收盤</span><b class="num">${fmt.px(C[i])}</b></div><div class="row"><span>月線</span><span class="num">${fmt.px(M20[i])}</span></div><div class="row"><span>季線</span><span class="num">${fmt.px(M60[i])}</span></div><div class="row"><span>半年線</span><span class="num">${fmt.px(M120[i])}</span></div>`;
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

  function niceStep(x) {
    const p = Math.pow(10, Math.floor(Math.log10(x || 1)));
    const f = x / p;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
  }
  function fmtAxis(v) { return v >= 1000 ? Math.round(v).toLocaleString('en-US') : v >= 100 ? v.toFixed(1) : v.toFixed(2); }

  // ------------------------------------------------------------ 其他
  let toastTimer = null;
  function toast(msg) {
    let t = $('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  }

  window.addEventListener('popstate', () => {
    const code = location.hash.replace('#', '');
    if (code && S.rows.has(code)) openDetail(code, false);
    else if (openCode) closeDetail(true);
  });
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.deferredInstall = e; if (S.tab === 'today' && S.summary) renderToday(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.summary) refreshLive(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openCode) closeDetail(); });

  async function boot() {
    renderShell();
    const cached = store.get('cache.summary', null);
    if (cached) { S.summary = cached; S.rows = new Map(cached.etfs.map((r) => [r.c, r])); S.live = store.get('cache.live', null); }
    render();
    try {
      await loadCore();
      render();
    } catch (e) {
      if (!S.summary) $('#view').innerHTML = `<section class="card empty">資料還在準備中。第一次部署後約 1 小時會出現完整資料，請稍後再開。</section>`;
      else toast('連不上伺服器，顯示的是上次的資料');
    }
    const code = location.hash.replace('#', '');
    if (code && S.rows.has(code)) openDetail(code, false);
    setInterval(() => { if (document.visibilityState === 'visible' && S.live && S.live.open) refreshLive(); }, 60000);
    setInterval(() => { if (document.visibilityState === 'visible') loadCore().then(() => { if (!openCode) render(); }).catch(() => {}); }, 15 * 60000);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  boot();
})();
