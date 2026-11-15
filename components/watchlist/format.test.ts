import { describe, expect, it } from 'vitest';
import { compactUsd, formatSignal, isStale, kindLabel, staleSummary } from './format';
import type { SignalSet, Sourced } from '@/lib/domain/types';

const at = (iso: string): Sourced => ({ value: 1, source: 'test', fetchedAt: iso });
const now = new Date(2026, 10, 14, 15, 0, 0);
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

describe('watchlist display helpers', () => {
    it('marks a quote stale after the rule\'s seconds, and a daily value only when fetched before today', () => {
        expect(isStale('price', at(ago(30_000)), 60, now)).toBe(false);
        expect(isStale('price', at(ago(61_000)), 60, now)).toBe(true);
        expect(isStale('pe', at(ago(3 * 3600_000)), 60, now)).toBe(false);
        expect(isStale('pe', at(ago(26 * 3600_000)), 60, now)).toBe(true);
        expect(isStale('pe', at('not a date'), 60, now)).toBe(true);
    });

    it('summarises staleness over the signals that exist only', () => {
        const signals = { symbol: 'X', missing: ['pe'], price: at(ago(120_000)), beta: at(ago(1000)) } as unknown as SignalSet;
        expect(staleSummary(signals, 60, now)).toEqual({ quote: true, daily: false });
    });

    it('formats values in their unit and never fills a missing one', () => {
        expect(formatSignal('pe', undefined)).toBe('not available');
        expect(formatSignal('volatility1y', { ...at(ago(0)), value: 0.2499 })).toBe('25.0%');
        expect(formatSignal('changePercent', { ...at(ago(0)), value: -1.234 })).toBe('-1.23%');
        expect(formatSignal('price', { ...at(ago(0)), value: 3.78, unit: '%' })).toBe('3.78%');
        expect(formatSignal('price', { ...at(ago(0)), value: 356.27, currency: 'USD' })).toBe('356.27 USD');
        expect(compactUsd(5177380424341)).toBe('US$5.18T');
        expect(kindLabel('stock', 'Energy')).toBe('Stock · Energy');
        expect(kindLabel('etf')).toBe('ETF');
    });
});
