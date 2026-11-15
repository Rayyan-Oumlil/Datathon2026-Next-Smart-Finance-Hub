import type { Level, OnboardingAnswers, ProfileConfig, Risk } from '@/lib/domain/types';
import { RULES, type Rules } from '@/lib/rules';
import { computeLevel } from '@/lib/rules/level';
import { computeRisk } from '@/lib/rules/risk';

export type ProfileOverrides = {
    level?: Level;        // chosen on the Profile tab
    risk?: Risk;          // chosen on the Profile tab
    createdAt?: string;   // pass the stored value when this is an edit, so the first save time is kept
};

/**
 * Builds the stored profile. The rules always run on the answers given, so calling this again after an edit
 * re-runs them. What the rules computed is kept beside any override; "overridden" is true only when the
 * chosen value differs from the computed one.
 */
export function buildProfile(
    userId: string,
    answers: OnboardingAnswers,
    now: string,
    overrides: ProfileOverrides = {},
    rules: Rules = RULES,
): ProfileConfig {
    const levelResult = computeLevel(answers, rules);
    const riskResult = computeRisk(answers, rules);
    const level = overrides.level ?? levelResult.level;
    const risk = overrides.risk ?? riskResult.risk;
    return {
        userId,
        answers,
        level,
        risk,
        levelResult,
        riskResult,
        levelOverridden: level !== levelResult.level,
        riskOverridden: risk !== riskResult.risk,
        ruleVersions: { level: levelResult.ruleVersion, risk: riskResult.ruleVersion },
        createdAt: overrides.createdAt ?? now,
        updatedAt: now,
    };
}
