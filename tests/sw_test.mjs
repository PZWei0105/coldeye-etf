// 冷眼「介面換新版」的瀏覽器實測（sw.js 的 announce、app.js 的 swCheck／swApply）。
// 用法：node tests/sw_test.mjs <data 資料夾>（要有 summary.json 等，App 才開得起來）；約 5 分鐘。
// 測試網站和 GitHub Pages 一樣讓瀏覽器把檔案快取 10 分鐘（Cache-Control: max-age=600、支援 If-Modified-Since）。
// 每一步把 site/ 複製一份、換掉 sw.js 的 BUILD、在 updates.js 加一個記號（window.__ceMark），看手機上的頁面什麼時候換成新的那一版。
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const SITE_SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const DATA = process.argv[2];
if (!DATA || !fs.existsSync(path.join(DATA, 'summary.json'))) { console.error('用法：node tests/sw_test.mjs <data 資料夾（有 summary.json）>'); process.exit(2); }
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'coldeye-sw-'));
const SITE = path.join(ROOT, 'coldeye-etf');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); if (!c) fails++; };

function put(build, mark) {
  fs.cpSync(SITE_SRC, SITE, { recursive: true });
  if (!fs.existsSync(path.join(SITE, 'data'))) fs.symlinkSync(path.resolve(DATA), path.join(SITE, 'data'));
  const sw = fs.readFileSync(path.join(SITE_SRC, 'sw.js'), 'utf8');
  if (sw.split('__BUILD__').length !== 2) throw new Error('sw.js 裡的 __BUILD__ 應該只有一個（註解裡不要寫）');
  fs.writeFileSync(path.join(SITE, 'sw.js'), sw.replace('__BUILD__', build));
  fs.writeFileSync(path.join(SITE, 'updates.js'), `${fs.readFileSync(path.join(SITE_SRC, 'updates.js'), 'utf8')}\nwindow.__ceMark = '${mark}';\n`);
  // 檔案時間往前推一秒以上，If-Modified-Since 才分得出新舊（秒為單位）
  const t = new Date(Date.now() + 1000);
  for (const f of fs.readdirSync(SITE)) if (f !== 'data') fs.utimesSync(path.join(SITE, f), t, t);
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  const mt = fs.statSync(f).mtime;
  mt.setMilliseconds(0);
  const ims = req.headers['if-modified-since'];
  const head = { 'Cache-Control': 'max-age=600', 'Last-Modified': mt.toUTCString() };
  if (ims && new Date(ims) >= mt) { res.writeHead(304, head); res.end(); return; }
  res.writeHead(200, { ...head, 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL0 = `http://localhost:${server.address().port}/coldeye-etf/`;
const LATEST = fs.readFileSync(path.join(SITE_SRC, 'updates.js'), 'utf8').match(/id: '([^']+)'/)[1];

put('b1', 'v1');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
await ctx.addInitScript((latest) => {
  try {
    if (!localStorage.getItem('coldeye.settings')) {
      localStorage.setItem('coldeye.settings', JSON.stringify({ boot: false, sfx: false, voice: false, theme: 'dark', watch: ['0050'] }));
      localStorage.setItem('coldeye.seenUpd', JSON.stringify(latest));
    }
    // 模擬「舊版頁面」：不認得 sw.js 的通知（不回「收到」）
    if (sessionStorage.getItem('ce-test-deaf')) {
      const add = ServiceWorkerContainer.prototype.addEventListener;
      ServiceWorkerContainer.prototype.addEventListener = function (type, fn, o) { if (type !== 'message') add.call(this, type, fn, o); };
      ServiceWorkerContainer.prototype.startMessages = function () {};
    }
  } catch (e) { /* */ }
}, LATEST);
const page = await ctx.newPage();
let loads = 0;
const errs = [];
page.on('load', () => { loads++; });
page.on('pageerror', (e) => errs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errs.push(`[console] ${m.text()}`); });

const mark = async () => { try { return await page.evaluate(() => window.__ceMark || null); } catch { return 'nav'; } };
const waitMark = async (want, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await mark() === want) return (Date.now() - t0) / 1000; await sleep(250); } return null; };
const upd = () => page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r && r.update())).catch(() => {});
const status = () => page.$eval('#status', (e) => e.textContent).catch(() => '');
const shells = () => page.evaluate(() => caches.keys()).catch(() => []);
const waitShell = async (build, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await shells()).includes(`coldeye-shell-${build}`)) return true; await sleep(250); } return false; };
const waitCtl = async (ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.evaluate(() => !!navigator.serviceWorker.controller).catch(() => false)) return true; await sleep(250); } return false; };
const resume = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))).catch(() => {});
const hide = () => page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }).catch(() => {});

