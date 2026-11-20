// 上鎖的測試：node tests/lock_test.mjs
// 1) 驗密語：用《下回分解》書房同一套工具（PZ-Games 的 tools/pzcrypt.py make_keyring）做的測試鑰匙圈，
//    密語（中文、多了空白）、備用碼（小寫、加了連字號、I/L/O 打錯）都要打得開；錯的打不開。
// 2) 真的鑰匙圈（書房的）：格式對、錯的密語打不開（不知道真的密語，也不該知道）。
// 3) 什麼時候要鎖：記住這支手機／離開 5 分鐘／每次離開，開機與從背景回來的每一種情況。
// 4) 不碰持股：儲存的鍵不是 coldeye. 開頭（HAD_SAVE、備份、清除都只看 coldeye.）、不進備份；開機在畫任何東西之前先過門。
import assert from 'node:assert/strict';
import fs from 'node:fs';

const L = await import('../site/lock.js');
const { LockCore: C, RING } = L;

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };

// pzcrypt.make_keyring(new_master(), '冷眼 測試用的密語', 'ABCDEFGH12345678')（600000 次，跟書房一樣）
const TEST_RING = { v: 1, kdf: { alg: 'PBKDF2-SHA256', iter: 600000, salt: 'XLMhdoz-gweJyJGWcyr3zw' }, wraps: [
  { id: 'pass', n: 'aX5tPFGemPbQJv5m', c: 'ASTO4EYKCJKuo-SNGIAju_b53khUZk44BPdMy0EPbJCPqdJ7byF6_I3fBs6xn82L' },
  { id: 'code', n: 'wtvvEEVFXFAsqi3q', c: 'E-lwobAsmL-jLudINtwHBAuuC3oy6SWc2EYNXiuZ1w1rmdJ7PI1chhRLJ0iQUXZ3' },
] };

// ------------------------------------------------------------------ 驗密語
await t('密語：跟書房一樣拿掉空白、NFC，打得開', async () => {
  assert.equal(await C.check(TEST_RING, '冷眼測試用的密語'), 'pass');
  assert.equal(await C.check(TEST_RING, '  冷眼 測試 用的 密語 '), 'pass');
});
await t('備用碼：小寫、連字號、空白都可以', async () => {
  assert.equal(await C.check(TEST_RING, 'abcd-efgh-1234-5678'), 'code');
  assert.equal(await C.check(TEST_RING, 'ABCD EFGH 1234 5678'), 'code');
});
await t('錯的密語、錯的備用碼、空的：打不開', async () => {
  assert.equal(await C.check(TEST_RING, '冷眼測試用的蜜語'), null);
  assert.equal(await C.check(TEST_RING, 'abcd-efgh-1234-5679'), null);
  assert.equal(await C.check(TEST_RING, '   '), null);
  assert.equal(await C.check(null, '冷眼測試用的密語'), null);
});
await t('正規化跟書房一字不差', () => {
  assert.equal(C.normPass(' 冷 眼\t\n'), '冷眼');
  assert.equal(C.normPass('é'), 'é');                 // NFC
  assert.equal(C.normCode('il-o0 abcd efgh 1234'), '1100ABCDEFGH1234');
  assert.ok(C.looksCode('abcd-efgh-1234-5678'));
  assert.ok(!C.looksCode('冷眼測試用的密語'));
  assert.ok(!C.looksCode('abcd'));
});
await t('真的鑰匙圈（書房的）：格式對、指紋穩定、錯的密語打不開', async () => {
  assert.ok(C.validRing(RING));
  assert.equal(RING.kdf.iter, 600000);
  assert.deepEqual(RING.wraps.map((w) => w.id), ['pass', 'code']);
  assert.equal(C.ringId(RING), 'KN6A6kSOKx.jcpz43kd');
  assert.equal(await C.check(RING, '這一定不是痞子葳的密語'), null);
});

