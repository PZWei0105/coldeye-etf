import * as PF from '../site/pf.js';
import assert from 'node:assert';
const lots=[{id:'a',c:'X',side:'buy',d:20250101,sh:1000,px:30,fee:20},{id:'b',c:'X',side:'sell',d:0,sh:500,px:35,fee:20,tax:17}];
const h=PF.holdingFromLots(lots,[]); assert.equal(h.sh,500); assert(h.realized>2000);
assert.throws(()=>PF.readBackup({app:'coldeye',pf:{lots:[{id:'1',c:'X',side:'buy',sh:'1000',px:30}]}}));
assert.throws(()=>PF.readBackup({app:'coldeye',pf:{lots:[{c:'X',side:'buy',sh:1000,px:30}]}}));
PF.readBackup({app:'coldeye',pf:{lots:[{id:'1',c:'X',side:'buy',d:null,sh:1000,px:30}],cash:5}});
console.log('回歸測試通過');
