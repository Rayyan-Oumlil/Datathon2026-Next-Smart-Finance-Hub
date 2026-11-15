// Putting several daily-close series on one calendar and one currency. Pure.

import type { DailyClose } from '@/lib/sources/types';

type Fx = Array<{ date: string; rate: number }>;

/** The last element on or before `date` (rows sorted by date), or undefined when every row is later. */
export function asOf<T extends { date: string }>(rows: T[], date: string): T | undefined {
    let low = 0;
    let high = rows.length - 1;
    let found: T | undefined;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (rows[mid].date <= date) {
            found = rows[mid];
            low = mid + 1;
        } else high = mid - 1;
    }
    return found;
}

/**
 * Closes in Canadian dollars. A CAD close is kept; a USD close is multiplied by the Bank of Canada rate of the day
 * (the last published rate on or before it: the Bank publishes none on Canadian holidays). A close dated before the
 * first rate has no conversion and is dropped; any other currency is not converted, so the series is empty.
 */
export function toCadCloses(closes: DailyClose[], currency: string, fx: Fx): DailyClose[] {
    if (currency === 'CAD') return closes;
    if (currency !== 'USD') return [];
    const rows: DailyClose[] = [];
    for (const row of closes) {
        const rate = asOf(fx, row.date)?.rate;
        if (rate !== undefined) rows.push({ date: row.date, close: row.close * rate });
    }
    return rows;
}

/**
 * The days all the series can be compared on: for stocks and funds, the days every one of them has a close (a day a
 * market was shut is left out for all, so the next return spans the gap alike); crypto trades every day, so it
 * never limits the calendar and is read as of each of those days. Only crypto: the days all of it has a close.
 */
export function commonCalendar(series: Array<{ isCrypto: boolean; closes: DailyClose[] }>): string[] {
    const market = series.filter((s) => !s.isCrypto);
    const base = market.length > 0 ? market : series;
    if (base.length === 0) return [];
    const [first, ...rest] = base.map((s) => new Set(s.closes.map((row) => row.date)));
    return [...first].filter((date) => rest.every((dates) => dates.has(date))).sort();
}

/** The close of each date, as of that date. Null where the series had not started yet. */
export function levelsOn(closes: DailyClose[], dates: string[]): Array<number | null> {
    return dates.map((date) => asOf(closes, date)?.close ?? null);
}
