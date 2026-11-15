import { describe, it, expect } from 'vitest';
import { formatDateTime, formatMoney, formatNumber, formatPercent } from '@/i18n/format';

// Intl puts a no-break (or narrow no-break) space in French numbers; compare with plain spaces
const plain = (s: string) => s.replace(/[  ]/g, ' ');

describe('format helpers', () => {
    it('formats numbers with each language’s separators', () => {
        expect(formatNumber(1234.5, 'en')).toBe('1,234.5');
        expect(plain(formatNumber(1234.5, 'fr'))).toBe('1 234,5');
        expect(plain(formatNumber(1234.567, 'fr', { maximumFractionDigits: 1 }))).toBe('1 234,6');
    });

    it('formats percentages given in percent', () => {
        expect(formatPercent(12.5, 'en')).toBe('12.5%');
        expect(plain(formatPercent(12.5, 'fr'))).toBe('12,5 %');
        expect(formatPercent(3, 'en', { signDisplay: 'exceptZero' })).toBe('+3%');
        expect(plain(formatPercent(-0.25, 'fr'))).toBe('-0,25 %');
    });

    it('formats money with the currency after the amount in French', () => {
        expect(formatMoney(1500, 'CAD', 'en')).toBe('$1,500.00');
        expect(plain(formatMoney(1500, 'CAD', 'fr'))).toBe('1 500,00 $');
        expect(formatMoney(1500, 'USD', 'en')).toBe('US$1,500.00');
        expect(plain(formatMoney(1500, 'USD', 'fr'))).toBe('1 500,00 $ US');
    });

    it('formats an ISO timestamp in Québec time', () => {
        const iso = '2026-11-15T14:30:00Z';
        expect(plain(formatDateTime(iso, 'en'))).toBe('Nov 15, 2026, 9:30 a.m.');
        expect(plain(formatDateTime(iso, 'fr'))).toBe('15 nov. 2026, 09 h 30');
        expect(plain(formatDateTime(iso, 'fr', { dateStyle: 'long' }))).toBe('15 novembre 2026');
        expect(formatDateTime('not a date', 'en')).toBe('not a date');
    });

    it('falls back to French for an unknown locale', () => {
        expect(formatNumber(1234.5, 'pl')).toBe(formatNumber(1234.5, 'fr'));
    });
});
