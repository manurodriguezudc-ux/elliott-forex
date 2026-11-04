import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanCandles, candidates} from './fetch.mjs';
const MS=3600000;
test('rechaza velas inválidas y aún abiertas',()=>{
 const checkAt=Date.UTC(2026,10,4,10,10);
 const raw=[{timestamp:Date.UTC(2026,10,4,8),open:1.1,high:1.12,low:1.09,close:1.11},{timestamp:Date.UTC(2026,10,4,10),open:1.1,high:1.12,low:1.09,close:1.11},{timestamp:Date.UTC(2026,10,4,9),open:1.1,high:1.02,low:1.09,close:1.11}];
 const result=cleanCandles(raw, MS, checkAt);
 assert.equal(result.length,1);
});
test('la heurística no produce señales con datos insuficientes',()=>{
 assert.deepEqual(candidates([{open:1,close:1,high:1,low:1,timestamp:1600000000000}],'EUR/USD','H1'),[]);
});
