import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchJson, HttpError } from '@/lib/sources/http';
import { mockFetch } from './helpers';

afterEach(() => vi.unstubAllGlobals());

describe('fetchJson', () => {
    it('retries once on 429 and returns the second answer', async () => {
        const calls = mockFetch((_, i) => (i === 0 ? { status: 429 } : { json: { ok: true } }));
        expect(await fetchJson('https://example.test/a', { retryDelayMs: 1 })).toEqual({ ok: true });
        expect(calls).toHaveLength(2);
    });

    it('retries once on a server error, then gives up with the status', async () => {
        const calls = mockFetch(() => ({ status: 503 }));
        await expect(fetchJson('https://example.test/a', { retryDelayMs: 1 })).rejects.toMatchObject({ status: 503 });
        expect(calls).toHaveLength(2);
    });

    it('does not retry a refusal', async () => {
        const calls = mockFetch(() => ({ status: 403, json: { error: "You don't have access to this resource." } }));
        await expect(fetchJson('https://example.test/a')).rejects.toBeInstanceOf(HttpError);
        expect(calls).toHaveLength(1);
    });

    it('sends a browser User-Agent only when asked, and a JSON body on POST', async () => {
        const calls = mockFetch(() => ({ json: {} }));
        await fetchJson('https://example.test/a');
        await fetchJson('https://example.test/b', { method: 'POST', body: { q: 1 }, browserUserAgent: true });
        expect((calls[0].init?.headers as Record<string, string>)['User-Agent']).toBeUndefined();
        expect((calls[1].init?.headers as Record<string, string>)['User-Agent']).toMatch(/^Mozilla/);
        expect(calls[1].init?.body).toBe('{"q":1}');
    });
});
