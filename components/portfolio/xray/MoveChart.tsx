'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Level } from '@/lib/domain/types';
import type { XrayView } from '@/lib/services/portfolio-xray';
import { chartBox } from '../logic';
import { useFmt } from '../useFmt';
import { dropFact, type AvailableWindow } from './logic';
import { Section } from './parts';

const W = 600;
const H = 170;

// The replay of the period, indexed to 100, with its worst fall shaded. Hand-drawn SVG like the performance chart.
export default function MoveChart({ view, window, level }: { view: XrayView; window: AvailableWindow; level: Level }) {
    const t = useTranslations('Xray');
    const fmt = useFmt();
    const dd = window.maxDrawdown;
    const box = chartBox(window.curve.map((point) => ({ t: point.date, valueCad: point.value })), 100);
    const peak = box.dots.find((dot) => dot.point.t === dd.peakDate);
    const trough = box.dots.find((dot) => dot.point.t === dd.troughDate);
    const last = window.curve[window.curve.length - 1];
    const answer = dropFact(view, window);
    const [hover, setHover] = useState<number | null>(null);
    const shown = hover === null ? null : box.dots[hover];
    const onMove = (event: React.PointerEvent<HTMLDivElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        let nearest = 0;
        box.dots.forEach((dot, index) => { if (Math.abs(dot.x - x) < Math.abs(box.dots[nearest].x - x)) nearest = index; });
        setHover(nearest);
    };

    return (
        <Section title={t('move.title')} sub={t('move.sub')} tag="scenario">
            <div className="flex gap-2">
                <div className="num flex flex-none flex-col justify-between py-0.5 text-right text-[11px] text-faint" aria-hidden>
                    <span>{fmt.money(box.high)}</span>
                    <span>{fmt.money(box.low)}</span>
                </div>
                <div className="relative min-w-0 flex-1 touch-none" style={{ height: H }} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
                    <svg
                        viewBox={`0 0 ${W} ${H}`}
                        preserveAspectRatio="none"
                        className="xray-wipe size-full overflow-visible"
                        role="img"
                        aria-label={t('move.chartLabel', {
                            from: fmt.when(window.from), to: fmt.when(window.to), last: fmt.money(last.value),
                            pct: fmt.signedPct(dd.pct), peak: fmt.when(dd.peakDate), trough: fmt.when(dd.troughDate),
                        })}
                    >
                        {peak && trough && dd.pct < 0 && (
                            <rect x={peak.x * W} y={0} width={Math.max(2, (trough.x - peak.x) * W)} height={H} fill="var(--down-soft)" />
                        )}
                        <line x1={0} x2={W} y1={box.baselineY * H} y2={box.baselineY * H} stroke="var(--line-strong)" strokeWidth={1} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
                        <polyline
                            points={box.dots.map((dot) => `${(dot.x * W).toFixed(1)},${(dot.y * H).toFixed(1)}`).join(' ')}
                            fill="none" stroke="var(--brand)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"
                        />
                    </svg>
                    {shown && (
                        <>
                            <span className="pointer-events-none absolute inset-y-0 w-px bg-line-strong" style={{ left: `${shown.x * 100}%` }} />
                            <span className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand ring-2 ring-card" style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%` }} />
                        </>
                    )}
                    {dd.pct < 0 && [peak, trough].map((dot, index) => dot && (
                        <span
                            key={index}
                            className={`pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card ${index === 0 ? 'bg-foreground' : 'bg-down'}`}
                            style={{ left: `${dot.x * 100}%`, top: `${dot.y * 100}%` }}
                        />
                    ))}
                </div>
            </div>
            <p className="num mt-2 min-h-5 text-[13px] text-muted-foreground" aria-live="polite">
                {shown ? <><span className="font-bold text-foreground">{fmt.money(shown.point.valueCad)}</span> · {fmt.when(shown.point.t)}</> : ''}
            </p>
            <div className="mt-1 flex justify-between ps-12 text-[11px] text-faint">
                <span>{fmt.when(window.from)}</span>
                <span>{fmt.when(window.to)}</span>
            </div>

            <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-faint">
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-brand" />{t('move.legendReplay')}</span>
                <span className="flex items-center gap-1.5"><span className="w-4 border-t border-dashed border-line-strong" />{t('move.legendStart')}</span>
                {dd.pct < 0 && <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: 'var(--down-soft)' }} />{t('move.legendFall')}</span>}
            </p>

            {dd.pct < 0 && (
                <p className="mt-2 text-[13px] text-foreground">
                    <span className="font-semibold">{t('move.worst', { pct: fmt.signedPct(dd.pct), peak: fmt.when(dd.peakDate), trough: fmt.when(dd.troughDate) })}.</span>{' '}
                    <span className="text-muted-foreground">{dd.recoveredDate ? t('move.regained', { date: fmt.when(dd.recoveredDate) }) : t('move.notRegained', { date: fmt.when(window.to) })}.</span>
                </p>
            )}
            {answer && (
                <p className="mt-2 rounded-[10px] bg-hover px-3 py-2 text-[13px] text-foreground">
                    {t('move.yourAnswer', { answer: t(`move.answers.${answer.answer}`), pct: fmt.signedPct(answer.fallPct) })}
                </p>
            )}
            {level === 'Expert' && (
                <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-2">
                    <div className="flex justify-between gap-3"><dt className="text-faint">{t('move.worstDay')}</dt><dd className="num font-semibold text-foreground">{fmt.signedPct(window.worstDay.pct)} · {fmt.when(window.worstDay.date)}</dd></div>
                    {window.worstSpan20 && (
                        <div className="flex justify-between gap-3"><dt className="text-faint">{t('move.worstSpan')}</dt><dd className="num font-semibold text-foreground">{fmt.signedPct(window.worstSpan20.pct)} · {fmt.when(window.worstSpan20.from)}</dd></div>
                    )}
                </dl>
            )}
        </Section>
    );
}
