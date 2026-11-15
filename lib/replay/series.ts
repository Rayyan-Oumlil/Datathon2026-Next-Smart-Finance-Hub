/**
 * Pure series helpers of the replay: as-of lookups, total-return series aligned on the common calendar,
 * conversion to CAD and macro publication lags. No I/O. The no-look-ahead guarantee starts here: every lookup
 * takes a date and can only return a value dated on or before it (or, for macro data, published on or before it).
 */

import type { Sourced } from '@/lib/domain/types';
import type { AssetClass, DailyPrice, FxPoint, IsoDate, ListingCurrency, MacroPoint, Provenance } from './types';

// ------------------------------------------------------------------ dates

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function toUtc(date: IsoDate): Date {
    if (!ISO_RE.test(date)) throw new Error(`"${date}" is not an ISO date`);
    const d = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) throw new Error(`"${date}" is not a valid date`);
    return d;
}

export function addDays(date: IsoDate, days: number): IsoDate {
    const d = toUtc(date);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

/** Adds weekdays (Monday to Friday), skipping weekends; holidays are not known here. */
export function addWeekdays(date: IsoDate, days: number): IsoDate {
    const d = toUtc(date);
    let left = days;
    while (left > 0) {
        d.setUTCDate(d.getUTCDate() + 1);
        const wd = d.getUTCDay();
        if (wd !== 0 && wd !== 6) left--;
    }
    return d.toISOString().slice(0, 10);
}

/** First day of the month `months` after the month of `date`. */
export function firstOfMonthAfter(date: IsoDate, months: number): IsoDate {
    const d = toUtc(date);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1)).toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ as-of lookups

/**
 * Index of the last element whose key is <= date, or -1. Rows must be sorted ascending by key (the provider
 * guarantees it). Binary search, so it can never pick a later row even if one is "closer".
 */
