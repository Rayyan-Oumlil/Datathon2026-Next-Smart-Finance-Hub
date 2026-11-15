// Suggested strategies and suggested rule thresholds for the visitor's risk level (rules/v1.json ->
// strategy_suggestions). Teaching examples, not advice. buildStrategySuggestions is pure and deterministic: it reads
// the table for the risk level, fills the two placeholders (the target weights and the largest holding) from the
// simulated portfolio, or from a suggested portfolio when nothing is held, and validates every rule with
// parseStrategy. Each suggestion carries its reasons as codes and values, rendered by messages (Strategy.suggestions.why.*).

import type { Risk } from '@/lib/domain/types';
import { RULES } from '@/lib/rules';
import { currentScope, type Scope } from '@/lib/session';
import { getProfile } from '@/lib/store';
import { LIMITS, RULE_KINDS, parseStrategy, type AllocationTarget, type RuleKind, type StrategyRule } from '@/lib/strategy/types';
import type { Locale } from '@/lib/watchlist/text';
import { ServiceError } from './errors';
import { buildModelOptions } from './model-portfolio';
import { getPortfolio } from './portfolio';

// ---------------------------------------------------------------- the table

type Text = { fr: string; en: string };
type TableRule = Record<string, unknown> & { kind: RuleKind };
type TableStrategy = { id: string; family: string; name: Text; description: Text; rules: TableRule[] };
type TableLevel = { strategies: TableStrategy[]; rules: Record<RuleKind, TableRule> };
type Table = { version: string; label_fr: string; label_en: string; fallback_targets: Weight[]; levels: Record<Risk, TableLevel> };

export const SUGGESTIONS_TABLE = RULES.strategy_suggestions as unknown as Table;
export const STRATEGY_SUGGESTIONS_VERSION: string = SUGGESTIONS_TABLE.version;

/** Placeholders the table uses where the value depends on the portfolio. */
const FROM_PORTFOLIO = 'from_portfolio';
const LARGEST_HOLDING = 'largest_holding';

// ---------------------------------------------------------------- types

/** One reason a suggestion looks the way it does: a message code (Strategy.suggestions.why.<code>) and its values. */
export type SuggestionWhy = { code: 'risk' | 'targets_portfolio' | 'targets_model' | 'largest_holding' | 'cap_over' | 'targets_capped'; values: Record<string, string | number> };

export type Weight = { symbol: string; weightPct: number };

/** Where the target weights come from: the simulated portfolio, or one of the suggested portfolios. */
export type WeightsSource = { kind: 'portfolio' } | { kind: 'model'; optionId: string; name: Text };

export type StrategySuggestion = {
    id: string;
    family: string;
    name: Text;
    description: Text;
    /** Valid strategy rules (parseStrategy), ids `<kind>_<n>`: ready for POST /api/strategy. */
    rules: StrategyRule[];
    why: SuggestionWhy[];
};

export type RuleSuggestion = { kind: RuleKind; rule: StrategyRule; why: SuggestionWhy[] };

export type Suggestions = { version: string; risk: Risk; source: WeightsSource; strategies: StrategySuggestion[]; rules: RuleSuggestion[] };

// ---------------------------------------------------------------- the pure part

const floor1 = (value: number) => Math.floor(value * 10) / 10;

/** Weights of positions in a portfolio (cash counted in the total), rounded down to 0.1, largest first. */
export function weightsFromValues(positions: Array<{ symbol: string; valueCad: number }>, cashCad: number): Weight[] {
    const total = Math.max(0, cashCad) + positions.reduce((sum, p) => sum + Math.max(0, p.valueCad), 0);
    if (total <= 0) return [];
    return positions
        .map((p) => ({ symbol: p.symbol, weightPct: floor1((Math.max(0, p.valueCad) / total) * 100) }))
        .filter((w) => w.weightPct >= LIMITS.weightPct.min)
        .sort((a, b) => b.weightPct - a.weightPct || a.symbol.localeCompare(b.symbol))
        .slice(0, LIMITS.targetsMax);
}

const sourceWhy = (source: WeightsSource, count: number): SuggestionWhy =>
    source.kind === 'portfolio' ? { code: 'targets_portfolio', values: { count } } : { code: 'targets_model', values: { count, fr: source.name.fr, en: source.name.en } };

/** Fills the placeholders of one table rule; `cap` lowers every target to a weight cap of the same strategy. */
function fill(rule: TableRule, weights: Weight[], cap: number | null): { rule: Record<string, unknown>; capped: number } {
    const out: Record<string, unknown> = { ...rule };
    let capped = 0;
    if (rule.kind === 'allocation_target' && rule.targets === FROM_PORTFOLIO) {
        out.targets = weights.map((w): AllocationTarget => {
            if (cap !== null && w.weightPct > cap) {
                capped += 1;
                return { symbol: w.symbol, weightPct: cap };
            }
            return { symbol: w.symbol, weightPct: w.weightPct };
        });
    }
    if (rule.kind === 'price_threshold' && rule.symbol === LARGEST_HOLDING) out.symbol = weights[0]?.symbol ?? 'XIU.TO';
    return { rule: out, capped };
}

