// A small synthetic DataProvider for the engine tests: same interface as the snapshot provider, values written by
// hand in the tests. No file, no network.
import type { DataProvider } from '@/lib/replay/provider';
import type { AssetClass, DailyPrice, DataNote, DatasetDescription, FxPoint, ListingCurrency, Provenance, ReplayAsset, ReplayTable } from '@/lib/replay/types';

export type FixtureAsset = { currency: ListingCurrency; assetClass?: AssetClass; market?: string; prices: number[]; startAt?: number };
export type Fixture = { dates: string[]; assets: Record<string, FixtureAsset>; usdcad: number[]; id?: string };

/** `count` consecutive weekdays from `from` (an ISO date). */
export function weekdays(from: string, count: number): string[] {
    const out: string[] = [];
    const d = new Date(`${from}T00:00:00Z`);
    while (out.length < count) {
        if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
        d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
}

const provenance = (id: string): Provenance => ({
    datasetId: id, file: 'fixture', content: 'synthetic prices', source: 'test fixture', sourceUrl: null, retrievedOn: '2026-11-15',
    coverage: 'synthetic', frequency: 'daily', processing: 'none', limitations: 'synthetic', termsOfUse: 'n/a',
});

export const FIXTURE_LIMITATIONS: DataNote[] = [{ id: 'synthetic', textRef: { key: 'limitations.synthetic' }, detail: 'synthetic prices written for a test' }];

export function fixtureProvider(fixture: Fixture): DataProvider {
    const id = fixture.id ?? 'fixture-1';
    const table = <R>(tableId: string, rows: R[]): ReplayTable<R> => ({ id: tableId, rows, provenance: provenance(id) });
    const rowsOf = (ticker: string): DailyPrice[] => {
        const asset = fixture.assets[ticker];
        if (!asset) throw new Error(`unknown ticker "${ticker}"`);
        return asset.prices.map((price, i) => ({ date: fixture.dates[i + (asset.startAt ?? 0)], ticker, open: price, high: price, low: price, close: price, adjClose: price, volume: 1000, currency: asset.currency }));
    };
    const assets: ReplayAsset[] = Object.entries(fixture.assets).map(([ticker, a]) => ({
        assetId: ticker, ticker, name: ticker, assetClass: a.assetClass ?? 'equity', market: a.market ?? (a.currency === 'CAD' ? 'TSX' : 'NYSE'), currency: a.currency, sector: 'n/a',
    }));
    const description: DatasetDescription = { datasetId: id, provider: 'fixture', extractedOn: '2026-11-15', window: { from: fixture.dates[0], to: fixture.dates[fixture.dates.length - 1] }, files: [], notes: [], limitations: FIXTURE_LIMITATIONS };
    return {
        getAssets: async () => table('assets', assets),
        getDailyPrices: async (tickers) => tickers.map((ticker) => ({ ...table(ticker, rowsOf(ticker)), currency: fixture.assets[ticker].currency })),
        getFx: async () => table<FxPoint>('fx:USDCAD', fixture.usdcad.map((usdcad, i) => ({ date: fixture.dates[i], usdcad, cadusd: 1 / usdcad }))),
        getCorporateActions: async () => table('corporate_actions', []),
        getMacro: async () => [],
        getSourcesMetadata: async () => [],
        describe: async () => description,
    };
}

/**
 * A deterministic market of `days` weekdays from 2021-12-01 (so it crosses a year end and several quarters):
 * GROW (CAD) climbs, SWING (USD) falls by a third then recovers, SAFE (CAD) barely moves; XIU.TO and XBB.TO are the
 * benchmark legs. USD/CAD drifts from 1.25 to about 1.35.
 */
export function syntheticMarket(days = 300): Fixture {
    const dates = weekdays('2021-12-01', days);
    const wave = (i: number, period: number) => Math.sin((2 * Math.PI * i) / period);
    const series = (make: (i: number) => number) => dates.map((_, i) => Math.round(make(i) * 10000) / 10000);
    return {
        dates,
        usdcad: series((i) => 1.25 + 0.1 * (i / days) + 0.01 * wave(i, 37)),
        assets: {
            GROW: { currency: 'CAD', prices: series((i) => 50 * (1 + 0.002 * i) * (1 + 0.03 * wave(i, 23))) },
            SWING: { currency: 'USD', prices: series((i) => 100 * (1 - 0.35 * Math.sin((Math.PI * Math.min(i, 200)) / 200)) * (1 + 0.02 * wave(i, 11))) },
            SAFE: { currency: 'CAD', prices: series((i) => 20 * (1 + 0.0001 * i)) },
            'XIU.TO': { currency: 'CAD', prices: series((i) => 30 * (1 + 0.0005 * i) * (1 + 0.04 * wave(i, 60))) },
            'XBB.TO': { currency: 'CAD', prices: series((i) => 28 * (1 + 0.0001 * i)) },
        },
    };
}
