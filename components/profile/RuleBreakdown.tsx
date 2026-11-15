import { useLocale, useTranslations } from 'next-intl';
import type { ProfileConfig } from '@/lib/domain/types';
import { labelOf } from '@/components/onboarding/labels';
import { formatPercent } from '@/i18n/format';

/** The bands and maxima of the two rules, read from the rules file on the server and passed down. */
export type RuleBands = {
    level: { max: number; bands: Array<{ min: number; max: number; level: string }> };
    risk: { max: number; bands: Array<{ min: number; max: number; risk: string }> };
};

function Rows({ rows }: { rows: Array<{ label: string; value: number }> }) {
    const t = useTranslations('Profile');
    return (
        <ul className="flex flex-col divide-y divide-line">
            {rows.map((row) => (
                <li key={row.label} className="flex items-baseline justify-between gap-3 py-1.5 text-[13.5px]">
                    <span className="min-w-0 text-foreground">{row.label}</span>
                    <span className="num flex-none text-muted-foreground">{t('breakdown.points', { count: row.value })}</span>
                </li>
            ))}
        </ul>
    );
}

/** The answers that led to the computed level, in plain words, with the points the rule gave each. */
export function LevelBreakdown({ profile, bands }: { profile: ProfileConfig; bands: RuleBands }) {
    const t = useTranslations('Profile');
    const to = useTranslations('Onboarding');
    const { answers, levelResult } = profile;
    if (!answers.traded) {
        return (
            <p className="text-[13.5px] text-muted-foreground">
                {t('breakdown.notTraded', { level: t('level', { level: levelResult.level }) })}
                <span className="mono mt-1 block text-[12px] text-faint">{t('breakdown.rule', { version: levelResult.ruleVersion })}</span>
            </p>
        );
    }
    const rows = Object.entries(levelResult.breakdown).map(([key, value]) => ({
        label: key === 'experience'
            ? t('breakdown.experienceRow', { value: labelOf(to, 'experience', answers.experience) })
            : t('breakdown.toolRow', { value: labelOf(to, 'tools', key.replace('tools.', '')) }),
        value,
    }));
    const bandList = bands.level.bands.map((b) => t('breakdown.band', { min: b.min, max: b.max, label: t('level', { level: b.level }) })).join(' · ');
    return (
        <div className="flex flex-col gap-2">
            <Rows rows={rows} />
            <p className="text-[12.5px] text-faint">
                {t('breakdown.levelTotal', { points: levelResult.points, max: bands.level.max, bands: bandList })}
                <span className="mono"> {t('breakdown.rule', { version: levelResult.ruleVersion })}</span>
            </p>
        </div>
    );
}

/** The four risk answers with their points, the cap when one applied, and the self-rating beside the result when they differ. */
export function RiskBreakdown({ profile, bands }: { profile: ProfileConfig; bands: RuleBands }) {
    const t = useTranslations('Profile');
    const to = useTranslations('Onboarding');
    const locale = useLocale();
    const { answers, riskResult } = profile;
    const percent = formatPercent(20, locale);
    const labels: Record<string, string> = {
        goal: t('breakdown.goalRow', { value: labelOf(to, 'investingGoal', answers.investingGoal) }),
        echeance: t('breakdown.echeanceRow', { value: labelOf(to, 'echeance', answers.echeance) }),
        drop_20pct: t('breakdown.dropRow', { percent, value: labelOf(to, 'drop20', answers.drop20) }),
        self_rating: t('breakdown.selfRow', { value: labelOf(to, 'selfRating', answers.selfRating) }),
    };
    const rows = Object.entries(riskResult.breakdown).map(([key, value]) => ({ label: labels[key] ?? key, value }));
    const bandList = bands.risk.bands.map((b) => t('breakdown.band', { min: b.min, max: b.max, label: t('risk', { risk: b.risk }) })).join(' · ');
    const strong = { strong: (chunks: React.ReactNode) => <strong>{chunks}</strong> };
    return (
        <div className="flex flex-col gap-2">
            <Rows rows={rows} />
            <p className="text-[12.5px] text-faint">
                {t('breakdown.riskTotal', { points: riskResult.points, max: bands.risk.max, bands: bandList })}
                <span className="mono"> {t('breakdown.rule', { version: riskResult.ruleVersion })}</span>
            </p>
            {riskResult.cappedBy && (
                <p className="rounded-[10px] bg-brand-soft px-3 py-2 text-[13px] text-brand-ink">
                    {t('breakdown.capped', { answer: labelOf(to, 'drop20', answers.drop20), percent, risk: t('risk', { risk: riskResult.risk }) })}
                </p>
            )}
            {riskResult.differsFromSelfRating && (
                <p className="rounded-[10px] bg-hover px-3 py-2 text-[13px] text-foreground">
                    {t.rich('breakdown.differs', {
                        selfRated: t('risk', { risk: riskResult.selfRated }),
                        risk: t('risk', { risk: riskResult.risk }),
                        ...strong,
                    })}
                </p>
            )}
        </div>
    );
}
