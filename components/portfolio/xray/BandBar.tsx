import { useTranslations } from 'next-intl';
import type { XrayView } from '@/lib/services/portfolio-xray';
import { useFmt } from '../useFmt';
import { bandStatus, bandTrack, type AvailableWindow } from './logic';
import { GrowBar, Section } from './parts';

// The replay's volatility on a track, with the limit of the user's risk profile marked on it. Words say the same
// thing as the bar: colour is never the only signal.
export default function BandBar({ band, window }: { band: NonNullable<XrayView['band']>; window: AvailableWindow }) {
    const t = useTranslations('Xray');
    const fmt = useFmt();
    const status = bandStatus(window.volatilityPct, band.volatilityLimitPct);
    const { volatilityAt, limitAt } = bandTrack(window.volatilityPct, band.volatilityLimitPct);

    return (
        <Section title={t('band.title')} tag="assumption">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[13px]">
                <p className="num text-foreground">
                    <span className="font-bold">{fmt.share(window.volatilityPct)}</span>
                    <span className="text-muted-foreground"> · {t('band.limit', { risk: t(`band.risk.${band.risk}`), limit: fmt.share(band.volatilityLimitPct) })}</span>
                </p>
                <p className={`pill ${status === 'within' ? 'is-up' : 'is-down'}`}>{t(`band.${status}`)}</p>
            </div>
            <div className="relative mt-3 h-2 rounded-full bg-hover" role="img" aria-label={`${fmt.share(window.volatilityPct)} / ${fmt.share(band.volatilityLimitPct)}`}>
                <GrowBar value={volatilityAt} className={status === 'within' ? 'bg-brand' : 'bg-down'} />
                <span className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 rounded bg-foreground" style={{ left: `${limitAt}%` }} aria-hidden />
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-faint">{t('band.note')}</p>
        </Section>
    );
}
