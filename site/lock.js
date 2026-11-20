/* 冷眼 — 上鎖（2026/11/21，痞子葳：「設定一個跟電子書一樣的密碼，讓冷眼……有輸入密碼開啟的功能」）
   打開冷眼要先輸入密語；密語跟《下回分解》書房同一組（備用碼也一樣）。

   為什麼這樣做（看完再改）：
   - 持股、交易、日記、定期定額計畫本來就只存在這支手機的 localStorage，從來不上傳（見 CLAUDE.md 原則）；
     網站上只有證交所等官方的公開資料。所以這把鎖守的是「別人拿到你的手機、或在你的電腦上打開冷眼」。
   - 驗密語的方法跟書房一字不差（PZ-Games 的 _build/apps/next-chapter/src/crypt.js、tools/pzcrypt.py）：
     書房的 keyring（公開檔）複製一份放在下面的 RING；打得開裡面包著的總鑰匙＝密語對。開出來的鑰匙馬上抹掉、不存。
     **冷眼永遠獨立**：這裡是冷眼自己的一份，執行時不去讀書房的任何檔案（書房改版、搬家都不會讓冷眼打不開，離線也能開）。
     純邏輯（LockCore）複製自《PZ App 引擎》門鎖 1.0.0（PZ-Games 的 _build/appkit/src/20_lock.js），之後兩邊各自維護。
   - 書房換了密語（pz-novels 的 shelf.py 換密語、keyring.json 換新）：照新的 keyring.json 改下面的 RING，
     記住的裝置會因為指紋不同自動要求重新輸入。痞子葳兩個都忘了：照他說的新密語用 pzcrypt.make_keyring 做一份新的 RING。
   - 這台裝置的紀錄存在 localStorage 的 `coldeye-lock`（**不是** `coldeye.` 開頭：app.js 的 HAD_SAVE、備份、清除都只看 `coldeye.` 開頭的鍵）。
     只存在這支手機、不進備份。上鎖、忘記密語都不會動到任何持股資料。
   - 三種「什麼時候要再輸入」：trust 記住這支手機（預設，跟書房一樣）／away 離開 5 分鐘以上／every 每次離開（10 秒內回來不算）。
     away、every 離開時先蓋住畫面（多工切換的縮圖看不到持股）。
   測試：node tests/lock_test.mjs（純邏輯、用 pzcrypt 同格式的測試鑰匙圈驗證解得開；真的 RING 只驗格式與錯的密語打不開）。 */

/* 書房的鑰匙圈（PZ-Games 的 apps/next-chapter/books/keyring.json，2026-11-19 版）。公開也沒關係：沒有密語打不開。 */
export const RING = { v: 1, kdf: { alg: 'PBKDF2-SHA256', iter: 600000, salt: 'KN6A6kSOKxLAPzO0GiUQSw' }, wraps: [
  { id: 'pass', n: 'jcpz43kdW7CNOUAE', c: 'j_19qO5BGgetDWfV_9dIJezHPt1pzGPUoR9ClMkL0nF_FHarSdh2r5FP8gdx2VCO' },
  { id: 'code', n: 'pvWHhVpbimPzKB6n', c: 'efEElW9FxlAbhohojk6vFCe59lyFjHr-8G8Iwwr0WocMAsCkfysetLX6Boj6BDBl' },
] };
const KEY = 'coldeye-lock';

