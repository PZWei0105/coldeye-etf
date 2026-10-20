/* 冷眼 — 兩個工具頁：ETF 對決、存股時光機。都開在全螢幕的 #sheet，網址分別是 #duel、#tm。 */
import {
  $, $$, esc, isNum, S, settings, saveSettings, fmt, money, catName, ICON, quote, ensureDetail, ensureHist, stanceChip, posChip, toast,
} from './core.js';
import { duelStats, DUEL_AXES, timeMachine, firstMonth, indexTo100, TM_STRATS } from './calc.js';
import { hexSVG, linesSVG, bindLines } from './viz.js';
import { closeDetail } from './sheet.js';

const SLOT_COL = ['var(--s1)', 'var(--s2)', 'var(--s3)'];   // 顏色跟著格子，不跟著排名
const pctS = (x, d = 1) => (isNum(x) ? `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(d)}%` : '—');

function openSheet(key, hash, push) {
  S.openCode = key;
  if (push && location.hash !== '#' + hash) history.pushState({ tool: hash }, '', '#' + hash);
  const sh = $('#sheet');
  sh.hidden = false;
  document.body.classList.add('locked');
  sh.scrollTop = 0;
  return sh;
}
function topBar(title, sub) {
  return `<div class="sheet-top"><button class="icon-btn" id="back" aria-label="返回">${ICON.back}</button><span class="ttl"><b class="ttl-b">${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</span></div>`;
}
function picker(id, ph) {
  return `<div class="picker"><input class="input" id="${id}" placeholder="${esc(ph)}" autocomplete="off"><div class="sugg" id="${id}-s"></div></div>`;
}
function bindPicker(root, id, onPick, exclude = []) {
  const q = $('#' + id, root), sugg = $(`#${id}-s`, root);
  if (!q) return;
  q.addEventListener('input', () => {
    const s = q.value.trim().toLowerCase();
    if (!s) { sugg.innerHTML = ''; return; }
    const hits = S.summary.etfs.filter((r) => !exclude.includes(r.c) && (r.c.toLowerCase().includes(s) || (r.n || '').toLowerCase().includes(s))).slice(0, 8);
    sugg.innerHTML = hits.map((r) => `<button type="button" data-pick="${r.c}">${esc(r.n)} <span class="num">${r.c}</span></button>`).join('') || '<span class="muted small">找不到這檔 ETF</span>';
    $$('[data-pick]', sugg).forEach((b) => b.addEventListener('click', () => onPick(b.dataset.pick)));
  });
}

