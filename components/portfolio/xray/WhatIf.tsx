'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { formatNumber } from '@/i18n/format';
import type { XrayView, XrayWhatIf } from '@/lib/services/portfolio-xray';
import type { WindowId } from '@/lib/xray/types';
import { api } from '../logic';
import { useFmt } from '../useFmt';
import AssetSearch, { type Asset } from './AssetSearch';
import { metricRows, type MetricRow } from './logic';
import { Tag } from './parts';

type Props = { view: XrayView; windowId: WindowId };

const RUN_DELAY_MS = 650;

// A hypothetical change, run through the same engine as the X-ray: pick an asset, drag the amount, and the before and
// after update by themselves. Read-only: nothing is traded or saved.
export default function WhatIf({ view, windowId }: Props) {
    const t = useTranslations('Xray');
    const fmt = useFmt();
    const [asset, setAsset] = useState<Asset | null>(null);
    const [amount, setAmount] = useState(0);
    const [mode, setMode] = useState<'add' | 'reduce'>('add');
    const [running, setRunning] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const [result, setResult] = useState<XrayWhatIf | null>(null);
    const latest = useRef(0);

    const held = view.holdings.map((h) => ({ symbol: h.symbol, name: h.name }));
    // The most the slider can reach: all the cash for an addition, the whole position for a reduction
    const heldValue = view.holdings.find((h) => h.symbol === asset?.symbol)?.valueCad ?? 0;
    const max = Math.floor(mode === 'add' ? view.cashCad : heldValue);
    const step = Math.max(1, Math.round(max / 200));

    // A new asset or direction starts from a fresh amount inside the new range
    useEffect(() => {
        setAmount((current) => (max > 0 ? Math.min(current || Math.round(max / 4), max) : 0));
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

    const show = (value: number | null, kind: MetricRow['kind']) => {
        if (value === null) return t('tiles.notAvailable');
        if (kind === 'share') return fmt.share(value);
        if (kind === 'signed') return value === 0 ? fmt.share(0) : fmt.signedPct(value);
        return formatNumber(value, fmt.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    };

    return (
        <section aria-labelledby="xray-lab-title" className="flex flex-col gap-4">
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

            {problem && <p role="alert" className="text-[13px] text-down">{problem}</p>}

            {result && (
                <div aria-live="polite" aria-busy={running} className={`flex flex-col gap-3 transition-opacity ${running ? 'opacity-60' : ''}`}>
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
            {!asset && <p className="text-[12.5px] text-faint">{t('whatIf.pickFirst')}</p>}
        </section>
    );
}
