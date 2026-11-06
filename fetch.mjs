// La librería de mercado se importa solo durante la descarga; las pruebas locales no necesitan conexión.
import fs from 'node:fs/promises';
import path from 'node:path';

// Datos de mercado únicamente: NO envía órdenes ni usa claves de bróker.
export const PAIRS = [
  'EUR/USD', 'CAD/JPY', 'GBP/CHF', 'AUD/NZD', 'GBP/JPY',
  'GBP/USD', 'USD/JPY', 'AUD/USD', 'NZD/USD', 'USD/CAD',
  'USD/CHF', 'EUR/JPY', 'EUR/GBP', 'AUD/JPY', 'EUR/AUD'
];
const FRAMES = [ ['M15', 'm15', 900000], ['H1', 'h1', 3600000], ['H4', 'h4', 14400000], ['D1', 'd1', 86400000] ];
const ROOT = path.resolve('docs');
const now = Date.now();
const fetchedAt = new Date(now).toISOString();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const stamp = t => new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
const fmt = x => Number.isFinite(x) ? Number(x).toFixed(5) : '-';
const pip = pair => pair.endsWith('/JPY') ? 0.01 : 0.0001;

export function cleanCandles(raw, ms, checkedAt=now) {
  if (!Array.isArray(raw)) return [];
  const tmp = [];
  for (const c of raw) {
    const timestamp = Number(c.timestamp);
    const open = Number(c.open), high = Number(c.high), low = Number(c.low), close = Number(c.close);
    if (![timestamp, open, high, low, close].every(Number.isFinite)) continue;
    if (timestamp < 1500000000000 || open <= 0 || low <= 0 || high < Math.max(open, close, low) || low > Math.min(open, close)) continue;
    // Solo velas cerradas, con un minuto adicional de margen frente al feed.
    if (timestamp + ms > checkedAt - 60000) continue;
    tmp.push({timestamp, open, high, low, close});
  }
  return [...new Map(tmp.map(c => [c.timestamp, c])).values()].sort((a,b) => a.timestamp-b.timestamp).slice(-240);
}
function atr(bars, n=14) {
  if (bars.length < n + 2) return 0;
  const rs = bars.slice(-n).map((b, k) => {
    const prev = bars[bars.length - n - 1 + k];
    return Math.max(b.high-b.low, Math.abs(b.high-prev.close), Math.abs(b.low-prev.close));
  });
  return rs.reduce((a,b)=>a+b,0)/rs.length;
}
function pivots(b, side, radius=3) {
  const found = [];
  for (let i=radius; i < b.length-radius; i++) {
    const v=b[i][side];
    let ok=true;
    for (let j=i-radius;j<=i+radius;j++) if (i!==j && (side==='high' ? b[j].high >=v : b[j].low<=v)) {ok=false;break;}
    if(ok) found.push(i);
  }
  return found;
}
// Heurística transparente para proponer candidatos, NO un recuento Elliott confirmado.
export function candidates(bars, pair, tf) {
  if (bars.length < 55) return [];
  const b = bars.slice(-180), n=b.length, measure=atr(b), minLeg=Math.max(measure*2.0, pip(pair)*18);
  const highs=pivots(b,'high'), lows=pivots(b,'low');
  const out=[];
  for(const direction of ['BUY','SELL']) {
    const bull=direction==='BUY', xs=bull?lows:highs, opposite=bull?highs:lows;
    let best=null;
    for (const xi of xs) {
      if(xi < 6 || xi>n-6 || n-xi>80) continue;
      const prev=opposite.filter(i=>i<xi && xi-i<=55).at(-1);
      if(prev===undefined) continue;
      const x=bull?b[xi].low:b[xi].high, breakPrice=bull?b[prev].high:b[prev].low;
      const endSeries=b.slice(xi+1), maxmin=bull?Math.max(...endSeries.map(z=>z.high)):Math.min(...endSeries.map(z=>z.low));
      const ei=xi+1+endSeries.findLastIndex(z=>(bull?z.high===maxmin:z.low===maxmin));
      const wave=Math.abs(maxmin-x);
      if(wave<minLeg || (bull?maxmin<=breakPrice:maxmin>=breakPrice)) continue;
      const broken=b.slice(xi+1).some(z=>bull?z.close>breakPrice:z.close<breakPrice);
      if(!broken) continue;
      const after=b.slice(ei+1), bad=after.some(z=>bull?z.low<=x:z.high>=x);
      if(bad) continue;
      const maxPullback=after.length ? (bull?maxmin-Math.min(...after.map(z=>z.low)):Math.max(...after.map(z=>z.high))-maxmin)/wave : 0;
      const currentPullback=(bull?maxmin-b.at(-1).close:b.at(-1).close-maxmin)/wave;
      const stage=maxPullback>=0.1 ? 'B: posible onda 2 iniciada' : 'A: posible onda 1 tras ruptura';
      const candidate={pair,tf,direction,stage,x_timestamp:b[xi].timestamp,end_timestamp:b[ei].timestamp,origin:x,end:maxmin,brokenPivot:breakPrice,depthMaxPct:Math.max(0,100*maxPullback),depthNowPct:Math.max(0,100*currentPullback), currentClose:b.at(-1).close, levels:{'50':maxmin+(x-maxmin)*0.5,'61.8':maxmin+(x-maxmin)*0.618,'70.6':maxmin+(x-maxmin)*0.706,'78.6':maxmin+(x-maxmin)*0.786,'88.6':maxmin+(x-maxmin)*0.886,'100':x},invalidated:false, note:'Heurística: pivote de 3 velas, cierre más allá de pivote previo y tramo >= 2 ATR y 18 pips. NO confirma cinco subondas Elliott.'};
      if(!best || candidate.end_timestamp>best.end_timestamp) best=candidate;
    }
    if(best) out.push(best);
  }
  return out;
}
async function fetchFrame(pair, frame, ms) {
  const {getRealTimeRates, getHistoricalRates} = await import('dukascopy-node');
  const id=pair.replace('/','').toLowerCase();
  let data, error;
  try {
    data=await getRealTimeRates({instrument:id, timeframe:frame, format:'json', priceType:'bid', last:250, volumes:false, requestIntervalMs:150, rateLimitRetryCount:3});
  } catch (e) { error=String(e.message||e); }
  let clean=cleanCandles(data,ms);
  if (clean.length < 55) {
    try {
      const days=frame==='m15'?7:frame==='h1'?19:frame==='h4'?55:360;
      const raw=await getHistoricalRates({instrument:id, dates:{from:new Date(now-days*86400000),to:new Date(now)}, timeframe:frame, priceType:'bid', format:'json', volumes:false, retryCount:1, requestIntervalMs:150});
      clean=cleanCandles(raw,ms);
    } catch(e){ error=(error?error+'; ':'')+String(e.message||e); }
  }
  if (!clean.length) throw new Error(error||'No se recibieron velas OHLC válidas');
  const last=clean.at(-1);
  const staleMs=frame==='m15'?3*3600000:frame==='h1'?9*3600000:frame==='h4'?14*3600000:84*3600000;
  const weekday=new Date(now).getUTCDay();
  const weekend=(weekday===6 || weekday===0);
  const fresh=weekend?false:(now-(last.timestamp+ms)<=staleMs);
  return {pair,tf:frame.toUpperCase(),source:'Dukascopy vía dukascopy-node',side:'BID',fetchedAt,lastClosedAt:new Date(last.timestamp).toISOString(),fresh,candleCount:clean.length,candles:clean,candidates:fresh && (frame==='h1'||frame==='h4')?candidates(clean,pair,frame.toUpperCase()):[],error:(!fresh?'Datos atrasados o mercado cerrado':'')};
}
function reportHTML(rec){
  const links=`<p><a href="index.html">Volver al índice</a> · <a href="data/${rec.pair.replace('/','')}_${rec.tf}.json">Datos JSON originales normalizados</a></p>`;
  const heading=`<h1>${esc(rec.pair)} — ${esc(rec.tf)}</h1><p>Fuente: Dukascopy · precio BID · velas cerradas en UTC · última vela: <strong>${rec.candles?.length?stamp(rec.candles.at(-1).timestamp):'no disponible'}</strong>. Datos obtenidos: ${esc(rec.fetchedAt||'')}.</p>`;
  const warn=rec.fresh?'<p>La fuente ha suministrado datos recientes; el análisis de Elliott sigue siendo hipotético.</p>':'<p><strong>NO VERIFICADO / DATOS ATRASADOS O INSUFICIENTES. NO EMITIR SEÑALES.</strong></p>';
  const tbl=(rec.candles||[]).slice(-160).reverse().map(c=>`<tr><td>${stamp(c.timestamp)}</td><td>${fmt(c.open)}</td><td>${fmt(c.high)}</td><td>${fmt(c.low)}</td><td>${fmt(c.close)}</td></tr>`).join('\n');
  const sig=(rec.candidates||[]).map(s=>`<tr><td>${s.direction}</td><td>${esc(s.stage)}</td><td>${fmt(s.origin)}</td><td>${fmt(s.end)}</td><td>${s.depthMaxPct.toFixed(1)}%</td><td>${fmt(s.levels['61.8'])}</td><td>${fmt(s.levels['78.6'])}</td></tr>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(rec.pair)} ${rec.tf} OHLC</title><style>body{font:15px system-ui;max-width:1100px;margin:25px auto;padding:0 12px;line-height:1.5}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:5px;text-align:right}th:first-child,td:first-child{text-align:left}thead{background:#eee}small{color:#666}</style></head><body>${links}${heading}${warn}<h2>Candidatos heurísticos (revisión humana obligatoria)</h2><table><tr><th>Dirección</th><th>Fase</th><th>Origen</th><th>Extremo</th><th>Retroceso máx.</th><th>Fib 61,8</th><th>Fib 78,6</th></tr>${sig||'<tr><td colspan="7">Sin candidatos de la heurística; no equivale a ausencia de ondas Elliott.</td></tr>'}</table><h2>OHLC por temporalidad: últimas velas cerradas</h2><table><thead><tr><th>Inicio (UTC)</th><th>Open</th><th>High</th><th>Low</th><th>Close</th></tr></thead><tbody>${tbl}</tbody></table><small>Las velas no son de MetaTrader; diferencia de proveedor, spread BID/ASK y horario pueden desplazar máximos/mínimos y Fibonacci. No son señales para ejecutar automáticamente.</small></body></html>`;
}
async function main(){
  await fs.mkdir(ROOT,{recursive:true});
  await fs.mkdir(path.join(ROOT,'data'),{recursive:true});
  const all=[];
  for(const pair of PAIRS){
    for(const [upper, low, ms] of FRAMES){
      console.log('Buscando',pair,upper);
      let rec;
      try {rec=await fetchFrame(pair,low,ms);}
      catch(e){rec={pair,tf:upper,source:'Dukascopy',fetchedAt,fresh:false,candleCount:0,candles:[],candidates:[],error:String(e.message||e)};}
      all.push(rec);
      const prefix=pair.replace('/','')+'_'+upper;
      await fs.writeFile(path.join(ROOT,'data',prefix+'.json'),JSON.stringify(rec,null,2));
      await fs.writeFile(path.join(ROOT,prefix+'.html'),reportHTML(rec));
      await sleep(250);
    }
  }
  const valid=all.filter(r=>r.fresh&&r.candleCount>=55);
  const signs=valid.flatMap(r=>r.candidates);
  await fs.writeFile(path.join(ROOT,'data','index.json'),JSON.stringify({fetchedAt,source:'Dukascopy via dukascopy-node',verified:valid.length,total:all.length,status:all.map(({pair,tf,fresh,candleCount,lastClosedAt,error})=>({pair,tf,fresh,candleCount,lastClosedAt,error})),candidates:signs},null,2));
  const rows=all.map(r=>`<tr><td>${esc(r.pair)}</td><td>${r.tf}</td><td>${r.fresh&&r.candleCount>=55?'VERIFICADO':'NO VERIFICADO'}</td><td>${r.candleCount||0}</td><td>${r.candles?.length?stamp(r.candles.at(-1).timestamp):'—'}</td><td>${r.candidates?.length||0}</td><td><a href="${r.pair.replace('/','')}_${r.tf}.html">Ver velas</a></td><td>${esc(r.error||'')}</td></tr>`).join('\n');
  const srows=signs.map(s=>`<tr><td>${esc(s.pair)}</td><td>${s.tf}</td><td>${s.direction}</td><td>${esc(s.stage)}</td><td>${fmt(s.origin)}</td><td>${fmt(s.end)}</td><td>${s.depthMaxPct.toFixed(1)}%</td><td>${fmt(s.levels['61.8'])}</td><td>${fmt(s.levels['78.6'])}</td></tr>`).join('\n');
  const summary=`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Monitor Forex Elliott H1 H4</title><style>body{font:14px system-ui;max-width:1300px;margin:24px auto;padding:0 12px;line-height:1.5}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:5px;text-align:left}thead{background:#eee}p.warn{border-left:3px solid #b60;padding-left:10px}</style></head><body><h1>OHLC Forex para vigilancia Elliott M15, H1, H4 y D1</h1><p>Última actualización: <strong>${esc(fetchedAt)}</strong> (UTC). Fuente: <a href="https://www.dukascopy.com/">Dukascopy</a>, extracción con dukascopy-node. Datos de precios BID. Se excluyen velas todavía en formación.</p><p>Series verificadas: <strong>${valid.length}/${all.length}</strong> (15 pares x 4 marcos). <a href="data/index.json">Resumen estructurado JSON</a>.</p><p class="warn">ATENCIÓN: los candidatos inferiores son heurísticos, NO validaciones Elliott. Para informar de una oportunidad, comprobar los pivotes y las velas de su enlace individual. Si falla la fuente, marcar la serie como NO VERIFICADA y no generar señales.</p><h2>Candidatos de ruptura y retroceso (provisionales)</h2><table><thead><tr><th>Par</th><th>Marco</th><th>Dirección</th><th>Hito</th><th>Origen</th><th>Extremo</th><th>Máx. retroceso</th><th>61,8</th><th>78,6</th></tr></thead><tbody>${srows||'<tr><td colspan="9">Sin candidatos heurísticos comprobados.</td></tr>'}</tbody></table><h2>Comprobación por par y temporalidad</h2><table><thead><tr><th>Par</th><th>Marco</th><th>Estado</th><th>Velas</th><th>Última vela cerrada</th><th>Candidatos</th><th>OHLC</th><th>Incidencia</th></tr></thead><tbody>${rows}</tbody></table><p>Los precios de un proveedor pueden diferir del bróker MT4 por su horario de velas, spread y liquidez. No es un sistema de ejecución ni asesoramiento financiero.</p></body></html>`;
  await fs.writeFile(path.join(ROOT,'index.html'),summary);
  await fs.writeFile(path.join(ROOT,'.nojekyll'),'');
  console.log(`Informe generado: ${valid.length}/${all.length} series verificadas; candidatos heurísticos H1/H4: ${signs.length}`);
  // Publicar también los fallos: 0/30 es un resultado honesto y evita conservar una página anterior que parezca actual.
}
if (process.argv[1] && new URL('file://'+path.resolve(process.argv[1])).href === import.meta.url) main().catch(err=>{console.error(err);process.exitCode=1;});
