import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UniverseEntry } from '@/lib/domain/types';
import { collectSignals } from '@/lib/sources/signals';
import { annualizedVolatility } from '@/lib/sources/volatility';
import { fixture, freshCache, mockProviders } from './helpers';

beforeEach(() => {
    freshCache();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-14T22:00:00Z'));
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

const entry = (symbol: string, assetClass: UniverseEntry['assetClass'], market: UniverseEntry['market'], sector?: string): UniverseEntry =>
    ({ symbol, name: symbol, assetClass, market, sector, themes: [], esg: 'not screened', listSource: 'test list' });

const AAPL = entry('AAPL', 'stock', 'US', 'Information Technology');
const RY = entry('RY.TO', 'stock', 'Canada', 'Financials');
const XIU = entry('XIU.TO', 'etf', 'Canada');
const BTC = entry('BTC', 'crypto', 'none');
const GOLD = entry('GOLD', 'gold', 'none');
const CA5Y = entry('CA5Y', 'bond_yield', 'none');

const tmxCloses = () => (fixture('tmx-timeseries-RY.json').data.getTimeSeriesData as Array<{ close: number }>).map((row) => row.close).reverse();
const yahooRefuses = (call: { url: string }) => (call.url.includes('yahoo') ? { status: 404 } : undefined);

describe('collectSignals', () => {
    it('routes a US stock to Finnhub, with history from Yahoo', async () => {
        const calls = mockProviders();
        const { signals: [aapl], fxUsdCad } = await collectSignals([AAPL]);
        expect(fxUsdCad).toMatchObject({ value: 1.4257, source: 'Bank of Canada' });
        expect(aapl.price).toMatchObject({ value: 356.27, source: 'Finnhub' });
        expect(aapl.changePercent?.value).toBe(0.3917);
        expect(aapl.marketCapUsd).toMatchObject({ unit: 'USD', currency: 'USD', source: 'Finnhub' });
        expect(aapl.marketCapUsd?.value).toBeCloseTo(5177380.424341398e6, 0);
        expect(aapl.avgDailyTradedValueUsd).toMatchObject({ source: 'derived', unit: 'USD per day' });
        expect(aapl.avgDailyTradedValueUsd?.value).toBeCloseTo(52.28032e6 * 356.27, 0);
        expect(aapl.avgDailyTradedValueUsd?.note).toContain('x last price 356.27 USD (Finnhub)');
        expect(aapl.pe?.value).toBe(39.1706);
        expect(aapl.revenueGrowthPct?.value).toBe(15.06);
        expect(aapl.beta?.value).toBe(1.0898671);
        expect(aapl.sectorLabel).toMatchObject({ value: 'Technology', source: 'Finnhub' });
        expect(aapl.newsCount7d?.value).toBe(40);
        expect(aapl.closes1m).toMatchObject({ value: [100, 101, 102], source: 'Yahoo chart (unofficial)' });
        // The Yahoo fixture has 3 closes: too few for a volatility, so it is named as missing, not estimated
        expect(aapl.volatility1y).toBeUndefined();
        expect(aapl.missing).toEqual(['volatility1y']);
        expect(calls.some((call) => call.url.includes('tmx.com'))).toBe(false);
    });

    it('falls back to TMX Money (SYMBOL:US) for US history when Yahoo refuses', async () => {
        const calls = mockProviders(yahooRefuses);
        const { signals: [aapl] } = await collectSignals([AAPL]);
        const tmxCall = calls.find((call) => call.url.includes('tmx.com'))!;
        expect(JSON.parse(String(tmxCall.init?.body)).variables.symbol).toBe('AAPL:US');
        expect(aapl.volatility1y).toMatchObject({ source: 'derived', unit: 'fraction per year', asOf: '2026-11-13' });
        expect(aapl.volatility1y?.value).toBeCloseTo(annualizedVolatility(tmxCloses())!, 12);
        expect(aapl.volatility1y?.note).toContain('39 daily returns x sqrt(252)');
        expect(aapl.volatility1y?.note).toContain('from TMX Money (delayed 15 min or more)');
        expect(aapl.missing).toEqual([]);
    });

    it('routes a Canadian stock to TMX Money and converts CAD to USD with the Bank of Canada rate', async () => {
        const calls = mockProviders();
        const { signals: [ry] } = await collectSignals([RY]);
        expect(calls.some((call) => call.url.includes('finnhub') || call.url.includes('yahoo'))).toBe(false);
        expect(ry.price).toMatchObject({ value: 288.37, currency: 'CAD', source: 'TMX Money (delayed 15 min or more)' });
        expect(ry.marketCapUsd?.value).toBeCloseTo(399112274611 / 1.4257, 2);
        expect(ry.marketCapUsd).toMatchObject({ currency: 'USD', source: 'TMX Money (delayed 15 min or more)' });
        expect(ry.marketCapUsd?.note).toContain('converted from CAD at 1.4257 CAD per USD (Bank of Canada FXUSDCAD, 2026-11-13)');
        expect(ry.avgDailyTradedValueUsd?.value).toBeCloseTo((2830331 * 288.37) / 1.4257, 2);
        expect(ry.avgDailyTradedValueUsd?.note).toContain('converted from CAD at 1.4257');
        expect(ry.pe?.value).toBe(16.88);
        expect(ry.sectorLabel).toMatchObject({ value: 'Finance' });
        expect(ry.volatility1y?.value).toBeCloseTo(annualizedVolatility(tmxCloses())!, 12);
        expect(ry.closes1m?.value.at(-1)).toBe(288.37);
        expect(ry.closes1m?.value.length).toBeLessThan(40);
        // TMX Money gives neither: named, never filled in
        expect(ry.missing).toEqual(['revenueGrowthPct', 'newsCount7d']);
    });

    it('expects no market cap, P/E or sector from an ETF', async () => {
        mockProviders();
        const { signals: [xiu] } = await collectSignals([XIU]);
        expect(xiu.price?.value).toBe(54.55);
        expect(xiu.marketCapUsd).toBeUndefined();
        expect(xiu.pe).toBeUndefined();
        expect(xiu.sectorLabel).toBeUndefined();
        expect(xiu.avgDailyTradedValueUsd?.value).toBeCloseTo((4308991 * 54.55) / 1.4257, 2);
        expect(xiu.missing).toEqual([]);
    });

    it('routes crypto to Kraken, gold to the Yahoo gold future and yields to the Bank of Canada', async () => {
        mockProviders();
        const { signals: [btc, gold, yield5] } = await collectSignals([BTC, GOLD, CA5Y]);
        expect(btc.price).toMatchObject({ value: 92831.6, currency: 'CAD', source: 'Kraken' });
        expect(btc.volatility1y?.note).toContain('38 daily returns');
        expect(btc.missing).toEqual([]);
        expect(gold.price?.source).toBe('Yahoo chart (unofficial), COMEX gold futures');
        expect(gold.missing).toEqual(['volatility1y']);
        expect(yield5.price).toMatchObject({ value: 3.53, unit: '%', source: 'Bank of Canada', asOf: '2026-11-12' });
        expect(yield5.price?.note).toContain('a yield, not a price');
        expect(yield5.missing).toEqual([]);
    });

    it('names every signal as missing when the providers refuse, and reports each failure', async () => {
        mockProviders(() => ({ status: 403 }));
        const errors: string[] = [];
        const { signals, fxUsdCad } = await collectSignals([AAPL, RY, BTC, CA5Y, entry('DOGE', 'crypto', 'none'), entry('CA99Y', 'bond_yield', 'none')], {
            onError: (symbol, what) => errors.push(`${symbol}: ${what}`),
        });
        expect(fxUsdCad).toBeUndefined();
        expect(signals[0].missing).toEqual(['price', 'changePercent', 'marketCapUsd', 'avgDailyTradedValueUsd', 'volatility1y', 'beta', 'pe', 'revenueGrowthPct', 'closes1m', 'newsCount7d']);
        // The sector then comes from the candidate list, labelled with the list as its source
        expect(signals[0].sectorLabel).toMatchObject({ value: 'Information Technology', source: 'test list' });
        expect(signals[1].missing).toContain('price');
        expect(signals[2].missing).toEqual(['price', 'changePercent', 'volatility1y', 'closes1m']);
        expect(signals[3].missing).toEqual(['price']);
        expect(signals[4].missing).toEqual(['price', 'changePercent', 'volatility1y', 'closes1m']);
        expect(signals[5].missing).toEqual(['price']);
        expect(errors).toContain('FXUSDCAD: Bank of Canada USD/CAD rate');
        expect(errors).toContain('AAPL: Finnhub quote');
        for (const set of signals) expect(Object.keys(set).sort()).toEqual(expect.arrayContaining(['entry', 'missing', 'symbol']));
    });

    it('leaves CAD amounts unconverted and missing when the exchange rate is not available', async () => {
        mockProviders((call) => (call.url.includes('bankofcanada') ? { status: 503 } : undefined));
        const { signals: [ry] } = await collectSignals([RY]);
        expect(ry.price?.value).toBe(288.37);
        expect(ry.missing).toEqual(['marketCapUsd', 'avgDailyTradedValueUsd', 'revenueGrowthPct', 'newsCount7d']);
    }, 10_000);

    it('stops asking Yahoo after three refusals in a row', async () => {
        const calls = mockProviders(yahooRefuses);
        const many = ['A', 'B', 'C', 'D', 'E'].map((symbol) => entry(symbol, 'etf', 'US'));
        await collectSignals(many, { concurrency: 1 });
        expect(calls.filter((call) => call.url.includes('yahoo'))).toHaveLength(3);
        expect(calls.filter((call) => call.url.includes('tmx.com'))).toHaveLength(5);
    });

    it('keeps the order of the entries and reports progress', async () => {
        mockProviders();
        const progress: string[] = [];
        const { signals } = await collectSignals([XIU, BTC, RY, CA5Y], { concurrency: 2, onProgress: (done, total, symbol) => progress.push(`${done}/${total} ${symbol}`) });
        expect(signals.map((set) => set.symbol)).toEqual(['XIU.TO', 'BTC', 'RY.TO', 'CA5Y']);
        expect(progress).toHaveLength(4);
        expect(progress[3]).toMatch(/^4\/4 /);
    });

    it('gives the same output for the same inputs', async () => {
        mockProviders();
        const first = await collectSignals([RY, BTC, CA5Y]);
        freshCache();
        const second = await collectSignals([RY, BTC, CA5Y]);
        expect(second).toEqual(first);
    });
});
