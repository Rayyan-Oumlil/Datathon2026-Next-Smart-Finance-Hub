import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UniverseEntry } from '@/lib/domain/types';
import { loadDailySignals, marketDate, refreshDailySignals } from '@/lib/sources/daily-signals';
import { freshCache, mockProviders } from './helpers';

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
const BTC = entry('BTC', 'crypto', 'none');
const CA5Y = entry('CA5Y', 'bond_yield', 'none');

describe('daily signals', () => {
    it('dates the file by the Toronto day, not the UTC day', () => {
        expect(marketDate(new Date('2026-11-15T03:00:00Z'))).toBe('2026-11-14');
        expect(marketDate(new Date('2026-11-15T06:00:00Z'))).toBe('2026-11-15');
    });

    it('collects once, writes the day file, then answers from it without calling a provider', async () => {
        const calls = mockProviders();
        const first = await loadDailySignals([RY, BTC]);
        expect(first).toMatchObject({ date: '2026-11-14', stale: false });
        expect(existsSync(path.join(dir, 'signals', '2026-11-14.json'))).toBe(true);
        const callsAfterFirst = calls.length;

        vi.setSystemTime(new Date('2026-11-14T23:30:00Z'));
        const second = await loadDailySignals([BTC, RY]);
        expect(calls.length).toBe(callsAfterFirst);
        expect(second.signals.map((set) => set.symbol)).toEqual(['BTC', 'RY.TO']);
        expect(second.signals[1].price?.fetchedAt).toBe('2026-11-14T22:00:00.000Z');
    });

    it('serves the newest earlier file as stale, each value keeping the time it was fetched', async () => {
        mockProviders();
        await refreshDailySignals([RY, BTC]);
        vi.setSystemTime(new Date('2026-11-16T15:00:00Z'));
        const calls = mockProviders(() => ({ status: 503 }));
        const later = await loadDailySignals([RY]);
        expect(later).toMatchObject({ date: '2026-11-14', stale: true, collectedAt: '2026-11-14T22:00:00.000Z' });
        expect(later.signals[0].price).toMatchObject({ value: 288.37, fetchedAt: '2026-11-14T22:00:00.000Z' });
        expect(later.fxUsdCad?.fetchedAt).toBe('2026-11-14T22:00:00.000Z');
        expect(calls).toHaveLength(0);
    });

    it('collects an entry the day file does not hold and adds it to the file', async () => {
        mockProviders();
        await refreshDailySignals([RY]);
        const loaded = await loadDailySignals([RY, CA5Y]);
        expect(loaded.signals.map((set) => set.symbol)).toEqual(['RY.TO', 'CA5Y']);
        expect(loaded.signals[1].price?.value).toBe(3.53);
        const onDisk = JSON.parse(readFileSync(path.join(dir, 'signals', '2026-11-14.json'), 'utf8'));
        expect(onDisk.signals.map((set: { symbol: string }) => set.symbol)).toEqual(['RY.TO', 'CA5Y']);
    });

    it('refresh overwrites the day file with a new collection', async () => {
        mockProviders();
        await refreshDailySignals([RY]);
        vi.setSystemTime(new Date('2026-11-14T23:00:00Z'));
        const again = await refreshDailySignals([RY, BTC]);
        expect(again.collectedAt).toBe('2026-11-14T23:00:00.000Z');
        expect(again.signals).toHaveLength(2);
    });
});
