// Sources cited once per view: each source gets a marker (*, **, ...) in the order it first appears, and one
// legend lists every source with the time range of the values shown. Pure, so it can be tested.

import type { Sourced } from '@/lib/domain/types';

export type SourceLegendEntry = { mark: string; source: string; from: string; to: string };
export type MarkOf = (sourced: Pick<Sourced<unknown>, 'source'> | undefined | null) => string | null;

const MARKS = ['*', '**', '***', '†', '‡', '§'];

/** Marker for the n-th source (0-based): asterisks first, then the usual footnote signs, then numbers. */
export function markLabel(index: number): string {
    return MARKS[index] ?? String(index + 1);
}

const time = (iso: string) => {
    const ms = Date.parse(iso);
    return Number.isNaN(ms) ? null : ms;
};

/** Walks the values in display order; a value without a source or time is skipped. */
export function buildSourceMarks(values: Array<Pick<Sourced<unknown>, 'source' | 'fetchedAt'> | undefined | null>): { entries: SourceLegendEntry[]; markOf: MarkOf } {
    const bySource = new Map<string, SourceLegendEntry>();
    for (const value of values) {
        if (!value?.source) continue;
        const entry = bySource.get(value.source);
        if (!entry) {
            bySource.set(value.source, { mark: markLabel(bySource.size), source: value.source, from: value.fetchedAt, to: value.fetchedAt });
            continue;
        }
        const at = time(value.fetchedAt);
        if (at === null) continue;
        const from = time(entry.from), to = time(entry.to);
        if (from === null || at < from) entry.from = value.fetchedAt;
        if (to === null || at > to) entry.to = value.fetchedAt;
    }
    return {
        entries: [...bySource.values()],
        markOf: (sourced) => (sourced?.source ? bySource.get(sourced.source)?.mark ?? null : null),
    };
}
