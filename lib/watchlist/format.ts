import type { ProfileConfig, Sourced } from '@/lib/domain/types';

/** The part of the profile the pipeline reads (the same slice a snapshot stores). */
export type ProfileView = Pick<ProfileConfig, 'level' | 'risk' | 'answers'>;

/** Case and surrounding spaces never decide a match between an answer and a list entry. */
export const normalize = (text: string): string => text.trim().toLowerCase();

/** A provider value counts only when it is a real number; anything else is treated as missing. */
export function numberOf(sourced: Sourced | undefined): number | undefined {
    return sourced && typeof sourced.value === 'number' && Number.isFinite(sourced.value) ? sourced.value : undefined;
}

/** A record lookup that only sees the record's own keys, so a name such as "constructor" never finds an inherited member. */
export function own<T>(record: Record<string, T>, key: string): T | undefined {
    return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

export const round1 = (value: number): number => Math.round((value + Number.EPSILON) * 10) / 10;

export const formatPercent = (fraction: number, decimals = 1): string => `${(fraction * 100).toFixed(decimals)}%`;

/** US$ in billions or millions with 1 decimal; exact = true gives whole dollars. */
export function formatUsd(value: number, exact = false): string {
    if (!exact && Math.abs(value) >= 1e9) return 'US$' + (value / 1e9).toFixed(1) + 'B';
    if (!exact && Math.abs(value) >= 1e6) return 'US$' + (value / 1e6).toFixed(1) + 'M';
    return 'US$' + Math.round(value).toLocaleString('en-US');
}

// A sentence must never read "35.0% is above the 35.0% cap": when two different numbers round to the same text,
// the pair is written with more precision.

export function formatPercentPair(value: number, limit: number): [string, string] {
    for (let decimals = 1; decimals < 6; decimals++) {
        const pair: [string, string] = [formatPercent(value, decimals), formatPercent(limit, decimals)];
        if (pair[0] !== pair[1] || value === limit) return pair;
    }
    return [formatPercent(value, 6), formatPercent(limit, 6)];
}

export function formatUsdPair(value: number, limit: number): [string, string] {
    const pair: [string, string] = [formatUsd(value), formatUsd(limit)];
    return pair[0] !== pair[1] || value === limit ? pair : [formatUsd(value, true), formatUsd(limit, true)];
}
