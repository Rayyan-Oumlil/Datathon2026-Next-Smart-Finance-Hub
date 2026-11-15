'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplayResult, SeriesMetrics } from '@/lib/replay/engine/types';
import { useReplayFmt, type ReplayFmt } from './useReplayFmt';

type Row = { key: string; cell: (m: SeriesMetrics) => React.ReactNode; diff: (w: SeriesMetrics, wo: SeriesMetrics) => string };

const dash = '—';

function rows(f: ReplayFmt, t: (key: string, values?: Record<string, string | number>) => string): Row[] {
    const pctOrDash = (v: number | null) => (v === null ? dash : f.pct(v));
    const ptsOrDash = (a: number | null, b: number | null) => (a === null || b === null ? dash : f.pts(a - b));
    return [
        { key: 'finalValue', cell: (m) => f.money(m.finalValueCad), diff: (w, wo) => f.signedMoney(w.finalValueCad - wo.finalValueCad) },
        { key: 'contributed', cell: (m) => f.money(m.contributedCad), diff: (w, wo) => f.signedMoney(w.contributedCad - wo.contributedCad) },
        { key: 'valueExContributions', cell: (m) => f.money(m.valueExContributionsCad), diff: (w, wo) => f.signedMoney(w.valueExContributionsCad - wo.valueExContributionsCad) },
        { key: 'totalReturn', cell: (m) => f.pct(m.totalReturnPct), diff: (w, wo) => f.pts(w.totalReturnPct - wo.totalReturnPct) },
        { key: 'annualised', cell: (m) => pctOrDash(m.annualisedReturnPct), diff: (w, wo) => ptsOrDash(w.annualisedReturnPct, wo.annualisedReturnPct) },
        { key: 'volatility', cell: (m) => f.pct(m.volatilityPct), diff: (w, wo) => f.pts(w.volatilityPct - wo.volatilityPct) },
        {
            key: 'worstFall',
            cell: (m) => (
                <span className="flex flex-col items-end">
                    <span>{f.pct(m.worstFall.pct)}</span>
                    {m.worstFall.peakDate && m.worstFall.troughDate && (
                        <span className="text-[11px] font-normal text-faint">{t('compare.fallDates', { peak: f.date(m.worstFall.peakDate), trough: f.date(m.worstFall.troughDate) })}</span>
                    )}
                </span>
            ),
            diff: (w, wo) => f.pts(w.worstFall.pct - wo.worstFall.pct),
        },
        { key: 'return2022', cell: (m) => pctOrDash(m.return2022Pct), diff: (w, wo) => ptsOrDash(w.return2022Pct, wo.return2022Pct) },
        {
            key: 'worstDay',
            cell: (m) => (
                <span className="flex flex-col items-end">
                    <span>{f.pct(m.worstDay.pct)}</span>
                    <span className="text-[11px] font-normal text-faint">{f.date(m.worstDay.date)}</span>
                </span>
            ),
            diff: (w, wo) => f.pts(w.worstDay.pct - wo.worstDay.pct),
        },
        { key: 'orders', cell: (m) => f.num(m.orderCount), diff: (w, wo) => f.num(w.orderCount - wo.orderCount) },
        { key: 'turnover', cell: (m) => f.pct(m.turnoverPct, 0), diff: (w, wo) => f.pts(w.turnoverPct - wo.turnoverPct, 0) },
        { key: 'fees', cell: (m) => f.money(m.feesCad, 2), diff: (w, wo) => f.signedMoney(w.feesCad - wo.feesCad, 2) },
    ];
}

