import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as boc from '@/lib/sources/boc';
import * as finnhub from '@/lib/sources/finnhub';
import * as gold from '@/lib/sources/gold';
import * as kraken from '@/lib/sources/kraken';
import * as tmx from '@/lib/sources/tmx';
import * as yahoo from '@/lib/sources/yahoo';
import { freshCache, mockProviders } from './helpers';

const NOW = '2026-11-14T22:00:00.000Z';

beforeEach(() => {
    freshCache();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('finnhub', () => {
    it('reads a quote, with the key in a header and never in the stored endpoint', async () => {
        const calls = mockProviders();
        const q = await finnhub.quote('AAPL');
        expect(q.price).toEqual({ value: 356.27, unit: 'USD', currency: 'USD', source: 'Finnhub', endpoint: 'https://finnhub.io/api/v1/quote?symbol=AAPL', fetchedAt: NOW, asOf: '2026-11-13T21:00:00.000Z' });
        expect(q.changePercent).toMatchObject({ value: 0.3917, unit: '%', source: 'Finnhub', fetchedAt: NOW });
        expect(calls[0].url).not.toContain('test-key');
        expect((calls[0].init?.headers as Record<string, string>)['X-Finnhub-Token']).toBe('test-key');
        expect(JSON.stringify(q)).not.toContain('test-key');
    });

    it('throws when Finnhub refuses a .TO quote, and when it answers zeros for an unknown symbol', async () => {
        mockProviders((call) => (call.url.includes('symbol=NOPE') ? { json: { c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 } } : undefined));
        await expect(finnhub.quote('RY.TO')).rejects.toThrow('HTTP 403');
        await expect(finnhub.quote('NOPE')).rejects.toThrow('no quote');
    });

    it('reads a profile: market cap in millions of the profile currency, industry labelled as Finnhub\'s own', async () => {
        mockProviders();
        const us = await finnhub.profile('AAPL');
        expect(us.marketCapMillions).toMatchObject({ value: 5177380.424341398, unit: 'USD millions', currency: 'USD', source: 'Finnhub' });
        expect(us.industry).toMatchObject({ value: 'Technology', note: 'Finnhub industry (its own classification, not GICS)' });
        const interlisted = await finnhub.profile('RY');
        expect(interlisted).toMatchObject({ ticker: 'RY.TO', currency: 'CAD', marketCapMillions: { value: 401268.045943, unit: 'CAD millions', currency: 'CAD' } });
    });

    it('reads metrics and converts the 10-day volume from millions of shares', async () => {
        mockProviders();
        const m = await finnhub.metrics('AAPL');
        expect(m.pe?.value).toBe(39.1706);
        expect(m.revenueGrowthPct).toMatchObject({ value: 15.06, unit: '%' });
        expect(m.beta?.value).toBe(1.0898671);
        expect(m.avgVolume10dShares?.value).toBeCloseTo(52_280_320, 3);
        expect(m.pe?.endpoint).toBe('https://finnhub.io/api/v1/stock/metric?symbol=AAPL&metric=all');
    });

    it('leaves out metrics the provider does not give', async () => {
        mockProviders((call) => (call.url.includes('/stock/metric') ? { json: { metric: { peTTM: null, beta: 1.2 }, symbol: 'AAPL' } } : undefined));
        const m = await finnhub.metrics('AAPL');
        expect(m).toEqual({ beta: expect.objectContaining({ value: 1.2 }) });
    });

    it('counts headlines over the last 7 days', async () => {
        const calls = mockProviders();
        const news = await finnhub.newsCount7d('AAPL');
        expect(calls[0].url).toBe('https://finnhub.io/api/v1/company-news?symbol=AAPL&from=2026-11-07&to=2026-11-14');
        expect(news).toMatchObject({ value: 40, unit: 'headlines', source: 'Finnhub', fetchedAt: NOW });
    });

    it('answers from the cache within 60 seconds, then asks again', async () => {
        const calls = mockProviders();
        await finnhub.quote('AAPL');
        await finnhub.quote('AAPL');
        expect(calls).toHaveLength(1);
        vi.setSystemTime(new Date('2026-11-14T22:01:01Z'));
        await finnhub.quote('AAPL');
        expect(calls).toHaveLength(2);
    });
});

describe('tmx', () => {
    it('maps app symbols to TMX symbols', () => {
        expect(tmx.tmxSymbol('RY.TO')).toBe('RY');
        expect(tmx.tmxSymbol('bip-un.to')).toBe('BIP.UN');
        expect(tmx.tmxSymbol('AAPL:US')).toBe('AAPL:US');
    });

    it('reads a stock quote', async () => {
        const calls = mockProviders();
        const q = await tmx.quote('RY.TO');
        expect(JSON.parse(String(calls[0].init?.body)).variables).toEqual({ symbol: 'RY', locale: 'en' });
        expect(q.price).toEqual({ value: 288.37, unit: 'CAD', currency: 'CAD', source: 'TMX Money (delayed 15 min or more)', endpoint: 'https://app-money.tmx.com/graphql getQuoteBySymbol(symbol: "RY")', fetchedAt: NOW });
        expect(q.changePercent?.value).toBe(-0.352466);
        expect(q.marketCap).toMatchObject({ value: 399112274611, currency: 'CAD' });
        expect(q.pe?.value).toBe(16.88);
        expect(q.beta?.value).toBe(0.933141);
        expect(q.avgVolume10dShares?.value).toBe(2830331);
        expect(q.sector).toMatchObject({ value: 'Finance', source: 'TMX Money (delayed 15 min or more)' });
        expect(q.issueType).toBe('CS');
    });

    it('reads an ETF quote: the empty sector is absent, not an empty label', async () => {
        mockProviders();
        const q = await tmx.quote('XIU.TO');
        expect(q.price.value).toBe(54.55);
        expect(q.issueType).toBe('ET');
        expect(q.sector).toBeUndefined();
    });

    it('throws on an unknown symbol', async () => {
        mockProviders();
        await expect(tmx.quote('NOPE123.TO')).rejects.toThrow("couldn't find any results");
    });

    it('reads daily closes, oldest first, dated by the Toronto trading day', async () => {
        const calls = mockProviders();
        const closes = await tmx.dailyCloses('RY.TO');
        expect(JSON.parse(String(calls[0].init?.body)).variables).toEqual({ symbol: 'RY', freq: 'day', start: '2025-11-13' });
        expect(closes.value).toHaveLength(40);
        expect(closes.value[39]).toEqual({ date: '2026-11-13', close: 288.37 });
        expect(closes.value[38]).toEqual({ date: '2026-11-12', close: 289.39 });
        expect(closes.value[0].date < closes.value[1].date).toBe(true);
        expect(closes).toMatchObject({ source: 'TMX Money (delayed 15 min or more)', asOf: '2026-11-13', fetchedAt: NOW });
    });
});

describe('bank of canada', () => {
    it('reads the latest benchmark yields, each with its own date', async () => {
        const calls = mockProviders();
        const yields = await boc.bondYields();
        expect(calls[0].url).toBe('https://www.bankofcanada.ca/valet/observations/BD.CDN.2YR.DQ.YLD,BD.CDN.5YR.DQ.YLD,BD.CDN.10YR.DQ.YLD,BD.CDN.LONG.DQ.YLD/json?recent=5');
        expect(yields['2Y']).toMatchObject({ value: 3.33, unit: '%', source: 'Bank of Canada', asOf: '2026-11-12', note: 'Benchmark bond yield, 2-year' });
        expect(yields['5Y']?.value).toBe(3.53);
        expect(yields['10Y']?.value).toBe(3.78);
        expect(yields.LONG?.value).toBe(4.09);
    });

    it('reads the USD/CAD rate and the policy rate', async () => {
        mockProviders();
        expect(await boc.fxUsdCad()).toMatchObject({ value: 1.4257, unit: 'CAD per USD', asOf: '2026-11-13', source: 'Bank of Canada', fetchedAt: NOW });
        expect(await boc.policyRate()).toMatchObject({ value: 2.5, unit: '%', asOf: '2026-11-12' });
    });

    it('throws when the series has no observation', async () => {
        mockProviders((call) => (call.url.includes('bankofcanada') ? { json: { observations: [] } } : undefined));
        await expect(boc.fxUsdCad()).rejects.toThrow('no USD/CAD rate');
    });
});

describe('kraken', () => {
    it('reads the last trade in CAD and the change since the open', async () => {
        const calls = mockProviders();
        const q = await kraken.quote('BTC');
        expect(calls[0].url).toBe('https://api.kraken.com/0/public/Ticker?pair=XBTCAD');
        expect(q.price).toMatchObject({ value: 92831.6, currency: 'CAD', source: 'Kraken', fetchedAt: NOW });
        expect(q.changePercent?.value).toBeCloseTo((92831.6 / 91726.7 - 1) * 100, 10);
        expect((await kraken.quote('ETH')).price.value).toBe(2598.65);
    });

    it('reads daily closes and leaves out the day still in progress', async () => {
        mockProviders();
        const closes = await kraken.dailyCloses('BTC');
        expect(closes.value).toHaveLength(39);          // 40 bars recorded, the last one unfinished
        expect(closes.asOf).toBe('2026-11-14');
        expect(closes.value.every((row) => row.close > 0)).toBe(true);
    });

    it('throws on a Kraken error answer', async () => {
        mockProviders((call) => (call.url.includes('kraken') ? { json: { error: ['EQuery:Unknown asset pair'] } } : undefined));
        await expect(kraken.quote('BTC')).rejects.toThrow('Unknown asset pair');
    });
});

describe('yahoo and gold', () => {
    it('reads daily closes, skipping empty days, dated in the exchange time zone', async () => {
        const calls = mockProviders();
        const closes = await yahoo.dailyCloses('AAPL');
        expect(calls[0].url).toBe('https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1y&interval=1d');
        expect(closes.value).toEqual([{ date: '2026-11-10', close: 100 }, { date: '2026-11-11', close: 101 }, { date: '2026-11-13', close: 102 }]);
        expect(closes).toMatchObject({ source: 'Yahoo chart (unofficial)', currency: 'USD', asOf: '2026-11-13', fetchedAt: NOW });
    });

    it('reads a quote from the last two closes', async () => {
        mockProviders();
        const q = await yahoo.quote('SHOP.TO');
        expect(q.price).toMatchObject({ value: 102, currency: 'USD', source: 'Yahoo chart (unofficial)', asOf: '2026-11-13T21:00:00.000Z' });
        expect(q.changePercent?.value).toBeCloseTo((102 / 101 - 1) * 100, 10);
    });

    it('throws when Yahoo refuses', async () => {
        mockProviders((call) => (call.url.includes('yahoo') ? { status: 404, json: { chart: { result: null, error: { description: 'No data found' } } } } : undefined));
        await expect(yahoo.dailyCloses('AAPL')).rejects.toThrow('HTTP 404');
    });

    it('labels gold as COMEX futures from the unofficial Yahoo chart', async () => {
        const calls = mockProviders();
        const q = await gold.quote();
        expect(calls[0].url).toContain('/chart/GC%3DF?');
        expect(q.price.source).toBe('Yahoo chart (unofficial), COMEX gold futures');
        expect((await gold.dailyCloses()).source).toBe('Yahoo chart (unofficial), COMEX gold futures');
    });
});
