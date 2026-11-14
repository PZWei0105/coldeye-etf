/* 冷眼 — 投入總覽（部位分頁，「我的部位」下面）：你投入了多少（對照國泰 App 的「總成本」）、市值、
   現在全部賣掉扣掉手續費與證交稅之後實拿多少、損益；和國泰 App 的數字怎麼對（打進國泰的總成本，冷眼幫你找差在哪）。
   計算都是 calc.js 的純函式（investView、costGap）；定期定額卡的每一檔、每個月扣款在 dca.js（同一個 investView）。 */
import { $, $$, esc, isNum, S, settings, fmt, money, dirCls, book, today, splitsOf, reduceMotion, isPaper, quoteWhen } from './core.js';
import { investView, costGap, isDcaLot } from './calc.js';
import { openPending } from './dca.js';
import * as FX from './fx.js';

const anim = () => settings.fx !== false && !reduceMotion();
/** 這一本（真實部位或模擬倉）的投入總覽 */
export const investNow = (P = S.P) => (P ? investView(P, book.lots, splitsOf, settings.fee, today()) : null);

function whenOf(P) {
  const qs = (P.holdings || []).map((x) => x.q).filter(Boolean);
  const d = Math.max(0, ...qs.map((q) => q.date || 0));
  const live = qs.filter((q) => q.live && q.date === d).sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')));
  return live.length ? quoteWhen(live[0]) : d ? `${fmt.d(d)} 收盤` : '';
}
const feeText = () => {
  const disc = settings.fee && isNum(settings.fee.disc) ? settings.fee.disc : 1;
  return `${disc < 1 ? `${(disc * 10).toFixed(1).replace(/\.0$/, '')} 折` : '原價 0.1425%'}，整股、零股分開算`;
};

