'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Level } from '@/lib/domain/types';
import type { XrayView } from '@/lib/services/portfolio-xray';
import type { WindowId } from '@/lib/xray/types';
import Panel from '@/components/Panel';
import { api } from '../logic';
import { useFmt } from '../useFmt';
import BandBar from './BandBar';
import Exposure from './Exposure';
import Limits from './Limits';
import MoveChart from './MoveChart';
import Tiles from './Tiles';
import Together from './Together';
import ValueVsRisk from './ValueVsRisk';
import WhatIf from './WhatIf';
import { isAvailable, pickWindow } from './logic';

const WINDOWS: WindowId[] = ['full', 'y2022', 'last12m'];

// The Portfolio tab's X-ray: how the simulated holdings are spread and how this mix would have moved in past periods.
// Loads on its own, so a slow history provider never holds up the rest of the tab.
export default function Xray({ level, refreshKey }: { level: Level; refreshKey: number }) {
    const t = useTranslations('Xray');
    const fmt = useFmt();
    const [view, setView] = useState<XrayView | null>(null);
    const [error, setError] = useState<{ failure: unknown } | null>(null);
    const [wanted, setWanted] = useState<WindowId>('full');

    const load = useCallback(async () => {
        try {
            setView(await api<XrayView>('/api/portfolio/xray'));
            setError(null);
        } catch (failure) {
            setError({ failure });
        }
    }, []);

    useEffect(() => { load(); }, [load, refreshKey]);

    const header = (action?: React.ReactNode) => ({ title: t('title'), sub: t('sub'), action });

    if (error && !view) {
        return (
            <Panel {...header()} bodyClassName="p-4">
                <div role="alert" className="flex flex-wrap items-center justify-between gap-3 text-[13.5px] text-down">
                    <span>{t('states.error', { error: fmt.error(error.failure) })}</span>
                    <button type="button" className="btn btn-ghost h-8 px-3 text-[13px]" onClick={load}>{t('states.retry')}</button>
                </div>
            </Panel>
        );
    }
    if (!view) {
        return <Panel {...header()} bodyClassName="p-5"><p className="text-[13.5px] text-faint" aria-busy="true">{t('states.loading')}</p></Panel>;
    }
    if (view.holdings.length === 0 && view.unpriced.length === 0) {
        return (
            <Panel {...header()} bodyClassName="p-4">
                <div className="empty-state"><h3>{t('states.emptyTitle')}</h3><p className="max-w-md text-[13px]">{t('states.empty')}</p></div>
            </Panel>
        );
    }

    const id = pickWindow(view.windows, wanted);
    const current = view.windows[id];
    const picker = (
        <div role="radiogroup" aria-label={t('window.label')} className="flex flex-none flex-wrap gap-1">
            {WINDOWS.map((option) => (
                <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={id === option}
                    onClick={() => setWanted(option)}
                    className={`h-7 rounded-full px-2.5 text-[12px] font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${id === option ? 'bg-brand-soft text-brand-ink' : 'text-muted-foreground hover:bg-hover hover:text-foreground'}`}
                >
                    {t(`window.${option}`)}
                </button>
            ))}
        </div>
    );

    return (
        <Panel className="[&>.section-head]:flex-wrap" {...header(picker)} bodyClassName="p-5">
            <div className="flex flex-col gap-5">
                <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-faint">
                    <span className="pill is-brand">{t('simulated')}</span>
                    {isAvailable(current) && <span>{t('window.range', { from: fmt.when(current.from), to: fmt.when(current.to) })}</span>}
                    <span><span className="font-semibold text-muted-foreground">{t('scope.measured')}:</span> {t('scope.market')} · {t('scope.concentration')} · {t('scope.currency')}</span>
                    <span><span className="font-semibold text-muted-foreground">{t('scope.notMeasured')}:</span> {t('scope.credit')} · {t('scope.liquidity')} · {t('scope.rates')}</span>
                </p>

                {isAvailable(current) ? (
                    <>
                        <Tiles view={view} window={current} level={level} />
                        {view.band && <BandBar band={view.band} window={current} />}
                        <ValueVsRisk window={current} level={level} />
                        <MoveChart view={view} window={current} level={level} />
                        {level !== 'Novice' && <Together window={current} />}
                        {level !== 'Novice' && <Exposure view={view} />}
                        <WhatIf view={view} windowId={id} />
                        <Limits view={view} window={current} level={level} />
                    </>
                ) : (
                    <>
                        <p className="text-[13.5px] text-muted-foreground">{t(current.reason === 'no_holdings' ? 'window.noHoldings' : 'window.unavailable')}</p>
                        <Exposure view={view} />
                        <Limits view={view} window={null} level={level} />
                    </>
                )}
            </div>
        </Panel>
    );
}
