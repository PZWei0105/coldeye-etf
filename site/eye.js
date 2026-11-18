/* 冷眼 — 開機「睜眼」（2026/11/18，PZ：「一開啟就：哇～」）
   每天第一次打開：先是一條閉著的冰川藍細縫（待命），按「啟動」冷眼睜開——虹膜刻度環轉起來、掃描光掃一圈，
   每一個資料來源連線成功時，環上那個名字亮起來、一顆光點射進瞳孔（瞳孔就是「冷眼」的標誌），最後揭曉今天的戰況。
   全部用 canvas 2D 畫（不用濾鏡、不用圖片），只在開機畫面存在的那幾秒畫；減少動態效果、關掉畫面特效時不畫（只剩原本的開機畫面）。
   這個檔案不讀寫任何資料：要顯示的數字由 app.js 傳進來。 */

export const EYE_STYLES = [['eye', '睜眼'], ['classic', '經典']];
const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const easeOut = (k) => 1 - Math.pow(1 - clamp(k, 0, 1), 3);
const easeBack = (k) => { k = clamp(k, 0, 1); const c = 1.4; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };

/**
 * 在開機畫面（boot：#boot 元素）裡放一張 canvas，回傳控制器 { open(), lock(i, warn), stop() }。
 * labels：環上的名字（和開機清單一行一行對應）。anchor()：瞳孔要對準的元素（冷眼的標誌）。
 */