export function investHTML(P) {
  if (!P || !(P.holdings || []).length) return '';
  const V = investNow(P);
  if (!V) return '';
  const real = !isPaper();
  const scale = Math.max(V.cost, V.mv, V.sell.net, 1);
  const w = (v) => `${Math.max(0, Math.min(100, (v / scale) * 100)).toFixed(1)}%`;
  // 賣過的話，兩邊的成本扣法不同（定期定額照國泰先賣現股），加起來不一定剛好等於上面的數字：不拆
  const mix = V.sold ? '' : V.dca && V.other.cost > 0.5
    ? `：定期定額 <b class="num">${money(V.dca.cost)}</b>＋自己買的 <b class="num">${money(V.other.cost)}</b>`
    : V.dca ? `，全部是定期定額買的（記了 <b class="num">${V.dca.n}</b> 期）` : '';
  const bar = (k, v, cls, i) => `<div class="iv-row ${cls}" style="--i:${i}"><span class="iv-k">${k}</span><span class="iv-track" aria-hidden="true"><i style="--w:${w(v)}"></i></span><b class="num">${money(v)}</b></div>`;
  const withDiv = V.real + V.div;
  const pend = V.dca && V.dca.est ? `<p class="iv-pend">定期定額還有 <b class="num">${V.dca.est}</b> 期是冷眼用收盤價<b>估</b>的，核對之後「你投入了」才會和國泰一樣。<button type="button" class="link" data-iv="pend">現在核對</button></p>` : '';
  return `<div class="sec-h"><h2 data-term="invest">投入總覽</h2><span class="aside">${esc(whenOf(P))}${real ? '・對照國泰 App 的總成本' : ''}</span></div>
    <section class="panel iv-card${anim() && S.ivAnim !== today() ? ' grow' : ''}" aria-label="投入總覽">
      <div class="iv-head">
        <div class="iv-in"><span class="k" data-term="invest">你投入了</span><b class="num">${money(V.cost)}</b></div>
        <div class="iv-gain"><span class="k" data-term="netsell">損益<small>（賣掉實拿 − 投入）</small></span><b class="num ${dirCls(V.real)}">${money(V.real, true)}</b><small class="num ${dirCls(V.real)}">${fmt.r(V.realPct, 2)}</small></div>
        <p class="iv-mix">還在手上的股票當初花的錢${mix}</p>
      </div>
      <div class="iv-bars" role="img" aria-label="投入、市值、全部賣掉實拿的比較">
        ${bar('你投入了', V.cost, 'in', 0)}${bar('現在市值', V.mv, 'mv', 1)}${bar('賣掉實拿', V.sell.net, 'net', 2)}
      </div>
      <ol class="iv-sell" aria-label="現在全部賣掉">
        <li><span>現在市值</span><b class="num">${money(V.mv)}</b></li>
        <li><span>− 賣出手續費<small>${esc(feeText())}</small></span><b class="num">${V.sell.fee ? '−' : ''}${money(V.sell.fee)}</b></li>
        <li><span>− 證交稅<small>ETF 0.1%（被動式債券 ETF 2026/12/31 前免）</small></span><b class="num">${V.sell.tax ? '−' : ''}${money(V.sell.tax)}</b></li>
        <li class="eq"><span data-term="netsell">＝ 全部賣掉實拿</span><b class="num">${money(V.sell.net)}</b></li>
      </ol>
      <div class="iv-more">
        <span>${real ? '國泰的算法' : '帳面'}（市值 − 投入，還沒扣賣出的手續費、證交稅）<b class="num ${dirCls(V.paper)}">${money(V.paper, true)}</b><small class="num ${dirCls(V.paper)}">${fmt.r(V.paperPct, 2)}</small></span>
        <span>已領配息 <b class="num">${money(V.div)}</b>・含息損益 <b class="num ${dirCls(withDiv)}">${money(withDiv, true)}</b></span>
        ${V.sold ? `<span>以前賣掉過：總共買進花了 <b class="num">${money(V.paidAll)}</b>、賣掉拿回 <b class="num">${money(V.back)}</b>（已實現損益 <b class="num ${dirCls(V.realized)}">${money(V.realized, true)}</b>）。上面的「你投入了」只算還在手上的。</span>` : ''}
      </div>
      ${pend}
      ${V.missing.length ? `<p class="small muted">${V.missing.map(esc).join('、')} 現在沒有價格，市值和實拿沒有算它（投入有算）。</p>` : ''}
      ${real ? cmpHTML(V) : ''}
    </section>`;
}

function cmpHTML(V) {
  return `<details class="iv-cmp" id="iv-cmp"><summary>和國泰 App 的數字怎麼對</summary>
      <dl class="iv-map">
        <div><dt>國泰「投資總現值」</dt><dd>＝這裡的「現在市值」<b class="num">${money(V.mv)}</b></dd></div>
        <div><dt>國泰「總成本」</dt><dd>＝這裡的「你投入了」<b class="num">${money(V.cost)}</b>：現在還在帳上的那些股票當初花的錢。沒賣過的話，大致就是這些年扣款的總和；<b>賣掉的那部分不算，領到的配息也不算</b>。國泰的定期定額庫存用成交均價算、每期 1 元的買進手續費另外算，冷眼有算進去，所以會差幾塊錢。</dd></div>
        <div><dt>國泰「不含息參考報酬」</dt><dd>＝市值 − 總成本 <b class="num">${money(V.paper, true)}</b>，還沒扣賣出的手續費和證交稅；冷眼的「損益」是扣掉之後、真的賣掉會拿到的。</dd></div>
      </dl>
      <label class="field"><span class="lab">把國泰 App 的「總成本」打進來，冷眼幫你對</span><input class="input num" id="iv-cathay" inputmode="numeric" placeholder="例如 188924" autocomplete="off"></label>
      <div class="iv-res" id="iv-res" aria-live="polite"></div>
    </details>`;
}

