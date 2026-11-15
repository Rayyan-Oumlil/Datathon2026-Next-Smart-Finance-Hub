'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { formatNumber } from '@/i18n/format';
import { shownChecks } from '@/components/watchlist/format';
import type { XrayView, XrayWhatIf } from '@/lib/services/portfolio-xray';
import type { WindowId } from '@/lib/xray/types';
import { api } from '../logic';
import { useFmt } from '../useFmt';
import AssetSearch, { type Asset } from './AssetSearch';
import { comparisonOf, metricRows, type MetricRow } from './logic';
import { Tag, useGapText } from './parts';

// Opens the lab on a symbol; the direction and the amount are left to the user
export type Preset = { symbol: string; nonce: number };
type Props = { view: XrayView; windowId: WindowId; preset?: Preset | null };

const RUN_DELAY_MS = 650;

// A hypothetical change, run through the same engine as the X-ray: pick an asset, drag the amount, and the before and
// after update by themselves. Read-only: nothing is traded or saved.
export default function WhatIf({ view, windowId, preset }: Props) {
    const t = useTranslations('Xray');
    const fmt = useFmt();
    const [asset, setAsset] = useState<Asset | null>(null);
    const [amount, setAmount] = useState(0);
    const [mode, setMode] = useState<'add' | 'reduce'>('add');
    const [running, setRunning] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const [result, setResult] = useState<XrayWhatIf | null>(null);
    const gapText = useGapText();
    const latest = useRef(0);
    const root = useRef<HTMLElement>(null);

    const held = view.holdings.map((h) => ({ symbol: h.symbol, name: h.name }));
    // The most the slider can reach: all the cash for an addition, the whole position for a reduction
    const heldValue = view.holdings.find((h) => h.symbol === asset?.symbol)?.valueCad ?? 0;
    const max = Math.floor(mode === 'add' ? view.cashCad : heldValue);
    const step = Math.max(1, Math.round(max / 200));

    // A reading's link opens the lab on its holding, with no amount: nothing runs until the user drags one
    useEffect(() => {
        if (!preset) return;
        const name = view.holdings.find((h) => h.symbol === preset.symbol)?.name ?? preset.symbol;
        setAsset({ symbol: preset.symbol, name });
        setAmount(0);
        root.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        // only a new press (nonce) loads the lab again
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [preset?.nonce]);

    // A new asset or direction keeps the amount inside the new range; the app never picks an amount itself
    useEffect(() => {
        setAmount((current) => (max > 0 ? Math.min(current, max) : 0));
    }, [asset?.symbol, mode, max]);

    useEffect(() => {
        if (!asset || !(amount > 0)) {
            setResult(null);
            setProblem(null);
            return;
        }
        const id = ++latest.current;
        const timer = setTimeout(async () => {
            setRunning(true);
            try {
                const answer = await api<XrayWhatIf>('/api/portfolio/xray/what-if', { method: 'POST', body: { symbol: asset.symbol, amountCad: amount, direction: mode } });
                if (id === latest.current) { setResult(answer); setProblem(null); }
            } catch (failure) {
                if (id === latest.current) { setResult(null); setProblem(t('whatIf.failed', { error: fmt.error(failure) })); }
            } finally {
                if (id === latest.current) setRunning(false);
            }
        }, RUN_DELAY_MS);
        return () => clearTimeout(timer);
        // fmt and t change identity with the language only
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [asset?.symbol, amount, mode]);

    const comparison = result ? comparisonOf(result.before, result.after, windowId) : { period: null, afterGap: null, gaps: [], coveragePct: null };

    const show = (value: number | null, kind: MetricRow['kind']) => {
        if (value === null) return t('tiles.notAvailable');
        if (kind === 'share') return fmt.share(value);
        if (kind === 'signed') return value === 0 ? fmt.share(0) : fmt.signedPct(value);
        return formatNumber(value, fmt.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    };

    return (
        <section ref={root} aria-labelledby="xray-lab-title" className="flex flex-col gap-4">
            <div>
                <div className="flex items-center gap-2"><h3 id="xray-lab-title" className="text-[14px] font-bold tracking-[-0.01em] text-foreground">{t('whatIf.title')}</h3><Tag kind="scenario" /></div>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{t('whatIf.sub')}</p>
            </div>

            <div>
                <p className="kicker mb-1.5">{t('whatIf.asset')}</p>
                <AssetSearch value={asset} onChange={(next) => { setAsset(next); setResult(null); }} held={held} />
            </div>

            <div role="radiogroup" aria-label={t('whatIf.title')} className="flex gap-1">
                {(['add', 'reduce'] as const).map((option) => (
                    <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={mode === option}
                        onClick={() => setMode(option)}
                        className={`h-8 rounded-full px-3 text-[12.5px] font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${mode === option ? 'bg-brand-soft text-brand-ink' : 'text-muted-foreground hover:bg-hover hover:text-foreground'}`}
                    >
                        {t(`whatIf.${option}`)}
                    </button>
                ))}
            </div>

            {asset && (
                <div>
                    <div className="flex items-baseline justify-between gap-3">
                        <label htmlFor="xray-amount" className="kicker">{t('whatIf.amount')}</label>
                        <span className="num text-[18px] font-bold tracking-[-0.02em] text-foreground">{fmt.cad(amount)}</span>
                    </div>
                    {max > 0 ? (
                        <input
                            id="xray-amount"
                            type="range"
                            min={0}
                            max={max}
                            step={step}
                            value={amount}
                            onChange={(event) => setAmount(Number(event.target.value))}
                            className="mt-2 h-2 w-full cursor-pointer accent-[var(--brand)]"
                        />
                    ) : (
                        <p className="mt-1 text-[13px] text-muted-foreground">{mode === 'add' ? t('whatIf.noCash') : t('whatIf.heldOnly')}</p>
                    )}
                </div>
            )}

            {asset && max > 0 && !(amount > 0) && <p className="text-[12.5px] text-faint">{t('whatIf.pickAmount')}</p>}

            {problem && <p role="alert" className="text-[13px] text-down">{problem}</p>}

            {result && (
                <div aria-live="polite" aria-busy={running} className={`flex flex-col gap-3 transition-opacity ${running ? 'opacity-60' : ''}`}>
                    {/* Before and after are computed over the same dates and the same covered holdings */}
                    {comparison.period && <p className="text-[12px] text-faint">{t('whatIf.period', { from: fmt.when(comparison.period.from), to: fmt.when(comparison.period.to) })}</p>}
                    {comparison.afterGap && <p className="text-[12.5px] text-down">{t('whatIf.afterUnavailable', { reason: gapText(comparison.afterGap) })}</p>}
                    {comparison.gaps.length > 0 && <p className="text-[12px] text-down">{t('coverage.partial', { share: fmt.share(comparison.coveragePct ?? 0), gaps: comparison.gaps.map(gapText).join('; ') })}</p>}
                    <div className="overflow-x-auto rounded-[10px] border border-line">
                        <table className="data-table w-full text-[12.5px] [&_td]:px-2.5 [&_th]:px-2.5">
                            <thead>
                                <tr><th>{result.change.symbol}</th><th className="is-num">{t('whatIf.before')}</th><th className="is-num">{t('whatIf.after')}</th></tr>
                            </thead>
                            <tbody>
                                {metricRows(result.before, result.after, windowId).map((row) => {
                                    return (
                                        <tr key={row.key}>
                                            <td className="!h-9">{t(`whatIf.metrics.${row.key}`)}</td>
                                            <td className="is-num !h-9">{show(row.before, row.kind)}</td>
                                            <td className="is-num !h-9 font-bold text-foreground">{show(row.after, row.kind)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    {mode === 'add' && (
                        <div>
                            <p className="kicker">{t('whatIf.conflictsTitle')}</p>
                            {shownChecks(result.conflicts).length === 0 ? (
                                <p className="mt-1 text-[13px] text-muted-foreground">{t('whatIf.noConflicts')}</p>
                            ) : (
                                <ul className="mt-1 flex flex-col gap-1.5">
                                    {shownChecks(result.conflicts).map((conflict) => <li key={conflict.filter} className="rounded-[10px] bg-brand-soft px-3 py-2 text-[13px] text-foreground">{conflict.detail}</li>)}
                                </ul>
                            )}
                        </div>
                    )}
                    <p className="text-[12px] text-faint">{t('whatIf.scenarioNote')}</p>
                </div>
            )}
            {!asset && <p className="text-[12.5px] text-faint">{t('whatIf.pickFirst')}</p>}
        </section>
    );
}
