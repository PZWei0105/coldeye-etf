// 換裝的聲音實測：node tests/audio_test.mjs [all|songs|sfx]（Playwright 開真的瀏覽器離線渲染，不用喇叭，約 1 分鐘）
// 每一首配樂、每一種心情的音量（RMS、手機喇叭聽得到的部分＝150 Hz 以下拿掉、峰值），每一套音效和機甲 HUD 同一個聲音差幾 dB；
// 順便確定每個聲音都跑得動、沒有 NaN。改了聲音或配樂要重量：配樂「手機」那一欄平常（心情 0）要在 −31 dB 左右（調 song.gain），
// 音效和機甲 HUD 差 ±4 dB 以內（超過的會列出來；有幾個聲音帶一點隨機，每次量差零點幾）。雲端環境沒有內建瀏覽器時，設 CHROME=/usr/bin/google-chrome。
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const MODE = process.argv[2] || 'all';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const srv = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>t</title>'); return; } const f = path.join(SITE, p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => srv.listen(0, r));
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()); });
await page.goto(`http://127.0.0.1:${srv.address().port}/`);
const out = await page.evaluate(async (MODE) => {
  const FX = await import('/fx.js');
  const MU = await import('/music.js');
  const skins = {};
  for (const k of ['hud', 'term', 'sonar', 'led', 'ink']) skins[k] = await import(`/skins/${k}.js`);
  const SR = 48000;
  const stats = (buf, from = 0) => {
    let ss = 0, n = 0, pk = 0, nan = 0;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = Math.floor(from * SR); i < d.length; i++) { const v = d[i]; if (!Number.isFinite(v)) { nan++; continue; } ss += v * v; n++; if (Math.abs(v) > pk) pk = Math.abs(v); }
    }
    const rms = Math.sqrt(ss / Math.max(1, n));
    return { rms, db: 20 * Math.log10(rms + 1e-12), pk, pkdb: 20 * Math.log10(pk + 1e-12), nan };
  };
  const res = { songs: {}, sfx: {} };
  // ---------- 配樂：照 music.js 的接法（歌的音量 → 殘響、迴音），每一種心情各彈 16 小節
  if (MODE !== 'sfx') for (const [k, m] of Object.entries(skins)) {
    const song = m.song;
    res.songs[k] = {};
    for (const mood of [0, 1, 2]) {
      const md = MU.MOODS[mood];
      const spb = 60 / (song.bpm * md.tempo);
      const bars = 16;
      const dur = bars * spb * 4 + 6;
      const oc = new OfflineAudioContext(2, Math.ceil(dur * SR), SR);
      const master = oc.createGain(); master.gain.value = md.gain;
      const lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = md.lp; lp.Q.value = 0.5;
      master.connect(lp).connect(oc.destination);
      const conv = oc.createConvolver(); conv.buffer = MU.makeIR(oc);
      const verbIn = oc.createGain(); const verbOut = oc.createGain(); verbOut.gain.value = 0.9;
      verbIn.connect(conv).connect(verbOut).connect(master);
      const bus = oc.createGain(); bus.gain.value = song.gain ?? 1; bus.connect(master);
      const wsend = oc.createGain(); wsend.connect(verbIn);
      let dly = null;
      if (song.delay) { dly = oc.createDelay(2); dly.delayTime.value = (60 / song.bpm) * (song.delay.beats || 0.75); const fb = oc.createGain(); fb.gain.value = song.delay.fb ?? 0.32; const f2 = oc.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = song.delay.lp || 2600; dly.connect(f2); f2.connect(fb); fb.connect(dly); f2.connect(bus); }
      const syn = FX.makeSynth(oc, bus, wsend, FX.makeNoise(oc));
      const A = MU.instruments(syn, { wet: wsend, dly });
      let t = 0.1, errs = 0, notes = 0;
      const orig = {};
      for (const key of ['tone', 'note', 'noise', 'pluck', 'ep', 'bell', 'pad', 'bass', 'kick', 'snare', 'hat']) { orig[key] = A[key]; A[key] = (...a) => { notes++; return orig[key](...a); }; }
      for (let bar = 0; bar < bars; bar++) {
        const rnd = MU.rng(MU.hashStr(song.id) ^ Math.imul(bar + 1, 2654435761));
        for (let s = 0; s < 16; s++) {
          const s16 = spb / 4;
          const sw = s % 2 === 1 ? (song.swing || 0) * s16 : 0;
          try { song.step(A, { t: t + sw, bar, s, mood, s16, spb, rnd }); } catch (e) { errs++; if (errs < 3) console.error(k, e.message); }
          t += s16;
        }
      }
      const buf = await oc.startRendering();
      // 手機喇叭聽得到的部分：150 Hz 以下拿掉再量一次（低音嗡鳴在手機上幾乎聽不到）
      const oc2 = new OfflineAudioContext(2, buf.length, SR);
      const src = oc2.createBufferSource(); src.buffer = buf;
      const hp = oc2.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 150; hp.Q.value = 0.7;
      const hp2 = oc2.createBiquadFilter(); hp2.type = 'highpass'; hp2.frequency.value = 150; hp2.Q.value = 0.7;
      src.connect(hp).connect(hp2).connect(oc2.destination); src.start();
      const buf2 = await oc2.startRendering();
      res.songs[k][mood] = { ...stats(buf, 4), phone: stats(buf2, 4).db, notes, errs, secs: Math.round(dur) };
    }
  }
  // ---------- 音效：每一個聲音單獨渲染，和機甲 HUD 同一個聲音比
  if (MODE !== 'songs') {
    const banks = { hud: FX.HUD_SOUNDS, term: skins.term.sfx, sonar: skins.sonar.sfx, led: skins.led.sfx, ink: skins.ink.sfx };
    // 「最大瞬間音量」：每 0.3 秒一窗（每 0.05 秒移一次）的 RMS 取最大的（人耳大約 0.2～0.4 秒整合一次音量；很短的按鍵聲和長的點火聲都量得穩）。
    // 有些聲音帶一點隨機（雜訊從哪裡開始），每個聲音渲染 3 次取平均。
    const W = Math.floor(SR * 0.3), HOP = Math.floor(SR * 0.05);
    const once = async (fn) => {
      const oc = new OfflineAudioContext(1, SR * 5, SR);
      const master = oc.createGain(); master.gain.value = 0.85; master.connect(oc.destination);
      const d = oc.createDelay(0.5); d.delayTime.value = 0.13; const fb = oc.createGain(); fb.gain.value = 0.28; const lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
      const wet = oc.createGain(); wet.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(master);
      fn(FX.makeSynth(oc, master, wet, FX.makeNoise(oc)));
      const dd = (await oc.startRendering()).getChannelData(0);
      let last = 0; for (let i = dd.length - 1; i >= 0; i--) if (Math.abs(dd[i]) > 1e-4) { last = i; break; }
      let nan = 0, ms = 0;
      for (let i = 0; i <= last; i++) if (!Number.isFinite(dd[i])) nan++;
      for (let a = 0; a <= Math.max(0, last - HOP); a += HOP) { let ss = 0; for (let i = a; i < a + W && i < dd.length; i++) { const v = dd[i]; if (Number.isFinite(v)) ss += v * v; } ms = Math.max(ms, ss / W); }
      return { ms, nan, len: last / SR };
    };
    for (const [k, bank] of Object.entries(banks)) {
      res.sfx[k] = {};
      for (const name of FX.SOUND_NAMES) {
        const fn = bank[name];
        if (!fn) { res.sfx[k][name] = { missing: true }; continue; }
        try {
          const rs = [await once(fn), await once(fn), await once(fn)];
          const ms = rs.reduce((a, r) => a + r.ms, 0) / rs.length;
          res.sfx[k][name] = { db: +(10 * Math.log10(ms + 1e-24)).toFixed(1), len: +rs[0].len.toFixed(2), nan: rs.reduce((a, r) => a + r.nan, 0) };
        } catch (e) { res.sfx[k][name] = { err: e.message }; }
      }
      res.sfx[k].__trim = (skins[k] && skins[k].sfxTrim) || {};
    }
  }
  return res;
}, MODE);
await browser.close(); srv.close();
if (out.songs && Object.keys(out.songs).length) {
  console.log('配樂（從第 4 秒算起）：RMS dB／手機 dB／峰值 dB／音符數／錯誤');
  for (const [k, v] of Object.entries(out.songs)) console.log(k.padEnd(6), [0, 1, 2].map((m) => v[m] ? `${v[m].db.toFixed(1)}/${v[m].phone.toFixed(1)}/${v[m].pkdb.toFixed(1)}/${v[m].notes}/${v[m].errs}${v[m].nan ? ' NaN!' : ''}` : '-').join('   '));
}
if (out.sfx && Object.keys(out.sfx).length) {
  console.log('\n音效：最大瞬間音量 dB（和機甲 HUD 差幾 dB）');
  const names = Object.keys(out.sfx.hud).filter((n) => n !== '__trim');
  for (const n of names) {
    const h = out.sfx.hud[n];
    const row = ['term', 'sonar', 'led', 'ink'].map((k) => { const x = out.sfx[k][n]; if (!x || x.missing) return 'MISSING'; if (x.err) return 'ERR ' + x.err; return `${x.db}(${(x.db - h.db >= 0 ? '+' : '')}${(x.db - h.db).toFixed(1)})${x.nan ? 'NaN' : ''}`; });
    console.log(n.padEnd(7), String(h.db).padEnd(6), row.map((r) => r.padEnd(14)).join(' '));
  }
}
// 超出範圍的列出來
const bad = [];
if (out.songs) for (const [k, v] of Object.entries(out.songs)) { if (v[0] && Math.abs(v[0].phone + 31) > 1.5) bad.push(`${k} 配樂平常 ${v[0].phone.toFixed(1)} dB（要在 −31 ±1.5）`); for (const m of [0, 1, 2]) if (v[m] && (v[m].errs || v[m].nan)) bad.push(`${k} 心情 ${m} 有錯誤或 NaN`); }
if (out.sfx && out.sfx.hud) for (const k of ['term', 'sonar', 'led', 'ink']) for (const [n, x] of Object.entries(out.sfx[k] || {})) { if (n === '__trim') continue; if (x.missing || x.err || x.nan) bad.push(`${k}.${n} ${x.err || (x.missing ? '缺少' : 'NaN')}`); else if (Math.abs(x.db - out.sfx.hud[n].db) > 4) bad.push(`${k}.${n} 和機甲 HUD 差 ${(x.db - out.sfx.hud[n].db).toFixed(1)} dB`); }
console.log(bad.length ? `\n要調整：\n- ${bad.join('\n- ')}` : '\n全部在範圍內');
// 建議的音量校正（貼到 skins/{代號}.js 的 TRIM）：差 1.5 dB 以上的才改
if (out.sfx && out.sfx.hud) for (const k of ['term', 'sonar', 'led', 'ink']) {
  const cur = out.sfx[k].__trim || {};
  const sug = {};
  for (const n of Object.keys(out.sfx.hud)) {
    if (n === '__trim') continue;
    const x = out.sfx[k][n];
    if (!x || x.db == null) continue;
    const diff = out.sfx.hud[n].db - x.db;
    const t = Math.abs(diff) >= 1.5 ? Math.round(((cur[n] || 0) + diff) * 2) / 2 : (cur[n] || 0);
    if (t) sug[n] = Math.max(-15, Math.min(12, t));
  }
  console.log(`${k} TRIM = ${JSON.stringify(sug)}`);
}
if (bad.length) process.exitCode = 1;
