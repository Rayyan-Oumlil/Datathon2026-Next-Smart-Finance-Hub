// A decision-log row shown in a language: the sentences it holds are rendered again from the structured values
// logged beside them. The row in the log is never changed; this only builds the copy that is shown.

import type { DecisionLogEntry, FilterCheck, Pick as WatchlistPick, SimulatedTrade, WatchlistResult } from '@/lib/domain/types';
import { renderCandidate, renderChecks, renderFactors, renderReason, renderRun } from '@/lib/watchlist/render';
import type { Locale } from '@/lib/watchlist/text';
import { renderTrade } from './portfolio';

type Payload = Record<string, unknown>;
const isObject = (value: unknown): value is Payload => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** One logged row with every sentence it carries in `locale`. Rows with no sentences come back unchanged. */
export function renderDecision(row: DecisionLogEntry, locale: Locale): DecisionLogEntry {
    const payload = row.payload;
    if (!isObject(payload)) return row;
    const out: Payload = { ...payload };
    if (row.kind === 'watchlist_run') {
        if (isObject(payload.result)) out.result = renderRun(payload.result as WatchlistResult, locale);
        if (Array.isArray(payload.candidates)) out.candidates = (payload.candidates as Array<Parameters<typeof renderCandidate>[0]>).map((c) => renderCandidate(c, locale));
    } else if (row.kind === 'pick') {
        if (isObject(payload.factors)) out.factors = renderFactors(payload.factors as WatchlistPick['factors'], locale);
        if ('reason' in payload) out.reason = renderReason((payload.reason ?? null) as WatchlistPick['reason'], locale);
    } else if (row.kind === 'simulated_trade') {
        if (isObject(payload.trade)) out.trade = renderTrade(payload.trade as SimulatedTrade, locale);
        if (Array.isArray(payload.conflicts)) out.conflicts = renderChecks(payload.conflicts as FilterCheck[], locale);
    } else if (row.kind === 'profile_conflict') {
        if (Array.isArray(payload.conflicts)) out.conflicts = renderChecks(payload.conflicts as FilterCheck[], locale);
    } else {
        return row;
    }
    return { ...row, payload: out };
}
