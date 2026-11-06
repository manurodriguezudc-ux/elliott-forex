import test from 'node:test';
import assert from 'node:assert/strict';
import {ema,atr,swingLevels,inspectM15,assessCandidate} from './quality.mjs';

test('EMA y ATR no se inventan sin historial',()=>{
  assert.equal(ema([{close:1}],20),null);
  assert.equal(atr([{high:1,low:0,close:0.5}],14),null);
});
test('los pivotes requieren 3 velas posteriores; no se usa el último máximo en formación',()=>{
  const b=Array.from({length:9},(_,i)=>({timestamp:i*900000,high:i===4?10:i===8?12:1+i/10,low:0,close:1}));
  const highs=swingLevels(b,'high',3);
  assert.deepEqual(highs.map(x=>x.price),[10]);
});
test('no se considera confirmación M15 si todavía no alcanza el 61.8',()=>{
  const base=Date.UTC(2026,10,6,10,0);
  const b=Array.from({length:60},(_,i)=>({timestamp:base+i*900000,open:1.11,high:1.12,low:1.105,close:1.112}));
  const c={direction:'BUY',tf:'H1',origin:1.0,end_timestamp:base+3600000,levels:{'61.8':1.10}};
  assert.equal(inspectM15(b,c).state,'zona_pendiente');
});
test('origen atravesado invalida candidato aunque hubiera reacción M15',()=>{
  const base=Date.UTC(2026,10,6,10,0);
  const b=Array.from({length:60},(_,i)=>({timestamp:base+i*900000,open:1.11,high:1.12,low:i===56?0.99:1.05,close:1.112}));
  const c={direction:'BUY',tf:'H1',origin:1.0,end_timestamp:base+3600000,levels:{'61.8':1.10}};
  assert.equal(inspectM15(b,c).state,'invalidado');
});
test('sin marcos frescos no valida un candidato para operar',()=>{
  const c={pair:'EUR/USD',tf:'H1',direction:'BUY',stage:'A',origin:1.1,end:1.12,x_timestamp:Date.UTC(2026,10,6),end_timestamp:Date.UTC(2026,10,6,1),levels:{'61.8':1.112,'78.6':1.109}};
  const x=assessCandidate(c,{});
  assert.equal(x.priority,'NO_VERIFICABLE');
  assert.ok(x.flags.includes('DATOS_INCOMPLETOS_O_ATRASADOS'));
});