// One row per metric, the two series side by side and the difference (with minus without). No row is coloured
// as better or worse, and no column is labelled a winner: the table is shown the same whichever ended higher.
export default function Comparison({ result }: { result: ReplayResult }) {
    const t = useTranslations('Replay');
    const f = useReplayFmt();
    const w = result.series.with.metrics;
    const wo = result.series.without.metrics;
    // contributions only exist with a periodic purchase: then the final values include money added, so show both views
    const contributions = w.contributedCad > 0 || wo.contributedCad > 0;
    const shown = rows(f, t).filter((r) => contributions || (r.key !== 'contributed' && r.key !== 'valueExContributions'));
    return (
        <div className="flex flex-col gap-2">
            <div className="overflow-x-auto rounded-[10px] border border-line">
                <table className="data-table text-[13px]">
                    <thead>
                        <tr>
                            <th>{t('compare.metric')}</th>
                            <th className="is-num">{t('chart.without')}</th>
                            <th className="is-num">{t('chart.with')}</th>
                            <th className="is-num">{t('compare.difference')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {shown.map((r) => (
                            <tr key={r.key}>
                                <td className="!h-auto py-2.5 font-semibold text-foreground">{t(`compare.rows.${r.key}`)}</td>
                                <td className="is-num !h-auto py-2.5">{r.cell(wo)}</td>
                                <td className="is-num !h-auto py-2.5">{r.cell(w)}</td>
                                <td className="is-num !h-auto py-2.5 font-bold text-foreground">{r.diff(w, wo)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {contributions && <p className="text-[11.5px] font-semibold leading-relaxed text-muted-foreground">{t('compare.contributionsNote')}</p>}
            <p className="text-[11.5px] leading-relaxed text-faint">{t('compare.note', { initial: w.initialOrderCount })}</p>
        </div>
    );
}

const GW = 1000;
const GH = 120;

/** The gap over time: "with" minus "without", in index points (100 = starting capital), drawn up to the cursor. */
export function GapChart({ result, cursor }: { result: ReplayResult; cursor: number }) {
    const t = useTranslations('Replay');
    const f = useReplayFmt();
    const gap = result.gap.indexPts;
    const n = gap.length;
    const geo = useMemo(() => {
        let low = Math.min(0, ...gap);
        let high = Math.max(0, ...gap);
        const span = high - low || 1;
        low -= span * 0.08;
        high += span * 0.08;
        const y = (v: number) => (1 - (v - low) / (high - low)) * GH;
        const x = (i: number) => (n > 1 ? (i / (n - 1)) * GW : 0);
        return { y, x, low, high, pts: gap.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`) };
    }, [gap, n]);
    const shown = geo.pts.slice(0, cursor + 1);
    const area = shown.length > 1 ? `${geo.x(0)},${geo.y(0)} ${shown.join(' ')} ${geo.x(cursor)},${geo.y(0)}` : '';

    return (
        <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-[12.5px]">
                <p className="font-bold text-foreground">{t('gap.title')}</p>
                <p className="num text-faint">{t('gap.at', { date: f.date(result.dates[cursor]), value: f.pts(gap[cursor]) })}</p>
            </div>
            <div className="mt-2 flex gap-2">
                <div className="num relative w-14 flex-none text-right text-[11px] text-faint" style={{ height: GH }} aria-hidden>
                    <span className="absolute right-0 top-0">{f.pts(geo.high, 0)}</span>
                    {geo.y(0) > 16 && geo.y(0) < GH - 16 && <span className="absolute right-0 -translate-y-1/2" style={{ top: geo.y(0) }}>0</span>}
                    <span className="absolute bottom-0 right-0">{f.pts(geo.low, 0)}</span>
                </div>
                <svg viewBox={`0 0 ${GW} ${GH}`} preserveAspectRatio="none" className="min-w-0 flex-1 overflow-visible" style={{ height: GH }} role="img"
                    aria-label={t('gap.aria', { final: f.pts(gap[n - 1]) })}>
                    <line x1={0} x2={GW} y1={geo.y(0)} y2={geo.y(0)} stroke="var(--line-strong)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
                    {area && <polygon points={area} fill="var(--brand-soft)" />}
                    <polyline points={shown.join(' ')} fill="none" stroke="var(--brand)" strokeWidth={1.75} vectorEffect="non-scaling-stroke" />
                    <line x1={geo.x(cursor)} x2={geo.x(cursor)} y1={0} y2={GH} stroke="var(--line-strong)" vectorEffect="non-scaling-stroke" />
                </svg>
            </div>
            <p className="mt-1.5 text-[11.5px] text-faint">{t('gap.note')}</p>
        </div>
    );
}
