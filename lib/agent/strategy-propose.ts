// The action strategy_propose (docs/agent-api.md): the agent proposes a whole strategy (a name and its rules), the
// app validates it with the strict schema of lib/strategy, previews it as its rule sentences with a 5-year history
// preview (the replay engine, on the visitor's current simulated portfolio, without and with the strategy) and the
// profile conflicts, and saves it only after the user confirms. Undo restores the previous version, or moves a new
// strategy out of the visitor's list into `strategiesRemoved` in the same document; no log row is ever deleted.

import type { Locale } from '@/i18n/config';
import type { FilterCheck } from '@/lib/domain/types';
import { RULES, RULES_VERSION } from '@/lib/rules';
import { ServiceError } from '@/lib/services/errors';
import { getPortfolio } from '@/lib/services/portfolio';
import { getProfile } from '@/lib/services/profile';
import { getStrategy, listStrategies, saveStrategy, type StoredStrategy } from '@/lib/services/rules-engine';
import { runReplay } from '@/lib/services/replay';
import type { Scope } from '@/lib/session';
import { appendDecision, updateState } from '@/lib/store';
import { STRATEGY_CONFIG } from '@/lib/strategy/config';
import '@/lib/strategy/text';
import { parseStrategy, type Strategy, type StrategyIssue } from '@/lib/strategy/types';
import { renderText } from '@/lib/watchlist/text';
import { checkStrategyConflicts, type StrategyConflict } from './strategy-conflict';
import { strategyRuleSentence, strategyWords } from './strategy-words';

/** The history preview always starts here: about five years of the frozen snapshot. */
export const PREVIEW_START_DATE = '2021-01-04';

export type StrategyPreview = {
    name: string;
    replaceId: string | null;
    sentences: string[];
    beforeSentences: string[] | null;
    table: Array<{ label: string; without: string; with: string }>;
    firings: Array<{ ruleId: string; label: string; count: number }>;
    replay: { replayId: string; snapshotId: string; from: string; to: string; tradingDays: number; capitalCad: number } | null;
    replayNote: string | null;
    conflicts: Array<{ symbol: string; detail: string }>;
    notes: string[];
    illustrative: string;
};

/** A strategy refused by the schema: the sentences in the request's language and the issue codes for the agent. */
export class StrategyRefusal extends Error {
    constructor(public messages: string[], public issues: Array<Pick<StrategyIssue, 'code' | 'path' | 'values'>>) {
        super(messages.join(' '));
    }
}

/** A refusal already worded in the request's language (unknown strategy id, no profile). */
export class StrategyPreviewError extends ServiceError {}

/** The model may send ids and versions: they are dropped, the app sets them (replaceId names the stored one). */
export function strategyInput(raw: Record<string, unknown>): Record<string, unknown> {
    const { id: _id, version: _version, createdAt: _c, updatedAt: _u, peakValueCad: _p, ...rest } = raw;
    return rest;
}

export function validateStrategy(raw: Record<string, unknown>, locale: Locale): Strategy {
    const parsed = parseStrategy(strategyInput(raw));
    if (parsed.ok) return parsed.strategy;
    throw new StrategyRefusal(parsed.errors.map((issue) => renderText(issue.textRef, locale)), parsed.errors.map(({ code, path, values }) => ({ code, path, values })));
}

/** The simulated portfolio as weights of its value (in percent), and that value. At cost when a holding has no price. */
export async function currentWeights(scope: Scope): Promise<{ weights: Record<string, number>; valueCad: number }> {
    const view = await getPortfolio('en', scope);
    const priced = view.positions.every((position) => position.valueCad !== null);
    const values = view.positions.map((position) => ({ symbol: position.symbol, valueCad: priced ? position.valueCad! : position.quantity * position.avgCostCad }));
    const total = view.cashCad + values.reduce((sum, v) => sum + v.valueCad, 0);
    const weights = Object.fromEntries(values.filter((v) => v.valueCad > 0 && total > 0).map((v) => [v.symbol, Math.round((v.valueCad / total) * 1e4) / 100]));
    return { weights, valueCad: Math.round(total * 100) / 100 };
}