// ================================================================== ETF 對決
export function addToDuel(code) {
  const d = (settings.duel || []).slice(0, 3);
  while (d.length < 3) d.push(null);
  if (!d.includes(code)) {
    const k = d.indexOf(null);
    if (k >= 0) d[k] = code; else d[2] = code;
  }
  settings.duel = d;
  saveSettings();
}
export function openDuel(push = true) {
  if (!settings.duel || !settings.duel.filter(Boolean).length) {
    const w = (settings.watch || []).filter((c) => S.rows.get(c));
    settings.duel = [w[0] || '0050', w[1] || '0056', null];
  }
  openSheet('__duel', 'duel', push);
  drawDuel();
}
let duelSeq = 0;   // 連續切換時，只畫最後一次的結果（慢的回應不能蓋掉新的選擇）
async function drawDuel() {
  const my = ++duelSeq;
  const sh = $('#sheet');
  const slots = (settings.duel || []).slice(0, 3);
  while (slots.length < 3) slots.push(null);
  const rows = slots.map((c) => (c ? S.rows.get(c) || null : null));
  const picks = rows.map((r, i) => (r ? { r, i } : null)).filter(Boolean);
  const all = S.summary.etfs;
  const stats = duelStats(all, picks.map((p) => p.r));
  const nWith = all.filter((r) => isNum(r.r1y)).length;
  const nAll = all.filter((r) => isNum(r.sc)).length;
  const slotHTML = rows.map((r, i) => (r
    ? `<div class="slot" style="--c:${SLOT_COL[i]}"><i></i><span class="sl-n"><b>${esc(r.n)}</b><span class="num">${r.c}・${esc(catName(r.k))}</span></span><button class="mini-btn" data-rm="${i}" aria-label="移出對決">${ICON.x}</button></div>`
    : `<div class="slot empty" style="--c:${SLOT_COL[i]}"><i></i>${picker('dq' + i, i === 2 ? '第三檔（選填）' : '輸入代號或名稱')}</div>`)).join('');
  const T = (k) => `data-term="${k}"`;
  const fmtAxis = (a, v) => (v == null ? '—' : a.f === 'y' ? `${v.toFixed(2)}%` : a.f === 'sc' ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}` : a.f === 'hd' ? fmt.n(v) : `${(v * 100).toFixed(1)}%`);
  const termOf = { r1y: 'r1y', vol: 'vol', mdd: 'mdd', y: 'y', hd: 'hd', sc: 'sc' };
  const tRows = DUEL_AXES.map((a, k) => {
    const vals = stats.map((s) => s.axes[k].v);
    const ok = vals.filter(isNum);
    const best = ok.length > 1 ? (a.hi ? Math.max(...ok) : Math.min(...ok)) : null;
    return `<tr><td><span ${T(termOf[a.f])}>${esc(a.note)}</span></td>${stats.map((s, i) => { const v = s.axes[k].v; const p = s.axes[k].p; return `<td class="r"><b class="num${best != null && v === best ? ' lead' : ''}">${fmtAxis(a, v)}</b>${isNum(p) ? `<small class="num">贏過 ${(p * 100).toFixed(0)}%</small>` : ''}</td>`; }).join('')}</tr>`;
  }).join('');
  const extra = [
    ['規則觀點', (r) => `${stanceChip(r.st)}${posChip(r.ps)}`, 'st'],
    ['現價', (r) => `<b class="num">${fmt.px(quote(r).px)}</b>`, null],
    ['溢價', (r) => { const q = quote(r); return isNum(q.prem) ? `<b class="num">${q.prem.toFixed(2)}%</b>` : '—'; }, 'prem'],
    ['規模', (r) => (isNum(r.aum) ? `<b class="num">${fmt.big(r.aum)}</b>` : '—'), 'aum'],
    ['成交值', (r) => (isNum(r.val) ? `<b class="num">${fmt.big(r.val)}</b>` : '—'), 'val'],
  ].map(([k, f, term]) => `<tr><td>${term ? `<span ${T(term)}>${k}</span>` : k}</td>${picks.map((p) => `<td class="r">${f(p.r)}</td>`).join('')}</tr>`).join('');
  sh.innerHTML = topBar('ETF 對決', '過去一年的屬性比一比') + `<div class="sheet-body tool duel">
    <section class="panel slots">${slotHTML}</section>
    ${picks.length >= 2 ? `
    <section class="panel hex-card">
      <div class="hx-wrap">${hexSVG(stats, picks.map((p) => SLOT_COL[p.i]))}</div>
      <ul class="hx-leg">${picks.map((p) => `<li style="--c:${SLOT_COL[p.i]}"><i></i>${esc(p.r.n)}</li>`).join('')}</ul>
      <p class="small muted">每一項都是和其他 ETF 比的百分位，越往外圈代表在那一項贏過越多 ETF：報酬、穩定、抗跌只和上市滿一年的 ${nWith} 檔比，配息、人氣、規則和全部 ${nAll} 檔比。「穩定」「抗跌」是波動與回檔越小越外圈。</p>
    </section>
    <section class="panel tbl-wrap"><table class="t duel-t"><thead><tr><th></th>${picks.map((p) => `<th class="r"><span class="th-c" style="--c:${SLOT_COL[p.i]}"><i></i>${esc(p.r.c)}</span></th>`).join('')}</tr></thead><tbody>${tRows}${extra}</tbody></table></section>
    <section class="panel chart-card"><div class="chart-head"><h3>近一年含息走勢</h3><span class="small muted">起點都換成 100</span></div><div class="chart" id="dchart"><div class="skeleton" style="height:200px"></div></div></section>
    <section class="panel pad prose" id="dsum">${duelSummary(picks.map((p) => p.r))}</section>
    <p class="disclaim">數字來自官方收盤價與除息紀錄，用還原權息價計算；過去一年的表現不代表未來，這裡只是比較，不是推薦。</p>` : `<section class="panel pad calm"><b>再選一檔就能開始對決。</b><span class="muted">最多三檔，顏色會跟著格子，不會因為排名改變。</span></section>`}
  </div>`;
  $('#back', sh).addEventListener('click', () => closeDetail());
  $$('[data-rm]', sh).forEach((b) => b.addEventListener('click', () => { const d = settings.duel.slice(); d[+b.dataset.rm] = null; settings.duel = d; saveSettings(); drawDuel(); }));
  rows.forEach((r, i) => { if (!r) bindPicker(sh, 'dq' + i, (code) => { const d = settings.duel.slice(); while (d.length < 3) d.push(null); d[i] = code; settings.duel = d; saveSettings(); drawDuel(); }, slots.filter(Boolean)); });
  if (picks.length >= 2) {
    const dets = await Promise.all(picks.map((p) => ensureDetail(p.r.c)));
    if (S.openCode !== '__duel' || my !== duelSeq) return;
    const box = $('#dchart', sh);
    if (!box) return;
    const base = dets.find((d) => d && d.bars) ;
    if (!base) { box.innerHTML = '<div class="empty small">走勢資料暫時載入失敗</div>'; return; }
    const dates = base.bars.d.slice(-250);
    const series = picks.map((p, k) => {
      const d = dets[k];
      if (!d || !d.bars) return { name: p.r.n, col: SLOT_COL[p.i], vals: dates.map(() => null) };
      const m = new Map(d.bars.d.map((x, j) => [x, d.bars.c[j]]));
      return { name: p.r.n, col: SLOT_COL[p.i], vals: indexTo100(dates.map((x) => m.get(x) ?? null)) };
    });
    box.innerHTML = linesSVG({ dates, series, fmtY: (v) => v.toFixed(0), ref: 100 });
    bindLines(box, { dates, series, fmtV: (v) => `${v.toFixed(1)}（${v >= 100 ? '+' : '−'}${Math.abs(v - 100).toFixed(1)}%）` });
  }
}
function duelSummary(rs) {
  const ok = (f) => rs.filter((r) => isNum(r[f]));
  const lines = [];
  const pick = (f, hi) => { const xs = ok(f); if (xs.length < 2) return null; const s = xs.slice().sort((a, b) => (hi ? b[f] - a[f] : a[f] - b[f])); return [s[0], s[s.length - 1]]; };
  let p = pick('r1y', true);
  if (p) lines.push(`近一年含息報酬：<b>${esc(p[0].n)}</b> 最高（${pctS(p[0].r1y)}），${esc(p[1].n)} 最低（${pctS(p[1].r1y)}）。`);
  p = pick('vol', false);
  if (p) lines.push(`波動：<b>${esc(p[0].n)}</b> 最穩（年化 ${(p[0].vol * 100).toFixed(1)}%），${esc(p[1].n)} 起伏最大（${(p[1].vol * 100).toFixed(1)}%）。`);
  p = pick('mdd', false);
  if (p) lines.push(`近一年最大回檔：${esc(p[0].n)} 只跌過 ${(p[0].mdd * 100).toFixed(1)}%，${esc(p[1].n)} 曾經跌 ${(p[1].mdd * 100).toFixed(1)}%。`);
  const yl = rs.filter((r) => isNum(r.y));
  if (yl.length >= 2) {
    const s = yl.slice().sort((a, b) => b.y - a.y);
    lines.push(`殖利率：${esc(s[0].n)} ${s[0].y.toFixed(2)}% 最高。殖利率高不等於賺比較多，配息會從股價扣掉，要看含息報酬。`);
  }
  const st = rs.map((r) => `${esc(r.n)}${r.st == null ? '資料不足' : r.st > 0 ? '偏多' : r.st < 0 ? '偏空' : '中性'}`);
  lines.push(`今天的規則觀點：${st.join('、')}。`);
  return lines.map((l) => `<p>${l}</p>`).join('');
}

// ================================================================== 存股時光機
const TM_DEF = { code: '0050', amount: 10000, day: 6, reinvest: true, start: null };
export function openTM(push = true, code = null) {
  settings.tm = Object.assign({ ...TM_DEF }, settings.tm || {});
  if (code && code !== settings.tm.code) { settings.tm.code = code; settings.tm.start = null; saveSettings(); }
  openSheet('__tm', 'tm', push);
  drawTM();
}
let tmSeq = 0;
async function drawTM() {
  const my = ++tmSeq;
  const sh = $('#sheet');
  const o = settings.tm;
  const row = S.rows.get(o.code) || S.rows.get('0050');
  if (row && row.c !== o.code) o.code = row.c;
  sh.innerHTML = topBar('存股時光機', '如果當初每月固定買') + `<div class="sheet-body tool tm"><div class="skeleton" style="height:220px"></div><div class="skeleton" style="height:260px"></div></div>`;
  $('#back', sh).addEventListener('click', () => closeDetail());
  const hist = await ensureHist(o.code);
  if (S.openCode !== '__tm' || my !== tmSeq) return;
  const body = $('.sheet-body', sh);
  if (!hist || !hist.d || hist.d.length < 40) {
    body.innerHTML = `${tmInputs(row, null)}<section class="panel pad calm"><b>這檔的歷史資料還不夠。</b><span class="muted">上市不久，或後台還在補 2020 年以來的歷史資料（約需一兩天）。可以先換一檔試試。</span></section>`;
    bindTM(sh, row, null);
    return;
  }
  const fm = firstMonth(hist);
  const lastYm = Math.floor(hist.d[hist.d.length - 1] / 100);
  if (!o.start || o.start < fm || o.start > lastYm) o.start = fm;   // 預設從最早能比的月份開始（含 2022 年的大跌）
  const res = timeMachine(hist, { start: o.start, amount: o.amount, day: o.day, reinvest: o.reinvest, fee: settings.fee, cat: row ? row.k : null });
  body.innerHTML = tmInputs(row, hist) + (res ? tmResult(res, row) : `<section class="panel pad calm"><b>這段期間還沒有扣款日。</b><span class="muted">把開始月份往前調。</span></section>`);
  bindTM(sh, row, hist);
  if (res) {
    const box = $('#tmchart', sh);
    const step = Math.max(1, Math.floor(res.series.length / 260));
    const pts = res.series.filter((_, i) => i % step === 0 || i === res.series.length - 1);
    const dates = pts.map((p) => p.d);
    const series = [
      { name: '總投入', col: 'var(--frost-3)', vals: pts.map((p) => p.inv), dash: '3 4', width: 1.5 },
      { name: TM_STRATS.dca.name, col: 'var(--frost)', vals: pts.map((p) => p.v.dca) },
      ...(res.hasSig ? [
        { name: TM_STRATS.add.name, col: 'var(--s1)', vals: pts.map((p) => p.v.add) },
        { name: TM_STRATS.pause.name, col: 'var(--s2)', vals: pts.map((p) => p.v.pause) },
      ] : []),
    ];
    box.innerHTML = linesSVG({ dates, series, fmtY: (v) => (Math.abs(v) >= 1e4 ? `${(v / 1e4).toFixed(0)}萬` : v.toFixed(0)), h: 230 });
    bindLines(box, { dates, series, fmtV: (v) => money(v) });
  }
}
function monthOpts(hist, sel) {
  if (!hist) return '';
  const fm = firstMonth(hist);
  const last = Math.floor(hist.d[hist.d.length - 1] / 100);
  const out = [];
  let y = Math.floor(fm / 100), m = fm % 100;
  while (y * 100 + m <= last) { out.push(y * 100 + m); m++; if (m > 12) { y++; m = 1; } }
  return out.reverse().map((ym) => `<option value="${ym}"${ym === sel ? ' selected' : ''}>${Math.floor(ym / 100)} 年 ${ym % 100} 月</option>`).join('');
}
function tmInputs(row, hist) {
  const o = settings.tm;
  return `<section class="panel tm-in">
    <div class="tm-etf"><span class="lab">ETF</span><div class="picked"><b>${esc(row ? row.n : o.code)}</b><span class="num muted">${esc(o.code)}</span><button type="button" class="link" id="tm-change">更換</button></div><div id="tm-pick" hidden>${picker('tmq', '輸入代號或名稱，例如 006208')}</div></div>
    <div class="row2">
      <label class="field"><span>每月金額（元）</span><input class="input num" id="tm-amt" inputmode="numeric" value="${o.amount}"></label>
      <label class="field"><span>從哪個月開始</span><select class="input" id="tm-start">${monthOpts(hist, o.start)}</select></label>
    </div>
    <div class="row2">
      <div class="field"><span>每月扣款日</span><div class="seg wide">${[6, 16, 26].map((d) => `<button type="button" data-day="${d}" aria-pressed="${o.day === d}">${d} 號</button>`).join('')}</div></div>
      <div class="field"><span>股息再投入</span><button type="button" class="switch-row" id="tm-re" aria-pressed="${o.reinvest}" aria-label="股息加進下個月一起買"><span class="switch" role="switch" aria-checked="${o.reinvest}"></span><span>${o.reinvest ? '加進下個月' : '留著不買'}</span></button></div>
    </div>
  </section>`;
}
function tmResult(res, row) {
  // 上市太短、規則還沒有訊號的 ETF：只看定期定額，不拿「從來沒買」去和定期定額比
  const S3 = res.hasSig ? res.strats : { dca: res.strats.dca };
  const base = S3.dca;
  const span = res.months >= 12 ? `（約 ${(Math.round(res.months / 12 * 10) / 10).toString()} 年）` : '';
  const cmp = (k) => {
    const s = S3[k];
    const d = s.value - base.value;
    const dp = (s.ret - base.ret) * 100;
    return `${esc(s.name)}：比定期定額${d >= 0 ? '多' : '少'} <b class="num">${money(Math.abs(d))}</b> 元（報酬${dp >= 0 ? '高' : '低'} ${Math.abs(dp).toFixed(1)} 個百分點），一共等了 ${s.waits} 次、買了 ${s.buys} 次。`;
  };
  const col = { dca: 'var(--frost)', add: 'var(--s1)', pause: 'var(--s2)' };
  return `<section class="panel tm-hero">
      <div class="tm-k">${fmt.dy(res.start)} 起，每月 ${money(settings.tm.amount)} 元，共 ${res.months} 個月${span}</div>
      <div class="tm-big"><span class="num">${money(base.value)}</span><small>元</small></div>
      <div class="tm-sub">投入 <b class="num">${money(base.invested)}</b>　賺 <b class="num ${base.gain >= 0 ? 'up' : 'down'}">${money(base.gain, true)}</b>　報酬 <b class="num ${base.ret >= 0 ? 'up' : 'down'}">${pctS(base.ret)}</b>　<span data-term="irr">年化</span> <b class="num">${pctS(base.irr)}</b></div>
      <div class="tm-sub muted">領到股息 ${money(base.div)} 元・手續費 ${money(base.fee)} 元・現在約 ${fmt.n(base.sh)} 股</div>
    </section>
    <div class="sec-h"><h2>照冷眼的訊號買，會更好嗎？</h2></div>
    ${res.hasSig ? '' : '<section class="panel pad calm"><b>這檔有成交的交易日還不夠多（上市不久，或平常很少成交），規則還沒有足夠的資料判讀。</b><span class="muted">所以這裡只看定期定額；等它累積更多交易日，就能比較照訊號買的結果。</span></section>'}
    <section class="panel list tm-list">${Object.entries(S3).map(([k, s]) => `<div class="tm-row${k === 'dca' ? ' base' : ''}" style="--c:${col[k]}">
        <div class="tm-r1"><span class="tm-n"><i></i><b>${esc(s.name)}</b>${k === 'dca' ? '<small>基準</small>' : ''}</span><b class="num tm-v">${money(s.value)}</b></div>
        <div class="tm-r2"><span class="muted">${esc(s.desc)}</span></div>
        <div class="tm-r3"><span>報酬 <b class="num ${s.ret >= 0 ? 'up' : 'down'}">${pctS(s.ret)}</b></span><span><span data-term="irr">年化</span> <b class="num">${pctS(s.irr)}</b></span><span>最差帳面 <b class="num">${pctS(s.worst)}</b></span><span>買 ${s.buys} 次${s.waits ? `・等 ${s.waits} 次` : ''}</span></div>
      </div>`).join('')}</section>
    <section class="panel chart-card"><div class="chart-head"><h3>帳戶價值</h3><span class="small muted">含沒買的現金與股息</span></div><div class="chart" id="tmchart"></div>
      <div class="legend">${[['總投入', 'var(--frost-3)', 'dash'], [TM_STRATS.dca.name, col.dca], ...(res.hasSig ? [[TM_STRATS.add.name, col.add], [TM_STRATS.pause.name, col.pause]] : [])].map(([n, c, d]) => `<span><i class="${d || ''}" style="border-color:${c}"></i>${esc(n)}</span>`).join('')}</div></section>
    ${res.hasSig ? `<section class="panel pad prose">
      <p>${cmp('add')}</p><p>${cmp('pause')}</p>
      <p>「最差帳面」是這段期間帳戶價值低於總投入最多的時候。等訊號的買法常常抱著現金，所以帳面比較不會難看，但遇到一路上漲就會少賺。</p>
    </section>` : ''}
    <p class="disclaim">簡化：以扣款日收盤價成交（實際多為開盤附近），股息在除息日入帳（實際約一個月後；除息日剛好沒成交就在下一個交易日），不計二代健保補充保費；手續費依你在設定的折扣與最低收費計算。訊號用扣款日之前最近一次的部位訊號（每 5 個交易日一次，和回測同一套；不用扣款日當天收盤才算得出來的訊號）。過去的結果不代表未來。</p>`;
}
function bindTM(sh, row, hist) {
  const o = settings.tm;
  const redo = () => { saveSettings(); drawTM(); };
  const ch = $('#tm-change', sh);
  if (ch) ch.addEventListener('click', () => { $('#tm-pick', sh).hidden = false; $('#tmq', sh).focus(); });
  bindPicker(sh, 'tmq', (code) => { o.code = code; o.start = null; redo(); });
  const amt = $('#tm-amt', sh);
  if (amt) amt.addEventListener('change', () => {
    const v = Math.round(Number(String(amt.value).replace(/[^0-9]/g, '')));
    if (v >= 100 && v <= 10000000) { o.amount = v; redo(); } else { amt.value = o.amount; toast('每月金額請填 100 元到 1,000 萬元'); }
  });
  const stt = $('#tm-start', sh);
  if (stt) stt.addEventListener('change', () => { o.start = +stt.value; redo(); });
  $$('[data-day]', sh).forEach((b) => b.addEventListener('click', () => { o.day = +b.dataset.day; redo(); }));
  const re = $('#tm-re', sh);
  if (re) re.addEventListener('click', () => { o.reinvest = !o.reinvest; redo(); });
}
