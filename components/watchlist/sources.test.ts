import { describe, expect, it } from 'vitest';
import { buildSourceMarks, markLabel } from './sources';

const v = (source: string, fetchedAt: string) => ({ source, fetchedAt });

describe('buildSourceMarks', () => {
    it('assigns markers in order of first appearance, one per source', () => {
        const { entries, markOf } = buildSourceMarks([
            v('Finnhub', '2026-11-15T15:00:00Z'),
            undefined,
            v('Yahoo chart (unofficial)', '2026-11-15T12:00:00Z'),
            v('Finnhub', '2026-11-15T15:05:00Z'),
        ]);
        expect(entries.map((e) => [e.mark, e.source])).toEqual([['*', 'Finnhub'], ['**', 'Yahoo chart (unofficial)']]);
        expect(markOf({ source: 'Yahoo chart (unofficial)' })).toBe('**');
        expect(markOf({ source: 'Kraken' })).toBeNull();
        expect(markOf(undefined)).toBeNull();
    });

    it('keeps the earliest and latest fetch time of each source', () => {
        const { entries } = buildSourceMarks([
            v('Finnhub', '2026-11-15T15:05:00Z'),
            v('Finnhub', '2026-11-15T14:00:00Z'),
            v('Finnhub', 'not a time'),
            v('Finnhub', '2026-11-15T16:00:00Z'),
        ]);
        expect(entries[0]).toMatchObject({ from: '2026-11-15T14:00:00Z', to: '2026-11-15T16:00:00Z' });
    });

    it('runs out of asterisks gracefully', () => {
        expect([0, 1, 2, 3, 6].map(markLabel)).toEqual(['*', '**', '***', '†', '7']);
    });
});
