import type { OnboardingAnswers, Risk, RiskResult } from '@/lib/domain/types';
import { RULES, type Rules } from '@/lib/rules';
import { sayRules } from '@/lib/rules/text';
import type { Locale, TextRef } from '@/lib/watchlist/text';

const RISK_ORDER: Risk[] = ['Low', 'Medium', 'High'];
const SELF_RATED: Record<OnboardingAnswers['selfRating'], Risk> = { low: 'Low', medium: 'Medium', high: 'High' };

const givenAnswers = (answers: OnboardingAnswers): Record<string, string> => ({
    goal: answers.investingGoal,
    echeance: answers.echeance,
    drop_20pct: answers.drop20,
    self_rating: answers.selfRating,
});

/**
 * The caps apply to a risk chosen by hand too (risk.caps_apply_to_overrides). Returns the refusal as a catalog
 * reference (its sentence in either language) when the chosen risk is above a cap that the answers trigger,
 * otherwise undefined.
 */
export function overrideCapRefusalRef(chosen: Risk, answers: OnboardingAnswers, rules: Rules = RULES): TextRef | undefined {
    const given = givenAnswers(answers);
    for (const [index, cap] of rules.risk.caps.entries()) {
        const applies = Object.entries(cap.when).every(([question, answer]) => given[question] === answer);
        const max = cap.max_risk as Risk;
        if (applies && RISK_ORDER.indexOf(chosen) > RISK_ORDER.indexOf(max)) {
            return sayRules('rules.cap_refusal', { chosen, max, cap: index }).textRef;
        }
    }
    return undefined;
}

/** The refusal of overrideCapRefusalRef in plain words, in `locale` (default English), or undefined. */
export function overrideCapRefusal(chosen: Risk, answers: OnboardingAnswers, rules: Rules = RULES, locale: Locale = 'en'): string | undefined {
    const ref = overrideCapRefusalRef(chosen, answers, rules);
    return ref && sayRules('rules.cap_refusal', ref.params as { chosen: string; max: string; cap: number }, locale).text;
}

/**
 * RiskResult.cappedBy in `locale`. The stored profile keeps the rules file's English wording (cap.board_text); this
 * finds the cap it names and gives its wording in the language. A text that names no cap is returned as stored.
 */
export function localizeCappedBy(cappedBy: string, locale: Locale, rules: Rules = RULES): string {
    const index = rules.risk.caps.findIndex((cap) => cap.board_text === cappedBy || (cap as { board_text_fr?: string }).board_text_fr === cappedBy);
    return index < 0 ? cappedBy : sayRules('rules.capped_by', { cap: index }, locale).text;
}

/** Risk rule: four questions scored 0-2, summed into bands, then the caps of the rules file. */
export function computeRisk(answers: OnboardingAnswers, rules: Rules = RULES): RiskResult {
    const rule = rules.risk;
    // Keyed like the rules file, so a cap's "when" can be matched against the same names.
    const given = givenAnswers(answers);
    const breakdown: Record<string, number> = {
        goal: rule.points.goal[answers.investingGoal],
        echeance: rule.points.echeance[answers.echeance],
        drop_20pct: rule.points.drop_20pct[answers.drop20],
        self_rating: rule.points.self_rating[answers.selfRating],
    };
    const points = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
    const band = rule.bands.find((b) => points >= b.min && points <= b.max);
    if (!band) throw new Error(`risk rule ${rule.version}: no band holds ${points} points`);

    let risk = band.risk as Risk;
    let cappedBy: string | undefined;
    for (const cap of rule.caps) {
        const applies = Object.entries(cap.when).every(([question, answer]) => given[question] === answer);
        const max = cap.max_risk as Risk;
        if (applies && RISK_ORDER.indexOf(risk) > RISK_ORDER.indexOf(max)) {
            risk = max;
            cappedBy = cap.board_text;
        }
    }

    const selfRated = SELF_RATED[answers.selfRating];
    return {
        risk,
        points,
        breakdown,
        ...(cappedBy ? { cappedBy } : {}),
        selfRated,
        differsFromSelfRating: risk !== selfRated,
        ruleVersion: rule.version,
    };
}
