// A live check against the real providers, skipped unless LIVE=1 (it needs the network and FINNHUB_API_KEY):
//   set -a; . ./.env; set +a; LIVE=1 npx vitest run __tests__/sources/live.test.ts
import { describe, expect, it } from 'vitest';
import type { UniverseEntry } from '@/lib/domain/types';
import * as boc from '@/lib/sources/boc';
import { collectSignals } from '@/lib/sources/signals';

const entry = (symbol: string, assetClass: UniverseEntry['assetClass'], market: UniverseEntry['market']): UniverseEntry =>
    ({ symbol, name: symbol, assetClass, market, themes: [], esg: 'not screened', listSource: 'live check' });

describe.skipIf(!process.env.LIVE)('live providers', () => {
    it('collects one candidate of each kind and prints what came back', async () => {
        const entries = [
            entry('AAPL', 'stock', 'US'), entry('RY.TO', 'stock', 'Canada'), entry('XIU.TO', 'etf', 'Canada'),
            entry('BTC', 'crypto', 'none'), entry('GOLD', 'gold', 'none'), entry('CA5Y', 'bond_yield', 'none'),
        ];
        const errors: string[] = [];
        const { signals, fxUsdCad } = await collectSignals(entries, { onError: (symbol, what, e) => errors.push(`${symbol} / ${what}: ${e instanceof Error ? e.message : e}`) });
        const short = (x: unknown) => (Array.isArray(x) ? `[${x.length} values]` : typeof x === 'number' ? Number(x.toPrecision(8)) : x);
        for (const set of signals) {
            console.log(`\n${set.symbol}  missing: ${set.missing.join(', ') || 'nothing'}`);
            for (const [name, sourced] of Object.entries(set)) {
                if (sourced && typeof sourced === 'object' && 'fetchedAt' in sourced) console.log(`  ${name} = ${short(sourced.value)} ${sourced.unit ?? ''} | ${sourced.source} | asOf ${sourced.asOf ?? '-'}`);
            }
        }
        console.log('\nFXUSDCAD', fxUsdCad?.value, fxUsdCad?.asOf, '| yields', JSON.stringify(await boc.bondYields().then((y) => Object.entries(y).map(([term, s]) => `${term} ${s.value}% (${s.asOf})`))), '| policy rate', (await boc.policyRate()).value);
        console.log('\nProvider failures:\n' + (errors.join('\n') || 'none'));
        expect(signals).toHaveLength(entries.length);
    }, 120_000);
});
