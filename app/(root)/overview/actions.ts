'use server';

import type { FilterCheck, SignalSet } from '@/lib/domain/types';
import { requestScope } from '@/lib/session';
import { getDecision } from '@/lib/store';

export type RunDetail = { filters: FilterCheck[] | null; signals: SignalSet | null };

/**
 * What GET /api/watchlist/why leaves out, read from the same logged run: every filter check of a listed
 * pick, and the input values of a symbol that is not listed. Nothing is recomputed here.
 */
export async function runDetail(decisionId: string, symbol: string): Promise<RunDetail> {
    if (typeof decisionId !== 'string' || decisionId.length > 80 || typeof symbol !== 'string' || symbol.length > 20) return { filters: null, signals: null };
    const run = await getDecision((await requestScope()).scopeId, decisionId);
    if (!run || run.kind !== 'watchlist_run') return { filters: null, signals: null };
    const payload = run.payload as { candidates?: Array<{ symbol: string; filters: FilterCheck[] }>; snapshot?: { signals?: SignalSet[] } };
    return {
        filters: payload.candidates?.find((c) => c.symbol === symbol)?.filters ?? null,
        signals: payload.snapshot?.signals?.find((s) => s.symbol === symbol) ?? null,
    };
}
