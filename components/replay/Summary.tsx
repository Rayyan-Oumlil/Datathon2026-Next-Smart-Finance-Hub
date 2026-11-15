'use client';

import { useTranslations } from 'next-intl';
import type { ReplayResult } from '@/lib/replay/engine/types';
import { ruleName } from './rules';
import { useReplayFmt } from './useReplayFmt';

/** Fixed sentences built from result.summary: facts, never a verdict. */
export function SummaryText({ result }: { result: ReplayResult }) {
    const t = useTranslations('Replay');
    const f = useReplayFmt();
    const s = result.summary;
    const w = result.series.with.metrics;
    const wo = result.series.without.metrics;
    const lines: string[] = [];

    if (s.identical) {
        lines.push(result.params.strategy.rules.length === 0 ? t('summary.noRules') : t('summary.identical'));
    } else {
        if (s.endedHigher === 'equal') lines.push(t('summary.endedEqual'));
        else lines.push(t(s.endedHigher === 'with' ? 'summary.endedWith' : 'summary.endedWithout', {
            pts: f.num(Math.abs(s.totalReturnGapPts), 1),
            with: f.pct(w.totalReturnPct), without: f.pct(wo.totalReturnPct),
        }));
        lines.push(t(w.contributedCad > 0 ? 'summary.valueGapEx' : 'summary.valueGap', { cad: f.signedMoney(s.finalValueGapCad) }));
        if (Math.abs(s.worstFallGapPts) >= 0.05) {
            lines.push(t(s.worstFallGapPts > 0 ? 'summary.fallShallower' : 'summary.fallDeeper', { pts: f.num(Math.abs(s.worstFallGapPts), 1), with: f.pct(w.worstFall.pct), without: f.pct(wo.worstFall.pct) }));
        } else lines.push(t('summary.fallSame', { value: f.pct(w.worstFall.pct) }));
        lines.push(t(s.volatilityGapPts < 0 ? 'summary.volLower' : s.volatilityGapPts > 0 ? 'summary.volHigher' : 'summary.volSame', { pts: f.num(Math.abs(s.volatilityGapPts), 1), with: f.pct(w.volatilityPct), without: f.pct(wo.volatilityPct) }));
        if (s.totalReturnGapPts < 0 && s.worstFallGapPts > 0) lines.push(t('summary.tradeoffCost'));
        if (s.totalReturnGapPts > 0 && s.worstFallGapPts < 0) lines.push(t('summary.tradeoffRisk'));
        if (s.feesGapCad !== 0) lines.push(t('summary.fees', { cad: f.money(Math.abs(s.feesGapCad), 2) }));
        if (w.contributedCad > 0) lines.push(t('summary.contributions', { cad: f.money(w.contributedCad) }));
    }
    for (const firing of s.firings) {
        if (firing.count > 0) lines.push(t('summary.fired', { rule: ruleName(t, result, firing.ruleId), count: firing.count }));
    }
    for (const ruleId of s.rulesNeverFired) lines.push(t('summary.neverFired', { rule: ruleName(t, result, ruleId) }));

    return (
        <ul className="flex flex-col gap-1.5 text-[14px] leading-relaxed text-foreground">
            {lines.map((line, i) => (
                <li key={i} className="flex gap-2"><span className="mt-[9px] size-1.5 flex-none rounded-full bg-line-strong" />{line}</li>
            ))}
        </ul>
    );
}

