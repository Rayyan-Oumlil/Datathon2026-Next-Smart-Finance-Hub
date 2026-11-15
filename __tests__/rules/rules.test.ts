import { describe, expect, it } from 'vitest';
import type { Level, OnboardingAnswers, Risk } from '@/lib/domain/types';
import { noviceStockFloorUsd, RULES, RULE_VERSIONS, RULES_VERSION } from '@/lib/rules';
import { computeLevel } from '@/lib/rules/level';
import { buildProfile } from '@/lib/rules/profile';
import { computeRisk, overrideCapRefusal } from '@/lib/rules/risk';

const base: OnboardingAnswers = {
    goal: 'learn',
    traded: true,
    experience: '<1y',
    tools: [],
    investingGoal: 'income',
    echeance: 'weeks',
    drop20: 'wait',
    selfRating: 'low',
    markets: 'US',
    sectors: [],
    niches: [],
    themes: [],
    brands: [],
    avoid: [],
    agentStyle: 'just the data',
};
const answers = (over: Partial<OnboardingAnswers>): OnboardingAnswers => ({ ...base, ...over });

describe('rules file', () => {
    it('exposes the versions', () => {
        expect(RULES_VERSION).toBe('v1');
        expect(RULE_VERSIONS).toEqual({
            level: 'level-v1', risk: 'risk-v1', filters: 'filters-v1', score: RULES.score.version, selection: 'selection-v1', reasons: 'reasons-v1',
            strategy: 'strategy-v1', model_portfolios: 'model-portfolios-v1',
        });
    });

    it('names what changed in the score version', () => {
        expect(RULES.score.version).toBe('score-v1.1');
        expect(RULES.score.changed).toContain('diversification');
    });

    it('reads the Novice stock floor from the rule sentence', () => {
        expect(noviceStockFloorUsd(RULES)).toBe(10_000_000_000);
        const changed = structuredClone(RULES);
        changed.filters.asset_class_rules.novice.stocks = 'market cap >= US$750M';
        expect(noviceStockFloorUsd(changed)).toBe(750_000_000);
        changed.filters.asset_class_rules.novice.stocks = 'large caps only';
        expect(() => noviceStockFloorUsd(changed)).toThrow();
    });
});

describe('computeLevel', () => {
    it('gives Novice to someone who has not traded, whatever else is answered', () => {
        const result = computeLevel(answers({ traded: false, experience: '5+y', tools: ['options', 'limit_or_stop', 'margin_or_shorting'] }));
        expect(result).toEqual({ level: 'Novice', points: 0, breakdown: {}, ruleVersion: 'level-v1' });
    });

    type Tools = NonNullable<OnboardingAnswers['tools']>;
    const cases: Array<[OnboardingAnswers['experience'], Tools, number, Level]> = [
        ['<1y', [], 0, 'Novice'],
        ['<1y', ['options'], 1, 'Novice'],                                        // top of Novice
        ['1-5y', [], 1, 'Novice'],
        ['<1y', ['options', 'limit_or_stop'], 2, 'Intermediate'],                 // bottom of Intermediate
        ['1-5y', ['limit_or_stop'], 2, 'Intermediate'],
        ['5+y', [], 2, 'Intermediate'],                                           // years alone are not enough
        ['5+y', ['margin_or_shorting'], 3, 'Intermediate'],                       // top of Intermediate
        ['<1y', ['options', 'limit_or_stop', 'margin_or_shorting'], 3, 'Intermediate'],
        ['1-5y', ['options', 'limit_or_stop', 'margin_or_shorting'], 4, 'Expert'], // bottom of Expert
        ['5+y', ['options', 'limit_or_stop'], 4, 'Expert'],
        ['5+y', ['options', 'limit_or_stop', 'margin_or_shorting'], 5, 'Expert'],  // maximum
    ];
    it.each(cases)('experience %s with tools %j gives %i points: %s', (experience, tools, points, level) => {
        const result = computeLevel(answers({ experience, tools }));
        expect(result.points).toBe(points);
        expect(result.level).toBe(level);
        expect(result.ruleVersion).toBe('level-v1');
    });

    it('lists where the points came from and counts a repeated tool once', () => {
        const result = computeLevel(answers({ experience: '1-5y', tools: ['options', 'options', 'limit_or_stop'] }));
        expect(result.breakdown).toEqual({ experience: 1, 'tools.limit_or_stop': 1, 'tools.options': 1 });
        expect(result.points).toBe(3);
    });

    it('gives no experience points when the question was not answered', () => {
        const result = computeLevel(answers({ experience: undefined, tools: undefined }));
        expect(result).toMatchObject({ level: 'Novice', points: 0, breakdown: { experience: 0 } });
    });

    it('never exceeds the maximum in the rules file', () => {
        const top = computeLevel(answers({ experience: '5+y', tools: ['options', 'limit_or_stop', 'margin_or_shorting'] }));
        expect(top.points).toBe(RULES.level.max_points);
    });
});