try {
  await page.goto(URL0, { waitUntil: 'domcontentloaded' });
  ok(await waitCtl(), '第一次打開：service worker 接手');
  ok(await waitMark('v1', 10000) != null, '第一次打開是 v1');
  await sleep(6000);
  ok(loads === 1, `第一次裝好不會重新載入（載入 ${loads} 次）`);

  // 1. 剛打開、沒開著東西：自動換
  put('b2', 'v2');
  let l0 = loads;
  await upd();
  let t = await waitMark('v2', 15000);
  let tAuto = Date.now();
  ok(t != null && loads === l0 + 1, `剛打開：自動換成 v2（${t}s，重新載入 ${loads - l0} 次）`);

  // 2. 保險：上一次自動換才過幾秒又有新版 → 不自動重新載入，只寫「點一下更新」；點了照樣換
  await sleep(1500);
  put('b3', 'v3');
  l0 = loads;
  await upd();
  ok(await waitShell('b3'), '裝好 b3');
  await sleep(5000);
  ok(await mark() === 'v2' && loads === l0, '30 秒內第二次：不自動重新載入');
  ok((await status()).includes('有新版本'), `頂端顯示：${await status()}`);
  await page.click('#status');
  t = await waitMark('v3', 10000);
  ok(t != null, `點「更新」換成 v3（${t}s）`);

  // 3. 剛打開、但全螢幕頁（設定）開著：先不換；關掉之後換
  while (Date.now() - tAuto < 32000) await sleep(500);
  await page.click('#prefs');
  await sleep(1000);
  put('b4', 'v4');
  l0 = loads;
  await upd();
  ok(await waitShell('b4'), '裝好 b4');
  await sleep(5000);
  ok(await mark() === 'v3' && loads === l0, '設定開著：先不換');
  await page.keyboard.press('Escape');
  t = await waitMark('v4', 10000);
  tAuto = Date.now();
  ok(t != null, `關掉設定之後換成 v4（${t}s）`);

  // 4. 用了一陣子（超過 45 秒）：不突然重新載入，頂端寫「點一下更新」，點了才換
  await sleep(50000);
  put('b5', 'v5');
  l0 = loads;
  await upd();
  ok(await waitShell('b5'), '裝好 b5');
  await sleep(6000);
  ok(await mark() === 'v4' && loads === l0, '用了一陣子：不會突然重新載入');
  ok((await status()).includes('有新版本'), `頂端顯示：${await status()}`);
  await page.click('#status');
  t = await waitMark('v5', 10000);
  ok(t != null, `點「更新」換成 v5（${t}s）`);

  // 5. 從背景切回來（超過 1 分鐘沒問過）：自己問有沒有新版，剛切回來就直接換
  await sleep(70000);
  put('b6', 'v6');
  l0 = loads;
  await resume();
  t = await waitMark('v6', 20000);
  ok(t != null && loads === l0 + 1, `切回 App：自己發現並換成 v6（${t}s，重新載入 ${loads - l0} 次）`);

  // 6. 用了一陣子有新版，離開 App（畫面藏起來）時換（先清掉保險的紀錄，當作過了半小時）
  await sleep(50000);
  await page.evaluate(() => sessionStorage.removeItem('coldeye.swReload'));
  put('b7', 'v7');
  await upd();
  ok(await waitShell('b7'), '裝好 b7');
  await sleep(5000);
  ok(await mark() === 'v6', '還在用：先不換');
  await hide();
  t = await waitMark('v7', 10000);
  ok(t != null, `離開 App 時換成 v7（${t}s）`);

  // 7. 舊版頁面（不認得通知）：sw.js 等不到「收到」，幾秒後直接幫它重新載入，而且只一次
  await page.evaluate(() => sessionStorage.setItem('ce-test-deaf', '1'));
  await page.reload();
  await waitMark('v7', 10000);
  await sleep(3000);
  put('b8', 'v8');
  l0 = loads;
  await upd();
  t = await waitMark('v8', 20000);
  ok(t != null, `舊版頁面被 sw.js 換成 v8（${t}s）`);
  await sleep(6000);
  ok(loads === l0 + 1 && await mark() === 'v8', `只重新載入一次（${loads - l0}）`);
  const ks = (await shells()).filter((k) => k.startsWith('coldeye-shell-'));
  ok(ks.length === 1 && ks[0] === 'coldeye-shell-b8', `只留最新一版的快取：${ks.join(', ')}`);
  ok(errs.length === 0, `沒有錯誤${errs.length ? `：\n${errs.join('\n')}` : ''}`);
} finally {
  await browser.close();
  server.close();
  fs.rmSync(ROOT, { recursive: true, force: true });
}
console.log(fails ? `\n${fails} 項沒過` : '\n全部通過');
process.exit(fails ? 1 : 0);