export function eyeStart(boot, { labels = [], anchor = () => null, bus = () => null, log = () => null } = {}) {
  const logEl = log;
  const cv = document.createElement('canvas');
  cv.className = 'bt-eye';
  cv.setAttribute('aria-hidden', 'true');
  boot.prepend(cv);
  const g = cv.getContext('2d');
  if (!g) { cv.remove(); return null; }
  const css = getComputedStyle(boot);
  const col = (v, d) => (css.getPropertyValue(v) || '').trim() || d;
  const C = { ice: col('--glacier', '#4ee0ff'), me: col('--aurora', '#b59cff'), amber: col('--amber', '#ffb02e'), void: col('--void', '#02060c'), frost: col('--frost', '#e3f1ff') };
  const dark = !/^#(?:d|e|f)/i.test(C.void);
  let W = 0, H = 0, dpr = 1;
  const size = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = boot.clientWidth; H = boot.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  };
  size();
  const onResize = () => size();
  window.addEventListener('resize', onResize);

  const t0 = performance.now();
  let openAt = null, raf = 0, stopped = false, lastDraw = 0;
  const lit = labels.map(() => 0);         // 每個名字亮起來的時間（0＝還沒）
  const warn = labels.map(() => false);
  const shots = [];                         // 射向瞳孔的光點 { i, at }
  let pulseAt = 0;

  const center = () => {
    const el = anchor();
    const br = boot.getBoundingClientRect();
    if (el) { const r = el.getBoundingClientRect(); if (r.width) return [r.left - br.left + r.width / 2, r.top - br.top + r.height / 2]; }
    return [W / 2, H * 0.32];
  };

  function frame(now) {
    if (stopped) return;
    raf = requestAnimationFrame(frame);
    const sleeping = openAt == null;
    if (sleeping && now - lastDraw < 33) return;   // 待命時 30fps 就夠
    lastDraw = now;
    const t = (now - t0) / 1000;
    const [cx, cy] = center();
    const R = clamp(Math.min(W, H) * 0.3, 112, 190);
    const EW = R * 1.62, EH = R * 0.66;
    // 眼睛張開的程度：待命時一條會呼吸的細縫；啟動後 1.1 秒張開（稍微過頭再回來）
    const ko = sleeping ? 0 : (now - openAt) / 1100;
    const a = sleeping ? 0.035 + 0.02 * Math.sin(t * 1.7) : 0.035 + 0.965 * easeBack(ko);
    const irisK = sleeping ? 0 : easeOut((now - openAt - 250) / 900);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    // 外圈的光暈與兩圈雷達線（很淡）
    const halo = g.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 2.2);
    halo.addColorStop(0, hexA(C.ice, sleeping ? 0.07 : 0.16 * Math.max(0.35, irisK)));
    halo.addColorStop(1, hexA(C.ice, 0));
    g.fillStyle = halo;
    g.fillRect(0, 0, W, H);
    g.lineWidth = 1;
    for (const k of [1.35, 1.9]) {
      g.strokeStyle = hexA(C.ice, (sleeping ? 0.07 : 0.12) / k);
      g.beginPath(); g.arc(cx, cy, R * k, 0, TAU); g.stroke();
    }

    // 眼睛的輪廓（上下兩條弧）
    const lid = () => {
      g.beginPath();
      g.moveTo(cx - EW, cy);
      g.quadraticCurveTo(cx, cy - EH * 2 * a, cx + EW, cy);
      g.quadraticCurveTo(cx, cy + EH * 2 * a, cx - EW, cy);
      g.closePath();
    };
    g.save();
    lid();
    g.clip();
    // 眼白：深色的鏡面
    const lens = g.createRadialGradient(cx, cy, 0, cx, cy, EW);
    lens.addColorStop(0, hexA(C.ice, dark ? 0.16 : 0.1));
    lens.addColorStop(1, hexA(C.ice, 0.02));
    g.fillStyle = lens;
    g.fillRect(cx - EW, cy - EH * 2, EW * 2, EH * 4);
    if (irisK > 0) drawIris(cx, cy, R, irisK, now, t);
    g.restore();
    // 輪廓線（待命時是一條會呼吸的細縫）
    lid();
    g.lineWidth = sleeping ? 2 : 2.2;
    g.strokeStyle = hexA(C.ice, sleeping ? 0.55 + 0.25 * Math.sin(t * 1.7) : 0.85);
    g.stroke();
    // 眼角的兩道光
    for (const s of [-1, 1]) {
      const x = cx + s * EW;
      const gl = g.createLinearGradient(x, cy, x + s * R * 0.9, cy);
      gl.addColorStop(0, hexA(C.ice, sleeping ? 0.5 : 0.7));
      gl.addColorStop(1, hexA(C.ice, 0));
      g.strokeStyle = gl; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(x, cy); g.lineTo(x + s * R * 0.9, cy); g.stroke();
    }
    // 環上的名字與射向瞳孔的光點（在眼睛外面也看得到）
    if (!sleeping) drawLabels(cx, cy, R, now, irisK);
  }

  function drawIris(cx, cy, R, k, now, t) {
    const sc = 0.7 + 0.3 * k;
    // 刻度環：72 格，每 6 格一條長的
    g.save();
    g.translate(cx, cy);
    g.rotate(t * 0.08);
    for (let i = 0; i < 72; i++) {
      const ang = (i / 72) * TAU;
      const long = i % 6 === 0;
      const r1 = R * 0.95 * sc, r2 = r1 - (long ? R * 0.1 : R * 0.045);
      g.strokeStyle = hexA(C.ice, (long ? 0.85 : 0.45) * k);
      g.lineWidth = long ? 1.6 : 1;
      g.beginPath(); g.moveTo(Math.cos(ang) * r1, Math.sin(ang) * r1); g.lineTo(Math.cos(ang) * r2, Math.sin(ang) * r2); g.stroke();
    }
    g.restore();
    // 虛線環（反轉）、三段弧（快轉）
    g.save(); g.translate(cx, cy);
    g.rotate(-t * 0.35);
    g.setLineDash([R * 0.06, R * 0.04]);
    g.strokeStyle = hexA(C.ice, 0.55 * k); g.lineWidth = 1.4;
    g.beginPath(); g.arc(0, 0, R * 0.76 * sc, 0, TAU); g.stroke();
    g.setLineDash([]);
    g.rotate(t * 1.1);
    g.strokeStyle = hexA(C.ice, 0.9 * k); g.lineWidth = 2.4;
    for (let s = 0; s < 3; s++) { g.beginPath(); g.arc(0, 0, R * 0.62 * sc, s * TAU / 3, s * TAU / 3 + 0.9); g.stroke(); }
    g.restore();
    // 掃描光：一道扇形，2.4 秒一圈
    const ang = ((now - (openAt || now)) / 2400) * TAU - Math.PI / 2;
    const sw = g.createRadialGradient(cx, cy, R * 0.4, cx, cy, R * 1.05);
    sw.addColorStop(0, hexA(C.ice, 0.0));
    sw.addColorStop(1, hexA(C.ice, 0.28 * k));
    g.fillStyle = sw;
    g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R * 1.05, ang - 0.55, ang); g.closePath(); g.fill();
    g.strokeStyle = hexA(C.ice, 0.75 * k); g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(cx + Math.cos(ang) * R * 0.45, cy + Math.sin(ang) * R * 0.45); g.lineTo(cx + Math.cos(ang) * R * 1.05, cy + Math.sin(ang) * R * 1.05); g.stroke();
    // 瞳孔外緣：光點打進來時亮一下
    const pk = pulseAt ? Math.max(0, 1 - (now - pulseAt) / 420) : 0;
    g.strokeStyle = hexA(C.ice, (0.6 + 0.4 * pk) * k);
    g.lineWidth = 2 + pk * 3;
    g.beginPath(); g.arc(cx, cy, R * 0.44 * sc + pk * 4, 0, TAU); g.stroke();
  }

  // 名字排成兩排「資料匯流排」，放在眼睛和開機清單之間（窄螢幕也不會跑出畫面）
  function labelPos(i, cx, cy, R) {
    const n = Math.max(1, labels.length), per = Math.ceil(n / 2);
    const row = Math.floor(i / per), col = i % per;
    const br = boot.getBoundingClientRect();
    const box = (bus() || boot).getBoundingClientRect();
    const left = box.left - br.left + 10, width = Math.max(120, box.width - 20);
    const x = left + width * ((col + 0.5) / per);
    const log = logEl();
    const lr = log ? log.getBoundingClientRect() : null;
    const a = anchor(); const ar = a ? a.getBoundingClientRect() : null;
    // 手機橫拿：開機清單在標誌右邊（左右兩欄），名字排在眼睛正下方、只占左邊那一欄
    if (lr && ar && lr.width && lr.left > ar.right) {
      const colW = 2 * (cx - (box.left - br.left));
      const lw = Math.max(120, colW - 20), lx = box.left - br.left + 10 + lw * ((col + 0.5) / per);
      return [lx, Math.min(br.height - 44, cy + R + 10) + row * 20];
    }
    const yTop = lr && lr.height ? lr.top - br.top - 40 : cy + R * 0.66 + 22;
    return [x, Math.max(cy + R * 0.5, yTop) + row * 20];
  }
  function drawLabels(cx, cy, R, now, k) {
    g.font = `600 ${Math.round(clamp(R * 0.085, 10, 13))}px Oxanium, "Noto Sans TC", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    labels.forEach((name, i) => {
      const [x, y] = labelPos(i, cx, cy, R);
      const on = lit[i] ? Math.min(1, (now - lit[i]) / 220) : 0;
      const c = warn[i] ? C.amber : C.ice;
      g.fillStyle = hexA(c, (0.18 + 0.82 * on) * k);
      g.fillText(name, x, y);
      if (on > 0) {
        g.strokeStyle = hexA(c, 0.5 * on * k); g.lineWidth = 1;
        const w = g.measureText(name).width / 2 + 6;
        g.beginPath(); g.moveTo(x - w, y + 9); g.lineTo(x + w, y + 9); g.stroke();
      }
    });
    // 光點：從名字飛進瞳孔（380ms），到了瞳孔亮一下
    for (let s = shots.length - 1; s >= 0; s--) {
      const sh = shots[s];
      const p = (now - sh.at) / 380;
      if (p >= 1) { shots.splice(s, 1); pulseAt = now; continue; }
      const [x0, y0] = labelPos(sh.i, cx, cy, R);
      const e = easeOut(p);
      const x = x0 + (cx - x0) * e, y = y0 + (cy - y0) * e;
      const c = warn[sh.i] ? C.amber : C.ice;
      const tail = g.createLinearGradient(x0 + (cx - x0) * Math.max(0, e - 0.25), y0 + (cy - y0) * Math.max(0, e - 0.25), x, y);
      tail.addColorStop(0, hexA(c, 0)); tail.addColorStop(1, hexA(c, 0.9));
      g.strokeStyle = tail; g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(x0 + (cx - x0) * Math.max(0, e - 0.25), y0 + (cy - y0) * Math.max(0, e - 0.25)); g.lineTo(x, y); g.stroke();
      g.fillStyle = hexA(C.frost, 0.95);
      g.beginPath(); g.arc(x, y, 2.6, 0, TAU); g.fill();
    }
  }

  raf = requestAnimationFrame(frame);
  return {
    open() { if (openAt == null) openAt = performance.now(); },
    lock(i, isWarn = false) { if (i < 0 || i >= labels.length) return; lit[i] = performance.now(); warn[i] = !!isWarn; shots.push({ i, at: performance.now() }); },
    stop() { stopped = true; cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); },
  };
}

/** #rrggbb（或 rgb()）加透明度 */
function hexA(c, a) {
  a = clamp(a, 0, 1);
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) { const n = parseInt(m[1], 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`; }
  const r = /rgba?\(([^)]+)\)/.exec(c);
  if (r) { const [x, y, z] = r[1].split(',').map((v) => parseFloat(v)); return `rgba(${x},${y},${z},${a.toFixed(3)})`; }
  return c;
}