describe('computeRisk', () => {
    const goals = { income: 0, growth: 1, trading: 2 } as const;
    const echeances = { weeks: 0, months: 0, '1 yr': 1, '5+ yrs': 2 } as const;
    const drops = { sell: 0, wait: 1, buy_more: 2 } as const;
    const ratings = { low: 0, medium: 1, high: 2 } as const;
    const selfRated = { low: 'Low', medium: 'Medium', high: 'High' } as const;

    it('matches the points table, the bands and the cap for all 108 answer combinations', () => {
        let count = 0;
        const seen = new Set<string>();
        for (const investingGoal of Object.keys(goals) as Array<keyof typeof goals>) {
            for (const echeance of Object.keys(echeances) as Array<keyof typeof echeances>) {
                for (const drop20 of Object.keys(drops) as Array<keyof typeof drops>) {
                    for (const selfRating of Object.keys(ratings) as Array<keyof typeof ratings>) {
                        const points = goals[investingGoal] + echeances[echeance] + drops[drop20] + ratings[selfRating];
                        const banded: Risk = points <= 2 ? 'Low' : points <= 5 ? 'Medium' : 'High';
                        const capped = drop20 === 'sell' && banded === 'High';
                        const expected: Risk = capped ? 'Medium' : banded;

                        const result = computeRisk(answers({ investingGoal, echeance, drop20, selfRating }));
                        expect(result.points).toBe(points);
                        expect(result.risk).toBe(expected);
                        expect(result.cappedBy !== undefined).toBe(capped);
                        expect(result.selfRated).toBe(selfRated[selfRating]);
                        expect(result.differsFromSelfRating).toBe(expected !== selfRated[selfRating]);
                        if (drop20 === 'sell') expect(result.risk).not.toBe('High');
                        seen.add(`${points}:${result.risk}`);
                        count++;
                    }
                }
            }
        }
        expect(count).toBe(108);
        // Every band edge was reached: 0-2 Low, 3-5 Medium, 6-8 High, and 6 capped to Medium.
        expect([...seen].sort()).toEqual(['0:Low', '1:Low', '2:Low', '3:Medium', '4:Medium', '5:Medium', '6:High', '6:Medium', '7:High', '8:High']);
    });

    const edges: Array<[Partial<OnboardingAnswers>, number, Risk]> = [
        [{ investingGoal: 'income', echeance: 'weeks', drop20: 'sell', selfRating: 'low' }, 0, 'Low'],
        [{ investingGoal: 'growth', echeance: 'months', drop20: 'wait', selfRating: 'low' }, 2, 'Low'],
        [{ investingGoal: 'growth', echeance: '1 yr', drop20: 'wait', selfRating: 'low' }, 3, 'Medium'],
        [{ investingGoal: 'growth', echeance: '1 yr', drop20: 'buy_more', selfRating: 'medium' }, 5, 'Medium'],
        [{ investingGoal: 'growth', echeance: '5+ yrs', drop20: 'buy_more', selfRating: 'medium' }, 6, 'High'],
        [{ investingGoal: 'trading', echeance: '5+ yrs', drop20: 'buy_more', selfRating: 'high' }, 8, 'High'],
    ];
    it.each(edges)('band edge %j: %i points is %s', (over, points, risk) => {
        const result = computeRisk(answers(over));
        expect(result.points).toBe(points);
        expect(result.risk).toBe(risk);
        expect(result.cappedBy).toBeUndefined();
    });

    it('caps "sell" at Medium even with 6 points, and says why', () => {
        const result = computeRisk(answers({ investingGoal: 'trading', echeance: '5+ yrs', drop20: 'sell', selfRating: 'high' }));
        expect(result).toEqual({
            risk: 'Medium',
            points: 6,
            breakdown: { goal: 2, echeance: 2, drop_20pct: 0, self_rating: 2 },
            cappedBy: '"Sell" on the drop question can never give High',
            selfRated: 'High',
            differsFromSelfRating: true,
            ruleVersion: 'risk-v1',
        });
    });

    it('refuses a risk chosen by hand above the cap, naming the answer that limits it', () => {
        const sell = answers({ drop20: 'sell' });
        expect(overrideCapRefusal('High', sell)).toBe('High is not available: you answered "reduce my position" to the 20% drop question, which limits the risk profile to Medium.');
        expect(overrideCapRefusal('Medium', sell)).toBeUndefined();
        expect(overrideCapRefusal('Low', sell)).toBeUndefined();
        expect(overrideCapRefusal('High', answers({ drop20: 'wait' }))).toBeUndefined();
    });

    it('does not mention the cap when "sell" would not have reached High anyway', () => {
        const result = computeRisk(answers({ investingGoal: 'trading', echeance: '1 yr', drop20: 'sell', selfRating: 'high' }));
        expect(result.points).toBe(5);
        expect(result.risk).toBe('Medium');
        expect(result.cappedBy).toBeUndefined();
    });

    it('reports when the self-rating equals the result', () => {
        const result = computeRisk(answers({ investingGoal: 'growth', echeance: '1 yr', drop20: 'wait', selfRating: 'medium' }));
        expect(result).toMatchObject({ risk: 'Medium', points: 4, selfRated: 'Medium', differsFromSelfRating: false });
    });
});