/** Current weights scaled so `symbol` can take `weightPct` (rounded down to 0.01 pt, so the total stays at or under 100). */
export function makeRoom(weights: Record<string, number>, symbol: string, weightPct: number): Array<{ symbol: string; weightPct: number }> {
    const wanted = symbol.trim().toUpperCase();
    const others = Object.entries(weights).filter(([s]) => s !== wanted);
    const total = others.reduce((sum, [, w]) => sum + w, 0);
    const room = Math.max(0, 100 - weightPct);
    const scaled = others.map(([s, w]) => ({ symbol: s, weightPct: Math.floor((total > 0 ? (w / total) * room : 0) * 100) / 100 })).filter((t) => t.weightPct >= 0.1);
    return [...scaled, { symbol: wanted, weightPct }];
}

const fmt = (locale: Locale) => ({
    cad: (v: number) => new Intl.NumberFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', { style: 'currency', currency: 'CAD' }).format(v),
    pct: (v: number) => new Intl.NumberFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', { style: 'percent', maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(v / 100),
});

export async function previewStrategy(raw: Record<string, unknown>, replaceId: string | undefined, locale: Locale, scope: Scope): Promise<{ strategy: Strategy; preview: StrategyPreview; conflicts: StrategyConflict[]; summary: string; signals: unknown }> {
    const words = strategyWords(locale);
    const strategy = validateStrategy(raw, locale);
    const previous = replaceId ? await getStrategy(replaceId, scope).catch(() => null) : null;
    if (replaceId && !previous) throw new StrategyPreviewError(404, words.unknownStrategy(replaceId));
    const profile = await getProfile(undefined, scope);
    if (!profile) throw new StrategyPreviewError(409, words.noProfile);

    const { weights, valueCad } = await currentWeights(scope);
    const report = await checkStrategyConflicts(strategy, profile, weights, locale);

    const f = fmt(locale);
    let replay: StrategyPreview['replay'] = null;
    let replayNote: string | null = null;
    const table: StrategyPreview['table'] = [];
    const firings: StrategyPreview['firings'] = [];
    const notes: string[] = [];
    try {
        const result = await runReplay({ portfolio: 'current', capitalCad: Math.max(100, valueCad), strategy: strategy as unknown as Record<string, unknown>, startDate: PREVIEW_START_DATE, feePerOrderCad: 0 }, { scope });
        const a = result.series.without.metrics;
        const b = result.series.with.metrics;
        table.push(
            { label: words.finalValue, without: f.cad(a.finalValueCad), with: f.cad(b.finalValueCad) },
            { label: words.totalReturn, without: f.pct(a.totalReturnPct), with: f.pct(b.totalReturnPct) },
            { label: words.largestFall, without: f.pct(a.worstFall.pct), with: f.pct(b.worstFall.pct) },
            { label: words.volatility, without: f.pct(a.volatilityPct), with: f.pct(b.volatilityPct) },
        );
        for (const stat of result.ruleStats) {
            const rule = strategy.rules.find((r) => r.id === stat.ruleId);
            firings.push({ ruleId: stat.ruleId, label: rule ? words.kind(rule.kind) : stat.kind, count: stat.fired });
        }
        replay = { replayId: result.replayId, snapshotId: result.snapshotId, from: result.window.from, to: result.window.to, tradingDays: result.window.tradingDays, capitalCad: result.params.capitalCad };
        const left = [...new Set(result.unreplayable.filter((u) => u.role !== 'benchmark').map((u) => u.symbol))];
        if (left.length > 0) notes.push(words.unreplayable(left));
    } catch (error) {
        replayNote = words.replayUnavailable(error instanceof ServiceError ? error.messageIn(locale) : error instanceof Error ? error.message : String(error));
    }
    if (report.unchecked.length > 0) notes.push(words.unchecked(report.unchecked));

    const sentences = strategy.rules.map((rule) => strategyRuleSentence(rule, locale));
    const preview: StrategyPreview = {
        name: strategy.name,
        replaceId: previous?.id ?? null,
        sentences,
        beforeSentences: previous ? previous.rules.map((rule) => strategyRuleSentence(rule, locale)) : null,
        table, firings, replay, replayNote,
        conflicts: report.conflicts.map(({ symbol, detail }) => ({ symbol, detail })),
        notes,
        illustrative: words.illustrative,
    };
    const summary = previous ? words.summaryReplace(strategy.name, strategy.rules.length) : words.summaryNew(strategy.name, strategy.rules.length);
    return { strategy, preview, conflicts: report.conflicts, summary, signals: report.signals };
}

