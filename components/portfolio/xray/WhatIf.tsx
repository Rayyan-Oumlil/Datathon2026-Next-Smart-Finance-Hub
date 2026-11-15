'use client';

import { useState } from 'react';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { formatNumber } from '@/i18n/format';
import type { XrayView, XrayWhatIf } from '@/lib/services/portfolio-xray';
import type { WindowId } from '@/lib/xray/types';
import { api } from '../logic';
import { useFmt } from '../useFmt';
import AssetSearch, { type Asset } from './AssetSearch';
import { direction, metricRows, type MetricRow } from './logic';
import { Tag } from './parts';

type Props = { view: XrayView; windowId: WindowId };

// A hypothetical change, run through the same engine: the X-ray before and after, and where the asset meets the
// user's profile filters. Read-only: nothing is traded or saved.
export default function WhatIf({ view, windowId }: Props) {
    const t = useTranslations('Xray');
    const fmt = useFmt();
    const [open, setOpen] = useState(false);
    const [asset, setAsset] = useState<Asset | null>(null);
    const [amount, setAmount] = useState('');
    const [mode, setMode] = useState<'add' | 'reduce'>('add');
    const [running, setRunning] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const [result, setResult] = useState<XrayWhatIf | null>(null);

    const held = view.holdings.map((h) => ({ symbol: h.symbol, name: h.name }));
    const reset = () => { setResult(null); setProblem(null); };

    const run = async () => {
        const value = Number(amount.replace(',', '.'));
        if (!asset) return setProblem(t('whatIf.pickFirst'));
        if (!(Number.isFinite(value) && value > 0)) return setProblem(t('whatIf.amountInvalid'));
        setRunning(true);
        setProblem(null);
        try {
            setResult(await api<XrayWhatIf>('/api/portfolio/xray/what-if', { method: 'POST', body: { symbol: asset.symbol, amountCad: value, direction: mode } }));
        } catch (failure) {
            setResult(null);
            setProblem(t('whatIf.failed', { error: fmt.error(failure) }));
        } finally {
            setRunning(false);
        }
    };

    const show = (value: number | null, kind: MetricRow['kind']) => {
        if (value === null) return t('tiles.notAvailable');
        if (kind === 'share') return fmt.share(value);
        if (kind === 'signed') return value === 0 ? fmt.share(0) : fmt.signedPct(value);
        return formatNumber(value, fmt.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    };

    return (
        <section className="border-t border-line pt-5">
            <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-3 rounded-[8px] text-start outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span>
                    <span className="flex items-center gap-2"><span className="text-[14px] font-bold tracking-[-0.01em] text-foreground">{t('whatIf.title')}</span><Tag kind="scenario" /></span>
                    <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted-foreground">{t('whatIf.sub')}</span>
                </span>
                <ChevronDown className={`size-4 flex-none text-faint transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
            </button>

            {open && (
                <div className="mt-4 flex flex-col gap-4">
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
                        <div>
                            <p className="kicker mb-1.5">{t('whatIf.asset')}</p>
                            <AssetSearch value={asset} onChange={(next) => { setAsset(next); reset(); }} held={held} />
                        </div>
                        <label className="block">
                            <span className="kicker mb-1.5 block">{t('whatIf.amount')}</span>
                            <input
                                type="text"
                                inputMode="decimal"
                                value={amount}
                                onChange={(event) => { setAmount(event.target.value); reset(); }}
                                className="num h-10 w-full rounded-[10px] border border-line-strong bg-card px-3 text-[13.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            />
                        </label>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        <div role="radiogroup" aria-label={t('whatIf.title')} className="flex gap-1">
                            {(['add', 'reduce'] as const).map((option) => (
                                <button
                                    key={option}
                                    type="button"
                                    role="radio"
                                    aria-checked={mode === option}
                                    onClick={() => { setMode(option); reset(); }}
                                    className={`h-8 rounded-full px-3 text-[12.5px] font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${mode === option ? 'bg-brand-soft text-brand-ink' : 'text-muted-foreground hover:bg-hover hover:text-foreground'}`}
                                >
                                    {t(`whatIf.${option}`)}
                                </button>
                            ))}
                        </div>
                        <button type="button" className="btn btn-primary h-9 px-4 text-[13px]" onClick={run} disabled={running}>{running ? t('whatIf.running') : t('whatIf.run')}</button>
                        {mode === 'reduce' && <span className="text-[12px] text-faint">{t('whatIf.heldOnly')}</span>}
                    </div>

                    {problem && <p role="alert" className="text-[13px] text-down">{problem}</p>}

                    {result && (
                        <div aria-live="polite" className="flex flex-col gap-3">
                            <div className="overflow-x-auto rounded-[10px] border border-line">
                                <table className="data-table text-[13px]">
                                    <thead>
                                        <tr><th>{result.change.symbol}</th><th className="is-num">{t('whatIf.before')}</th><th aria-hidden /><th className="is-num">{t('whatIf.after')}</th></tr>
                                    </thead>
                                    <tbody>
                                        {metricRows(result.before, result.after, windowId).map((row) => {
                                            const way = direction(row.before, row.after);
                                            return (
                                                <tr key={row.key}>
                                                    <td className="!h-9">{t(`whatIf.metrics.${row.key}`)}</td>
                                                    <td className="is-num !h-9">{show(row.before, row.kind)}</td>
                                                    <td className="!h-9 text-faint" aria-hidden>{way && way !== 'same' ? <ArrowRight className="size-3.5" /> : null}</td>
                                                    <td className="is-num !h-9 font-bold text-foreground">{show(row.after, row.kind)}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            <div>
                                <p className="kicker">{t('whatIf.conflictsTitle')}</p>
                                {result.conflicts.length === 0 ? (
                                    <p className="mt-1 text-[13px] text-muted-foreground">{mode === 'add' ? t('whatIf.noConflicts') : '–'}</p>
                                ) : (
                                    <ul className="mt-1 flex flex-col gap-1.5">
                                        {result.conflicts.map((conflict) => <li key={conflict.filter} className="rounded-[10px] bg-brand-soft px-3 py-2 text-[13px] text-foreground">{conflict.detail}</li>)}
                                    </ul>
                                )}
                            </div>
                            <p className="text-[12px] text-faint">{t('whatIf.scenarioNote')}</p>
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}