function validRules(rules: Record<string, unknown>[], where: string): StrategyRule[] {
    const parsed = parseStrategy({ name: where, rules });
    if (!parsed.ok) throw new Error(`strategy_suggestions ${where}: ${parsed.errors.map((e) => `${e.code} at ${e.path}`).join(', ')}`);
    return parsed.strategy.rules;
}

/**
 * The suggestions for a risk level and a set of weights. Pure: the same input always gives the same output. Throws
 * when a filled rule fails validation (the table test makes sure it never does).
 */
export function buildStrategySuggestions(input: { risk: Risk; weights: Weight[]; source: WeightsSource }): Suggestions {
    const { risk, source } = input;
    // No weights at all (nothing held and no suggested portfolio): the table's fallback targets
    const weights = input.weights.length > 0 ? input.weights : SUGGESTIONS_TABLE.fallback_targets;
    const level = SUGGESTIONS_TABLE.levels[risk];
    const largest = weights[0];
    const riskWhy: SuggestionWhy = { code: 'risk', values: { risk, version: STRATEGY_SUGGESTIONS_VERSION } };

    const strategies = level.strategies.map((suggestion): StrategySuggestion => {
        const capRule = suggestion.rules.find((r) => r.kind === 'weight_cap');
        const cap = capRule ? Number(capRule.maxWeightPct) : null;
        let capped = 0;
        const filled = suggestion.rules.map((r) => {
            const one = fill(r, weights, cap);
            capped += one.capped;
            return one.rule;
        });
        const why: SuggestionWhy[] = [riskWhy];
        if (suggestion.rules.some((r) => r.targets === FROM_PORTFOLIO)) why.push(sourceWhy(source, weights.length));
        if (cap !== null && largest && largest.weightPct > cap) why.push({ code: 'cap_over', values: { symbol: largest.symbol, weight: largest.weightPct, cap } });
        if (capped > 0 && cap !== null) why.push({ code: 'targets_capped', values: { count: capped, cap } });
        return { id: suggestion.id, family: suggestion.family, name: suggestion.name, description: suggestion.description, rules: validRules(filled, suggestion.id), why };
    });

    const rules = RULE_KINDS.map((kind): RuleSuggestion => {
        const raw = level.rules[kind];
        const [rule] = validRules([fill(raw, weights, null).rule], `${risk}.rules.${kind}`);
        const why: SuggestionWhy[] = [riskWhy];
        if (kind === 'allocation_target') why.push(sourceWhy(source, weights.length));
        if (kind === 'price_threshold' && largest) why.push({ code: 'largest_holding', values: { symbol: largest.symbol, weight: largest.weightPct } });
        if (kind === 'weight_cap' && rule.kind === 'weight_cap' && largest && largest.weightPct > rule.maxWeightPct) {
            why.push({ code: 'cap_over', values: { symbol: largest.symbol, weight: largest.weightPct, cap: rule.maxWeightPct } });
        }
        return { kind, rule, why };
    });

    return { version: STRATEGY_SUGGESTIONS_VERSION, risk, source, strategies, rules };
}

// ---------------------------------------------------------------- the service

export type SuggestionsView = Omit<Suggestions, 'strategies' | 'source'> & {
    simulated: true;
    label: string;
    source: { kind: 'portfolio' } | { kind: 'model'; optionId: string; name: string };
    strategies: Array<Omit<StrategySuggestion, 'name' | 'description'> & { name: string; description: string }>;
};

/**
 * The suggestions for the current visitor, names in `locale`. Targets come from the simulated portfolio's weights;
 * with `portfolioOptionId` (one of the suggested portfolios of the profile), or when nothing is held, from that
 * suggested portfolio (the middle option by default).
 */
export async function getStrategySuggestions(locale: Locale, options: { portfolioOptionId?: string } = {}, scope?: Scope): Promise<SuggestionsView> {
    const s = scope ?? await currentScope();
    const profile = await getProfile(s.profileUserId);
    if (!profile) throw new ServiceError(409, 'No profile yet: complete the onboarding first.');

    const models = buildModelOptions({ risk: profile.risk, answers: profile.answers });
    const chosen = options.portfolioOptionId ? models.find((m) => m.id === options.portfolioOptionId) : undefined;
    let weights: Weight[] = [];
    let source: WeightsSource = { kind: 'portfolio' };
    if (!chosen) {
        const view = await getPortfolio(locale, s);
        weights = weightsFromValues(view.positions.map((p) => ({ symbol: p.symbol, valueCad: p.valueCad ?? p.quantity * p.avgCostCad })), view.cashCad);
    }
    if (chosen || weights.length === 0) {
        const model = chosen ?? models.find((m) => m.variant === 'core') ?? models[0];
        weights = [...model.lines].sort((a, b) => b.weightPct - a.weightPct || a.symbol.localeCompare(b.symbol)).map((line) => ({ symbol: line.symbol, weightPct: line.weightPct }));
        source = { kind: 'model', optionId: model.id, name: model.name };
    }

    const built = buildStrategySuggestions({ risk: profile.risk, weights, source });
    return {
        ...built,
        simulated: true,
        label: locale === 'fr' ? SUGGESTIONS_TABLE.label_fr : SUGGESTIONS_TABLE.label_en,
        source: source.kind === 'portfolio' ? source : { kind: 'model', optionId: source.optionId, name: source.name[locale] },
        strategies: built.strategies.map((st) => ({ ...st, name: st.name[locale], description: st.description[locale] })),
    };
}
