import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as boc from '@/lib/sources/boc';
import * as kraken from '@/lib/sources/kraken';
import * as tmx from '@/lib/sources/tmx';
import { freshCache, mockFetch } from './helpers';

const NOW = '2026-11-14T22:00:00.000Z';
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
    freshCache();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

const tmxBody = (call: { init?: RequestInit }) => JSON.parse(String(call.init?.body)) as { variables: { symbol: string; start: string } };
const tmxRows = [
    { dateTime: '2026-11-13T16:00:00-05:00', close: 12 },
    { dateTime: '2021-11-12T16:00:00-05:00', close: 10 },
    { dateTime: '2022-01-03T16:00:00-05:00', close: null },
];

describe('TMX Money long history', () => {
    it('asks for five years, keeps the one-year call as it was, and caches them apart', async () => {
        const calls = mockFetch(() => ({ json: { data: { getTimeSeriesData: tmxRows } } }));
        const long = await tmx.dailyClosesLong('RY.TO');
        const short = await tmx.dailyCloses('RY.TO');
        const startOf = (index: number) => Date.parse(tmxBody(calls[index]).variables.start);
        expect(calls).toHaveLength(2);
        expect(tmxBody(calls[0]).variables.symbol).toBe('RY');
        expect(Math.round((Date.parse(NOW) - startOf(0)) / DAY)).toBeGreaterThanOrEqual(5 * 365);
        expect(Math.round((Date.parse(NOW) - startOf(1)) / DAY)).toBeLessThanOrEqual(367);
        // Oldest first, a close the provider left empty is skipped, the date is the Toronto trading day
        expect(long.value).toEqual([{ date: '2021-11-12', close: 10 }, { date: '2026-11-13', close: 12 }]);
        expect(long).toMatchObject({ source: tmx.TMX, asOf: '2026-11-13', fetchedAt: NOW });
        expect(long.endpoint).toContain('getTimeSeriesData(symbol: "RY"');
        expect(short.value).toHaveLength(2);
        // A second long call is served from the cache
        await tmx.dailyClosesLong('RY.TO');
        expect(calls).toHaveLength(2);
    });

    it('reads a US listing under its TMX form', async () => {
        const calls = mockFetch(() => ({ json: { data: { getTimeSeriesData: tmxRows } } }));
        await tmx.dailyClosesLong('AAPL:US');
        expect(tmxBody(calls[0]).variables.symbol).toBe('AAPL:US');
    });

    it('throws when TMX has no rows, so no series is invented', async () => {
        mockFetch(() => ({ json: { data: { getTimeSeriesData: [] } } }));
        await expect(tmx.dailyClosesLong('NOPE.TO')).rejects.toThrow('no daily closes');
    });
});

describe('Kraken long history', () => {
    const bars = Array.from({ length: 721 }, (_, i) => [Math.floor(Date.parse('2024-11-25T00:00:00Z') / 1000) + i * 86400, '0', '0', '0', String(100 + i), '0', '0', 0]);
    const answer = () => ({ json: { error: [], result: { XXBTZCAD: bars, last: bars[720][0] as number } } });

    it('keeps every bar (720) for the X-ray and 365 for the one-year path', async () => {
        mockFetch(answer);
        const max = await kraken.dailyClosesMax('BTC');
        const year = await kraken.dailyCloses('BTC');
        expect(max.value).toHaveLength(720);
        expect(year.value).toHaveLength(365);
        expect(max.value[max.value.length - 1].close).toBe(820);
        expect(max).toMatchObject({ currency: 'CAD', source: kraken.KRAKEN });
    });
});

describe('Bank of Canada USD/CAD history', () => {
    it('reads the daily rates from a start date, skipping empty cells, oldest first', async () => {
        const calls = mockFetch(() => ({
            json: {
                observations: [
                    { d: '2021-11-15', FXUSDCAD: { v: '1.2600' } },
                    { d: '2021-11-12', FXUSDCAD: { v: '1.2565' } },
                    { d: '2021-11-13', FXUSDCAD: { v: '' } },
                    { d: '2021-11-14', FXUSDCAD: { v: '0' } },
                ],
            },
        }));
        const history = await boc.fxUsdCadHistory('2021-11-12');
        expect(calls[0].url).toBe('https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?start_date=2021-11-12');
        expect(history.value).toEqual([{ date: '2021-11-12', rate: 1.2565 }, { date: '2021-11-15', rate: 1.26 }]);
        expect(history).toMatchObject({ source: boc.BANK_OF_CANADA, asOf: '2021-11-15', unit: 'CAD per USD' });
    });

    it('throws when the Bank returns no usable rate', async () => {
        mockFetch(() => ({ json: { observations: [{ d: '2021-11-12', FXUSDCAD: { v: '' } }] } }));
        await expect(boc.fxUsdCadHistory('2021-11-12')).rejects.toThrow('no USD/CAD history');
    });
});
