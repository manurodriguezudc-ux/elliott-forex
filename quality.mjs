// Evaluación objetiva de contexto. NO produce señales confirmadas de Elliott ni ejecuta operaciones.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const FRAME_MS={M15:900000,H1:3600000,H4:14400000,D1:86400000};
export const pipSize=pair=>pair.endsWith('/JPY')?0.01:0.0001;
export function ema(bars,n){
  if(bars.length<n)return null;
  const k=2/(n+1);
  let value=bars.slice(0,n).reduce((s,b)=>s+b.close,0)/n;
  for(let i=n;i<bars.length;i++)value+=k*(bars[i].close-value);
  return value;
}
export function atr(bars,n=14){
  if(bars.length<n+1)return null;
  const arr=[];
  for(let i=1;i<bars.length;i++){
    let c=bars[i],p=bars[i-1];
    arr.push(Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close)));
  }
  return arr.slice(-n).reduce((s,x)=>s+x,0)/n;
}
export function swingLevels(bars,side,radius=3){
  const result=[];
  for(let i=radius;i<bars.length-radius;i++){
    const v=bars[i][side];
    let ok=true;
    for(let j=i-radius;j<=i+radius;j++){
      if(i===j)continue;
      if(side==='high'&&bars[j].high>=v){ok=false;break;}
      if(side==='low'&&bars[j].low<=v){ok=false;break;}
    }
    if(ok)result.push({price:v,timestamp:bars[i].timestamp});
  }
  return result;
}
function condition(bars,side){
  if(!bars||bars.length<55)return {state:'no_verificable'};
  const close=bars.at(-1).close,e20=ema(bars,20),e50=ema(bars,50),p20=ema(bars.slice(0,-5),20);
  const bull=close>e20&&e20>e50&&e20>p20;
  const bear=close<e20&&e20<e50&&e20<p20;
  return {state:bull?'alcista':bear?'bajista':'mixto',close,ema20:e20,ema50:e50,ema20Slope5:e20-p20,aligned:side==='BUY'?bull:bear};
}
export function inspectM15(m15,candidate){
  if(!m15||m15.length<40)return {state:'no_verificable',reason:'Sin M15 suficiente'};
  const dir=candidate.direction,bull=dir==='BUY',origin=candidate.origin;
  const level=candidate.levels['61.8'];
  const after=m15.filter(b=>b.timestamp>=candidate.end_timestamp+FRAME_MS[candidate.tf]);
  if(!after.length)return {state:'esperar',reason:'Aún no hay M15 cerradas después del extremo'};
  const invalid=after.some(b=>bull?b.low<=origin:b.high>=origin);
  if(invalid)return {state:'invalidado',reason:'El precio traspasó el origen'};
  const touch=after.findIndex(b=>bull?b.low<=level:b.high>=level);
  if(touch<0)return {state:'zona_pendiente',reason:'M15 aún no ha tocado Fibonacci 61,8 %'};
  if(after.length-touch<5)return {state:'esperar',reason:'Muy pocas M15 después del toque'};
  const last=after.at(-1),prev=after.slice(-5,-1),e20=ema(m15,20);
  const broke=bull?last.close>Math.max(...prev.map(v=>v.high)):last.close<Math.min(...prev.map(v=>v.low));
  const emaCross=bull?last.close>e20:last.close<e20;
  return {state:broke&&emaCross?'microestructura_favorable':'esperar',
    reason:broke&&emaCross?'Cierre M15 rompe 4 velas previas a favor de la estructura y supera EMA20; confirmar pivotes manualmente':'Sin ruptura favorable vigente de microestructura',
    touchAt:new Date(after[touch].timestamp).toISOString(),currentM15Close:last.close,ema20:e20};
}
export function assessCandidate(candidate,frames){
  const side=candidate.direction,bull=side==='BUY',entry=candidate.levels['61.8'];
  const risk=Math.abs(entry-candidate.origin),tgt=candidate.end;
  const tf=frames[candidate.tf],h4=frames.H4,d1=frames.D1,m15=frames.M15;
  const flags=[];
  if(!tf?.fresh||!h4?.fresh||!d1?.fresh||!m15?.fresh){
    flags.push('DATOS_INCOMPLETOS_O_ATRASADOS');
  }
  const h4Cond=condition(h4?.candles,side),d1Cond=condition(d1?.candles,side);
  if(h4Cond.state!=='no_verificable'&&!h4Cond.aligned)flags.push('H4_NO_ALINEADO');
  if(d1Cond.state!=='no_verificable'&&!d1Cond.aligned)flags.push('D1_NO_ALINEADO');
  const sr=[];
  for(const [frame,rec] of [['H4',h4],['D1',d1]]){
    if(!rec?.candles?.length)continue;
    // Resistencias/soportes conocidos ANTES del inicio de la onda propuesta.
    const past=rec.candles.filter(b=>b.timestamp+FRAME_MS[frame]<=candidate.x_timestamp);
    const levels=swingLevels(past,bull?'high':'low',3);
    for(const x of levels)if(bull?x.price>entry:x.price<entry){
      const distance=Math.abs(x.price-entry);
      sr.push({tf:frame,price:x.price,timestamp:x.timestamp,distancePips:distance/pipSize(candidate.pair),distanceR:risk?distance/risk:null});
    }
  }
  sr.sort((a,b)=>a.distancePips-b.distancePips);
  const obstacle=sr[0]??null;
  const h4Atr=h4?.candles?atr(h4.candles):null;
  const roomR=obstacle?.distanceR??null;
  if(roomR!==null&&roomR<1.5)flags.push('OBSTACULO_ANTES_DE_1_5_R');
  if(h4Atr&&Math.abs(candidate.end-entry)<0.6*h4Atr)flags.push('TP1_ESPACIO_LIMITADO_VS_ATR_H4');
  if(h4Atr&&Math.abs(candidate.end-candidate.origin)>3*h4Atr)flags.push('IMPULSO_EXTENDIDO_REVISION_AGOTAMIENTO');
  const m15Check=inspectM15(m15?.candles,candidate);
  if(m15Check.state==='invalidado')flags.push('ORIGEN_INVALIDADO');
  if(m15Check.state!=='microestructura_favorable')flags.push('M15_SIN_CONFIRMACION');
  const opp=frames.H4?.candidates?.some(x=>x.direction!==side);
  if(opp)flags.push('RECUENTO_OPUESTO_H4');
  const priority=flags.includes('ORIGEN_INVALIDADO')?'INVALIDADO':
    flags.includes('DATOS_INCOMPLETOS_O_ATRASADOS')?'NO_VERIFICABLE':
    flags.includes('OBSTACULO_ANTES_DE_1_5_R')||flags.includes('D1_NO_ALINEADO')||flags.includes('H4_NO_ALINEADO')||flags.includes('RECUENTO_OPUESTO_H4')?'REQUIERE_REVISION_DE_CONTEXTO':
    m15Check.state==='microestructura_favorable'?'REVISAR_CONFIRMACION_M15':'EN_VIGILANCIA';
  return {pair:candidate.pair,tf:candidate.tf,direction:side,stage:candidate.stage,
    origin:candidate.origin,end:candidate.end,fib61:entry,fib78:candidate.levels['78.6'],
    h4Trend:h4Cond,d1Trend:d1Cond,nearestHistoricalObstacle:obstacle,
    availableRoomToObstacleR:roomR,h4Atr,m15:m15Check,flags,priority,
    disclaimer:'Criba técnica, NO recuento confirmado de cinco ondas. Evaluar ABC, canales y pivotes H4/D1 a mano; no abrir órdenes solo por este resultado.'};
}
export async function writeQualityIndex(dir='market-data'){
  const idx=JSON.parse(await fs.readFile(path.join(dir,'index.json'),'utf8'));
  const groups=new Map();
  for(const x of idx.coverage){
    const name=x.pair.replace('/','')+'_'+x.tf+'.json';
    const item=JSON.parse(await fs.readFile(path.join(dir,name),'utf8'));
    if(!groups.has(x.pair))groups.set(x.pair,{});
    groups.get(x.pair)[x.tf]=item;
  }
  const evaluations=[];
  for(const [pair,frames] of groups)for(const tf of ['H1','H4']){
    for(const candidate of frames[tf]?.candidates??[])evaluations.push(assessCandidate(candidate,frames));
  }
  const quality={fetchedAt:idx.fetchedAt,total:idx.total,verified:idx.verified,
    generatedAt:new Date().toISOString(),evaluations,
    method:'H4/D1 EMA20/50 y pendiente, pivotes de soporte/resistencia anteriores al inicio de onda, ATR H4, posible conflicto H4, toque 61,8 y señal simple de microestructura M15. No demuestra Elliott ni éxito estadístico.',
    status:'HEURISTICO: cualquier decisión operativa exige revisión del recuento ABC, canal, contexto y ejecución real del bróker'};
  await fs.writeFile(path.join(dir,'quality-index.json'),JSON.stringify(quality));
  idx.qualityFile='market-data/quality-index.json';
  idx.assessedCandidates=evaluations.length;
  await fs.writeFile(path.join(dir,'index.json'),JSON.stringify(idx));
  console.log('Evaluación de contexto:',evaluations.length,'candidatos');
  return quality;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  writeQualityIndex().catch(e=>{console.error(e);process.exitCode=1;});
}
