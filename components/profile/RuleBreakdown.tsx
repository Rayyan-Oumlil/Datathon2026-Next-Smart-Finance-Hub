import type { ProfileConfig } from '@/lib/domain/types';
import { DROP20, ECHEANCE, EXPERIENCE, INVESTING_GOAL, SELF_RATING, TOOLS, labelOf } from '@/components/onboarding/labels';

/** The bands and maxima of the two rules, read from the rules file on the server and passed down. */
export type RuleBands = {
    level: { max: number; bands: Array<{ min: number; max: number; level: string }> };
    risk: { max: number; bands: Array<{ min: number; max: number; risk: string }> };
};

const points = (n: number) => `${n} ${n === 1 ? 'point' : 'points'}`;

function Rows({ rows }: { rows: Array<{ label: string; value: number }> }) {
    return (
        <ul className="flex flex-col divide-y divide-line">
            {rows.map((row) => (
                <li key={row.label} className="flex items-baseline justify-between gap-3 py-1.5 text-[13.5px]">
                    <span className="min-w-0 text-foreground">{row.label}</span>
                    <span className="num flex-none text-muted-foreground">{points(row.value)}</span>
                </li>
            ))}
        </ul>
    );
}

/** The answers that led to the computed level, in plain words, with the points the rule gave each. */
export function LevelBreakdown({ profile, bands }: { profile: ProfileConfig; bands: RuleBands }) {
    const { answers, levelResult } = profile;
    if (!answers.traded) {
        return (
            <p className="text-[13.5px] text-muted-foreground">
                You have not placed a trade yourself. In that case the level rule gives {levelResult.level}, with no points counted.
                <span className="mono mt-1 block text-[12px] text-faint">Rule {levelResult.ruleVersion}</span>
            </p>
        );
    }
    const rows = Object.entries(levelResult.breakdown).map(([key, value]) => ({
        label: key === 'experience'
            ? `Trading experience: ${labelOf(EXPERIENCE, answers.experience)}`
            : `Tool used: ${labelOf(TOOLS, key.replace('tools.', ''))}`,
        value,
    }));
    return (
        <div className="flex flex-col gap-2">
            <Rows rows={rows} />
            <p className="text-[12.5px] text-faint">
                Total {levelResult.points} of {bands.level.max}. Bands: {bands.level.bands.map((b) => `${b.min}–${b.max} ${b.level}`).join(' · ')}.
                <span className="mono"> Rule {levelResult.ruleVersion}</span>
            </p>
        </div>
    );
}

/** The four risk answers with their points, the cap when one applied, and the self-rating beside the result when they differ. */
export function RiskBreakdown({ profile, bands }: { profile: ProfileConfig; bands: RuleBands }) {
    const { answers, riskResult } = profile;
    const labels: Record<string, string> = {
        goal: `Investing goal: ${labelOf(INVESTING_GOAL, answers.investingGoal)}`,
        echeance: `Time to see progress: ${labelOf(ECHEANCE, answers.echeance)}`,
        drop_20pct: `After a 20% drop: ${labelOf(DROP20, answers.drop20)}`,
        self_rating: `Your own rating: ${labelOf(SELF_RATING, answers.selfRating)}`,
    };
    const rows = Object.entries(riskResult.breakdown).map(([key, value]) => ({ label: labels[key] ?? key, value }));
    return (
        <div className="flex flex-col gap-2">
            <Rows rows={rows} />
            <p className="text-[12.5px] text-faint">
                Total {riskResult.points} of {bands.risk.max}. Bands: {bands.risk.bands.map((b) => `${b.min}–${b.max} ${b.risk}`).join(' · ')}.
                <span className="mono"> Rule {riskResult.ruleVersion}</span>
            </p>
            {riskResult.cappedBy && (
                <p className="rounded-[10px] bg-brand-soft px-3 py-2 text-[13px] text-brand-ink">
                    Limit applied: choosing “{labelOf(DROP20, answers.drop20)}” on the 20% drop question keeps the result at {riskResult.risk} at most,
                    whatever the points.
                </p>
            )}
            {riskResult.differsFromSelfRating && (
                <p className="rounded-[10px] bg-hover px-3 py-2 text-[13px] text-foreground">
                    You rated yourself <strong>{riskResult.selfRated}</strong>. The rule computed <strong>{riskResult.risk}</strong> from all four answers.
                    Both are kept.
                </p>
            )}
        </div>
    );
}