/** 最近兩個交易日成交的定期定額（國泰可能還沒算進總成本） */
function recentDca() {
  const ds = [...new Set(book.lots.filter((l) => isDcaLot(l) && Number.isInteger(l.d)).map((l) => l.d))].sort((a, b) => b - a).slice(0, 2);
  return ds.sort((a, b) => a - b).map((d) => ({ d, amt: book.lots.filter((l) => isDcaLot(l) && l.d === d).reduce((a, l) => a + l.sh * l.px + (l.fee || 0), 0) }));
}

export function bindInvest(v) {
  const card = $('.iv-card', v);
  if (!card) return;
  // 核對完 dca.js 會發 'book'，部位頁自己會重畫
  $$('[data-iv="pend"]', card).forEach((b) => b.addEventListener('click', () => openPending()));
  if (card.classList.contains('grow')) { S.ivAnim = today(); FX.sfx('scan'); }
  const inp = $('#iv-cathay', card);
  const res = $('#iv-res', card);
  if (!inp || !res) return;
  const show = () => {
    const theirs = Number(String(inp.value).replace(/[,\s，$＄元]/g, ''));
    if (!(theirs > 0)) { res.innerHTML = ''; return; }
    const V = investNow();
    if (!V) return;
    // 還在手上的定期定額那幾期的買進手續費（國泰的定期定額庫存不含這幾塊錢）
    const feeGap = book.lots.filter((l) => isDcaLot(l) && l.side !== 'sell').reduce((a, l) => a + (l.fee || 0), 0) * (V.dca && V.dca.paid > 0 ? Math.min(1, V.dca.cost / V.dca.paid) : 0);
    const g = costGap(V.cost, theirs, { feeGap, est: V.dca ? V.dca.est : 0, recent: recentDca() });
    if (!g) { res.innerHTML = ''; return; }
    const est = g.est ? `<li>還有 <b class="num">${g.est}</b> 期定期定額是冷眼用收盤價估的：照國泰「定期投資」的買進紀錄核對完，差距才是真的。<button type="button" class="link" data-iv="pend">現在核對</button></li>` : '';
    let html;
    if (g.kind === 'ok') {
      html = `<p class="iv-ok"><b>對得上。</b>冷眼和國泰只差 <b class="num">${money(Math.abs(g.diff))}</b> 元（四捨五入、手續費算法的差別）。你現在投入的就是 <b class="num">${money(V.cost)}</b> 元。</p>${est ? `<ul>${est}</ul>` : ''}`;
    } else if (g.kind === 'more') {
      html = `<p class="iv-off">冷眼記的比國泰<b>多 <span class="num">${money(g.diff)}</span> 元</b>。可能的原因：</p><ul>
          ${g.near ? `<li>多出來的剛好差不多是 <b class="num">${fmt.d(g.near.d)}</b> ${g.near.all ? '最近這幾期' : '那一期'}（<span class="num">${money(g.near.amt)}</span> 元）：可能還在交割（成交後第 2 個營業日交割），國泰還沒算進總成本。過一兩天再對一次。</li>` : ''}
          ${est}
          <li>某一期國泰其實沒扣到（餘額不足扣款失敗，國泰不會補扣）：核對時按那一期的「這期沒扣到」。</li>
          <li>同一筆記了兩次（例如自己記了一筆，冷眼又自動記了一筆）：到「核對」看有沒有要你確認的。</li>
        </ul>`;
    } else {
      html = `<p class="iv-off">冷眼記的比國泰<b>少 <span class="num">${money(-g.diff)}</span> 元</b>。可能的原因：</p><ul>
          <li>有幾期定期定額沒記到：例如計畫的「從哪一天開始記」比你第一次扣款晚。到下面「定期定額」點那個計畫，把開始日期往前改，冷眼會補記。</li>
          <li>有自己買的沒記到：在「部位」按「記一筆」補上。</li>
          ${est}
        </ul>`;
    }
    res.innerHTML = html;
    $$('[data-iv="pend"]', res).forEach((b) => b.addEventListener('click', () => openPending()));
  };
  inp.addEventListener('input', show);
  const box = $('#iv-cmp', card);
  if (box) box.addEventListener('toggle', () => { if (box.open) FX.cue('tap'); });
}
