import { useTranslations } from 'next-intl';
import type { Level } from '@/lib/domain/types';
import type { XrayView } from '@/lib/services/portfolio-xray';
import { useFmt } from '../useFmt';
import { formatNumber } from '@/i18n/format';
import { sourceSummary, type AvailableWindow } from './logic';
import { useGapText } from './parts';

// What the figures are, over which period, and what they leave out. Always on screen: a result without its limits
// reads as more certain than it is.
export default function Limits({ view, window, level }: { view: XrayView; window: AvailableWindow | null; level: Level }) {
    const t = useTranslations('Xray');
    const fmt = useFmt();
    const coverage = window?.coverage;
    const gapText = useGapText();
    const providers = sourceSummary(view, window);

    return (
        <section className="border-t border-line pt-5 text-[12px] leading-relaxed text-faint">
            <h3 className="mb-1 text-[12px] font-bold uppercase tracking-[0.06em] text-muted-foreground">{t('limits.title')}</h3>
            <ul className="flex flex-col gap-0.5">
                {window && <li>{t('limits.period', { from: fmt.when(window.from), to: fmt.when(window.to), count: window.observations })}</li>}
                {window && <li>{t(`coverage.calendar.${window.calendar}`, { count: formatNumber(Math.round(window.periodsPerYear), fmt.locale) })}</li>}
                <li>{t('limits.scenario')}</li>
                <li>{t('limits.priceOnly')}</li>
                <li>{t('limits.currency')}</li>
                <li>{t('limits.notForecast')}</li>
                {coverage && coverage.gaps.length > 0 && <li className="text-down">{t('coverage.partial', { share: fmt.share(coverage.sharePct), gaps: coverage.gaps.map(gapText).join('; ') })}</li>}
                {/* with a window, a holding with no history is among its gaps above */}
                {!window && view.noHistory.length > 0 && <li className="text-down">{t('limits.noHistory', { list: view.noHistory.join(', ') })}</li>}
                {view.unpriced.length > 0 && <li className="text-down">{t('limits.unpriced', { list: view.unpriced.join(', ') })}</li>}
                <li>{t('limits.computed', { when: fmt.when(view.computedAt) })}</li>
                {providers.length > 0 && <li>{t('coverage.sources', { list: providers.join(', ') })}</li>}
            </ul>
            {/* Every level can see each series used; the method text is for Experts */}
            <div className="mt-3 flex flex-col gap-3">
                {level === 'Expert' && (
                    <div>
                        <p className="font-semibold text-muted-foreground">{t('limits.methodLabel')}</p>
                        <p className="mono mt-0.5 text-[11px]">{view.method}</p>
                    </div>
                )}
                {view.sources.length > 0 && (
                    <div>
                        <p className="font-semibold text-muted-foreground">{t('limits.sourcesLabel')}</p>
                        <ul className="mono mt-0.5 flex flex-col gap-0.5 text-[11px]">
                            {view.sources.map((source) => <li key={source.value}>{source.value} · {fmt.sourceLine(source)}</li>)}
                        </ul>
                    </div>
                )}
            </div>
        </section>
    );
}