/** Logged when a strategy preview raises conflicts (proceeded: false) and again when the user confirms it (proceeded: true). */
export async function logStrategyConflict(scope: Scope, actionId: string, conflicts: FilterCheck[], proceeded: boolean, extra: Record<string, unknown> = {}): Promise<void> {
    if (conflicts.length === 0) return;
    const profile = await getProfile('en', scope);
    await appendDecision({
        userId: scope.portfolioUserId,
        kind: 'profile_conflict',
        ruleVersions: { filters: RULES.filters.version, rules: RULES_VERSION, strategy: STRATEGY_CONFIG.version, ...(profile ? { level: profile.ruleVersions.level, risk: profile.ruleVersions.risk } : {}) },
        payload: { conflicts, level: profile?.level ?? null, risk: profile?.risk ?? null, origin: 'agent', actionId, context: 'strategy_propose', proceeded, simulated: true, ...extra },
    }).catch(() => undefined);
}

export type StrategyUndo = { type: 'strategy_propose'; strategyId: string; previous: StoredStrategy | null };

export async function applyStrategy(params: { strategy: Record<string, unknown>; replaceId?: string }, scope: Scope): Promise<{ saved: StoredStrategy; undo: StrategyUndo }> {
    const input = strategyInput(params.strategy);
    const previous = params.replaceId ? (await listStrategies(scope)).find((s) => s.id === params.replaceId) ?? null : null;
    const saved = await saveStrategy(previous ? { ...input, id: previous.id } : input, scope);
    return { saved, undo: { type: 'strategy_propose', strategyId: saved.id, previous } };
}

type Doc = { strategies?: StoredStrategy[]; strategiesRemoved?: Array<StoredStrategy & { removedAt: string; actionId: string }> };

/** Puts back the version the confirmed proposal replaced, or moves a new strategy to `strategiesRemoved`. */
export async function undoStrategy(actionId: string, undo: StrategyUndo, scope: Scope): Promise<{ outcome: 'restored' | 'removed' | 'gone'; strategy?: StoredStrategy }> {
    const state: { outcome: 'restored' | 'removed' | 'gone'; touched?: StoredStrategy } = { outcome: 'gone' };
    await updateState(scope, (appState) => {
        const doc = appState as unknown as Doc;
        const list = (doc.strategies ??= []);
        const at = list.findIndex((s) => s.id === undo.strategyId);
        if (at < 0) return;
        state.touched = list[at];
        if (undo.previous) {
            list[at] = undo.previous;
            state.outcome = 'restored';
        } else {
            list.splice(at, 1);
            (doc.strategiesRemoved ??= []).push({ ...state.touched, removedAt: new Date().toISOString(), actionId });
            doc.strategiesRemoved = doc.strategiesRemoved.slice(-20);
            state.outcome = 'removed';
        }
    });
    const { outcome, touched } = state;
    if (outcome !== 'gone') {
        await appendDecision({
            userId: scope.portfolioUserId, kind: 'user_action', ruleVersions: { rules: RULES_VERSION, strategy: STRATEGY_CONFIG.version },
            payload: { action: outcome === 'restored' ? 'strategy_restore' : 'strategy_remove', origin: 'agent undo', actionId, strategy: outcome === 'restored' ? undo.previous : touched, replaced: outcome === 'restored' ? touched : undefined, simulated: true },
        });
    }
    return { outcome, strategy: outcome === 'restored' ? undo.previous ?? undefined : touched };
}

/** The strategies as the agent's context lists them: names, rule kinds and counts. */
export async function strategiesForContext(scope: Scope): Promise<Array<{ id: string; name: string; version: number; rules: number; kinds: Record<string, number> }>> {
    const list = await listStrategies(scope).catch(() => [] as StoredStrategy[]);
    return list.map((s) => ({
        id: s.id, name: s.name, version: s.version, rules: s.rules.length,
        kinds: s.rules.reduce<Record<string, number>>((count, rule) => ({ ...count, [rule.kind]: (count[rule.kind] ?? 0) + 1 }), {}),
    }));
}
