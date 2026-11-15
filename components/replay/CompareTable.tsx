'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { AssetLogo } from '@/components/AssetLogo';
import type { AssetClass } from '@/lib/domain/types';
import type { CompareScenarioOk } from '@/lib/services/replay';
import type { Replayed } from './CompareChart';
import { seriesColor } from './palette';
import { useReplayFmt } from './useReplayFmt';

type Metrics = CompareScenarioOk['metrics'];
type Row = { key: string; label: string; cell: (s: CompareScenarioOk) => ReactNode };
/** A metric the neutral paragraph reads: its value, and the words for its two ends. */
type Extreme = { key: string; label: string; value: (m: Metrics) => number | null; show: (v: number) => string; fall?: boolean };

const dash = '—';
const firedTotal = (s: CompareScenarioOk) => s.ruleStats.reduce((sum, r) => sum + r.fired, 0);

// One column per scenario, the same rows for all; no colour for better or worse, no rank, no winner. Below it, one
// neutral paragraph: the highest and the lowest of each metric, then the risk / return trade-off in plain words.
export default function CompareTable({ scenarios }: { scenarios: Replayed[] }) {
    const t = useTranslations('Replay');
    const f = useReplayFmt();
    const contributions = scenarios.some(({ s }) => s.metrics.contributedCad > 0);
    const pctOrDash = (v: number | null) => (v === null ? dash : f.pct(v));

    const rows: Row[] = [
        { key: 'finalValue', label: t('compare.rows.finalValue'), cell: (s) => f.money(s.metrics.finalValueCad) },
        ...(contributions ? [{ key: 'contributed', label: t('compare.rows.contributed'), cell: (s: CompareScenarioOk) => f.money(s.metrics.contributedCad) }] : []),
        { key: 'totalReturn', label: t('compare.rows.totalReturn'), cell: (s) => f.pct(s.metrics.totalReturnPct) },
        { key: 'annualised', label: t('compare.rows.annualised'), cell: (s) => pctOrDash(s.metrics.annualisedReturnPct) },
        { key: 'volatility', label: t('compare.rows.volatility'), cell: (s) => f.pct(s.metrics.volatilityPct) },
        {
            key: 'worstFall',
            label: t('compare.rows.worstFall'),
            cell: (s) => (
                <span className="flex flex-col items-end">
                    <span>{f.pct(s.metrics.worstFall.pct)}</span>
                    {s.metrics.worstFall.peakDate && s.metrics.worstFall.troughDate && (
                        <span className="text-[11px] font-normal text-faint">{t('compare.fallDates', { peak: f.date(s.metrics.worstFall.peakDate), trough: f.date(s.metrics.worstFall.troughDate) })}</span>
                    )}
                </span>
            ),
        },
        { key: 'return2022', label: t('compare.rows.return2022'), cell: (s) => pctOrDash(s.metrics.return2022Pct) },
        { key: 'orders', label: t('compare.rows.orders'), cell: (s) => f.num(s.metrics.orderCount) },
        {
            key: 'firings',
            label: t('multi.rows.firings'),
            cell: (s) => (s.ruleCount === 0 ? <span className="text-faint">{t('multi.noRule')}</span> : (
                <span className="flex flex-col items-end">
                    <span>{f.num(firedTotal(s))}</span>
                    <span className="text-[11px] font-normal text-faint">{t('multi.rulesCount', { count: s.ruleCount })}</span>
                </span>
            )),
        },
    ];

    const extremes: Extreme[] = [
        { key: 'totalReturn', label: t('compare.rows.totalReturn'), value: (m) => m.totalReturnPct, show: (v) => f.pct(v) },
        { key: 'annualised', label: t('compare.rows.annualised'), value: (m) => m.annualisedReturnPct, show: (v) => f.pct(v) },
        { key: 'volatility', label: t('compare.rows.volatility'), value: (m) => m.volatilityPct, show: (v) => f.pct(v) },
        { key: 'worstFall', label: t('compare.rows.worstFall'), value: (m) => m.worstFall.pct, show: (v) => f.pct(v), fall: true },
        { key: 'return2022', label: t('compare.rows.return2022'), value: (m) => m.return2022Pct, show: (v) => f.pct(v) },
    ];

    const ends = (e: Extreme) => {
        const known = scenarios.map(({ s }) => ({ s, v: e.value(s.metrics) })).filter((x): x is { s: CompareScenarioOk; v: number } => x.v !== null);
        if (known.length < 2) return null;
        // a fall is a negative number: the shallowest is the highest value
        const high = known.reduce((a, b) => (b.v > a.v ? b : a));
        const low = known.reduce((a, b) => (b.v < a.v ? b : a));
        return { high, low, same: Math.abs(high.v - low.v) < 0.05 };
    };

    const sentences: string[] = [];
    for (const e of extremes) {
        const r = ends(e);
        if (!r) continue;
        if (r.same) sentences.push(t('multi.allSame', { metric: e.label, value: e.show(r.high.v) }));
        else sentences.push(t(e.fall ? 'multi.fallHighLow' : 'multi.highLow', { metric: e.label, high: r.high.s.label, highValue: e.show(r.high.v), low: r.low.s.label, lowValue: e.show(r.low.v) }));
    }
    const ret = ends(extremes[0]);
    const fall = ends(extremes[3]);
    let tradeoff: string | null = null;
    if (ret && fall && !ret.same && !fall.same) {
        tradeoff = ret.high.s.replayId === fall.high.s.replayId
            ? t('multi.tradeoffSame', { label: ret.high.s.label })
            : t('multi.tradeoffSplit', { high: ret.high.s.label, shallow: fall.high.s.label });
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="overflow-x-auto rounded-[10px] border border-line" data-lenis-prevent>
                <table className="data-table text-[13px]">
                    <thead>
                        <tr>
                            <th className="align-bottom">{t('compare.metric')}</th>
                            {scenarios.map(({ s, slot }) => (
                                <th key={s.replayId} className="is-num !h-auto min-w-[150px] py-2.5 align-bottom">
                                    <span className="flex flex-col items-end gap-1">
                                        <span className="flex items-center gap-1.5 text-foreground">
                                            <span className="inline-block h-[3px] w-3.5 flex-none rounded" style={{ background: seriesColor(slot) }} />
                                            <span className="max-w-[180px] truncate !normal-case">{s.label}</span>
                                        </span>
                                        <span className="max-w-[180px] truncate text-[11px] font-normal !normal-case text-faint">{s.ruleCount ? s.strategyName || t('ids.unnamed') : t('controls.noRules')}</span>
                                        <Holdings holdings={s.holdings} />
                                    </span>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r) => (
                            <tr key={r.key}>
                                <td className="!h-auto py-2.5 font-semibold text-foreground">{r.label}</td>
                                {scenarios.map(({ s }) => <td key={s.replayId} className="is-num !h-auto py-2.5">{r.cell(s)}</td>)}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {contributions && <p className="text-[11.5px] font-semibold leading-relaxed text-muted-foreground">{t('compare.contributionsNote')}</p>}

            {sentences.length > 0 && (
                <div className="rounded-[12px] bg-canvas px-3.5 py-3 text-[13px] leading-relaxed text-muted-foreground">
                    <p className="text-[12.5px] font-bold text-foreground">{t('multi.neutralTitle')}</p>
                    <ul className="mt-1.5 flex list-disc flex-col gap-1 ps-4 marker:text-faint">
                        {sentences.map((line) => <li key={line}>{line}</li>)}
                    </ul>
                    {tradeoff && <p className="mt-2">{tradeoff}</p>}
                    <p className="mt-2 text-[12px] text-faint">{t('multi.neutralNote')}</p>
                </div>
            )}
        </div>
    );
}

function Holdings({ holdings }: { holdings: CompareScenarioOk['holdings'] }) {
    const t = useTranslations('Replay');
    const top = [...holdings].sort((a, b) => b.weightPct - a.weightPct);
    const shown = top.slice(0, 5);
    return (
        <span className="flex items-center justify-end -space-x-1.5" title={top.map((h) => h.symbol).join(', ')} aria-label={t('multi.holdings', { list: top.map((h) => h.symbol).join(', ') })} role="img">
            {shown.map((h) => (
                <AssetLogo key={h.symbol} symbol={h.symbol} name={h.name ?? undefined} assetClass={(h.assetClass ?? undefined) as AssetClass | undefined} size={20} className="ring-2 ring-card" />
            ))}
            {top.length > shown.length && <span className="num ps-2.5 text-[11px] font-normal text-faint">+{top.length - shown.length}</span>}
        </span>
    );
}
