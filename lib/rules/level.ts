import type { Level, LevelResult, OnboardingAnswers } from '@/lib/domain/types';
import { RULES, type Rules } from '@/lib/rules';

/** Level rule: not traded => Novice; otherwise points for experience and tools, summed into the bands of the rules file. */
export function computeLevel(answers: OnboardingAnswers, rules: Rules = RULES): LevelResult {
    const rule = rules.level;
    if (!answers.traded) {
        return { level: rule.not_traded as Level, points: 0, breakdown: {}, ruleVersion: rule.version };
    }

    const breakdown: Record<string, number> = {};
    // An unanswered experience question earns nothing; it is not guessed.
    breakdown.experience = answers.experience ? rule.points.experience[answers.experience] : 0;
    // Each tool counts once, in the rules file's order, whatever order or repeats the answer has.
    const tools = new Set(answers.tools ?? []);
    for (const tool of Object.keys(rule.points.tools) as Array<keyof typeof rule.points.tools>) {
        if (tools.has(tool)) breakdown[`tools.${tool}`] = rule.points.tools[tool];
    }

    const points = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
    const band = rule.bands.find((b) => points >= b.min && points <= b.max);
    if (!band) throw new Error(`level rule ${rule.version}: no band holds ${points} points`);
    return { level: band.level as Level, points, breakdown, ruleVersion: rule.version };
}