/** Market effect and currency effect for each series, plus what removing each rule alone would change. */
export function Effects({ result }: { result: ReplayResult }) {
    const t = useTranslations('Replay');
    const f = useReplayFmt();
    const series = [['without', result.series.without.effects], ['with', result.series.with.effects]] as const;
    return (
        <div className="flex flex-col gap-4">
            <div>
                <div className="grid gap-2 sm:grid-cols-2">
                    {series.map(([name, e]) => (
                        <div key={name} className="rounded-[12px] border border-line bg-card px-3 py-2.5">
                            <p className="text-[12px] font-semibold text-muted-foreground">{t(`chart.${name}`)}</p>
                            <div className="mt-1.5 grid grid-cols-2 gap-2">
                                <div>
                                    <p className="text-[11.5px] text-faint">{t('effects.market')}</p>
                                    <p className="num text-[16px] font-bold text-foreground">{f.signedMoney(e.marketCad)}</p>
                                    <p className="num text-[11.5px] text-faint">{f.signedPct(e.marketPct)}</p>
                                </div>
                                <div>
                                    <p className="text-[11.5px] text-faint">{t('effects.currency')}</p>
                                    <p className="num text-[16px] font-bold text-foreground">{f.signedMoney(e.currencyCad)}</p>
                                    <p className="num text-[11.5px] text-faint">{f.signedPct(e.currencyPct)}</p>
                                </div>
                            </div>
                            {(e.feesCad > 0 || e.contributedCad > 0) && (
                                <p className="num mt-1.5 text-[11.5px] text-faint">{t('effects.other', { fees: f.money(e.feesCad, 2), contributed: f.money(e.contributedCad) })}</p>
                            )}
                        </div>
                    ))}
                </div>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">{t('effects.explain')}</p>
            </div>

            {result.ruleContributions.length > 0 && (
                <div>
                    <p className="text-[12.5px] font-bold text-foreground">{t('contrib.title')}</p>
                    <div className="mt-1.5 overflow-x-auto rounded-[10px] border border-line">
                        <table className="data-table text-[12.5px]">
                            <thead>
                                <tr>
                                    <th>{t('contrib.rule')}</th>
                                    <th className="is-num">{t('contrib.value')}</th>
                                    <th className="is-num">{t('contrib.return')}</th>
                                    <th className="is-num">{t('contrib.fall')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {result.ruleContributions.map((c) => (
                                    <tr key={c.ruleId}>
                                        <td className="!h-10 font-semibold text-foreground">{ruleName(t, result, c.ruleId)}</td>
                                        <td className="is-num !h-10">{f.signedMoney(c.finalValueDeltaCad)}</td>
                                        <td className="is-num !h-10">{f.pts(c.totalReturnDeltaPts)}</td>
                                        <td className="is-num !h-10">{f.pts(c.worstFallDeltaPts)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">{t('contrib.explain')}</p>
                </div>
            )}
        </div>
    );
}

/** Symbols left out with their reason, the assumptions and the data limits of this replay. */
export function Caveats({ result }: { result: ReplayResult }) {
    const t = useTranslations('Replay');
    const f = useReplayFmt();
    const limit = (key: string) => {
        const k = key.replace(/^Replay\./, '');
        return t.has(k) ? t(k) : null;
    };
    return (
        <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-4">
                {result.unreplayable.length > 0 && (
                    <div>
                        <p className="text-[12.5px] font-bold text-foreground">{t('caveats.unreplayable')}</p>
                        <ul className="mt-1.5 flex flex-col gap-1 text-[12.5px]">
                            {result.unreplayable.map((u) => (
                                <li key={`${u.role}-${u.symbol}`} className="flex gap-2">
                                    <span className="pill flex-none">{u.symbol}</span>
                                    <span className="text-muted-foreground">{u.sentence[f.locale]}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                <div>
                    <p className="text-[12.5px] font-bold text-foreground">{t('caveats.assumptions')}</p>
                    <ul className="mt-1.5 flex list-disc flex-col gap-1 ps-4 text-[12.5px] leading-relaxed text-muted-foreground">
                        {result.assumptions.map((a) => <li key={a.id}>{a.sentence[f.locale]}</li>)}
                    </ul>
                </div>
            </div>
            <div>
                <p className="text-[12.5px] font-bold text-foreground">{t('caveats.limits')}</p>
                <ul className="mt-1.5 flex list-disc flex-col gap-1 ps-4 text-[12.5px] leading-relaxed text-muted-foreground">
                    {result.limitations.map((l) => {
                        const text = limit(l.textRef.key);
                        return text ? <li key={l.id}>{text}</li> : null;
                    })}
                </ul>
            </div>
        </div>
    );
}
