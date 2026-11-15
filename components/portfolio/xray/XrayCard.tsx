'use client';

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Panel from '@/components/Panel';
import { useFmt } from '../useFmt';
import { isAvailable, leadRow, pickWindow, sourceSummary } from './logic';
import { CoverageLine } from './parts';
import { useXray } from './useXray';

const W = 240;
const H = 56;

// The Portfolio tab's X-ray module: three figures with their period, coverage, time and sources, the one finding that
// matters, and a way into the full page.
// The whole analysis lives on its own page (/portfolio/xray), so this tab stays light.
export default function XrayCard({ refreshKey }: { refreshKey: number }) {
    const t = useTranslations('Xray');
    const fmt = useFmt();
    const { view, error, load } = useXray(refreshKey);

    const open = (
        <Link href="/portfolio/xray" className="btn btn-primary h-8 px-3 text-[13px]" title={t('card.hint')}>
            {t('card.open')} <ArrowUpRight />
        </Link>
    );
    const header = { title: t('title'), sub: t('sub'), action: open };

    if (error && !view) {
        return (
            <Panel {...header} bodyClassName="p-4">
                <div role="alert" className="flex flex-wrap items-center justify-between gap-3 text-[13.5px] text-down">
                    <span>{t('states.error', { error: fmt.error(error.failure) })}</span>
                    <button type="button" className="btn btn-ghost h-8 px-3 text-[13px]" onClick={load}>{t('states.retry')}</button>
                </div>
            </Panel>
        );
    }
    if (!view) {
        return <Panel {...header} bodyClassName="p-5"><div className="xray-shimmer h-16 rounded-[10px]" aria-busy="true" aria-label={t('states.loading')} /></Panel>;
    }
    if (view.holdings.length === 0 && view.unpriced.length === 0) {
        return <Panel {...header} bodyClassName="p-4"><div className="empty-state"><h3>{t('states.emptyTitle')}</h3><p className="max-w-md text-[13px]">{t('states.empty')}</p></div></Panel>;
    }

    const window = view.windows[pickWindow(view.windows, 'full')];
    const lead = isAvailable(window) ? leadRow(window) : null;
    const top = view.concentration.topHolding;
    const sources = sourceSummary(view, isAvailable(window) ? window : null);
    const points = isAvailable(window) ? window.curve : [];
    const min = Math.min(...points.map((p) => p.value));
    const max = Math.max(...points.map((p) => p.value));
    const line = points.map((p, i) => `${((i / (points.length - 1)) * W).toFixed(1)},${(H - ((p.value - min) / (max - min || 1)) * H).toFixed(1)}`).join(' ');

    return (
        <Panel className="[&>.section-head]:flex-wrap" {...header} bodyClassName="p-5">
            <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
                <dl className="flex flex-wrap gap-x-8 gap-y-3">
                    <div>
                        <dt className="kicker">{t('tiles.largest')}</dt>
                        <dd className="num mt-0.5 text-[22px] font-bold tracking-[-0.03em] text-foreground">{top ? fmt.share(top.sharePct) : '–'}</dd>
                        {top && <dd className="text-[12px] text-faint">{top.symbol}</dd>}
                    </div>
                    {isAvailable(window) && (
                        <>
                            <div>
                                <dt className="kicker">{t('tiles.volatility')}</dt>
                                <dd className="num mt-0.5 text-[22px] font-bold tracking-[-0.03em] text-foreground">{fmt.share(window.volatilityPct)}</dd>
                                <dd className="text-[12px] text-faint">{t('labels.scenario')}</dd>
                            </div>
                            <div>
                                <dt className="kicker">{t('tiles.worstFall')}</dt>
                                <dd className="num mt-0.5 text-[22px] font-bold tracking-[-0.03em] text-foreground">{window.maxDrawdown.pct === 0 ? fmt.share(0) : fmt.signedPct(window.maxDrawdown.pct)}</dd>
                                <dd className="text-[12px] text-faint">{t('labels.scenario')}</dd>
                            </div>
                        </>
                    )}
                </dl>
                {points.length > 1 && (
                    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="max-w-full flex-none overflow-visible" role="img" aria-label={isAvailable(window) ? t('card.moves', { from: fmt.when(window.from), to: fmt.when(window.to) }) : undefined}>
                        <polyline points={line} fill="none" stroke="var(--brand)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                    </svg>
                )}
            </div>
            {/* Every level sees what the figures cover, when they were computed and where the closes come from */}
            <div className="mt-3 flex flex-col gap-0.5">
                {isAvailable(window) && <CoverageLine window={window} />}
                <p className="text-[12px] leading-relaxed text-faint">
                    {t('coverage.computed', { when: fmt.when(view.computedAt) })}
                    {sources.length > 0 && <> · {t('coverage.sources', { list: sources.join(', ') })}</>}
                </p>
            </div>
            <p className="mt-4 rounded-[10px] bg-brand-soft px-3 py-2 text-[13.5px] text-foreground">
                {lead && lead.riskSharePct !== null
                    ? t('card.finding', { symbol: lead.symbol, value: fmt.share(lead.weightPct), risk: fmt.share(lead.riskSharePct) })
                    : t('card.spread')}
            </p>
        </Panel>
    );
}
