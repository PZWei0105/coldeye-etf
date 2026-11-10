/* 冷眼 — 盤勢脈動：今日戰報（部位分頁）、資金輪動（雷達）、同類排行（單檔頁）。
   全部用官方資料、固定規則算（calc.js 的 dayReport／rotation／peerRank），不預測、不叫你買賣；
   每一塊都寫清楚是哪一天、幾點的資料、怎麼算的。關注清單的盤中走勢小圖在 app.js（core.js 的 daySparkSVG）。 */
import {
  $, $$, esc, isNum, S, settings, saveSettings, fmt, money, dirCls, catName, quote, quoteWhen, today, book, slotVar, reduceMotion,
} from './core.js';
import { dayReport, rotation, peerRank, haltOn } from './calc.js';
import * as FX from './fx.js';

const anim = () => settings.fx !== false && !reduceMotion();
/** 盤中的話寫「盤中 HH:MM」，不然寫「M/D 收盤」（全 App 同一套說法） */
function whenOf(qs, date) {
  const live = qs.filter((q) => q && q.live && q.date === date).sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')));
  return live.length ? quoteWhen(live[0]) : `${fmt.d(date)} 收盤`;
}

// ================================================================== 今日戰報（部位分頁）
/** 今天每一檔賺賠多少（含息）：加起來＝今天的損益；和 0050 同一天比 */
export function dayReportHTML(P) {
  if (!P || !P.holdings) return '';
  const b0 = S.rows.get('0050');
  const R = dayReport(P, b0 ? quote(b0) : null, book.lots);
  if (!R || !R.date || !R.items.length) return '';
  const isToday = R.date === today();
  const when = whenOf([...P.holdings, ...(P.closed || [])].map((x) => x.q), R.date);
  const max = Math.max(1, ...R.items.map((x) => Math.abs(x.day || 0)));
  const rows = R.items.map((x, i) => {
    const w = Math.round(Math.abs(x.day || 0) / max * 1000) / 10;
    const td = isToday ? '今天' : '那天';
    const h = x.stale ? haltOn(x.code, R.date) : null;
    const nt = h ? `${isToday ? '停止交易中' : '停止交易'}（${h.why}）` : isToday ? '今天還沒成交' : '那天沒有成交';
    const note = x.stale ? (x.traded ? `${!x.held ? `${td}出清・` : ''}${nt}，只算${td}買賣的價差` : `${nt}，算 0`) : !x.held ? `${td}出清` : x.traded ? `含${td}的買賣` : '';
    return `<li class="dr-row${x.stale ? ' stale' : ''}" style="--i:${i}"><button data-code="${esc(x.code)}" aria-label="${esc(x.name)} ${td}${settings.privacy ? '' : ` ${money(x.day, true)} 元`}">
      <i class="dr-dot" style="background:${x.held ? slotVar(x.slot) : 'var(--s-other)'}"></i>
      <span class="dr-nm"><b>${esc(x.name)}</b><small><span class="num">${esc(x.code)}</span>${note ? `<em>${note}</em>` : ''}</small></span>
      <span class="dr-bar" aria-hidden="true"><i class="${(x.day || 0) >= 0 ? 'pos' : 'neg'}" style="--w:${w}%"></i></span>
      <span class="dr-v"><b class="num ${dirCls(x.day)}">${money(x.day, true)}</b><small class="num ${dirCls(x.pc)}">${x.stale ? '—' : fmt.r(x.pc / 100, 2)}</small></span>
    </button></li>`;
  }).join('');
  const pc = isNum(R.pct) ? R.pct * 100 : null;
  const diff = R.bench && isNum(pc) ? pc - R.bench.pc : null;
  const cmp = R.bench ? `<div class="dr-bench"><span>同一天 <b>0050</b></span><b class="num ${dirCls(R.bench.pc)}">${fmt.r(R.bench.pc / 100, 2)}</b>${isNum(diff) && Math.abs(diff) >= 0.005 ? `<small>你的持股${diff > 0 ? '多' : '少'} <b class="num">${Math.abs(diff).toFixed(2)}</b> 個百分點</small>` : isNum(diff) ? '<small>和你的持股差不多</small>' : ''}</div>` : '';
  return `<div class="sec-h"><h2 data-term="dayrep">${isToday ? '今日戰報' : `${fmt.d(R.date)} 戰報`}</h2><span class="aside">${esc(when)}・每一檔賺賠多少（含息）</span></div>
    <section class="panel dr-card" aria-label="${isToday ? '今日戰報' : `${fmt.d(R.date)} 戰報`}">
      <div class="dr-top">
        <div class="dr-total"><span class="k">${isToday ? '今天' : `${fmt.d(R.date)} `}合計</span><b class="num ${dirCls(R.total)}" id="dr-sum"${settings.privacy ? '' : ` data-v="${Math.round(R.total)}"`}>${money(R.total, true)}</b>${isNum(pc) ? `<small class="num ${dirCls(pc)}">持股 ${fmt.r(R.pct, 2)}</small>` : ''}<span class="dr-cnt">漲 <b class="num up">${R.up}</b>・跌 <b class="num down">${R.down}</b>${R.flat ? `・平 <b class="num">${R.flat}</b>` : ''}${R.wait ? `・沒成交 <b class="num">${R.wait}</b>` : ''}</span></div>
        ${cmp}
      </div>
      <ol class="dr-list">${rows}</ol>
      <p class="small muted dr-note">每一檔加起來就是${isToday ? '今天' : '那天'}的損益。漲跌照證交所的參考價算：除息那天股價扣掉的配息還是你的、不算虧損（配息約一個月後入帳）；${isToday ? '今天還沒成交（或停止交易）' : '那天沒有成交'}的那一檔算 0；${isToday ? '今天' : '那天'}的買賣用成交價和現價的差算。「持股」的百分比不含現金。</p>
    </section>`;
}
export function bindDayReport(v) {
  const card = $('.dr-card', v);
  if (!card) return;
  $$('[data-code]', card).forEach((b) => b.addEventListener('click', () => import('./sheet.js').then((m) => m.openDetail(b.dataset.code))));
  // 每天第一次打開才跑一次：數字從 0 數上來、長條從中間長出來
  const key = `${today()}|${book.lots.length}`;
  if (!anim() || settings.privacy || S.drAnim === key) return;
  S.drAnim = key;
  card.classList.add('grow');
  const sum = $('#dr-sum', card);
  const to = Number(sum && sum.dataset.v);
  if (sum && isNum(to)) {
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 900);
      sum.textContent = money(to * (1 - Math.pow(1 - k, 3)), true);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  FX.sfx('scan');
}

