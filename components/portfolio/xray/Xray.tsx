'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { WindowId } from '@/lib/xray/types';
import { useFmt } from '../useFmt';
import BandBar from './BandBar';
import Exposure from './Exposure';
import Limits from './Limits';
import MoveChart from './MoveChart';
import Tiles from './Tiles';
import Together from './Together';
import ValueVsRisk from './ValueVsRisk';
import Observations from './Observations';
import WhatIf, { type Preset } from './WhatIf';
import { isAvailable, pickWindow } from './logic';
import { Rise } from './parts';
import { useLevel, useXray } from './useXray';

// Shortest first, as a period picker reads
const WINDOWS: WindowId[] = ['last1y', 'last3y', 'full'];

const Card = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
    <div className="hatch"><div className={`card p-5 ${className}`}>{children}</div></div>
);

// The full X-ray, opened from the Portfolio tab in its own tab. Sections rise in one after another; the period
// buttons switch every figure and the chart at once; the what-if lab on the side re-runs as the amount is dragged.
export default function XrayPage() {
    const t = useTranslations('Xray');
    const fmt = useFmt();
    const level = useLevel();
    const { view, error, load } = useXray();
    const [wanted, setWanted] = useState<WindowId>('full');
    const [preset, setPreset] = useState<Preset | null>(null);

    const head = (picker?: React.ReactNode) => (
        <header className="page-head flex-wrap">
            <div>
                <Link href="/portfolio" className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />{t('page.back')}</Link>
                <h1 className="page-title">{t('page.title')} <span className="pill is-brand ms-1 align-middle">{t('simulated')}</span></h1>
                <p className="page-sub">{t('sub')}</p>
            </div>
            {picker}
        </header>
    );

    if (error && !view) {
        return (
            <>
                {head()}
                <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line bg-card px-4 py-3 text-[13.5px] text-down">
                    <span>{t('states.error', { error: fmt.error(error.failure) })}</span>
                    <button type="button" className="btn btn-ghost h-8 px-3 text-[13px]" onClick={load}>{t('states.retry')}</button>
                </div>
            </>
        );
    }
    if (!view) {
        return (
            <>
                {head()}
                <div className="flex flex-col gap-4" aria-busy="true" aria-label={t('page.loading')}>
                    <p className="text-[13.5px] text-faint">{t('page.loading')}</p>
                    {[84, 132, 192].map((h) => <div key={h} className="xray-shimmer rounded-[14px]" style={{ height: h }} />)}
                </div>
            </>
        );
    }
    if (view.holdings.length === 0 && view.unpriced.length === 0) {
        return <>{head()}<Card><div className="empty-state"><h3>{t('states.emptyTitle')}</h3><p className="max-w-md text-[13px]">{t('states.empty')}</p></div></Card></>;
    }

    const id = pickWindow(view.windows, wanted);
    const current = view.windows[id];
    const picker = (
        <div role="radiogroup" aria-label={t('window.label')} className="flex flex-none flex-wrap gap-1 self-end">
            {WINDOWS.map((option) => (
                <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={id === option}
                    onClick={() => setWanted(option)}
                    className={`h-8 rounded-full px-3 text-[12.5px] font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${id === option ? 'bg-brand-soft text-brand-ink' : 'text-muted-foreground hover:bg-hover hover:text-foreground'}`}
                >
                    {t(`window.${option}`)}
                </button>
            ))}
        </div>
    );

    return (
        <>
            {head(picker)}
            <Rise index={0} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-faint">
                {isAvailable(current) && <span>{t('window.range', { from: fmt.when(current.from), to: fmt.when(current.to) })}</span>}
                <span><span className="font-semibold text-muted-foreground">{t('scope.measured')}:</span> {t('scope.market')} · {t('scope.concentration')} · {t('scope.currency')}</span>
                <span><span className="font-semibold text-muted-foreground">{t('scope.notMeasured')}:</span> {t('scope.credit')} · {t('scope.liquidity')} · {t('scope.rates')}</span>
            </Rise>

            {isAvailable(current) ? (
                <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
                    {/* key: switching the period replays the motion with the new figures; the lab beside it keeps its state */}
                    <div key={id} className="flex min-w-0 flex-col gap-5">
                        <Rise index={1}><Card><Tiles view={view} window={current} level={level} /></Card></Rise>
                        <Rise index={2}><Card><Observations view={view} window={current} onTest={(test) => setPreset({ ...test, nonce: Date.now() })} /></Card></Rise>
                        <Rise index={3}><Card className="flex flex-col gap-5">
                            {view.band && <BandBar band={view.band} window={current} />}
                            <ValueVsRisk window={current} level={level} />
                        </Card></Rise>
                        <Rise index={4}><Card><MoveChart view={view} window={current} level={level} /></Card></Rise>
                        {level !== 'Novice' && <Rise index={5}><Card className="grid gap-6 md:grid-cols-2 [&>section]:border-t-0 [&>section]:pt-0"><Together window={current} /><Exposure view={view} /></Card></Rise>}
                    </div>
                    <Rise index={2} className="lg:sticky lg:top-4">
                        <Card><WhatIf view={view} windowId={id} preset={preset} /></Card>
                    </Rise>
                    <Rise index={6} className="lg:col-span-2"><Card><Limits view={view} window={current} level={level} /></Card></Rise>
                </div>
            ) : (
                <div className="flex flex-col gap-5">
                    <Card><p className="text-[13.5px] text-muted-foreground">{t(current.reason === 'no_holdings' ? 'window.noHoldings' : 'window.unavailable')}</p></Card>
                    <Card><Exposure view={view} /></Card>
                    <Card><Limits view={view} window={null} level={level} /></Card>
                </div>
            )}
        </>
    );
}
