import { describe, expect, it } from 'vitest';
import { MAX_ENTRIES, ReplyCache, TTL_MS, cacheKey, isCacheable, normalizeMessage } from '@/lib/agent/reply-cache';

const parts = { message: 'What is an ETF?', locale: 'en', level: 'Novice', risk: 'Low', agentStyle: 'teach me' };
const glossary = { refused: false, sources: [{ source: 'agent/glossary/etf.md' }] };

describe('cacheKey', () => {
    it('ignores case, spacing and accents form of the message', () => {
        expect(cacheKey({ ...parts, message: '  what   IS an etf? ' })).toBe(cacheKey(parts));
        expect(normalizeMessage('Québec')).toBe(normalizeMessage('Québec'));
    });

    it('differs when the language, level, risk or style differs', () => {
        const base = cacheKey(parts);
        for (const change of [{ locale: 'fr' }, { level: 'Expert' }, { risk: 'High' }, { agentStyle: 'just the data' }, { message: 'What is a bond?' }]) {
            expect(cacheKey({ ...parts, ...change })).not.toBe(base);
        }
    });

    it('does not mistake a missing level for another value', () => {
        expect(cacheKey({ ...parts, level: undefined })).not.toBe(cacheKey({ ...parts, level: 'null' }));
    });
});

describe('ReplyCache', () => {
    it('returns a copy, so a caller cannot change what is stored', () => {
        const cache = new ReplyCache<{ text: string; sources: string[] }>();
        cache.set('k', { text: 'a', sources: ['s'] }, 'act_1');
        const first = cache.get('k')!;
        first.value.sources.push('x');
        first.value.text = 'changed';
        expect(cache.get('k')!.value).toEqual({ text: 'a', sources: ['s'] });
    });

    it('gives the action that produced the entry', () => {
        const cache = new ReplyCache<string>();
        cache.set('k', 'v', 'act_42');
        expect(cache.get('k')).toMatchObject({ value: 'v', actionId: 'act_42' });
    });

    it('forgets an entry after the time to live', () => {
        let now = 1000;
        const cache = new ReplyCache<string>(() => now);
        cache.set('k', 'v', 'a');
        now += TTL_MS - 1;
        expect(cache.get('k')).toBeDefined();
        now += 1;
        expect(cache.get('k')).toBeUndefined();
    });

    it('drops the least recently used entry when full', () => {
        const cache = new ReplyCache<number>();
        for (let i = 0; i < MAX_ENTRIES; i += 1) cache.set(`k${i}`, i, 'a');
        cache.get('k0');                                    // k0 is now the most recent
        cache.set('new', 1, 'a');
        expect(cache.get('k0')).toBeDefined();
        expect(cache.get('k1')).toBeUndefined();
        expect(cache.size).toBe(MAX_ENTRIES);
    });
});

describe('isCacheable', () => {
    it('accepts a reply made only of glossary text, in either language', () => {
        expect(isCacheable(glossary)).toBe(true);
        expect(isCacheable({ refused: false, sources: [{ source: 'agent/glossary/fr/etf.md' }] })).toBe(true);
    });

    it('refuses anything that holds live data or a decision of this request', () => {
        expect(isCacheable({ ...glossary, refused: true })).toBe(false);
        expect(isCacheable({ ...glossary, proposed: { type: 'layout_change' } })).toBe(false);
        expect(isCacheable({ ...glossary, conflict: { symbol: 'TSLA' } })).toBe(false);
        expect(isCacheable({ ...glossary, logComplete: false })).toBe(false);
        expect(isCacheable({ refused: false, sources: [] })).toBe(false);
        expect(isCacheable({ refused: false, sources: [{ source: 'agent/glossary/etf.md' }, { source: 'Finnhub' }] })).toBe(false);
    });
});