/* ---------- 純邏輯（複製自《PZ App 引擎》20_lock.js 1.0.0） ---------- */
export const LockCore = (() => {
  const AWAY_MS = 5 * 60e3;
  const EVERY_MS = 10e3;
  const POLICIES = ['trust', 'away', 'every'];
  const te = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  const subtle = () => (typeof crypto !== 'undefined' && crypto && crypto.subtle) || null;
  const cryptoOK = () => !!(te && subtle() && (typeof isSecureContext === 'undefined' || isSecureContext !== false));
  function unb64u(s) {
    s = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  const normPass = (s) => String(s || '').normalize('NFC').replace(/\s+/g, '');
  const normCode = (s) => String(s || '').toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0').replace(/[^0-9A-Z]/g, '');
  const looksCode = (s) => /^[\s0-9A-Za-z-]+$/.test(String(s || '')) && normCode(s).length === 16;
  function validRing(ring) {
    return !!(ring && ring.kdf && typeof ring.kdf.salt === 'string' && ring.kdf.iter > 0 && Array.isArray(ring.wraps) && ring.wraps.length);
  }
  function ringId(ring) {
    if (!validRing(ring)) return '';
    const w = ring.wraps.find((x) => x && x.id === 'pass') || ring.wraps[0] || {};
    return String(ring.kdf.salt).slice(0, 10) + '.' + String(w.n || '').slice(0, 8);
  }
  async function unwrap(ring, id, secret) {
    const w = (ring.wraps || []).find((x) => x && x.id === id);
    if (!w || !secret) return false;
    const s = subtle();
    const base = await s.importKey('raw', te.encode(secret), 'PBKDF2', false, ['deriveKey']);
    const kek = await s.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64u(ring.kdf.salt), iterations: ring.kdf.iter },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    try {
      const k = new Uint8Array(await s.decrypt({ name: 'AES-GCM', iv: unb64u(w.n), additionalData: te.encode('pz-keyring:' + id) }, kek, unb64u(w.c)));
      k.fill(0);
      return true;
    } catch (e) { return false; }
  }
  async function check(ring, input) {
    if (!validRing(ring)) return null;
    if (!cryptoOK()) { const e = new Error('這個瀏覽器不能解鎖（需要 https 與 WebCrypto）'); e.code = 'nocrypto'; throw e; }
    if (looksCode(input) && await unwrap(ring, 'code', normCode(input))) return 'code';
    const p = normPass(input);
    if (p && await unwrap(ring, 'pass', p)) return 'pass';
    return null;
  }
  const pol = (rec) => (rec && POLICIES.includes(rec.pol) ? rec.pol : 'trust');
  const iso = (ms) => new Date(ms).toISOString();
  function valid(rec, ring) { return !!(rec && rec.v === 1 && rec.ring && rec.ring === ringId(ring)); }
  const trusted = (rec, ring) => valid(rec, ring) && !rec.lk;
  function trust(rec, ring, now) { return { v: 1, ring: ringId(ring), at: iso(now), pol: pol(rec), hid: 0, lk: false }; }
  function lockRec(rec) { return rec ? Object.assign({}, rec, { lk: true, hid: 0 }) : rec; }
  function setPolicy(rec, p) { return rec ? Object.assign({}, rec, { pol: POLICIES.includes(p) ? p : 'trust', hid: 0 }) : rec; }
  function markHidden(rec, now) { return rec && pol(rec) !== 'trust' && !rec.lk ? Object.assign({}, rec, { hid: now }) : rec; }
  function markShown(rec) { return rec && rec.hid ? Object.assign({}, rec, { hid: 0 }) : rec; }
  function needAtLaunch(rec, ring, now) {
    if (!trusted(rec, ring)) return true;
    const p = pol(rec);
    if (p === 'every') return true;
    if (p === 'away') return !(rec.hid > 0) || rec.hid > now + 60e3 || now - rec.hid >= AWAY_MS;
    return false;
  }
  function needOnReturn(rec, ring, hidAt, now) {
    if (!trusted(rec, ring)) return true;
    const gone = hidAt > 0 ? now - hidAt : 0;
    const p = pol(rec);
    if (p === 'every') return gone < 0 || gone >= EVERY_MS;
    if (p === 'away') return gone < 0 || gone >= AWAY_MS;
    return false;
  }
  const coverOnHide = (rec) => !!rec && pol(rec) !== 'trust';
  return { AWAY_MS, EVERY_MS, POLICIES, normPass, normCode, looksCode, cryptoOK, validRing, ringId, check,
    policy: pol, trusted, trust, lockRec, setPolicy, markHidden, markShown, needAtLaunch, needOnReturn, coverOnHide };
})();

