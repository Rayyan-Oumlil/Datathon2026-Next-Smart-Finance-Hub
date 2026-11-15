'use client';

import { useState } from 'react';
import Link from 'next/link';
import { History, Clock } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useFmt } from '@/components/portfolio/useFmt';
import { formatDateTime, formatMoney, formatPercent } from '@/i18n/format';
import type { ReplayResult, SeriesName } from '@/lib/replay/engine/types';
import type { StrategyRule } from '@/lib/strategy/types';
import type { ServerIssue } from './model';
import { ApiIssues } from './issues';

export const PREVIEW_START = '2021-01-04';

const LINE: Record<SeriesName, string> = { without: 'var(--muted-foreground)', with: 'var(--brand)' };

/** Two index series (100 at the start) as one small SVG chart. */
export function TwoLineChart({ without, withStrategy, label }: { without: number[]; withStrategy: number[]; label: string }) {
    const n = Math.min(without.length, withStrategy.length);
    if (n < 2) return null;
    const step = Math.max(1, Math.floor(n / 240));
    const picks: number[] = [];
    for (let i = 0; i < n; i += step) picks.push(i);
    if (picks[picks.length - 1] !== n - 1) picks.push(n - 1);
    const all = picks.flatMap((i) => [without[i], withStrategy[i]]);
    const low = Math.min(...all, 100);
    const high = Math.max(...all, 100);
    const pad = (high - low || 1) * 0.08;
    const W = 600;
    const H = 150;
    const x = (i: number) => (i / (n - 1)) * W;
    const y = (v: number) => H - ((v - (low - pad)) / (high - low + 2 * pad)) * H;
    const path = (values: number[]) => picks.map((i, k) => `${k === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(values[i]).toFixed(1)}`).join(' ');
    return (
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label} className="h-36 w-full overflow-visible">
            <line x1={0} x2={W} y1={y(100)} y2={y(100)} stroke="var(--line-strong)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
            <path d={path(without)} fill="none" stroke={LINE.without} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
            <path d={path(withStrategy)} fill="none" stroke={LINE.with} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>
    );
}

type Props = {
    /** The strategy as it is on screen (saved or not). */
    strategy: { id?: string; name: string; rules: StrategyRule[] };
    /** The stored id when what is on screen is saved; the time machine link needs it. */
    savedId: string | null;
    /** The simulated portfolio's value, used as the starting capital. */
    capitalCad: number | null;
    ruleLabel: (ruleId: string) => string;
};

