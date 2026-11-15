import { readdirSync } from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sourced } from '@/lib/domain/types';
import { cached, clearMemoryCache, remember, STALE_NOTE } from '@/lib/sources/cache';
import { freshCache } from './helpers';

let dir: string;
beforeEach(() => {
    dir = freshCache();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-14T15:00:00Z'));
});
afterEach(() => vi.useRealTimers());

const sourced = (value: number): Sourced => ({ value, source: 'test', fetchedAt: new Date().toISOString() });

describe('cached', () => {
    it('calls the loader once while the entry is younger than its TTL', async () => {
        const load = vi.fn(async () => sourced(1));
        await cached('k', 60_000, load);
        vi.setSystemTime(new Date('2026-11-14T15:00:59Z'));
        const hit = await cached('k', 60_000, load);
        expect(load).toHaveBeenCalledTimes(1);
        expect(hit).toMatchObject({ stale: false, value: { value: 1, fetchedAt: '2026-11-14T15:00:00.000Z' } });
    });

    it('loads again once the TTL has passed', async () => {
        await cached('k', 60_000, async () => sourced(1));
        vi.setSystemTime(new Date('2026-11-14T15:01:00Z'));
        const hit = await cached('k', 60_000, async () => sourced(2));
        expect(hit).toMatchObject({ stale: false, value: { value: 2, fetchedAt: '2026-11-14T15:01:00.000Z' } });
    });

    it('survives a restart: the value comes back from disk with its original fetchedAt', async () => {
        await cached('daily value/with:odd chars', 86_400_000, async () => sourced(7));
        expect(readdirSync(dir)).toEqual(['daily_value_with_odd_chars.json']);
        clearMemoryCache();
        vi.setSystemTime(new Date('2026-11-14T20:00:00Z'));
        const load = vi.fn(async () => sourced(8));
        const hit = await cached('daily value/with:odd chars', 86_400_000, load);
        expect(load).not.toHaveBeenCalled();
        expect(hit.value).toMatchObject({ value: 7, fetchedAt: '2026-11-14T15:00:00.000Z' });
    });

    it('returns the old entry flagged stale when the provider fails, never with a new fetchedAt', async () => {
        await cached('k', 60_000, async () => sourced(1));
        vi.setSystemTime(new Date('2026-11-14T16:00:00Z'));
        const hit = await cached<Sourced>('k', 60_000, async () => { throw new Error('HTTP 429'); });
        expect(hit.stale).toBe(true);
        expect(hit.value).toMatchObject({ value: 1, fetchedAt: '2026-11-14T15:00:00.000Z' });
    });

    it('throws when the provider fails and nothing is cached', async () => {
        await expect(cached('nothing', 60_000, async () => { throw new Error('HTTP 429'); })).rejects.toThrow('HTTP 429');
    });

    it('makes one provider call for callers asking at the same time', async () => {
        const load = vi.fn(async () => sourced(1));
        await Promise.all([cached('same', 60_000, load), cached('same', 60_000, load), cached('same', 60_000, load)]);
        expect(load).toHaveBeenCalledTimes(1);
    });
});

describe('remember', () => {
    it('adds a note to stale values, on a single value and on each field of an object', async () => {
        await remember('one', 60_000, async () => sourced(1));
        await remember('many', 60_000, async () => ({ price: sourced(2), name: 'X' }));
        vi.setSystemTime(new Date('2026-11-14T16:00:00Z'));
        const fail = async () => { throw new Error('down'); };
        const one = await remember<Sourced>('one', 60_000, fail);
        const many = await remember<{ price: Sourced; name: string }>('many', 60_000, fail);
        expect(one).toMatchObject({ value: 1, fetchedAt: '2026-11-14T15:00:00.000Z', note: STALE_NOTE });
        expect(many.price).toMatchObject({ value: 2, fetchedAt: '2026-11-14T15:00:00.000Z', note: STALE_NOTE });
        expect(many.name).toBe('X');
    });
});
