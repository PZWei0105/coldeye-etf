/* 冷眼 service worker
   介面檔案：裝新版時一次把整套抓下來（每個檔案都和網站確認過，不拿瀏覽器快取裡的舊檔），之後只從「這一版」的快取給，
   所以手機上永遠是同一版的整套檔案，不會新舊混在一起，也能秒開、離線打得開。
   BUILD＝介面檔案的指紋（部署時 build.py 的 site_fingerprint 填進來）：程式真的改了才換，盤中的資料更新不會讓手機重裝。
   新版裝好、接手之後通知每一個開著的冷眼（announce）：新版的頁面會回「收到」，自己挑安全的時候重新載入（app.js 的 swApply）；
   幾秒內沒回的是舊版的頁面，直接幫它重新載入——iPhone 加到主畫面的 App 從背景切回來不會重新載入，不這樣做會一直停在舊畫面。
   資料（data/）一律先抓網路、失敗才用上次的資料。 */
const BUILD = '__BUILD__';
const SHELL = `coldeye-shell-${BUILD}`;
const DATA = 'coldeye-data';
const SHELL_FILES = ['./', 'index.html', 'styles.css', 'app.js', 'core.js', 'pf.js', 'calc.js', 'viz.js', 'learn.js', 'tools.js', 'sheet.js', 'forms.js', 'aide.js', 'desk.js', 'fx.js', 'dca.js', 'updates.js', 'lessons.js', 'cases.js', 'coach.js', 'xray.js', 'plan.js', 'pulse.js', 'invest.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png'];
const ACK_MS = 4000;

self.addEventListener('install', (e) => {
  // cache: 'no-cache'：每個檔案都先和網站確認過才存。GitHub Pages 讓瀏覽器把檔案快取 10 分鐘，
  // 以前直接 addAll，剛部署完裝的新版可能存到舊的檔案（新版的名字、舊版的內容）
  e.waitUntil(caches.open(SHELL)
    .then((c) => c.addAll(SHELL_FILES.map((f) => new Request(f, { cache: 'no-cache' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('coldeye-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      // 通知不擋住接手（頁面接下來的資料請求不用等它）
      .then(() => { announce(); }),
  );
});

/** 告訴每一個開著的冷眼「換這一版了」；ACK_MS 內沒回的（舊版頁面，不認得這個通知）直接重新載入 */
function announce() {
  return self.clients.matchAll({ type: 'window' }).then((cs) => Promise.all(cs.map((c) => new Promise((done) => {
    let ch;
    try { ch = new MessageChannel(); } catch { done(); return; }
    const t = setTimeout(() => {
      // 不支援 navigate 的瀏覽器就算了：下次打開 App 就是新版
      if (typeof c.navigate === 'function') c.navigate(c.url).catch(() => {});
      done();
    }, ACK_MS);
    ch.port1.onmessage = () => { clearTimeout(t); done(); };
    try { c.postMessage({ t: 'coldeye-sw', build: BUILD }, [ch.port2]); } catch { clearTimeout(t); done(); }
  }))));
}

// 頁面問「你是哪一版」：這一頁就是這個 service worker 給的，app.js 拿來比之後的通知
self.addEventListener('message', (e) => {
  const m = e.data || {};
  if (m.t === 'coldeye-build?' && e.source) e.source.postMessage({ t: 'coldeye-sw', build: BUILD, hello: 1 });
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === location.origin && url.pathname.includes('/data/')) {
    const key = url.origin + url.pathname;
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          // 一定要在把回應交給頁面「之前」複製，頁面讀完之後就不能再複製了
          if (res.ok) { const copy = res.clone(); caches.open(DATA).then((c) => c.put(key, copy)); }
          return res;
        })
        // 連不上網路：給上次存下的資料，並標記「這是離線的舊資料」，App 才不會說成最新
        .catch(() => caches.open(DATA).then((c) => c.match(key)).then((r) => {
          if (!r) return Response.error();
          const h = new Headers(r.headers);
          h.set('X-ColdEye-Offline', '1');
          return r.blob().then((b) => new Response(b, { status: 200, statusText: 'OK', headers: h }));
        })),
    );
    return;
  }
  if (url.origin === location.origin) {
    // 介面檔案只從這一版的快取給（整套同一版）。快取裡沒有的（清單以外的檔案，例如其他尺寸的圖示）才上網抓，抓到的也存進這一版；
    // 以前是先給快取、再在背景一個一個換成網站上的新檔，換到一半就會新舊混在一起
    e.respondWith(
      caches.open(SHELL)
        .then((c) => c.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((res) => {
          if (res.ok && res.type === 'basic') { const copy = res.clone(); c.put(e.request, copy); }
          return res;
        })))
        .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || Response.error())),
    );
    return;
  }
  if (url.hostname.endsWith('gstatic.com') || url.hostname.endsWith('googleapis.com')) {
    e.respondWith(
      caches.open('coldeye-fonts').then((c) => c.match(e.request).then((hit) => hit || fetch(e.request).then((res) => { c.put(e.request, res.clone()); return res; }))),
    );
  }
});
