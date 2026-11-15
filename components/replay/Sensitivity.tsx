'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2, SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReplayResult, SensitivityReport, SensitivityVariant } from '@/lib/replay/engine/types';
import { ruleName } from './rules';
import { useReplayFmt } from './useReplayFmt';

type Props = { result: ReplayResult; body: Record<string, unknown> | null };

// The same replay from other start dates and with one other threshold per rule. Each variant has its own replay id
// and opens as its own replay. The tally counts, it does not judge.
export default function Sensitivity({ result, body }: Props) {
    const t = useTranslations('Replay');
    const f = useReplayFmt();
    const [report, setReport] = useState<SensitivityReport | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const stale = report && report.baseReplayId !== result.replayId;

    const run = async () => {
        if (!body) return;
        setBusy(true);
        setError(null);
        try {
            const res = await fetch('/api/replay/sensitivity', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : t('states.errorGeneric'));
            setReport(json.sensitivity as SensitivityReport);
        } catch (e) {
            setError(e instanceof Error ? e.message : t('states.errorGeneric'));
        } finally {
            setBusy(false);
        }
    };

    const label = (v: SensitivityVariant) => {
        const x = v.variant;
        if (x.type === 'base') return t('sensitivity.base');
        if (x.type === 'start_date') return t('sensitivity.startDate', { date: f.date(x.startDate) });
        // the engine names changed values in plain identifiers ('quarterly', 'drift 5', 'month', '63 trading days')
        const value = (n: number | string): string => {
            if (typeof n === 'number') return f.num(n, 2);
            const drift = /^drift (\d+(?:\.\d+)?)$/.exec(n);
            if (drift) return t('values.drift', { n: f.num(Number(drift[1]), 1) });
            const days = /^(\d+) trading days$/.exec(n);
            if (days) return t('values.tradingDays', { n: Number(days[1]) });
            return t.has(`values.${n}`) ? t(`values.${n}`) : n;
        };
        const fieldKey = `fields.${x.field.replace(/\./g, '_')}`;
        return t('sensitivity.threshold', { rule: ruleName(t, result, x.ruleId), field: t.has(fieldKey) ? t(fieldKey) : x.field, from: value(x.from), to: value(x.to) });
    };

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="max-w-xl text-[12.5px] leading-relaxed text-faint">{t('sensitivity.intro')}</p>
                <button type="button" className="btn btn-ghost h-9 px-3 text-[13px]" onClick={run} disabled={busy || !body}>
                    {busy ? <Loader2 className="animate-spin" /> : <SlidersHorizontal />}
                    {report && !stale ? t('sensitivity.rerun') : t('sensitivity.run')}
                </button>
            </div>
            {!body && <p className="text-[12.5px] text-faint">{t('sensitivity.needRun')}</p>}
            {error && <p role="alert" className="text-[13px] text-down">{error}</p>}
            {report && !stale && (
                <>
                    <p className="text-[13.5px] leading-relaxed text-foreground">
                        {t('sensitivity.tally', {
                            n: report.tally.variants, with: report.tally.withEndedHigher, without: report.tally.withoutEndedHigher, equal: report.tally.equal,
                            rMin: f.pts(report.tally.totalReturnGapPts.min), rMax: f.pts(report.tally.totalReturnGapPts.max),
                            fMin: f.pts(report.tally.worstFallGapPts.min), fMax: f.pts(report.tally.worstFallGapPts.max),
                        })}
                    </p>
                    <div className="overflow-x-auto rounded-[10px] border border-line">
                        <table className="data-table text-[12.5px]">
                            <thead>
                                <tr>
                                    <th>{t('sensitivity.variant')}</th>
                                    <th className="is-num">{t('sensitivity.returnWithout')}</th>
                                    <th className="is-num">{t('sensitivity.returnWith')}</th>
                                    <th className="is-num">{t('compare.difference')}</th>
                                    <th className="is-num">{t('sensitivity.fallGap')}</th>
                                    <th>{t('sensitivity.replayId')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {report.variants.map((v) => (
                                    <tr key={v.replayId}>
                                        <td className="!h-auto min-w-[220px] py-2.5 !whitespace-normal font-semibold text-foreground">
                                            {label(v)}
                                            <span className="block text-[11px] font-normal text-faint">{t('sensitivity.window', { from: f.date(v.window.from), to: f.date(v.window.to) })}</span>
                                        </td>
                                        <td className="is-num !h-auto py-2.5">{f.pct(v.metrics.without.totalReturnPct)}</td>
                                        <td className="is-num !h-auto py-2.5">{f.pct(v.metrics.with.totalReturnPct)}</td>
                                        <td className="is-num !h-auto py-2.5 font-bold text-foreground">{f.pts(v.summary.totalReturnGapPts)}</td>
                                        <td className="is-num !h-auto py-2.5">{f.pts(v.summary.worstFallGapPts)}</td>
                                        <td className="!h-auto py-2.5">
                                            <Link href={`/time-machine?replay=${encodeURIComponent(v.replayId)}`} className="mono text-[11.5px] text-brand-ink underline-offset-2 hover:underline">{v.replayId}</Link>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <p className="text-[11.5px] leading-relaxed text-faint">{t('sensitivity.note')}</p>
                </>
            )}
        </div>
    );
}