// ================================================================== 資金輪動（雷達）
const CATS_ORDER = ['broad', 'div', 'theme', 'overseas', 'bond', 'active', 'lev', 'inv', 'fut'];
/** 九大類今天（盤中即時）、近 5 日、近 20 日的平均漲跌、漲跌家數、成交值熱度 */
export function rotationHTML() {
  if (!S.summary) return '';
  const R = rotation(S.summary.etfs, quote, S.summary.asof);
  const cats = R.cats.filter((c) => CATS_ORDER.includes(c.k));
  if (!cats.length || !R.date) return '';
  const qs = S.summary.etfs.map(quote);
  const when = whenOf(qs, R.date);
  const anyLive = qs.some((q) => q && q.live && q.date === R.date);
  const hasV20 = S.summary.etfs.some((x) => isNum(x.v20));
  const max = Math.max(1, ...cats.map((c) => Math.abs(c.day || 0)));
  const pick = S.all.cat;
  const r = (x) => (isNum(x) ? `<b class="num ${dirCls(x)}">${fmt.r(x)}</b>` : '<b class="num muted">—</b>');
  const rows = cats.map((c, i) => {
    const w = isNum(c.day) ? Math.round(Math.abs(c.day) / max * 1000) / 10 : 0;
    const heat = isNum(c.heat) ? `<span class="rot-heat${c.heat >= 1.5 ? ' hi' : c.heat <= 0.67 ? ' lo' : ''}" title="${fmt.d(R.asof)} 的成交值是之前 20 個有成交日子平均的幾倍">成交值 <b class="num">${c.heat.toFixed(1)}</b> 倍</span>` : '';
    return `<button class="rot-row" data-cat="${c.k}" aria-pressed="${pick === c.k}" style="--i:${i}">
      <span class="rot-nm"><b>${esc(catName(c.k))}</b><small>${c.nDay}／${c.n} 檔・漲 <b class="num up">${c.up}</b> 跌 <b class="num down">${c.down}</b></small></span>
      <span class="rot-bar" aria-hidden="true"><i class="${(c.day || 0) >= 0 ? 'pos' : 'neg'}" style="--w:${w}%"></i></span>
      <span class="rot-day num ${dirCls(c.day)}">${isNum(c.day) ? fmt.r(c.day / 100, 2) : '—'}</span>
      <span class="rot-sub"><span>5 日 ${r(c.r5)}</span><span>20 日 ${r(c.r20)}</span>${heat}</span>
    </button>`;
  }).join('');
  const has = cats.filter((c) => isNum(c.day));
  const best = has[0], worst = has.length > 1 ? has[has.length - 1] : null;
  const one = (c) => `<b>${esc(catName(c.k))}</b> <b class="num ${dirCls(c.day)}">${fmt.r(c.day / 100, 2)}</b>`;
  const sum = best ? `<span class="rot-sum">最強 ${one(best)}${worst ? `・最弱 ${one(worst)}` : ''}</span>` : '';
  const open = typeof settings.rotOpen === 'boolean' ? settings.rotOpen : (typeof window !== 'undefined' && window.innerWidth >= 1100);
  return `<details class="panel rot" id="rot"${open ? ' open' : ''}>
      <summary><span class="rot-t" data-term="rot">資金輪動</span><span class="aside">${esc(when)}・九大類</span>${sum}</summary>
      <div class="rot-list">${rows}</div>
      <p class="small muted rot-note">每一類＝那一類 ETF 照${hasV20 ? '平均成交值（之前 20 個有成交的日子）' : `${fmt.d(R.asof)} 的成交值`}加權的平均（錢多的份量重）。${R.date === today() ? '今天' : '那天'}的漲跌${anyLive ? '盤中用即時價、' : ''}只算${R.date === today() ? '今天' : '那天'}有成交的；5 日、20 日＝最近 5、20 個有成交的交易日，用還原權息、分割的收盤價算到 ${fmt.d(R.asof)}${hasV20 ? `；成交值倍數＝${fmt.d(R.asof)} 的成交值 ÷ 之前 20 個有成交日子的平均` : ''}。點一類，下面只看那一類。</p>
    </details>`;
}
/** onPick(k)：點了某一類（再點一次取消） */
export function bindRotation(v, onPick) {
  const box = $('#rot', v);
  if (!box) return;
  // 一打開就是展開的 <details> 也會發一次 toggle：值沒變就不存
  box.addEventListener('toggle', () => { if (settings.rotOpen !== box.open) { settings.rotOpen = box.open; saveSettings(); } });
  $$('.rot-row', box).forEach((b) => b.addEventListener('click', () => {
    const k = S.all.cat === b.dataset.cat ? '*' : b.dataset.cat;
    $$('.rot-row', box).forEach((z) => z.setAttribute('aria-pressed', z.dataset.cat === k));
    FX.cue('tap');
    onPick(k);
  }));
  if (anim() && !S.rotAnim) { S.rotAnim = true; box.classList.add('grow'); }
}

