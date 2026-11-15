'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ArrowRight, ChevronDown, Loader2 } from 'lucide-react';
import { formatMoney, formatPercent } from '@/i18n/format';
import type { ModelOptionView } from '@/lib/services/model-portfolio';
import { AssetLogo } from '@/components/AssetLogo';
import { GROUP_CLASS, GROUP_ORDER, assetClassOfRole, groupOf } from './allocation';

type Props = {
    option: ModelOptionView;
    amountCad: number;
    replaceMode: boolean;       // a simulated portfolio exists: choosing replaces it (after a confirmation)
    disabled: boolean;
    busy: boolean;
    onApply: () => void;
};

/** One suggested portfolio: name, description, allocation bar, risk figures, lines with their reasons. */
export default function OptionCard({ option, amountCad, replaceMode, disabled, busy, onApply }: Props) {
    const t = useTranslations('Start');
    const locale = useLocale();
    const [confirming, setConfirming] = useState(false);

    const money = (value: number) => formatMoney(value, 'CAD', locale, { maximumFractionDigits: 0 });
    const pct = (value: number, digits = 0) => formatPercent(value, locale, { maximumFractionDigits: digits, minimumFractionDigits: digits });

    // Allocation bar: one segment per line, grouped by colour (bonds, equity funds, stocks, gold, crypto)
    const ordered = [...option.lines].sort((a, b) => GROUP_ORDER.indexOf(groupOf(a.role)) - GROUP_ORDER.indexOf(groupOf(b.role)) || b.weightPct - a.weightPct);
    const groups = GROUP_ORDER
        .map((group) => ({ group, weight: option.lines.filter((l) => groupOf(l.role) === group).reduce((sum, l) => sum + l.weightPct, 0) }))
        .filter((g) => g.weight > 0);
    const f = option.figures;
    const titleId = `option-${option.id}`;

    return (
        <section aria-labelledby={titleId} className="hatch">
            <div className="card flex h-full flex-col gap-4 p-4">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="kicker">{t(`variant.${option.variant}`)}</p>
                        <h2 id={titleId} className="mt-0.5 text-[18px] font-bold tracking-[-0.03em] text-foreground">{option.name}</h2>
                    </div>
                    <span className="pill num">{money(amountCad)}</span>
                </div>
                <p className="text-[13.5px] leading-snug text-muted-foreground">{option.description}</p>

                <div className="flex flex-col gap-2">
                    <div className="flex h-3 w-full overflow-hidden rounded-full bg-hover" role="img" aria-label={groups.map((g) => `${t(`legend.${g.group}`)} ${pct(g.weight)}`).join(', ')}>
                        {ordered.map((line) => (
                            <span
                                key={line.symbol}
                                title={`${line.symbol} ${pct(line.weightPct)}`}
                                className={`${GROUP_CLASS[groupOf(line.role)]} h-full border-e border-card last:border-e-0`}
                                style={{ width: `${line.weightPct}%` }}
                            />
                        ))}
                    </div>
                    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                        {groups.map((g) => (
                            <li key={g.group} className="flex items-center gap-1.5">
                                <span aria-hidden className={`size-2 rounded-full ${GROUP_CLASS[g.group]}`} />
                                {t(`legend.${g.group}`)} <span className="num font-semibold text-foreground">{pct(g.weight)}</span>
                            </li>
                        ))}
                    </ul>
                </div>

                <div className="rounded-[10px] bg-canvas p-3">
                    <p className="form-label">{t('figures.title')}</p>
                    {f ? (
                        <>
                            <dl className="mt-2 grid grid-cols-3 gap-2 [&>div]:flex [&>div]:flex-col [&>div]:justify-between">
                                <div>
                                    <dt className="text-[11.5px] text-faint">{t('figures.volatility')}</dt>
                                    <dd className="num text-[16px] font-bold text-foreground">{pct(f.volatilityPct, 1)}</dd>
                                </div>
                                <div>
                                    <dt className="text-[11.5px] text-faint">{t('figures.drawdown')}</dt>
                                    <dd className="num text-[16px] font-bold text-down">{pct(f.maxDrawdownPct, 1)}</dd>
                                </div>
                                <div>
                                    <dt className="text-[11.5px] text-faint">{t('figures.worstDay')}</dt>
                                    <dd className="num text-[16px] font-bold text-down">{pct(f.worstDayPct, 1)}</dd>
                                </div>
                            </dl>
                            <p className="mono mt-1.5 text-[11px] text-faint">{t('figures.window', { from: f.from, to: f.to, snapshot: f.snapshotId })}</p>
                        </>
                    ) : (
                        <p className="mt-1 text-[12.5px] text-faint">{t('figures.unavailable')}</p>
                    )}
                </div>

                {option.adjustments.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
                        <span>{t('adjustedBy')}</span>
                        {option.adjustments.map((rule) => <span key={rule} className="pill is-brand">{t(`rule.${rule}`)}</span>)}
                    </div>
                ) : (
                    <p className="text-[12px] text-faint">{t('notAdjusted')}</p>
                )}

                <div className="flex flex-col">
                    <p className="form-label pb-1">{t('linesTitle')}</p>
                    <ul className="flex flex-col divide-y divide-line">
                        {option.lines.map((line) => (
                            <li key={line.symbol} className="py-1.5">
                                <details className="group">
                                    <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
                                        <span aria-hidden className={`size-2 flex-none rounded-full ${GROUP_CLASS[groupOf(line.role)]}`} />
                                        <AssetLogo symbol={line.symbol} name={line.name} assetClass={assetClassOfRole(line.role)} size={26} className="shrink-0" />
                                        <span className="flex min-w-0 flex-1 flex-col leading-tight">
                                            <span className="mono text-[13px] font-semibold text-foreground">{line.symbol}</span>
                                            <span className="truncate text-[11.5px] text-faint">{t(`role.${line.role}`)}</span>
                                        </span>
                                        <span className="num text-[13px] font-bold text-foreground">{pct(line.weightPct)}</span>
                                        <span className="num w-[72px] text-end text-[12px] text-muted-foreground">{money((amountCad * line.weightPct) / 100)}</span>
                                        <span className="flex items-center gap-0.5 text-[12px] font-semibold text-brand-ink">
                                            {t('why')}
                                            <ChevronDown aria-hidden className="size-3.5 transition-transform group-open:rotate-180" />
                                        </span>
                                    </summary>
                                    <div className="mt-1.5 flex flex-col gap-1.5 rounded-[8px] bg-canvas px-2.5 py-2">
                                        <p className="text-[12px] text-muted-foreground">{line.name}</p>
                                        {line.why.map((why, i) => (
                                            <p key={i} className="text-[12.5px] leading-snug text-foreground">
                                                {t(`whyItem.${why.code}`, why.values)}
                                                <span className="mono ms-1.5 whitespace-nowrap text-[10.5px] text-faint">{t(`rule.${why.rule}`)}</span>
                                            </p>
                                        ))}
                                    </div>
                                </details>
                            </li>
                        ))}
                    </ul>
                </div>

                <div className="mt-auto flex flex-col gap-2 pt-1">
                    {replaceMode && confirming ? (
                        <>
                            <p className="text-[12.5px] text-muted-foreground">{t('replaceConfirm')}</p>
                            <div className="flex gap-2">
                                <button type="button" className="btn btn-ghost flex-1" onClick={() => setConfirming(false)} disabled={busy}>{t('cancel')}</button>
                                <button type="button" className="btn btn-primary flex-1" onClick={onApply} disabled={disabled || busy}>
                                    {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
                                    {busy ? t('choosing') : t('confirm')}
                                </button>
                            </div>
                        </>
                    ) : (
                        <button
                            type="button"
                            className={`btn w-full ${replaceMode ? 'btn-ghost' : 'btn-primary'}`}
                            onClick={replaceMode ? () => setConfirming(true) : onApply}
                            disabled={disabled || busy}
                        >
                            {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
                            {busy ? t('choosing') : replaceMode ? t('replace') : t('choose')}
                            {!busy && !replaceMode ? <ArrowRight aria-hidden /> : null}
                        </button>
                    )}
                </div>
            </div>
        </section>
    );
}