/**
 * 揭曉的戰況板（取代原本那一行「歡迎回來」）。全部是傳進來的真實數字；沒有的那一格不放。
 * o：{ name, tx: { px, pc, when }, day: { amt, pct, masked }, temp: { level, n }, asof, count }
 */
export function eyeSitHTML(o, esc, fmt) {
  const cls = (x) => (typeof x === 'number' && isFinite(x) ? (x > 0 ? 'up' : x < 0 ? 'down' : 'flat') : 'flat');
  const pc = (x) => (typeof x === 'number' && isFinite(x) ? (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(2) + '%' : '—');
  const chips = [];
  if (o.day) chips.push(`<span class="bs-c me"><small>今日損益</small><b class="num ${cls(o.day.pct)}">${o.day.masked ? pc(o.day.pct) : esc(o.day.amt)}</b>${o.day.masked ? '' : `<em class="num ${cls(o.day.pct)}">${pc(o.day.pct)}</em>`}</span>`);
  if (o.temp) chips.push(`<span class="bs-c ${o.temp.level === '雨' ? 'rain' : o.temp.level === '陰' ? 'cloud' : 'sun'}"><small>市場溫度</small><b>${esc(o.temp.level)}</b><em class="num">${o.temp.n}／7 警訊</em></span>`);
  if (o.asof) chips.push(`<span class="bs-c"><small>官方收盤</small><b class="num">${esc(fmt.d(o.asof))}</b><em class="num">${o.count} 檔 ETF</em></span>`);
  return `<span class="bs-hello">歡迎回來，${esc(o.name)}</span>
    ${o.tx ? `<span class="bs-tx"><small>加權指數・${esc(o.tx.when)}</small><b class="num" data-tx="${o.tx.px}">${fmt.n(o.tx.px, 0)}</b><em class="num ${cls(o.tx.pc)}">${pc(o.tx.pc)}</em></span>` : ''}
    ${chips.length ? `<span class="bs-row">${chips.join('')}</span>` : ''}`;
}
