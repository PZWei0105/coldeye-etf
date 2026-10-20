import * as PF from '../site/pf.js';
import assert from 'node:assert';
const lots=[{id:'a',c:'X',side:'buy',d:20250101,sh:1000,px:30,fee:20},{id:'b',c:'X',side:'sell',d:0,sh:500,px:35,fee:20,tax:17}];
const h=PF.holdingFromLots(lots,[]); assert.equal(h.sh,500); assert(h.realized>2000);
assert.throws(()=>PF.readBackup({app:'coldeye',pf:{lots:[{id:'1',c:'X',side:'buy',sh:'1000',px:30}]}}));
assert.throws(()=>PF.readBackup({app:'coldeye',pf:{lots:[{c:'X',side:'buy',sh:1000,px:30}]}}));
PF.readBackup({app:'coldeye',pf:{lots:[{id:'1',c:'X',side:'buy',d:null,sh:1000,px:30}],cash:5}});
// 證交稅：被動式債券 ETF 停徵到 2026 年底；主動式債券 ETF（尾碼 D）照課；極小額賣出稅金捨去成 0 不算「免稅」
const tx=(row,d)=>PF.tradeCost('sell',1000,30,PF.taxCat(row),d).tax;
assert.equal(tx({c:'00679B',k:'bond'},20261020),0);
assert.equal(tx({c:'00679B',k:'bond'},20270105),30);
assert.equal(tx({c:'00981D',k:'bond'},20261020),30);
assert.equal(tx({c:'0050',k:'broad'},20261020),30);
const ctx={today:20261020,fee:PF.DEFAULT_FEE,T:100000};
assert.equal(PF.simulateSell({row:{c:'00981D',k:'bond'},sh:1000,px:30,avg:29,cost:29000},1000,30,ctx).taxFree,false);
assert.equal(PF.simulateSell({row:{c:'00679B',k:'bond'},sh:1000,px:30,avg:29,cost:29000},1000,30,ctx).taxFree,true);
assert.equal(PF.simulateSell({row:{c:'0050',k:'broad'},sh:5,px:15,avg:14,cost:70},5,15,ctx).taxFree,false);
console.log('回歸測試通過');