// ================================================================== 同類排行（單檔頁）
const WORD = { r1y: '高', vol: '高', mdd: '深', y: '高', aum: '大', hd: '多', v20: '多', pr: '高' };
const LOG = new Set(['aum', 'hd', 'v20']);   // 差好幾個數量級的用對數位置
const TERM = { r1y: 'r1y', vol: 'vol', mdd: 'mdd', y: 'y', aum: 'aum', hd: 'hd', v20: 'val', pr: 'prem' };
function valText(k, v) {
  if (!isNum(v)) return '—';
  switch (k) {
    case 'r1y': return fmt.r(v);
    case 'vol': return `${(v * 100).toFixed(1)}%`;
    case 'mdd': return `−${(v * 100).toFixed(1)}%`;
    case 'y': return `${v.toFixed(2)}%`;
    case 'pr': return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`;
    case 'hd': return `${fmt.n(v)} 人`;
    default: return `${fmt.big(v)}元`;
  }
}
const posOf = (k, v, lo, hi) => {
  const f = (x) => (LOG.has(k) ? Math.log10(Math.max(x, 1)) : x);
  const a = f(lo), b = f(hi);
  return b > a ? Math.max(0, Math.min(100, ((f(v) - a) / (b - a)) * 100)) : 50;
};
export function peerHTML(row) {
  if (!row || !S.summary) return '';
  const res = peerRank(S.summary.etfs, row.c);
  const n = S.summary.etfs.filter((r) => r.k === row.k).length;
  if (!res || n < 3) return '';
  // 近一年報酬、波動、回檔是空的：上市不到一年，或近一年有成交的日子不到 250 天（冷門）
  const listed = isNum(row.since) && isNum(S.summary.asof) ? (Date.UTC(+String(S.summary.asof).slice(0, 4), +String(S.summary.asof).slice(4, 6) - 1, +String(S.summary.asof).slice(6, 8)) - Date.UTC(+String(row.since).slice(0, 4), +String(row.since).slice(4, 6) - 1, +String(row.since).slice(6, 8))) / 864e5 : null;
  const why1y = isNum(listed) && listed < 365 ? '上市未滿一年' : '近一年有成交的日子不到 250 天';
  // 同類沒有任何一檔有這個數字的那一項（例如後台剛加的欄位還沒算出來）整列不顯示
  const items = res.filter((m) => m.n > 0).map((m, i) => {
    const lo = m.vals.length ? m.vals[m.vals.length - 1] : null;
    const hi = m.vals.length ? m.vals[0] : null;
    const ticks = m.vals.length >= 2 ? m.vals.map((x) => `<i style="left:${posOf(m.k, x, lo, hi).toFixed(1)}%"></i>`).join('') : '';
    const me = isNum(m.v) && m.vals.length >= 2 ? `<b class="pr-me" style="--x:${posOf(m.k, m.v, lo, hi).toFixed(1)}%"></b>` : '';
    const med = isNum(m.med) && m.vals.length >= 2 ? `<u class="pr-med" style="left:${posOf(m.k, m.med, lo, hi).toFixed(1)}%" title="中位數 ${valText(m.k, m.med)}"></u>` : '';
    const why = !isNum(m.v) ? (['r1y', 'vol', 'mdd'].includes(m.k) ? why1y : '沒有這個數字') : m.rank == null ? `同類只有 ${m.n} 檔有數字` : '';
    return `<div class="pr-row" style="--i:${i}">
      <span class="pr-k" data-term="${TERM[m.k]}">${esc(m.t)}</span>
      <span class="pr-v num ${m.k === 'r1y' ? dirCls(m.v) : ''}">${valText(m.k, m.v)}</span>
      <span class="pr-rank">${m.rank != null ? `第 <b class="num">${m.rank}</b> ${WORD[m.k]}・共 <span class="num">${m.n}</span> 檔` : esc(why)}</span>
      <span class="pr-strip" aria-hidden="true"><span class="pr-ticks">${ticks}</span>${med}${me}</span>
      <span class="pr-ends"><small>${valText(m.k, lo)}</small><small>同類中位數 ${valText(m.k, m.med)}</small><small>${valText(m.k, hi)}</small></span>
    </div>`;
  }).join('');
  // 菱形滑進來的動態：每一檔每次打開 App 只跑一次（收盤資料換新、單檔頁重畫時不重跑）
  const seen = S.peerAnim || (S.peerAnim = new Set());
  const grow = anim() && !seen.has(row.c);
  seen.add(row.c);
  return `<div class="sec-h"><h2 data-term="peer">同類排行</h2><span class="aside">和${esc(catName(row.k))} ${n} 檔比</span></div>
    <section class="panel peer${grow ? ' grow' : ''}" aria-label="同類排行">
      ${items}
      <p class="small muted pr-note">同類＝冷眼的分類（${esc(catName(row.k))}）。近一年＝最近 250 個有成交的交易日，還原權息與分割；殖利率＝近 12 個月配息 ÷ ${fmt.d(S.summary.asof)} 收盤價；溢價是 ${fmt.d(S.summary.asof)} 收盤時、投信預估淨值算的；成交值是 ${fmt.d(S.summary.asof)} 之前 20 個有成交日子的平均。亮點是這一檔、短線是同類中位數。名次只是位置、不是好壞：波動高、回檔深代表起伏大，規模、成交值大代表比較好買賣。</p>
    </section>`;
}
