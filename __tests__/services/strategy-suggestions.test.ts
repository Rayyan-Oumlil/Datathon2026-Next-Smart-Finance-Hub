import { describe, expect, it } from 'vitest';
import type { Risk } from '@/lib/domain/types';
import { listReplaySymbols } from '@/lib/replay';
import { RULE_KINDS, parseStrategy, targetSymbols } from '@/lib/strategy/types';
import { buildModelOptions } from '@/lib/services/model-portfolio';
import { SUGGESTIONS_TABLE, buildStrategySuggestions, weightsFromValues, type Weight } from '@/lib/services/strategy-suggestions';

const RISKS: Risk[] = ['Low', 'Medium', 'High'];
const portfolio: Weight[] = [
    { symbol: 'NVDA', weightPct: 42.5 },
    { symbol: 'SPY', weightPct: 30 },
    { symbol: 'XBB.TO', weightPct: 20 },
];

describe('strategy suggestions (rules/v1.json strategy_suggestions)', () => {
    it('gives three strategies and one rule per kind for each level, every one valid for parseStrategy', () => {
        expect(SUGGESTIONS_TABLE.version).toBe('strategy-suggestions-v1');
        for (const risk of RISKS) {
            const model = buildModelOptions({ risk, answers: { markets: 'global', themes: [], avoid: [] } }).find((m) => m.variant === 'core')!;
            const sets: Weight[][] = [portfolio, model.lines.map((l) => ({ symbol: l.symbol, weightPct: l.weightPct })), []];
            for (const weights of sets) {
                const out = buildStrategySuggestions({ risk, weights, source: { kind: 'portfolio' } });
                expect(out.strategies).toHaveLength(3);
                for (const strategy of out.strategies) {
                    expect(strategy.name.fr && strategy.name.en && strategy.description.fr && strategy.description.en).toBeTruthy();
                    expect(strategy.rules.length).toBeGreaterThan(0);
                    const parsed = parseStrategy({ name: strategy.name.fr, rules: strategy.rules });
                    expect(parsed.ok, `${risk} ${strategy.id}`).toBe(true);
                    expect(strategy.why[0].code).toBe('risk');
                }
                expect(out.rules.map((r) => r.kind)).toEqual([...RULE_KINDS]);
                for (const suggestion of out.rules) expect(parseStrategy({ name: 'x', rules: [suggestion.rule] }).ok).toBe(true);
            }
        }
    });

    it('fills targets from the weights, caps them under a weight cap of the same strategy, and says why', () => {
        const out = buildStrategySuggestions({ risk: 'High', weights: portfolio, source: { kind: 'portfolio' } });
        const growth = out.strategies.find((s) => s.id === 'high-growth')!;
        const allocation = growth.rules.find((r) => r.kind === 'allocation_target');
        expect(allocation?.kind === 'allocation_target' && allocation.targets).toEqual([
            { symbol: 'NVDA', weightPct: 35 },
            { symbol: 'SPY', weightPct: 30 },
            { symbol: 'XBB.TO', weightPct: 20 },
        ]);
        expect(growth.why.map((w) => w.code)).toEqual(['risk', 'targets_portfolio', 'cap_over', 'targets_capped']);
        const price = out.rules.find((r) => r.kind === 'price_threshold')!;
        expect(price.rule.kind === 'price_threshold' && price.rule.symbol).toBe('NVDA');
        expect(price.why[1]).toEqual({ code: 'largest_holding', values: { symbol: 'NVDA', weight: 42.5 } });
    });

    it('is deterministic and adapts thresholds to the level', () => {
        const a = buildStrategySuggestions({ risk: 'Medium', weights: portfolio, source: { kind: 'portfolio' } });
        const b = buildStrategySuggestions({ risk: 'Medium', weights: portfolio, source: { kind: 'portfolio' } });
        expect(a).toEqual(b);
        const trigger = (risk: Risk) => {
            const rule = buildStrategySuggestions({ risk, weights: portfolio, source: { kind: 'portfolio' } }).rules.find((r) => r.kind === 'drawdown_guard')!.rule;
            return rule.kind === 'drawdown_guard' ? rule.triggerDrawdownPct : NaN;
        };
        expect(trigger('Low')).toBeLessThan(trigger('Medium'));
        expect(trigger('Medium')).toBeLessThan(trigger('High'));
    });

    it('only names symbols of the replay snapshot', async () => {
        const replayable = new Set((await listReplaySymbols()).map((s) => s.symbol));
        for (const risk of RISKS) {
            for (const strategy of buildStrategySuggestions({ risk, weights: [], source: { kind: 'portfolio' } }).strategies) {
                for (const rule of strategy.rules) {
                    const named = rule.kind === 'drawdown_guard' ? [rule.defensiveSymbol] : rule.kind === 'weight_cap' && rule.proceedsSymbol ? [rule.proceedsSymbol] : rule.kind === 'allocation_target' ? targetSymbols(rule.targets) : [];
                    for (const symbol of named) expect(replayable.has(symbol), symbol).toBe(true);
                }
            }
        }
    });

    it('computes weights with cash in the total, rounded down', () => {
        expect(weightsFromValues([{ symbol: 'A', valueCad: 333.33 }, { symbol: 'B', valueCad: 666.67 }], 0)).toEqual([
            { symbol: 'B', weightPct: 66.6 },
            { symbol: 'A', weightPct: 33.3 },
        ]);
        expect(weightsFromValues([{ symbol: 'A', valueCad: 500 }], 500)).toEqual([{ symbol: 'A', weightPct: 50 }]);
        expect(weightsFromValues([], 0)).toEqual([]);
    });
});