/** "Aperçu sur l'historique": POST /api/replay with the current portfolio and the strategy, shown compactly. */
export default function HistoryPreview({ strategy, savedId, capitalCad, ruleLabel }: Props) {
    const t = useTranslations('Strategy');
    const locale = useLocale();
    const fmt = useFmt();
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<{ replay: ReplayResult; key: string } | null>(null);
    const [error, setError] = useState<{ message: string; issues: ServerIssue[] } | null>(null);
    const key = JSON.stringify(strategy.rules);

    const run = async () => {
        if (!capitalCad || capitalCad < 100) {
            setError({ message: t('errors.noValue'), issues: [] });
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const body = { portfolio: 'current', capitalCad: Math.round(capitalCad * 100) / 100, startDate: PREVIEW_START, strategy: { name: strategy.name.trim() || '—', rules: strategy.rules } };
            const res = await fetch('/api/replay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
            const json = await res.json().catch(() => null);
            if (!res.ok) setError({ message: typeof json?.error === 'string' ? json.error : fmt.error(null), issues: Array.isArray(json?.issues) ? json.issues : [] });
            else setResult({ replay: (json as { replay: ReplayResult }).replay, key });
        } catch (failure) {
            setError({ message: fmt.error(failure), issues: [] });
        } finally {
            setBusy(false);
        }
    };

    const date = (iso: string) => formatDateTime(iso, locale, { dateStyle: 'medium', timeZone: 'UTC' });
    const money = (value: number) => formatMoney(value, 'CAD', locale, { maximumFractionDigits: 0 });
    const pct = (value: number, signed = false) => formatPercent(value, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1, ...(signed ? { signDisplay: 'exceptZero' } : {}) });
    const replay = result?.replay;
    // with a periodic purchase, the final values include the money added: show it and the value without it
    const contributions = !!replay && (strategy.rules.some((rule) => rule.kind === 'periodic_purchase')
        || replay.series.with.metrics.contributedCad > 0 || replay.series.without.metrics.contributedCad > 0);

    return (
        <div className="hatch">
            <div className="card grid gap-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h2 className="section-title">{t('preview.title')}</h2>
                        <p className="section-sub">{t('preview.sub', { start: date(PREVIEW_START) })}</p>
                    </div>
                    <button type="button" className="btn btn-primary h-9 px-4 text-[13px]" onClick={run} disabled={busy || strategy.rules.length === 0}>
                        <History />{busy ? t('preview.running') : t('preview.run')}
                    </button>
                </div>
                <p className="rounded-[9px] bg-hover px-3 py-2 text-[12.5px] font-semibold text-muted-foreground">{t('preview.label')}</p>

                {error && <ApiIssues message={error.message} issues={error.issues} />}

                {replay && (
                    <div className={`grid gap-3 ${result.key !== key ? 'opacity-60' : ''}`} aria-live="polite">
                        {result.key !== key && <p className="text-[12.5px] font-semibold text-warn">{t('preview.stale')}</p>}
                        <p className="text-[12.5px] text-faint">{t('preview.window', { from: date(replay.window.from), to: date(replay.window.to), capital: money(replay.params.capitalCad) })}</p>
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[22rem] text-[13px]">
                                <thead>
                                    <tr className="text-[11px] uppercase tracking-[0.06em] text-faint">
                                        <th className="py-1 text-start font-bold" />
                                        {(['without', 'with'] as const).map((s) => (
                                            <th key={s} className="py-1 text-end font-bold">
                                                <span className="flex flex-col items-end gap-1"><span className="block h-[3px] w-5 rounded-full" style={{ background: LINE[s] }} aria-hidden />{t(`preview.${s}`)}</span>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="num">
                                    {([
                                        ['finalValue', (s: SeriesName) => money(replay.series[s].metrics.finalValueCad)],
                                        ...(contributions ? [
                                            ['contributed', (s: SeriesName) => money(replay.series[s].metrics.contributedCad)],
                                            ['valueExContributions', (s: SeriesName) => money(replay.series[s].metrics.valueExContributionsCad)],
                                        ] as const : []),
                                        ['totalReturn', (s: SeriesName) => pct(replay.series[s].metrics.totalReturnPct, true)],
                                        ['worstFall', (s: SeriesName) => pct(replay.series[s].metrics.worstFall.pct)],
                                        ['volatility', (s: SeriesName) => pct(replay.series[s].metrics.volatilityPct)],
                                    ] as const).map(([label, cell]) => (
                                        <tr key={label} className="border-t border-line">
                                            <th scope="row" className="py-1.5 text-start font-semibold text-muted-foreground">{t(`preview.${label}`)}</th>
                                            <td className="py-1.5 text-end text-foreground">{cell('without')}</td>
                                            <td className="py-1.5 text-end font-bold text-foreground">{cell('with')}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {contributions && <p className="text-[12px] text-faint">{t('preview.contributionsNote')}</p>}
                        <TwoLineChart without={replay.series.without.index} withStrategy={replay.series.with.index} label={t('preview.chartLabel')} />
                        {replay.ruleStats.length > 0 && (
                            <div className="grid gap-1">
                                <span className="form-label">{t('preview.firings')}</span>
                                <ul className="flex flex-wrap gap-1.5">
                                    {replay.ruleStats.map((stat) => (
                                        <li key={stat.ruleId} className="pill h-auto py-0.5">{ruleLabel(stat.ruleId)} · {t('preview.fired', { count: stat.fired })}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {replay.unreplayable.length > 0 && (
                            <p className="text-[12px] text-faint">{t('preview.unreplayable', { list: replay.unreplayable.map((u) => u.sentence[locale === 'fr' ? 'fr' : 'en']).join(' ') })}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                            {savedId ? (
                                <Link href={`/time-machine?strategy=${encodeURIComponent(savedId)}`} className="btn btn-ghost h-9 px-4 text-[13px]"><Clock />{t('preview.openTimeMachine')}</Link>
                            ) : (
                                <p className="text-[12.5px] text-faint">{t('preview.saveForTimeMachine')}</p>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