export function asOfIndex<T>(rows: readonly T[], date: IsoDate, key: (r: T) => IsoDate): number {
    toUtc(date);
    let lo = 0;
    let hi = rows.length - 1;
    let found = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (key(rows[mid]) <= date) {
            found = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return found;
}

/** The last row dated on or before `date`, or undefined. Never a row dated after it. */
export function asOf<T extends { date: IsoDate }>(rows: readonly T[], date: IsoDate): T | undefined {
    const i = asOfIndex(rows, date, (r) => r.date);
    return i < 0 ? undefined : rows[i];
}

/** All rows dated on or before `date`: what was known at that date. */
export function knownAt<T extends { date: IsoDate }>(rows: readonly T[], date: IsoDate): T[] {
    return rows.slice(0, asOfIndex(rows, date, (r) => r.date) + 1);
}

/** The USD/CAD rate of `date`, or the last one published before it (Bank of Canada skips Canadian holidays). */
export function fxAsOf(fx: readonly FxPoint[], date: IsoDate): FxPoint | undefined {
    return asOf(fx, date);
}

// ------------------------------------------------------------------ macro publication lags

/**
 * When a macro value may first be used. The organizers' README gives no exact release dates; it says monthly
 * values are dated to the reference month and come out "weeks later", and the dataset has no release calendar.
 * We therefore apply conservative lags, chosen so that the value is public before availableFrom in normal times:
 *
 *  - BD.CDN.2YR.DQ.YLD, BD.CDN.10YR.DQ.YLD (Bank of Canada benchmark yields, business daily): next weekday.
 *    The Bank publishes them after the close of the day they describe, so they are not known at that close.
 *  - V39079 (Bank of Canada target overnight rate): next weekday. The rate dated D is effective on D and
 *    announced before, so this only costs a day and keeps one rule for all Bank of Canada daily series.
 *  - DFF (effective fed funds), DGS2, DGS10 (Treasury yields), FRED: two weekdays. FRED posts them on the next
 *    business day; the second day covers a U.S. holiday falling on that next day.
 *  - CPIAUCSL (U.S. CPI), UNRATE (U.S. unemployment), STATIC_TOTALCPICHANGE (Canada CPI y/y), monthly: first day
 *    of the second month after the reference month (October data usable from December 1). The usual releases
 *    (U.S. jobs report early in the next month, U.S. CPI around mid-month, Statistics Canada CPI in the third
 *    week) all come before that date.
 *  - Exception: UNRATE for September 2025, whose release was delayed by the October-November 2025 U.S. federal
 *    shutdown (October 2025 is missing from the file for the same reason). It is pushed to the first day of the
 *    third month (2025-12-01) rather than relying on an exact release date the dataset does not contain.
 *
 * Unknown series fall back on their frequency (daily: two weekdays; monthly: first day of month + 2). Any other
 * frequency throws, so a new series cannot slip in without a stated lag. FRED monthly values are also the latest
 * revision, not the first print; the lag does not fix that and describe() lists it as a note.
 */
type LagRule = { kind: 'weekdays'; days: number } | { kind: 'monthStart'; months: number };

export const MACRO_PUBLICATION_LAG: Readonly<Record<string, LagRule>> = {
    V39079: { kind: 'weekdays', days: 1 },
    'BD.CDN.2YR.DQ.YLD': { kind: 'weekdays', days: 1 },
    'BD.CDN.10YR.DQ.YLD': { kind: 'weekdays', days: 1 },
    DFF: { kind: 'weekdays', days: 2 },
    DGS2: { kind: 'weekdays', days: 2 },
    DGS10: { kind: 'weekdays', days: 2 },
    CPIAUCSL: { kind: 'monthStart', months: 2 },
    UNRATE: { kind: 'monthStart', months: 2 },
    STATIC_TOTALCPICHANGE: { kind: 'monthStart', months: 2 },
};

/** Explicit, documented release delays (series|reference date -> first usable date). */
export const MACRO_RELEASE_OVERRIDES: Readonly<Record<string, IsoDate>> = {
    'UNRATE|2025-09-01': '2025-12-01',
};

function ruleFor(seriesId: string, frequency: string): LagRule {
    const known = MACRO_PUBLICATION_LAG[seriesId];
    if (known) return known;
    const f = frequency.toLowerCase();
    if (f === 'monthly') return { kind: 'monthStart', months: 2 };
    if (f.startsWith('daily') || f.startsWith('business daily')) return { kind: 'weekdays', days: 2 };
    throw new Error(`no publication lag defined for ${seriesId} (frequency "${frequency}")`);
}

export function macroAvailableFrom(seriesId: string, frequency: string, date: IsoDate): IsoDate {
    const rule = ruleFor(seriesId, frequency);
    if (rule.kind === 'monthStart' && toUtc(date).getUTCDate() !== 1) {
        throw new Error(`${seriesId}: monthly value dated ${date}, expected the first day of the reference month`);
    }
    const base = rule.kind === 'weekdays' ? addWeekdays(date, rule.days) : firstOfMonthAfter(date, rule.months);
    const override = MACRO_RELEASE_OVERRIDES[`${seriesId}|${date}`];
    return override && override > base ? override : base;
}

/**
 * The latest macro value already published at `date` (availableFrom <= date). Rows are sorted by reference
 * date and availableFrom is non-decreasing in it except for overrides, so we scan back from the last candidate.
 */
export function macroAsOf(points: readonly MacroPoint[], date: IsoDate): MacroPoint | undefined {
    for (let i = asOfIndex(points, date, (p) => p.date); i >= 0; i--) {
        if (points[i].availableFrom <= date) return points[i];
    }
    return undefined;
}

// ------------------------------------------------------------------ aligned total-return series

export type AlignedPoint = {
    date: IsoDate;              // calendar date
    value: number | null;       // adj_close (listing currency or CAD), null before the asset's first known price
    sourceDate: IsoDate | null; // date of the price row actually used (<= date, or <= date - 1 day for crypto)
    dailyReturn: number | null; // value / previous value - 1, null on the first known point
};

export type AlignedSeries = {
    ticker: string;
    currency: ListingCurrency | 'CAD';
    points: AlignedPoint[];
};

export type AlignOptions = {
    /**
     * Crypto rows cover a UTC calendar day ending at 24:00 UTC, after the TSX/U.S. close (20:00 or 21:00 UTC).
     * By default the value on calendar date D is the close of UTC day D-1, the last one complete at the
     * North American close. Set true to use the same-day UTC close instead (looks a few hours ahead).
     */
    cryptoSameUtcDay?: boolean;
};

function withReturns(points: Omit<AlignedPoint, 'dailyReturn'>[]): AlignedPoint[] {
    let prev: number | null = null;
    return points.map((p) => {
        const dailyReturn = p.value !== null && prev !== null ? p.value / prev - 1 : null;
        if (p.value !== null) prev = p.value;
        return { ...p, dailyReturn };
    });
}

/**
 * Total-return series of one asset on the calendar: adj_close as of each date (dividends reinvested, splits
 * already in the data, so nothing is re-applied). On a date the asset's market is closed, the last close is
 * carried and the return is 0.
 */
export function alignedTotalReturn(
    calendar: readonly IsoDate[],
    prices: readonly DailyPrice[],
    asset: { ticker: string; assetClass: AssetClass; currency: ListingCurrency },
    opts: AlignOptions = {},
): AlignedSeries {
    const lag = asset.assetClass === 'crypto' && !opts.cryptoSameUtcDay ? 1 : 0;
    for (const p of prices) {
        if (p.ticker !== asset.ticker) throw new Error(`price row of ${p.ticker} passed for ${asset.ticker}`);
    }
    const points = calendar.map((date) => {
        const row = asOf(prices, lag ? addDays(date, -lag) : date);
        return { date, value: row ? row.adjClose : null, sourceDate: row ? row.date : null };
    });
    return { ticker: asset.ticker, currency: asset.currency, points: withReturns(points) };
}

/**
 * Converts a series to CAD with the Bank of Canada USD/CAD rate of each date, or the last rate known before it
 * on Canadian holidays. CAD series are returned unchanged. Throws when no rate is known yet at a date that has
 * a value, rather than guess one. The CAD return therefore includes the exchange-rate effect.
 */
export function toCad(series: AlignedSeries, fx: readonly FxPoint[]): AlignedSeries {
    if (series.currency === 'CAD') return series;
    const points = series.points.map((p) => {
        if (p.value === null) return { date: p.date, value: null, sourceDate: p.sourceDate };
        const rate = fxAsOf(fx, p.date);
        if (!rate) throw new Error(`no USD/CAD rate on or before ${p.date}`);
        return { date: p.date, value: p.value * rate.usdcad, sourceDate: p.sourceDate };
    });
    return { ticker: series.ticker, currency: 'CAD', points: withReturns(points) };
}

/** The USD/CAD rate used on each calendar date, with the publication date actually used. */
export function fxOnCalendar(calendar: readonly IsoDate[], fx: readonly FxPoint[]): Array<{ date: IsoDate; usdcad: number; sourceDate: IsoDate }> {
    return calendar.map((date) => {
        const r = fxAsOf(fx, date);
        if (!r) throw new Error(`no USD/CAD rate on or before ${date}`);
        return { date, usdcad: r.usdcad, sourceDate: r.date };
    });
}

/** The aligned point of `date`, never a later one. */
export function seriesAsOf(series: AlignedSeries, date: IsoDate): AlignedPoint | undefined {
    return asOf(series.points, date);
}

// ------------------------------------------------------------------ Sourced

/**
 * Wraps a replay figure in the app's Sourced type. Source, endpoint and dates come from the provenance, which
 * the provider reads from sources_metadata.csv. fetchedAt is the extraction date of the frozen snapshot.
 */
export function toSourced<T>(
    value: T,
    provenance: Provenance,
    asOfDate: IsoDate,
    extra: { unit?: string; currency?: string; note?: string } = {},
): Sourced<T> {
    return {
        value,
        ...(extra.unit ? { unit: extra.unit } : {}),
        ...(extra.currency ? { currency: extra.currency } : {}),
        source: provenance.source,
        ...(provenance.sourceUrl ? { endpoint: provenance.sourceUrl } : {}),
        fetchedAt: provenance.retrievedOn,
        asOf: asOfDate,
        note: extra.note ?? `${provenance.file} (${provenance.datasetId}); ${provenance.processing}`,
    };
}
