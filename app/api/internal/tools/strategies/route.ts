import { z } from 'zod';
import { internalTool } from '@/lib/agent/internal';
import { StrategyRefusal, currentWeights, makeRoom, validateStrategy } from '@/lib/agent/strategy-propose';
import { strategyRuleSentence } from '@/lib/agent/strategy-words';
import { listStrategies } from '@/lib/services/rules-engine';

const schema = z.object({
    locale: z.enum(['en', 'fr']).default('en'),
    /** Current weights scaled down so this symbol can take this weight (computed here, so the agent does no arithmetic). */
    makeRoomFor: z.strictObject({ symbol: z.string().trim().min(1).max(20), weightPct: z.number().min(0.1).max(100) }).optional(),
    /** A strategy to check against the strict schema; nothing is saved. */
    validate: z.record(z.string(), z.unknown()).optional(),
});

// The visitor's stored strategies with each rule as its sentence, the simulated portfolio's current weights, and on
// request a validation (issue codes, so the agent can correct a strategy once) or target weights that make room for one
// symbol. Read-only.
export const POST = internalTool(schema, async ({ locale, makeRoomFor, validate }, _actionId, scope) => {
    const [stored, current] = await Promise.all([listStrategies(scope), currentWeights(scope)]);
    let validation: unknown;
    if (validate) {
        try {
            const strategy = validateStrategy(validate, locale);
            validation = { ok: true, strategy: { name: strategy.name, rules: strategy.rules }, sentences: strategy.rules.map((rule) => strategyRuleSentence(rule, locale)) };
        } catch (error) {
            if (!(error instanceof StrategyRefusal)) throw error;
            validation = { ok: false, errors: error.messages, issues: error.issues };
        }
    }
    return {
        strategies: stored.map((s) => ({ id: s.id, name: s.name, version: s.version, updatedAt: s.updatedAt, rules: s.rules, sentences: s.rules.map((rule) => strategyRuleSentence(rule, locale)) })),
        currentWeights: Object.entries(current.weights).map(([symbol, weightPct]) => ({ symbol, weightPct })),
        portfolioValueCad: current.valueCad,
        ...(makeRoomFor ? { targetsWithRoom: makeRoom(current.weights, makeRoomFor.symbol, makeRoomFor.weightPct) } : {}),
        ...(validation ? { validation } : {}),
    };
});