describe('buildProfile', () => {
    const NOW = '2026-11-14T12:00:00.000Z';
    const given = answers({ experience: '5+y', tools: ['options', 'limit_or_stop'], investingGoal: 'growth', echeance: '1 yr', drop20: 'wait', selfRating: 'medium' });

    it('stores the answers verbatim, the computed results and the rule versions', () => {
        const profile = buildProfile('demo', given, NOW);
        expect(profile).toEqual({
            userId: 'demo',
            answers: given,
            level: 'Expert',
            risk: 'Medium',
            levelResult: computeLevel(given),
            riskResult: computeRisk(given),
            levelOverridden: false,
            riskOverridden: false,
            ruleVersions: { level: 'level-v1', risk: 'risk-v1' },
            createdAt: NOW,
            updatedAt: NOW,
        });
    });

    it('keeps what the rule computed beside an override', () => {
        const profile = buildProfile('demo', given, NOW, { level: 'Novice', risk: 'High' });
        expect(profile.level).toBe('Novice');
        expect(profile.risk).toBe('High');
        expect(profile.levelOverridden).toBe(true);
        expect(profile.riskOverridden).toBe(true);
        expect(profile.levelResult.level).toBe('Expert');
        expect(profile.riskResult.risk).toBe('Medium');
    });

    it('does not call it an override when the chosen value equals the computed one', () => {
        const profile = buildProfile('demo', given, NOW, { level: 'Expert', risk: 'Medium' });
        expect(profile.levelOverridden).toBe(false);
        expect(profile.riskOverridden).toBe(false);
    });

    it('re-runs the rules on an edit and keeps the first save time', () => {
        const later = '2026-11-15T09:00:00.000Z';
        const edited = buildProfile('demo', { ...given, traded: false, drop20: 'sell', selfRating: 'low' }, later, { createdAt: NOW });
        expect(edited.level).toBe('Novice');
        expect(edited.risk).toBe('Low');
        expect(edited.createdAt).toBe(NOW);
        expect(edited.updatedAt).toBe(later);
    });

    it('is deterministic', () => {
        expect(buildProfile('demo', given, NOW)).toEqual(buildProfile('demo', given, NOW));
    });
});
