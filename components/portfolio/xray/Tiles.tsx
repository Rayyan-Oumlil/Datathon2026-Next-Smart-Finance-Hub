import { useTranslations } from 'next-intl';
import type { Level } from '@/lib/domain/types';
import type { XrayView } from '@/lib/services/portfolio-xray';
import { formatNumber } from '@/i18n/format';
import { useFmt } from '../useFmt';
import type { AvailableWindow } from './logic';
import { Tag } from './parts';

type StatProps = { label: string; value: string; sub?: string; tag: 'fact' | 'scenario' };

const Stat = ({ label, value, sub, tag }: StatProps) => (
    <div className="min-w-0">
        <dt className="kicker flex items-center gap-1.5">{label}<Tag kind={tag} /></dt>
        <dd className="num mt-1 text-[24px] font-bold leading-tight tracking-[-0.03em] text-foreground">{value}</dd>
        {sub && <dd className="mt-0.5 text-[12px] text-faint">{sub}</dd>}
    </div>
);

type Props = { view: XrayView; window: AvailableWindow; level: Level };

// The four headline figures. The first two describe the portfolio as it is (facts); the last two come from the replay
// of the period on screen (a scenario). A Novice reads the same figures in plainer words.
export default function Tiles({ view, window, level }: Props) {
    const t = useTranslations('Xray');
    const fmt = useFmt();
    const novice = level === 'Novice';
    const { topHolding, effectiveHoldings } = view.concentration;
    const oneDecimal = (value: number) => formatNumber(value, fmt.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const key = (name: string) => (novice ? `tiles.${name}Novice` : `tiles.${name}`);
    const dd = window.maxDrawdown;

    return (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
            <Stat
                tag="fact"
                label={t(key('largest'))}
                value={topHolding ? fmt.share(topHolding.sharePct) : t('tiles.notAvailable')}
                sub={topHolding?.symbol}
            />
            <Stat
                tag="fact"
                label={t(key('effective'))}
                value={effectiveHoldings === null ? t('tiles.notAvailable') : oneDecimal(effectiveHoldings)}
                sub={effectiveHoldings === null ? undefined : novice
                    ? t('tiles.effectiveSubNovice', { count: Math.round(effectiveHoldings) })
                    : t('tiles.effectiveSub', { count: view.holdings.length })}
            />
            <Stat
                tag="scenario"
                label={t(key('volatility'))}
                value={fmt.share(window.volatilityPct)}
                sub={novice ? t('tiles.volatilitySubNovice') : t('tiles.volatilitySub')}
            />
            <Stat
                tag="scenario"
                label={t(key('worstFall'))}
                value={dd.pct === 0 ? fmt.share(0) : fmt.signedPct(dd.pct)}
                sub={dd.pct === 0 ? undefined : t('tiles.worstFallSub', { peak: fmt.when(dd.peakDate), trough: fmt.when(dd.troughDate) })}
            />
        </dl>
    );
}