/* ---------- 這支手機的紀錄 ---------- */
const readRec = () => { try { const v = localStorage.getItem(KEY); return v ? JSON.parse(v) : null; } catch { return null; } };
const saveRec = (r) => { try { if (r) localStorage.setItem(KEY, JSON.stringify(r)); } catch { /* 存不了：下次打開會再問一次，不會壞 */ } };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const prefs = () => { try { return JSON.parse(localStorage.getItem('coldeye.settings') || '{}') || {}; } catch { return {}; } };
const calm = () => prefs().fx === false || (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
const name = () => { const n = prefs().name; return typeof n === 'string' && n.trim() ? n.trim().slice(0, 8) : '痞子葳'; };
const twTime = (isoStr) => {
  const t = Date.parse(isoStr || '');
  if (!isFinite(t)) return '';
  const d = new Date(t + 8 * 3600e3);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};

/* ---------- 畫面：閉著的眼睛＋封印 ---------- */
const MARK = `<svg class="lk-svg" viewBox="0 0 120 120" aria-hidden="true">
  <g class="lk-seal"><circle class="lk-s1" cx="60" cy="60" r="54"/><circle class="lk-s2" cx="60" cy="60" r="46"/><path class="lk-bolt" d="M60 1v10M60 109v10M1 60h10M109 60h10"/></g>
  <g class="lk-open"><path class="lk-almond" d="M20 60Q60 28 100 60Q60 92 20 60Z"/><circle class="lk-iris" cx="60" cy="60" r="14"/><circle class="lk-pupil" cx="60" cy="60" r="5.5"/></g>
  <g class="lk-lid"><path class="lk-lid-l" d="M22 58Q60 84 98 58"/><path class="lk-lash" d="M36 68l-4 8M48 74l-2 9M60 76v9M72 74l2 9M84 68l4 8"/></g>
</svg><b class="lk-stamp">封</b>`;
const EYE_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4l18 16M10.6 6.1A10 10 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.3 3.9M6.4 7.6C3.6 9.4 2 12 2 12s3.6 6 10 6c1.6 0 3-.3 4.2-.9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

let el = null;          // 門（#cx-lock）
let mode = '';          // '' | 'lock' | 'cover'
let busy = false;
let masked = false;
let waiters = [];
let hidAt = 0;
let hooks = {};
const call = (fn, ...a) => { try { if (typeof fn === 'function') return fn(...a); } catch (e) { console.error(e); } return undefined; };

/* 門掛在 <html> 底下、<body> 旁邊：開機時 renderShell 會整個換掉 body 的內容，門不能跟著被拿掉（眼睛睜開的動畫要播完）。
   上鎖時把整個 body 設成 inert：底下的冷眼點不到、Tab 也跳不進去。 */
let bodyInert = false;
function inert(on) {
  const b = document.body;
  if (!b) return;
  if (on) { if (!b.hasAttribute('inert')) { b.setAttribute('inert', ''); bodyInert = true; } }
  else if (bodyInert) { b.removeAttribute('inert'); bodyInert = false; }
}
function mount() {
  if (el) { if (!el.isConnected) document.documentElement.appendChild(el); return; }
  el = document.createElement('div');
  el.id = 'cx-lock';
  el.className = 'lk';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', '冷眼已上鎖');
  document.documentElement.appendChild(el);
  el.addEventListener('submit', (e) => { e.preventDefault(); tryOpen(); });
  el.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[data-lk="eye"]');
    if (!t) return;
    masked = !masked;
    const i = el.querySelector('.lk-input');
    if (i) { i.classList.toggle('masked', masked); i.focus(); }
    t.innerHTML = masked ? EYE_OFF : EYE_ON;
    t.setAttribute('aria-pressed', String(masked));
  });
  el.addEventListener('input', () => { const m = el.querySelector('.lk-msg'); if (m && m.classList.contains('bad')) { m.textContent = ''; m.classList.remove('bad'); } });
  // Esc：上鎖時不准傳到底下的冷眼（app.js 的 Esc 會關開機畫面、全螢幕頁；開機前 #boot 還不存在）
  addEventListener('keydown', (e) => { if (mode && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
}
function paint(kind) {
  mount();
  if (el.getAnimations) el.getAnimations().forEach((a) => a.cancel());
  mode = kind;
  el.className = 'lk' + (kind === 'cover' ? ' cover' : '');
  el.innerHTML = `<div class="lk-in">
    <div class="lk-mark">${MARK}</div>
    ${kind === 'cover' ? '<p class="lk-kick">冷眼</p>' : `<p class="lk-kick">${esc(name())}的冷眼</p>
    <h1 class="lk-title">冷眼已上鎖</h1>
    <p class="lk-sub">輸入密語，冷眼才睜眼。</p>
    <form class="lk-form" autocomplete="off" novalidate>
      <label class="lk-field"><input class="input lk-input${masked ? ' masked' : ''}" type="text" placeholder="密語（跟書房同一組）" aria-label="密語" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go"><button type="button" class="lk-eyebtn" data-lk="eye" aria-label="遮住或顯示密語" aria-pressed="${masked}">${masked ? EYE_OFF : EYE_ON}</button></label>
      <button type="submit" class="btn primary lk-go">睜眼</button>
    </form>
    <p class="lk-msg" role="alert" aria-live="assertive"></p>
    <p class="lk-note">忘了密語：用書房的備用碼（16 碼英文數字）也能開；兩個都忘了，跟 Claude 說「重設冷眼的密語」。你的持股、交易、日記只存在這支手機，上鎖或忘記密語都不會讓它們不見。</p>`}
  </div>`;
  el.hidden = false;
  document.documentElement.classList.add('lk-on');
  inert(true);
  // iPhone 不自動跳鍵盤（點一下格子才跳，跟書房一樣）；電腦直接可以打字
  if (kind === 'lock' && !/iP(hone|ad|od)/.test(navigator.userAgent)) setTimeout(() => { const i = el && el.querySelector('.lk-input'); if (i && mode === 'lock') i.focus({ preventScroll: true }); }, 300);
}
function msg(t, bad) { const m = el && el.querySelector('.lk-msg'); if (m) { m.textContent = t || ''; m.classList.toggle('bad', !!bad); } }
function shake() {
  const a = el && el.querySelector('.lk-mark');
  if (a && a.animate && !calm()) a.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-9px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(3px)' }, { transform: 'none' }], { duration: 420, easing: 'ease-out' });
  try { if (navigator.vibrate) navigator.vibrate([18, 40, 18]); } catch { /* iPhone 沒有震動 */ }
}
async function close(animated) {
  if (!el) return;
  if (animated && !calm()) {
    el.classList.add('opening');                 // 封印散開、眼睛睜開（CSS），再淡出
    await new Promise((r) => setTimeout(r, 820));
    if (el.animate) { try { await el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(1.03)' }], { duration: 340, easing: 'ease', fill: 'forwards' }).finished; } catch { /* 被取消也照樣關 */ } }
  }
  el.hidden = true; el.innerHTML = ''; el.className = 'lk'; mode = '';
  document.documentElement.classList.remove('lk-on');
  inert(false);
}
async function tryOpen() {
  if (busy || mode !== 'lock') return;
  const inp = el.querySelector('.lk-input');
  const v = inp ? inp.value : '';
  if (!LockCore.normPass(v)) { msg('先輸入密語', true); if (inp) inp.focus(); return; }
  busy = true; el.classList.add('busy'); msg('比對密語中……');
  const go = el.querySelector('.lk-go'); if (go) go.disabled = true;
  await new Promise((r) => setTimeout(r, 30));    // 先讓「比對中」畫出來（六十萬次 PBKDF2，手機約 0.3～1 秒）
  let how = null, why = '';
  try { how = await LockCore.check(RING, v); } catch (e) { why = e && e.code === 'nocrypto' ? '這個瀏覽器開不了鎖（要用 https 的冷眼網址打開）' : String((e && e.message) || e); }
  busy = false; if (el) el.classList.remove('busy'); if (go) go.disabled = false;
  if (!how) { msg(why || '密語不對，再想想', true); call(hooks.sfx, 'err'); shake(); if (inp) inp.select(); return; }
  saveRec(LockCore.trust(readRec(), RING, Date.now()));
  if (inp) { inp.value = ''; inp.blur(); }
  msg(how === 'code' ? '用備用碼打開了' : '');
  call(hooks.sfx, 'iris');
  // 先讓冷眼在門後面開機（眼睛睜開的動畫播完時，底下已經排好了），再把門拿掉
  const ws = waiters; waiters = [];
  ws.forEach((r) => r(how));
  call(hooks.opened, how);
  await close(true);
}
const waitOpen = () => new Promise((r) => waiters.push(r));

/** 開機時（app.js 的 boot，畫任何東西之前）：這支手機記得、又不用再輸入就馬上回來，畫面一點都不會多；要輸入就等打開 */
export async function lockGate() {
  const r = readRec();
  if (!LockCore.needAtLaunch(r, RING, Date.now())) { if (r && r.hid) saveRec(LockCore.markShown(r)); return 'skip'; }
  paint('lock');
  return waitOpen();
}
/** 開機之後：照「什麼時候要再輸入」處理離開與回來。hooks：sfx(name)（回來上鎖時，打開那一下的音效）、locked()、opened(how) */
export function lockWatch(h = {}) {
  hooks = h || {};
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hidAt = Date.now();
      const r = readRec();
      if (r) saveRec(LockCore.markHidden(r, hidAt));
      if (LockCore.coverOnHide(r) && !mode) paint('cover');   // 多工切換的縮圖只看得到封住的眼睛
      return;
    }
    const r = readRec();
    if (LockCore.needOnReturn(r, RING, hidAt, Date.now())) { if (mode !== 'lock') { paint('lock'); call(hooks.locked); } }
    else { if (r && r.hid) saveRec(LockCore.markShown(r)); if (mode === 'cover') close(false); }
    hidAt = 0;
  });
  // 電腦關分頁、重新整理：記下離開的時間（away 政策下次打開時看）
  addEventListener('pagehide', () => { const r = readRec(); if (r) saveRec(LockCore.markHidden(r, Date.now())); });
}
/** 設定頁「現在上鎖」 */
export function lockNow() {
  saveRec(LockCore.lockRec(readRec()));
  if (mode !== 'lock') { paint('lock'); call(hooks.locked); }
  return waitOpen();
}
export const lockShown = () => !!mode;

/* ---------- 設定頁「上鎖」 ---------- */
const POL_TXT = [['trust', '記住這支手機'], ['away', '離開 5 分鐘就鎖'], ['every', '每次離開都鎖']];
const POL_D = {
  trust: '跟書房一樣：這支手機輸入過一次就記得，之後直接打開。別人拿到你的手機也能打開冷眼，介意的話選另外兩種。',
  away: '離開冷眼 5 分鐘以上（切到別的 App、鎖螢幕）回來要再輸入；離開的時候先把畫面蓋住，多工切換看不到你的持股。',
  every: '每次離開冷眼都鎖（10 秒內回來不算），回來要再輸入；離開的時候先把畫面蓋住。',
};
export function lockSettingsHTML() {
  const r = readRec();
  const p = LockCore.policy(r);
  const at = r && r.at ? twTime(r.at) : '';
  return `<div class="sec-h"><h2>上鎖</h2><span class="aside">密語跟書房同一組</span></div>
    <section class="panel set" id="s-lock">
      <div class="srow"><div><div class="h">這支手機</div><div class="d">${at ? `記得你・上次輸入密語 ${esc(at)}` : '記得你'}</div></div><button class="btn small ghost" id="s-lock-now">現在上鎖</button></div>
      <div class="srow col"><div><div class="h">什麼時候要再輸入密語</div><div class="d">${esc(POL_D[p])}</div></div>
        <div class="seg" role="group" aria-label="什麼時候要再輸入密語">${POL_TXT.map(([k, t]) => `<button type="button" data-lockpol="${k}" aria-pressed="${p === k}">${t}</button>`).join('')}</div></div>
      <p class="small muted pad-x">你的持股、交易、決策日記、定期定額計畫只存在這支手機，冷眼從來不會把它們上傳到任何地方；網站上只有證交所等官方的公開資料。上鎖守的是「別人拿到你的手機」。</p>
    </section>`;
}
export function bindLockSettings(sh, redraw) {
  const now = sh.querySelector('#s-lock-now');
  if (now) now.addEventListener('click', () => { lockNow().then(() => call(redraw)); });
  sh.querySelectorAll('[data-lockpol]').forEach((b) => b.addEventListener('click', () => {
    const r = readRec();
    if (r) saveRec(LockCore.setPolicy(r, b.dataset.lockpol));
    call(redraw);
  }));
}
