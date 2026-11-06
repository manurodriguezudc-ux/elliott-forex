// Exporta los OHLC cerrados a archivos versionados que ChatGPT puede leer
// mediante el conector GitHub. No modifica las órdenes del bróker.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function writeMarketSnapshot(sourceDir = 'docs/data', destinationDir = 'market-data') {
  const summary = JSON.parse(await fs.readFile(path.join(sourceDir, 'index.json'), 'utf8'));
  if (!Array.isArray(summary.status) || summary.status.length === 0) {
    throw new Error('No hay estado de series en docs/data/index.json');
  }
  await fs.mkdir(destinationDir, { recursive: true });
  const coverage = [];
  for (const info of summary.status) {
    if (!/^[A-Z]{3}\/\w{3}$/.test(info.pair) || !['M15', 'H1', 'H4', 'D1'].includes(info.tf)) {
      throw new Error(`Par o temporalidad inesperados: ${info.pair} ${info.tf}`);
    }
    const name = `${info.pair.replace('/', '')}_${info.tf}.json`;
    const source = JSON.parse(await fs.readFile(path.join(sourceDir, name), 'utf8'));
    if (source.pair !== info.pair || source.tf !== info.tf) {
      throw new Error(`Datos incoherentes en ${name}`);
    }
    const candles = Array.isArray(source.candles) ? source.candles.slice(-180) : [];
    const output = {
      pair: source.pair, tf: source.tf, source: source.source, side: source.side,
      fetchedAt: source.fetchedAt, lastClosedAt: source.lastClosedAt,
      fresh: Boolean(source.fresh) && candles.length >= 55,
      candleCount: source.candleCount, candles,
      candidates: Array.isArray(source.candidates) ? source.candidates : [],
      error: source.error || ''
    };
    if (!output.fresh) output.candidates = [];
    coverage.push({pair: output.pair, tf: output.tf, fresh: output.fresh,
      candlesAvailable: candles.length, lastClosedAt: output.lastClosedAt, error: output.error});
    await fs.writeFile(path.join(destinationDir, name), JSON.stringify(output));
  }
  const manifest = {
    fetchedAt: summary.fetchedAt,
    source: summary.source,
    total: coverage.length,
    verified: coverage.filter(x => x.fresh).length,
    coverage,
    candidates: Array.isArray(summary.candidates) ? summary.candidates : [],
    description: 'Datos OHLC BID de Dukascopy, velas cerradas en UTC. M15 sirve para confirmar la corrección y D1 para contexto de fondo; los candidatos H1/H4 son heurísticos y NO confirman ondas Elliott.',
    candleFiles: 'market-data/{BASEQUOTE}_{M15|H1|H4|D1}.json',
    candleCountPerFileMax: 180
  };
  await fs.writeFile(path.join(destinationDir, 'index.json'), JSON.stringify(manifest));
  console.log(`Snapshot versionado: ${manifest.verified}/${manifest.total} series verificadas`);
  return manifest;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  writeMarketSnapshot().catch(error => { console.error(error); process.exitCode = 1; });
}
