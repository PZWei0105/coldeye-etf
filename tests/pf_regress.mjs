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
// 模擬倉現金：照時間重播，賣出超過當時持股的部分不算錢（刪掉買進後，賣出的錢不能還留著）
const cf=(ls,sp)=>Math.round(PF.lotsCashFlow(ls,sp)*100)/100;
assert.equal(cf([{c:'X',side:'buy',d:20261020,at:'1',sh:1000,px:50,fee:71},{c:'X',side:'sell',d:20261020,at:'2',sh:1000,px:50,fee:71,tax:50}]),-71-71-50);
assert.equal(cf([{c:'X',side:'sell',d:20261020,at:'2',sh:1000,px:50,fee:71,tax:50}]),0);
assert.equal(cf([{c:'X',side:'buy',d:20261020,at:'1',sh:100,px:50,fee:7},{c:'X',side:'sell',d:20261020,at:'2',sh:1000,px:50,fee:71,tax:50}]),Math.round((-5007+0.1*(50000-71-50))*100)/100);
// 分割：分割前買 1000 股、分割後賣 4000 股（1 拆 4）是賣光，不是超賣
assert.equal(cf([{c:'X',side:'buy',d:20250101,at:'1',sh:1000,px:100,fee:0},{c:'X',side:'sell',d:20250701,at:'2',sh:4000,px:25,fee:0,tax:0}],()=>[[20250601,4]]),0);
// 除息日開盤前（報價還是昨收）不算當天的配息；開盤後才算
const lots2=[{id:'b',c:'0056',side:'buy',d:20261001,sh:1000,px:30,fee:0}];
const rows=new Map([['0056',{c:'0056',k:'div',p:30,d:20261019}]]);
const divs={'0056':{d:[[20261020,1]],s:[]}};
const pre=PF.buildPortfolio({cash:0,lots:lots2},rows,()=>({px:30,date:20261019}),divs,PF.DEFAULT_FEE,20261020);
const post=PF.buildPortfolio({cash:0,lots:lots2},rows,()=>({px:29,date:20261020}),divs,PF.DEFAULT_FEE,20261020);
assert.equal(pre.totals.divRecv,0);
assert.equal(post.totals.divRecv,1000);
console.log('回歸測試通過');
