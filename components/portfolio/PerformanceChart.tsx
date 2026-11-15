'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Level } from '@/lib/domain/types';
import Panel from '@/components/Panel';
import { PERIODS, chartBox, pointsFor, type HistoryPoint, type Period } from './logic';
import { useFmt } from './useFmt';

const PERIOD_KEY: Record<Period, string> = { '1D': 'd1', '1W': 'w1', '1M': 'm1', '1Y': 'y1', All: 'all' };

const W = 600;
const H = 200;

type Props = { history: HistoryPoint[]; dailyCloses: number; startingCashCad: number; note: string; level: Level };

// The simulated value over time against the starting amount. A plain SVG line: the series is a few dozen points.
export default function PerformanceChart({ history, dailyCloses, startingCashCad, note, level }: Props) {
    const t = useTranslations('Portfolio');
    const { money, signed, cad, when } = useFmt();
    const [period, setPeriod] = useState<Period>('All');
    const [hover, setHover] = useState<number | null>(null);
    const points = useMemo(() => pointsFor(history, period, Date.now()), [history, period]);
    // Trades but no daily close yet: the series is only the start and now, a line that would say nothing
    const awaitingClose = history.length >= 2 && dailyCloses === 0;
    const drawable = points.length >= 2 && !awaitingClose;
    const box = drawable ? chartBox(points, startingCashCad) : null;
    const first = points[0];
    const last = points[points.length - 1];
    const shown = box && hover !== null ? box.dots[hover] : null;

    const onMove = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!box) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        let nearest = 0;
        box.dots.forEach((dot, index) => {
            if (Math.abs(dot.x - x) < Math.abs(box.dots[nearest].x - x)) nearest = index;
        });
        setHover(nearest);
    };

    return (
        <Panel
            className="[&>.section-head]:flex-wrap"
            title={t('performance.title')}
            sub={t('performance.sub')}
            action={(
                <div role="radiogroup" aria-label={t('performance.periodLabel')} className="flex flex-none gap-1">
                    {PERIODS.map((option) => (
                        <button
                            key={option}
                            type="button"
                            role="radio"
                            aria-checked={period === option}
                            onClick={() => { setPeriod(option); setHover(null); }}
                            className={`h-7 rounded-full px-2.5 text-[12px] font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${period === option ? 'bg-brand-soft text-brand-ink' : 'text-muted-foreground hover:bg-hover hover:text-foreground'}`}
                        >
                            {t(`performance.periods.${PERIOD_KEY[option]}`)}
                        </button>
                    ))}
                </div>
            )}
            bodyClassName="p-4"
        >
            {awaitingClose ? (
                <div className="empty-state">
                    <h3>{t('performance.noCloseTitle')}</h3>
                    <p className="max-w-md text-[13px]">{t('performance.noCloseBody')}</p>
                </div>
            ) : !box ? (
                <div className="empty-state">
                    <h3>{t('performance.emptyTitle')}</h3>
                    <p className="max-w-md text-[13px]">
                        {history.length < 2
                            ? t('performance.emptyNoTrade')
                            : t('performance.emptyPeriod', { count: points.length, period: t(`performance.periods.${PERIOD_KEY[period]}`) })}
                    </p>
                </div>
            ) : (
                <>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[13px]">
                        <p className="num text-muted-foreground" aria-live="polite">
                            {shown
                                ? <><span className="font-bold text-foreground">{cad(shown.point.valueCad)}</span> · {when(shown.point.t)}</>
                                : t.rich('performance.overPeriod', {
                                    b: (chunks) => <span className="font-bold text-foreground">{chunks}</span>,
                                    change: signed(last.valueCad - first.valueCad),
                                    sinceStart: signed(last.valueCad - startingCashCad),
                                })}
                        </p>
                        <p className="flex items-center gap-3 text-[12px] text-faint">
                            <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-brand" />{t('performance.legendValue')}</span>
                            <span className="flex items-center gap-1.5"><span className="w-4 border-t border-dashed border-line-strong" />{t('performance.legendStart')}</span>
                        </p>
                    </div>

                    <div className="mt-3 flex gap-2">
                        <div className="num flex flex-none flex-col justify-between py-0.5 text-right text-[11px] text-faint" aria-hidden>
                            <span>{money(box.high)}</span>
                            <span>{money(box.low)}</span>
                        </div>
                        <div className="relative min-w-0 flex-1 touch-none" style={{ height: H }} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
                            <svg
                                viewBox={`0 0 ${W} ${H}`}
                                preserveAspectRatio="none"
                                className="size-full overflow-visible"
                                role="img"
                                aria-label={t('performance.chartLabel', { from: when(first.t), to: when(last.t), first: money(first.valueCad), last: money(last.valueCad), start: money(startingCashCad) })}
                            >
                                <line x1={0} x2={W} y1={box.baselineY * H} y2={box.baselineY * H} stroke="var(--line-strong)" strokeWidth={1} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
                                <polyline
                                    points={box.dots.map((dot) => `${(dot.x * W).toFixed(1)},${(dot.y * H).toFixed(1)}`).join(' ')}
                                    fill="none"
                                    stroke="var(--brand)"
                                    strokeWidth={2}
                                    strokeLinejoin="round"
                                    strokeLinecap="round"
                                    vectorEffect="non-scaling-stroke"
                                />
                            </svg>
                            {/* Markers are HTML so the stretched SVG does not squash them */}
                            {(shown ? [shown] : box.dots.length <= 12 ? box.dots : []).map((dot) => (
                                <span
                                    key={dot.point.t}
                                    className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand ring-2 ring-card"
                                    style={{ left: `${dot.x * 100}%`, top: `${dot.y * 100}%` }}
                                />
                            ))}
                        </div>
                    </div>
                    <div className="mt-1 flex justify-between ps-16 text-[11px] text-faint">
                        <span>{when(first.t)}</span>
                        <span>{when(last.t)}</span>
                    </div>

                    {level === 'Expert' && (
                        <div className="mt-3 max-h-48 overflow-auto rounded-[10px] border border-line">
                            <table className="data-table text-[12.5px]">
                                <thead><tr><th>{t('performance.colTime')}</th><th className="is-num">{t('performance.colValue')}</th><th className="is-num">{t('performance.colAgainstStart')}</th></tr></thead>
                                <tbody>
                                    {[...points].reverse().map((point) => (
                                        <tr key={point.t}>
                                            <td className="!h-8">{when(point.t)}</td>
                                            <td className="is-num !h-8">{money(point.valueCad)}</td>
                                            <td className="is-num !h-8">{signed(point.valueCad - startingCashCad)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}
            <p className="mt-3 text-[12px] leading-relaxed text-faint">
                {t('performance.footer', { start: money(startingCashCad), note })}
            </p>
        </Panel>
    );
}
