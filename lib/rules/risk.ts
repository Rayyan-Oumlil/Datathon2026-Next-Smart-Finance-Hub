import type { OnboardingAnswers, Risk, RiskResult } from '@/lib/domain/types';
import { RULES, type Rules } from '@/lib/rules';

const RISK_ORDER: Risk[] = ['Low', 'Medium', 'High'];
const SELF_RATED: Record<OnboardingAnswers['selfRating'], Risk> = { low: 'Low', medium: 'Medium', high: 'High' };

/** Risk rule: four questions scored 0-2, summed into bands, then the caps of the rules file. */
export function computeRisk(answers: OnboardingAnswers, rules: Rules = RULES): RiskResult {
    const rule = rules.risk;
    // Keyed like the rules file, so a cap's "when" can be matched against the same names.
    const given: Record<string, string> = {
        goal: answers.investingGoal,
        echeance: answers.echeance,
        drop_20pct: answers.drop20,
        self_rating: answers.selfRating,
    };
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
