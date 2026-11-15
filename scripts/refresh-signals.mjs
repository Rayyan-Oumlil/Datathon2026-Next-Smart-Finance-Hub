#!/usr/bin/env node
// Warms the daily signal cache for the whole universe, so the watchlist never waits on a provider.
// Run: node scripts/refresh-signals.mjs [--symbols AAPL,RY.TO]
// A full cold pass takes several minutes: Finnhub allows 60 calls a minute and a US stock needs 4.
import 'dotenv/config';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
process.chdir(root);

// The source modules are TypeScript with '@/' imports: bundle them once, then load the bundle.
const outfile = path.join(root, '.data', 'refresh-signals.bundle.mjs');
await mkdir(path.dirname(outfile), { recursive: true });
await build({
    stdin: {
        contents: `export { getUniverse } from '@/lib/universe'; export { marketDate, refreshDailySignals } from '@/lib/sources/daily-signals'; export { collectSignals } from '@/lib/sources/signals'; export { cacheDir, readJsonFile, writeJsonFile } from '@/lib/sources/cache';`,
        resolveDir: root,
        loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    outfile,
    logLevel: 'error',
});
const { getUniverse, marketDate, refreshDailySignals, collectSignals, cacheDir, readJsonFile, writeJsonFile } = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);

const only = process.argv.includes('--symbols') ? new Set(process.argv[process.argv.indexOf('--symbols') + 1].toUpperCase().split(',')) : null;
const entries = getUniverse().filter((entry) => !only || only.has(entry.symbol));

const started = Date.now();
const elapsed = () => `${Math.round((Date.now() - started) / 1000)} s`;
const failures = new Map();     // 'Finnhub quote' -> symbols it failed for
console.log(`collecting signals for ${entries.length} entries ...`);

const options = {
    onProgress: (done, total, symbol) => {
        if (done % 10 === 0 || done === total) console.log(`  ${done}/${total}  (${symbol})  ${elapsed()}`);
    },
    onError: (symbol, what, error) => {
        failures.set(what, [...(failures.get(what) ?? []), symbol]);
        // The message never holds the key: it travels in a header
        console.log(`  refused: ${what} for ${symbol}: ${String(error?.message ?? error).slice(0, 140)}`);
    },
};

// A full pass replaces the day's file. A partial pass (--symbols) replaces only its symbols in today's file:
// rewriting the file with them alone would drop every entry already collected today.
async function refreshSome() {
    const date = marketDate();
    const file = path.join(cacheDir(), 'signals', `${date}.json`);
    const held = await readJsonFile(file);
    if (!held || !Array.isArray(held.signals)) return refreshDailySignals(entries, options);
    const fresh = await collectSignals(entries, options);
    const merged = { ...held, fxUsdCad: fresh.fxUsdCad ?? held.fxUsdCad, signals: [...held.signals.filter((set) => !only.has(set.symbol)), ...fresh.signals] };
    await writeJsonFile(file, merged);
    console.log(`  today's file keeps its ${merged.signals.length - fresh.signals.length} other entries`);
    return { ...merged, signals: fresh.signals };
}
const daily = only ? await refreshSome() : await refreshDailySignals(entries, options);

const missing = new Map();      // signal name -> symbols without it
for (const set of daily.signals) {
    for (const name of set.missing) missing.set(name, [...(missing.get(name) ?? []), set.symbol]);
}
const list = (symbols) => (symbols.length > 12 ? `${symbols.slice(0, 12).join(', ')} ... (${symbols.length})` : symbols.join(', '));

console.log(`\ndone in ${elapsed()}: ${daily.signals.length} entries for ${daily.date}, collected at ${daily.collectedAt}`);
console.log(`USD/CAD: ${daily.fxUsdCad ? `${daily.fxUsdCad.value} (${daily.fxUsdCad.source}, ${daily.fxUsdCad.asOf})` : 'not available'}`);
console.log(`complete (nothing missing): ${daily.signals.filter((set) => set.missing.length === 0).length}`);
console.log('\nprovider calls that failed:');
if (failures.size === 0) console.log('  none');
for (const [what, symbols] of [...failures].sort()) console.log(`  ${what}: ${symbols.length}  [${list(symbols)}]`);
console.log('\nsignals missing (no value invented):');
if (missing.size === 0) console.log('  none');
for (const [name, symbols] of [...missing].sort()) console.log(`  ${name}: ${symbols.length}  [${list(symbols)}]`);
