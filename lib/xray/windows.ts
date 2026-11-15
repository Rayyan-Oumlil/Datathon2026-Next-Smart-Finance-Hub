// The three periods the X-ray replays the portfolio over, so the user can change the period and see whether the
// picture stays the same. Pure.

import type { WindowId } from './types';

/** A window needs at least this many daily returns; with fewer it is reported as unavailable, never guessed. */
export const MIN_RETURNS = 60;
/** A series covers a window when it starts and ends within this many days of the window's own bounds. */
export const EDGE_TOLERANCE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: string, days: number): string {
    return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The same day `years` years earlier (29 Feb becomes 28 Feb). */
export function yearsBefore(date: string, years: number): string {
    const d = new Date(`${date}T00:00:00Z`);
    const month = d.getUTCMonth();
    d.setUTCFullYear(d.getUTCFullYear() - years);
    if (d.getUTCMonth() !== month) d.setUTCDate(0);
    return d.toISOString().slice(0, 10);
}

const YEARS: Record<Exclude<WindowId, 'full'>, number> = { last3y: 3, last1y: 1 };

/**
 * The bounds of a window. `earliest` and `latest` are the first and last close date of any held series: the full
 * window (up to five years) runs over all of it, the others back from `latest` by 3 or 1 years. With less history
 * than that, the window is all of it.
 */
export function windowBounds(id: WindowId, earliest: string, latest: string): { start: string; end: string } {
    if (id === 'full') return { start: earliest, end: latest };
    const back = yearsBefore(latest, YEARS[id]);
    return { start: back > earliest ? back : earliest, end: latest };
}
