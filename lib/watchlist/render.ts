// Writes a stored watchlist run again in another language, from the structured values kept beside each sentence.
// Pure: nothing is recomputed, no score or result changes; only the sentences are rendered from their textRef.
// A sentence logged without a textRef (a run written before the catalog existed) is kept as it was written.

import type { Candidate, FactorDetail, FactorScores, FilterCheck, Pick as WatchlistPick, ReasonSentence, WatchlistResult } from '@/lib/domain/types';
import { renderOr, toLocale, type Locale } from '@/lib/watchlist/text';

/** One filter check with its detail in the language. */
export function renderCheck(check: FilterCheck, locale: Locale): FilterCheck {
    return check.textRef ? { ...check, detail: renderOr(check.textRef, locale, check.detail) } : check;
}

export const renderChecks = (checks: FilterCheck[], locale: Locale): FilterCheck[] => checks.map((check) => renderCheck(check, locale));

/** One factor with its detail in the language. */
export function renderFactor(factor: FactorDetail, locale: Locale): FactorDetail {
    return factor.textRef ? { ...factor, detail: renderOr(factor.textRef, locale, factor.detail) } : factor;
}

/** The four factors of a pick or candidate, each with its detail in the language. */
export function renderFactors<F extends Record<keyof FactorScores, FactorDetail>>(factors: F, locale: Locale): F {
    return Object.fromEntries(Object.entries(factors).map(([name, factor]) => [name, renderFactor(factor, locale)])) as F;
}

/** A reason sentence in the language; the template, its values and its sources do not change. */
export function renderReason(reason: ReasonSentence | null, locale: Locale): ReasonSentence | null {
    if (!reason || !reason.textRef) return reason;
    return { ...reason, text: renderOr(reason.textRef, locale, reason.text) };
}

export function renderPick(pick: WatchlistPick, locale: Locale): WatchlistPick {
    return { ...pick, factors: renderFactors(pick.factors, locale), reason: renderReason(pick.reason, locale) };
}

/** A candidate as the decision log stores it (filters and, when it was scored, factors), in the language. */
export function renderCandidate<C extends Pick<Candidate, 'filters' | 'factors'>>(candidate: C, locale: Locale): C {
    return {
        ...candidate,
        filters: renderChecks(candidate.filters, locale),
        ...(candidate.factors ? { factors: renderFactors(candidate.factors, locale) } : {}),
    };
}

/**
 * Every detail and reason sentence of a stored run, written in `locale`: filter checks of the rejected candidates,
 * factor details and reason sentences of the picks. The result says which language it is now in. Rendering a run
 * computed in English into French gives exactly the sentences a run computed in French would have.
 */
export function renderRun(result: WatchlistResult, locale: Locale): WatchlistResult {
    const lang = toLocale(locale);
    return {
        ...result,
        picks: result.picks.map((pick) => renderPick(pick, lang)),
        rejected: result.rejected.map((rejected) => ({ ...rejected, failed: renderChecks(rejected.failed, lang) })),
        locale: lang,
    };
}
