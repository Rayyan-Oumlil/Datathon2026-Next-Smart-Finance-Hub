// Pure helpers of the X-ray module: which window to show, the risk band, which rows each level sees, the
// before / after rows of the what-if. No formatting here: the components format for the active language.

import type { Level } from '@/lib/domain/types';
import type { XrayView } from '@/lib/services/portfolio-xray';
import { WINDOW_IDS, type WindowId, type WindowResult } from '@/lib/xray/types';

export type AvailableWindow = Extract<WindowResult, { available: true }>;
export const isAvailable = (window: WindowResult | undefined): window is AvailableWindow => window?.available === true;

/** The window to show: the wanted one when it can be replayed, otherwise the first that can, otherwise the wanted one. */
export function pickWindow(windows: XrayView['windows'], wanted: WindowId): WindowId {
    if (isAvailable(windows[wanted])) return wanted;
    return WINDOW_IDS.find((id) => isAvailable(windows[id])) ?? wanted;
}

export type BandStatus = 'within' | 'above';
export const bandStatus = (volatilityPct: number, limitPct: number): BandStatus => (volatilityPct <= limitPct ? 'within' : 'above');

/** Positions on a 0-100 track that holds both the volatility and the limit with some room. */
export function bandTrack(volatilityPct: number, limitPct: number) {
    const max = Math.max(limitPct, volatilityPct) * 1.2 || 1;
    return { volatilityAt: (volatilityPct / max) * 100, limitAt: (limitPct / max) * 100 };
}

export const clampPct = (value: number) => Math.min(100, Math.max(0, value));

const ROWS_SEEN: Record<Level, number> = { Novice: 3, Intermediate: 6, Expert: Number.POSITIVE_INFINITY };
/** The holdings of the value-against-risk list the level sees, largest first, and how many are not shown. */
export function riskRows(window: AvailableWindow, level: Level) {
    const limit = ROWS_SEEN[level];
    return { rows: window.risk.slice(0, limit), hidden: Math.max(0, window.risk.length - limit) };
}

/** The holding whose share of the risk exceeds its share of the value the most, or null when none does. */
export function leadRow(window: AvailableWindow) {
    let lead: AvailableWindow['risk'][number] | null = null;
    let gap = 0;
    for (const row of window.risk) {
        if (row.riskSharePct === null) continue;
        const diff = row.riskSharePct - row.weightPct;
        if (diff > gap) {
            gap = diff;
            lead = row;
        }
    }
    return lead;
}

/** The user's own answer next to the replay's fall, shown only when the fall reaches the 20 % of the question. */
export function dropFact(view: Pick<XrayView, 'dropAnswer'>, window: AvailableWindow): { answer: NonNullable<XrayView['dropAnswer']>; fallPct: number } | null {
    return view.dropAnswer && window.maxDrawdown.pct <= -20 ? { answer: view.dropAnswer, fallPct: window.maxDrawdown.pct } : null;
}

export type MetricRow = { key: 'largest' | 'effective' | 'volatility' | 'worstFall' | 'coverage' | 'cash'; kind: 'share' | 'number' | 'signed'; before: number | null; after: number | null };

/**
 * The rows of the what-if table. Volatility, the worst fall and the coverage are those of the window on screen; the
 * service computes before and after over the same dates and the same covered holdings (lib/xray/engine.ts).
 */
export function metricRows(before: XrayView, after: XrayView, windowId: WindowId): MetricRow[] {
    const win = (view: XrayView) => {
        const w = view.windows[windowId];
        return isAvailable(w) ? w : null;
    };
    return [
        { key: 'largest', kind: 'share', before: before.concentration.topHolding?.sharePct ?? null, after: after.concentration.topHolding?.sharePct ?? null },
        { key: 'effective', kind: 'number', before: before.concentration.effectiveHoldings, after: after.concentration.effectiveHoldings },
        { key: 'volatility', kind: 'share', before: win(before)?.volatilityPct ?? null, after: win(after)?.volatilityPct ?? null },
        { key: 'worstFall', kind: 'signed', before: win(before)?.maxDrawdown.pct ?? null, after: win(after)?.maxDrawdown.pct ?? null },
        { key: 'coverage', kind: 'share', before: win(before)?.coverage.sharePct ?? null, after: win(after)?.coverage.sharePct ?? null },
        { key: 'cash', kind: 'share', before: before.cashSharePct, after: after.cashSharePct },
    ];
}

/** Which way a change in a metric reads: more concentration or risk is "worse", never judged as good or bad in words. */
export const direction = (before: number | null, after: number | null): 'up' | 'down' | 'same' | null => {
    if (before === null || after === null) return null;
    const diff = after - before;
    return Math.abs(diff) < 0.005 ? 'same' : diff > 0 ? 'up' : 'down';
};

/** At most this many segments in an exposure bar; the rest are folded into one. */
export const SEGMENTS = 5;
export function segmentsOf(rows: Array<{ name: string; sharePct: number }>): Array<{ name: string; sharePct: number; rest?: number }> {
    if (rows.length <= SEGMENTS) return rows;
    const rest = rows.slice(SEGMENTS - 1);
    return [...rows.slice(0, SEGMENTS - 1), { name: '', sharePct: rest.reduce((sum, row) => sum + row.sharePct, 0), rest: rest.length }];
}

/**
 * The period of a what-if on screen: from and to of the window (the same for both sides, the service makes them so),
 * and the reason the after side could not be computed, if it could not.
 */
export function comparisonOf(before: XrayView, after: XrayView, windowId: WindowId) {
    const b = before.windows[windowId];
    const a = after.windows[windowId];
    const shown = isAvailable(a) ? a : isAvailable(b) ? b : null;
    return {
        period: shown ? { from: shown.from, to: shown.to } : null,
        afterGap: !isAvailable(a) && a?.reason === 'changed_asset_no_history' ? a.gap ?? null : null,
        // what the shown side leaves out (the same holdings on both sides), and the share of the value it covers
        gaps: shown ? shown.coverage.gaps : [],
        coveragePct: shown ? shown.coverage.sharePct : null,
    };
}

/**
 * The providers of the series a window used, once each, for a one-line source summary: the series of its included
 * holdings, and the USD/CAD rate when one of them is in US dollars.
 */
export function sourceSummary(view: Pick<XrayView, 'sources' | 'holdings'>, window: AvailableWindow | null): string[] {
    const symbols = new Set(window ? window.coverage.included : view.holdings.map((h) => h.symbol));
    const usd = view.holdings.some((h) => symbols.has(h.symbol) && h.currency === 'USD');
    if (usd) symbols.add('USD/CAD');
    return [...new Set(view.sources.filter((s) => symbols.has(s.value.split(':')[0])).map((s) => s.source))];
}
