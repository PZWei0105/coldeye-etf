// 語音播報的測試：node tests/voice_test.mjs
// 挑語音：台灣國語優先、其他普通話次之、粵語一律不用（以前「Hant（繁體）」被當成台灣，粵語（繁體，香港）就被選中）；
// 網路語音不用（會把晨報裡的持股送出去）；設定頁選的語音優先；念的文字：ETF 代號一個字一個字念。
import assert from 'node:assert/strict';

globalThis.window = globalThis;
if (!globalThis.navigator) globalThis.navigator = { userAgent: 'node' };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
const FX = await import('../site/fx.js');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const V = (name, lang, local = true) => ({ name, lang, localService: local });

t('分類：台灣國語、其他普通話、粵語（含各種寫法）、不是中文', () => {
  const cases = [
    [V('Mei-Jia', 'zh-TW'), 'tw'], [V('美佳（加強版）', 'zh-TW'), 'tw'], [V('Microsoft Hanhan - Chinese (Traditional, Taiwan)', 'zh-TW'), 'tw'],
    [V('cmn-tw-x-ctd-local', 'zh-TW'), 'tw'], [V('國語（臺灣）', 'zh-TW'), 'tw'], [V('Chinese Taiwan', 'cmn-TW'), 'tw'], [V('x', 'zh-Hant-TW'), 'tw'],
    [V('Sinji', 'zh-HK'), 'yue'], [V('Chinese (Hong Kong)', 'yue-Hant-HK'), 'yue'], [V('粵語（香港）', 'zh-HK'), 'yue'], [V('yue-hk-x-jar-local', 'yue-HK'), 'yue'],
    [V('Microsoft Tracy - Chinese (Traditional, Hong Kong S.A.R.)', 'zh-HK'), 'yue'], [V('x', 'zh-Hant-HK'), 'yue'], [V('澳門', 'zh-MO'), 'yue'],
    [V('Tingting', 'zh-CN'), 'cn'], [V('普通话（中国大陆）', 'zh-CN'), 'cn'], [V('Microsoft Huihui - Chinese (Simplified, PRC)', 'zh-CN'), 'cn'],
    [V('Samantha', 'en-US'), null], [V('Kyoko', 'ja-JP'), null],
  ];
  for (const [v, k] of cases) assert.equal(FX.classifyVoice(v), k, `${v.name} ${v.lang}`);
});
t('Android：粵語排在前面（lang 是 yue-Hant-HK、名字有 Chinese）也一定選台灣', () => {
  const list = [V('Chinese (Hong Kong)', 'yue-Hant-HK'), V('Chinese (China)', 'zh-CN'), V('Chinese (Taiwan)', 'zh-TW')];
  assert.equal(FX.chooseVoice(list).lang, 'zh-TW');
});
t('iPhone、Windows：選美佳、Hanhan；網路語音（Google 國語、Edge Online）不用', () => {
  assert.equal(FX.chooseVoice([V('Sinji', 'zh-HK'), V('Tingting', 'zh-CN'), V('Mei-Jia', 'zh-TW')]).name, 'Mei-Jia');
  const win = [V('Google 國語（臺灣）', 'zh-TW', false), V('Microsoft HsiaoChen Online (Natural) - Chinese (Taiwan)', 'zh-TW'), V('Microsoft Tracy - Chinese (Traditional, Hong Kong S.A.R.)', 'zh-HK'),
    V('Microsoft Huihui - Chinese (Simplified, PRC)', 'zh-CN'), V('Microsoft Hanhan - Chinese (Traditional, Taiwan)', 'zh-TW')];
  assert.match(FX.chooseVoice(win).name, /Hanhan/);
});
t('沒有台灣的：用其他普通話；只有粵語、或只有網路語音：不念', () => {
  assert.equal(FX.chooseVoice([V('Sinji', 'zh-HK'), V('Tingting', 'zh-CN')]).name, 'Tingting');
  assert.equal(FX.chooseVoice([V('Sinji', 'zh-HK'), V('yue-hk-x-jar-local', 'yue-HK')]), null);
  assert.equal(FX.chooseVoice([V('Google 國語（臺灣）', 'zh-TW', false)]), null);
  assert.equal(FX.chooseVoice([]), null);
});
t('設定頁選的語音優先；選的是粵語或已經不在清單上，就自動挑', () => {
  const list = [V('Mei-Jia', 'zh-TW'), V('Tingting', 'zh-CN'), V('Sinji', 'zh-HK')];
  assert.equal(FX.chooseVoice(list, 'Tingting').name, 'Tingting');
  assert.equal(FX.chooseVoice(list, 'Sinji').name, 'Mei-Jia');
  assert.equal(FX.chooseVoice(list, '不存在').name, 'Mei-Jia');
});
t('念的文字：ETF 代號一個字一個字念、漲跌與百分比、日期', () => {
  assert.equal(FX.speechText('0050 +0.84%'), '0 0 5 0 上漲百分之0.84');
  assert.equal(FX.speechText('00679B 下跌 −1.2%'), '0 0 6 7 9 B 下跌 下跌百分之1.2');
  assert.equal(FX.speechText('元大台灣50 10/24 除息'), '元大台灣50 10月24日 除息');
  assert.equal(FX.speechText('加權指數 27,000 點'), '加權指數 27000 點');
  assert.equal(FX.speechText('006208 與 00878'), '0 0 6 2 0 8 與 0 0 8 7 8');
});

console.log(`\n${n} 個測試通過`);
