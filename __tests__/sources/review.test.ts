// Cases a provider or a caller can really produce and that must never turn into an invented value or a lost run.
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UniverseEntry } from '@/lib/domain/types';
import * as boc from '@/lib/sources/boc';
import { STALE_NOTE, writeJsonFile, readJsonFile } from '@/lib/sources/cache';
import { loadDailySignals } from '@/lib/sources/daily-signals';
import * as finnhub from '@/lib/sources/finnhub';
import { collectSignals } from '@/lib/sources/signals';
import { annualizedVolatility } from '@/lib/sources/volatility';
import * as yahoo from '@/lib/sources/yahoo';
import { fixture, freshCache, mockProviders } from './helpers';

let dir: string;
beforeEach(() => {
    dir = freshCache();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-14T22:00:00Z'));
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

const entry = (symbol: string, assetClass: UniverseEntry['assetClass'], market: UniverseEntry['market']): UniverseEntry =>
    ({ symbol, name: symbol, assetClass, market, themes: [], esg: 'not screened', listSource: 'test list' });
const RY = entry('RY.TO', 'stock', 'Canada');

describe('no value is invented', () => {
    it('yahoo: a single daily bar gives a price and no % change, not 0 %', async () => {
        const oneBar = { chart: { result: [{ meta: { currency: 'USD', regularMarketTime: 1794603600, gmtoffset: -18000 }, timestamp: [1794580200], indicators: { quote: [{ close: [102] }] } }], error: null } };
        mockProviders((call) => (call.url.includes('yahoo') ? { json: oneBar } : undefined));
        const q = await yahoo.quote('NEWLY');
        expect(q.price.value).toBe(102);
        expect(q.changePercent).toBeUndefined();
    });

    it('bank of canada: an empty cell is absent, never a 0 % yield or a 0 rate', async () => {
        const yields = fixture('boc-yields.json');
        for (const row of yields.observations) row['BD.CDN.5YR.DQ.YLD'] = { v: '' };
        mockProviders((call) => {
            if (call.url.includes('FXUSDCAD')) return { json: { observations: [{ d: '2026-11-13', FXUSDCAD: { v: '' } }] } };
            return call.url.includes('bankofcanada') ? { json: yields } : undefined;
        });
        const result = await boc.bondYields();
        expect(result['5Y']).toBeUndefined();
        expect(result['2Y']?.value).toBe(3.33);
        await expect(boc.fxUsdCad()).rejects.toThrow('no USD/CAD rate');
    });

    it('bank of canada: a zero rate is refused, so nothing is divided by it', async () => {
        mockProviders((call) => (call.url.includes('FXUSDCAD') ? { json: { observations: [{ d: '2026-11-13', FXUSDCAD: { v: '0' } }] } } : undefined));
        const { signals: [ry], fxUsdCad } = await collectSignals([RY]);
        expect(fxUsdCad).toBeUndefined();
        expect(ry.marketCapUsd).toBeUndefined();
        expect(ry.missing).toContain('marketCapUsd');
        expect(ry.missing).toContain('avgDailyTradedValueUsd');
    });

    it('volatility: a zero or negative close anywhere gives null, the last one included', () => {
        const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
        expect(annualizedVolatility([...closes, 0])).toBeNull();
        expect(annualizedVolatility([...closes, -5])).toBeNull();
        expect(annualizedVolatility([...closes, NaN])).toBeNull();
    });

    it('finnhub news: only headlines of the last 7 days are counted, and the note says so', async () => {
        const now = Date.parse('2026-11-14T22:00:00Z') / 1000;
        const day = 86_400;
        mockProviders((call) => (call.url.includes('/company-news') ? { json: [{ datetime: now - day }, { datetime: now - 6.9 * day }, { datetime: now - 7.1 * day }, { datetime: null }, {}] } : undefined));
        const news = await finnhub.newsCount7d('AAPL');
        expect(news.value).toBe(2);
        expect(news.note).toBe('headlines published in the 7 days before 2026-11-14T22:00:00.000Z');
    });
});

describe('collectSignals under odd conditions', () => {
    it('does not ask Finnhub for the profile of a US fund, and reports no failure for it', async () => {
        const calls = mockProviders((call) => {
            if (!call.url.includes('finnhub.io')) return undefined;
            if (call.url.includes('/quote?symbol=SPY')) return { json: { c: 754.37, d: -2.75, dp: -0.3632, h: 760.12, l: 745.2, o: 760.07, pc: 757.12, t: 1794603600 } };
            if (call.url.includes('/stock/metric?symbol=SPY')) return { json: { metric: { beta: 1.0169067, '10DayAverageTradingVolume': 57.59817 }, symbol: 'SPY' } };
            return { json: {} };
        });
        const errors: string[] = [];
        const { signals: [spy] } = await collectSignals([entry('SPY', 'etf', 'US')], { onError: (symbol, what) => errors.push(`${symbol}: ${what}`) });
        expect(calls.some((call) => call.url.includes('profile2'))).toBe(false);
        expect(calls.some((call) => call.url.includes('company-news'))).toBe(false);
        expect(errors).toEqual([]);
        expect(spy.avgDailyTradedValueUsd?.value).toBeCloseTo(57.59817e6 * 754.37, 0);
        expect(spy.marketCapUsd).toBeUndefined();
        expect(spy.sectorLabel).toBeUndefined();
        expect(spy.missing).toEqual(['volatility1y']);   // the Yahoo fixture holds 3 closes
    });

    it('keeps the original fetch time and says so on derived values when the provider fails at the next refresh', async () => {
        mockProviders();
        await collectSignals([RY]);
        vi.setSystemTime(new Date('2026-11-16T22:00:00Z'));
        mockProviders(() => ({ status: 403 }));
        const { signals: [ry], fxUsdCad } = await collectSignals([RY]);
        expect(fxUsdCad).toMatchObject({ value: 1.4257, fetchedAt: '2026-11-14T22:00:00.000Z' });
        expect(fxUsdCad?.note).toContain(STALE_NOTE);
        for (const value of [ry.price, ry.volatility1y, ry.closes1m, ry.marketCapUsd, ry.avgDailyTradedValueUsd]) {
            expect(value?.fetchedAt).toBe('2026-11-14T22:00:00.000Z');
            expect(value?.note).toContain(STALE_NOTE);
        }
    });

    it('a malformed entry comes back with everything missing and does not sink the others', async () => {
        mockProviders();
        const broken = { ...entry('X', 'crypto', 'none'), symbol: undefined as unknown as string };
        const { signals } = await collectSignals([broken, RY]);
        expect(signals[0].missing).toEqual(['price', 'changePercent', 'volatility1y', 'closes1m']);
        expect(signals[1].price?.value).toBe(288.37);
    });

    it('an empty list makes no candidate and still returns the exchange rate', async () => {
        mockProviders();
        expect(await collectSignals([])).toMatchObject({ signals: [], fxUsdCad: { value: 1.4257 } });
    });

    it('every value of every candidate carries a source and a fetch time', async () => {
        mockProviders();
        const all = [entry('AAPL', 'stock', 'US'), RY, entry('XIU.TO', 'etf', 'Canada'), entry('BTC', 'crypto', 'none'), entry('GOLD', 'gold', 'none'), entry('CA10Y', 'bond_yield', 'none')];
        const { signals } = await collectSignals(all);
        let checked = 0;
        for (const set of signals) {
            for (const [name, value] of Object.entries(set)) {
                if (name === 'symbol' || name === 'entry' || name === 'missing') continue;
                expect(value, `${set.symbol}.${name}`).toMatchObject({ source: expect.stringMatching(/\S/), fetchedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });
                expect(JSON.stringify(value)).not.toContain('test-key');
                checked++;
            }
        }
        expect(checked).toBeGreaterThan(30);
    });
});

describe('files', () => {
    it('two writes of the same file at once both succeed', async () => {
        const file = path.join(dir, 'signals', 'same.json');
        await expect(Promise.all([writeJsonFile(file, { n: 1 }), writeJsonFile(file, { n: 2 }), writeJsonFile(file, { n: 3 })])).resolves.toBeDefined();
        expect((await readJsonFile<{ n: number }>(file))?.n).toBeGreaterThan(0);
    });

    it('two loads at once on a cold start both answer', async () => {
        mockProviders();
        const [a, b] = await Promise.all([loadDailySignals([RY]), loadDailySignals([RY])]);
        expect(a.signals[0].price?.value).toBe(288.37);
        expect(b.signals[0].price?.value).toBe(288.37);
    });

    it('an unreadable day file is skipped for the one before it', async () => {
        mockProviders();
        await loadDailySignals([RY]);
        vi.setSystemTime(new Date('2026-11-15T22:00:00Z'));
        await writeJsonFile(path.join(dir, 'signals', '2026-11-15.json'), { date: '2026-11-15', signals: 'oops' });
        const loaded = await loadDailySignals([RY]);
        expect(loaded).toMatchObject({ date: '2026-11-14', stale: true });
    });
});
