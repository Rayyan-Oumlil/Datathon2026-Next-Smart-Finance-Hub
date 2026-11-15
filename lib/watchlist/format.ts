import type { ProfileConfig, Sourced } from '@/lib/domain/types';

/** The part of the profile the pipeline reads (the same slice a snapshot stores). */
export type ProfileView = Pick<ProfileConfig, 'level' | 'risk' | 'answers'>;

/** Case and surrounding spaces never decide a match between an answer and a list entry. */
export const normalize = (text: string): string => text.trim().toLowerCase();

/** The ESG theme is a filter only (rules filters.esg): it selects no candidate and adds no profile-fit points. */
export const isEsgTheme = (theme: string): boolean => normalize(theme) === 'esg';

/** A provider value counts only when it is a real number; anything else is treated as missing. */
export function numberOf(sourced: Sourced | undefined): number | undefined {
    return sourced && typeof sourced.value === 'number' && Number.isFinite(sourced.value) ? sourced.value : undefined;
}

/** A record lookup that only sees the record's own keys, so a name such as "constructor" never finds an inherited member. */
export function own<T>(record: Record<string, T>, key: string): T | undefined {
    return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

export const round1 = (value: number): number => Math.round((value + Number.EPSILON) * 10) / 10;

// Numbers in sentences are formatted per language by the catalog (lib/watchlist/text.ts, fmt), not here.