// ------------------------------------------------------------------ 什麼時候要鎖
const T0 = Date.parse('2026-11-21T02:00:00Z');
const trusted = (pol, extra = {}) => Object.assign(C.trust(null, RING, T0), pol ? { pol } : {}, extra);
await t('沒打開過、鑰匙圈換了、手動上鎖：一定要輸入', () => {
  assert.ok(C.needAtLaunch(null, RING, T0));
  assert.ok(C.needAtLaunch({ v: 1, ring: 'old.ring', at: '', pol: 'trust' }, RING, T0));
  assert.ok(C.needAtLaunch(C.lockRec(trusted()), RING, T0));
  assert.ok(C.needAtLaunch({ garbage: true }, RING, T0));
});
await t('記住這支手機（預設，跟書房一樣）：打開、回來都不用再輸入', () => {
  const r = trusted();
  assert.equal(C.policy(r), 'trust');
  assert.ok(!C.needAtLaunch(r, RING, T0 + 86400e3 * 30));
  assert.ok(!C.needOnReturn(r, RING, T0, T0 + 86400e3));
  assert.ok(!C.coverOnHide(r));
  assert.deepEqual(C.markHidden(r, T0), r, 'trust 不記離開時間');
});
await t('離開 5 分鐘就鎖', () => {
  let r = trusted('away');
  assert.ok(C.coverOnHide(r));
  assert.ok(!C.needOnReturn(r, RING, T0, T0 + 4 * 60e3));
  assert.ok(C.needOnReturn(r, RING, T0, T0 + 5 * 60e3));
  r = C.markHidden(r, T0);
  assert.equal(r.hid, T0);
  assert.ok(!C.needAtLaunch(r, RING, T0 + 60e3), '關掉 1 分鐘重開不用');
  assert.ok(C.needAtLaunch(r, RING, T0 + 6 * 60e3), '關掉 6 分鐘重開要');
  assert.ok(C.needAtLaunch(C.markShown(r), RING, T0 + 1000), '在前景時被系統關掉（沒有離開時間）：保守起見要輸入');
  assert.ok(C.needAtLaunch(C.markHidden(trusted('away'), T0 + 10 * 60e3), RING, T0), '離開時間在未來（時鐘被調過）：要輸入');
  assert.ok(C.needOnReturn(r, RING, T0 + 1000, T0), '時間倒流：要輸入');
});
await t('每次離開都鎖（10 秒內回來不算）', () => {
  const r = trusted('every');
  assert.ok(C.needAtLaunch(C.markHidden(r, T0), RING, T0 + 1000), '每次重新打開都要');
  assert.ok(!C.needOnReturn(r, RING, T0, T0 + 9e3));
  assert.ok(C.needOnReturn(r, RING, T0, T0 + 10e3));
});
await t('密語對了：記住這支手機，政策沿用；換政策、上鎖不會亂掉', () => {
  const r = C.trust(C.lockRec(trusted('away')), RING, T0 + 1);
  assert.equal(r.pol, 'away');
  assert.equal(r.lk, false);
  assert.ok(C.trusted(r, RING));
  assert.equal(C.setPolicy(r, 'nonsense').pol, 'trust');
  assert.equal(C.setPolicy(r, 'every').hid, 0);
});

// ------------------------------------------------------------------ 不碰持股、開機先過門
const src = (f) => fs.readFileSync(new URL('../site/' + f, import.meta.url), 'utf8');
await t('儲存的鍵不是 coldeye. 開頭（HAD_SAVE、備份、清除都不會看到它）', () => {
  const s = src('lock.js');
  assert.match(s, /const KEY = 'coldeye-lock';/);
  assert.ok(!/localStorage\.(setItem|removeItem)\('coldeye\./.test(s), 'lock.js 不准寫 coldeye. 開頭的鍵');
  assert.ok(!/localStorage\.clear/.test(s));
  const app = src('app.js');
  assert.ok(app.includes("k.startsWith('coldeye.')"), 'HAD_SAVE 還是只看 coldeye. 開頭');
  const forms = src('forms.js');
  assert.ok(!/coldeye-lock|lockpol/.test(forms), '上鎖的設定不進備份');
});
await t('開機：畫任何東西之前先過門；設定頁有「上鎖」；介面檔案有進離線快取', () => {
  const app = src('app.js');
  const b = app.indexOf('async function boot() {');
  const g = app.indexOf('await lockGate();', b);
  const r = app.indexOf('renderShell();', b);
  const k = app.indexOf('await initSkin();', b);
  assert.ok(b > 0 && g > b && g < r && g < k, 'lockGate 要在 initSkin、renderShell 之前');
  assert.ok(app.includes('${lockSettingsHTML()}'));
  assert.ok(app.includes('bindLockSettings(sh'));
  assert.ok(src('sw.js').includes("'lock.js'"));
});
await t('畫面文字：說清楚密語跟書房同一組、持股只在手機、忘了怎麼辦', () => {
  const s = src('lock.js');
  for (const w of ['跟書房同一組', '只存在這支手機', '重設冷眼的密語', '備用碼']) assert.ok(s.includes(w), w);
  const h = L.lockSettingsHTML();
  assert.ok(h.includes('現在上鎖') && h.includes('data-lockpol="away"') && !/undefined|NaN/.test(h));
});

console.log(`\n${n} 個測試通過`);
