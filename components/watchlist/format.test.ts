import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';
import { compactUsd, formatSignal, formatTime, isStale, kindLabel, staleSummary, type Translate } from './format';
import type { SignalSet, Sourced } from '@/lib/domain/types';
import enWatchlist from '@/messages/en/Watchlist.json';
import frWatchlist from '@/messages/fr/Watchlist.json';

const translator = (locale: 'en' | 'fr'): Translate =>
    createTranslator({ locale, messages: { Watchlist: locale === 'en' ? enWatchlist : frWatchlist }, namespace: 'Watchlist' }) as unknown as Translate;
const en = translator('en');
const fr = translator('fr');
// Intl separates digits and symbols with no-break spaces in French
const plain = (text: string) => text.replace(/[  ]/g, ' ');

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

    it('formats values in their unit in English and never fills a missing one', () => {
        expect(formatSignal('pe', undefined, en, 'en')).toBe('not available');
        expect(formatSignal('volatility1y', { ...at(ago(0)), value: 0.2499 }, en, 'en')).toBe('25.0%');
        expect(formatSignal('changePercent', { ...at(ago(0)), value: -1.234 }, en, 'en').replace('−', '-')).toBe('-1.23%');
        expect(formatSignal('changePercent', { ...at(ago(0)), value: 1.234 }, en, 'en')).toBe('+1.23%');
        expect(formatSignal('price', { ...at(ago(0)), value: 3.78, unit: '%' }, en, 'en')).toBe('3.78%');
        expect(formatSignal('price', { ...at(ago(0)), value: 356.27, currency: 'USD' }, en, 'en')).toBe('356.27 USD');
        expect(compactUsd(5177380424341, en, 'en')).toBe('US$5.18T');
        expect(kindLabel(en, 'stock', 'Energy')).toBe('Stock · Energy');
        expect(kindLabel(en, 'etf')).toBe('ETF');
    });

    it('formats the same values with a decimal comma and French words', () => {
        expect(formatSignal('pe', undefined, fr, 'fr')).toBe('non disponible');
        expect(plain(formatSignal('volatility1y', { ...at(ago(0)), value: 0.2499 }, fr, 'fr'))).toBe('25,0 %');
        expect(plain(formatSignal('price', { ...at(ago(0)), value: 1356.27, currency: 'USD' }, fr, 'fr'))).toBe('1 356,27 USD');
        expect(plain(compactUsd(5177380424341, fr, 'fr'))).toBe('5,18 billions $ US');
        expect(plain(formatSignal('newsCount7d', { ...at(ago(0)), value: 1 }, fr, 'fr'))).toBe('1 manchette');
        expect(kindLabel(fr, 'etf')).toBe('FNB');
        expect(kindLabel(fr, 'stock', 'Énergie')).toBe('Action · Énergie');
    });

    it('shows a provider date as a date and a timestamp in Québec time', () => {
        expect(formatTime(undefined, en, 'en')).toBe('not available');
        expect(formatTime('2026-11-13', en, 'en')).toBe('Nov 13, 2026');
        expect(plain(formatTime('2026-11-13', fr, 'fr'))).toContain('13 nov');
        expect(formatTime('2026-11-15T14:30:00Z', en, 'en')).toMatch(/9:30/);
    });
});
