import { describe, expect, it } from 'vitest';
import { asOf, commonCalendar, levelsOn, toCadCloses } from '@/lib/xray/align';
import { addDays, windowBounds, yearBefore } from '@/lib/xray/windows';

const rows = (pairs: Array<[string, number]>) => pairs.map(([date, close]) => ({ date, close }));

describe('asOf', () => {
    const list = rows([['2026-01-02', 1], ['2026-01-05', 2], ['2026-01-09', 3]]);
    it('takes the last row on or before the date', () => {
        expect(asOf(list, '2026-01-05')?.close).toBe(2);
        expect(asOf(list, '2026-01-07')?.close).toBe(2);
        expect(asOf(list, '2026-02-01')?.close).toBe(3);
    });
    it('is undefined before the first row', () => {
        expect(asOf(list, '2026-01-01')).toBeUndefined();
        expect(asOf([], '2026-01-01')).toBeUndefined();
    });
});

describe('toCadCloses', () => {
    const fx = [{ date: '2026-01-02', rate: 1.25 }, { date: '2026-01-06', rate: 1.3 }];
    it('keeps a CAD close as it is', () => {
        const cad = rows([['2026-01-02', 10]]);
        expect(toCadCloses(cad, 'CAD', fx)).toBe(cad);
    });
    it("converts a USD close at the day's rate, or the last rate before it (a holiday has none)", () => {
        const usd = rows([['2026-01-02', 100], ['2026-01-05', 100], ['2026-01-06', 100]]);
        expect(toCadCloses(usd, 'USD', fx).map((r) => Math.round(r.close * 100) / 100)).toEqual([125, 125, 130]);
    });
    it('drops a close dated before the first rate, and does not convert another currency', () => {
        expect(toCadCloses(rows([['2025-12-31', 100], ['2026-01-02', 100]]), 'USD', fx)).toHaveLength(1);
        expect(toCadCloses(rows([['2026-01-02', 100]]), 'EUR', fx)).toEqual([]);
    });
});

describe('commonCalendar', () => {
    const tsx = { isCrypto: false, closes: rows([['2026-01-02', 1], ['2026-01-05', 1], ['2026-01-06', 1]]) };
    const nyse = { isCrypto: false, closes: rows([['2026-01-02', 1], ['2026-01-06', 1], ['2026-01-07', 1]]) };
    const btc = { isCrypto: true, closes: rows([['2026-01-02', 1], ['2026-01-03', 1], ['2026-01-04', 1], ['2026-01-05', 1], ['2026-01-06', 1]]) };
    it('keeps the days every stock and fund has a close', () => {
        expect(commonCalendar([tsx, nyse])).toEqual(['2026-01-02', '2026-01-06']);
    });
    it('does not let crypto limit the calendar', () => {
        expect(commonCalendar([tsx, nyse, btc])).toEqual(['2026-01-02', '2026-01-06']);
    });
    it('uses the crypto days when only crypto is held, and is empty with nothing', () => {
        expect(commonCalendar([btc])).toHaveLength(5);
        expect(commonCalendar([])).toEqual([]);
    });
});

describe('levelsOn', () => {
    it('reads crypto as of a weekday and gives null before the series starts', () => {
        const btc = rows([['2026-01-03', 5], ['2026-01-04', 6]]);
        expect(levelsOn(btc, ['2026-01-02', '2026-01-04', '2026-01-06'])).toEqual([null, 6, 6]);
    });
});

describe('windows', () => {
    it('adds days and finds the same day a year earlier', () => {
        expect(addDays('2026-01-30', 3)).toBe('2026-02-02');
        expect(yearBefore('2026-11-13')).toBe('2025-11-13');
        expect(yearBefore('2024-02-29')).toBe('2023-02-28');
    });
    it('gives the three bounds, and treats the last 12 months as all of a short history', () => {
        expect(windowBounds('full', '2021-11-12', '2026-11-13')).toEqual({ start: '2021-11-12', end: '2026-11-13' });
        expect(windowBounds('y2022', '2021-11-12', '2026-11-13')).toEqual({ start: '2022-01-01', end: '2022-12-31' });
        expect(windowBounds('last12m', '2021-11-12', '2026-11-13')).toEqual({ start: '2025-11-13', end: '2026-11-13' });
        expect(windowBounds('last12m', '2026-06-01', '2026-11-13')).toEqual({ start: '2026-06-01', end: '2026-11-13' });
    });
});
