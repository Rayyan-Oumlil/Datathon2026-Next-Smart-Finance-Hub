import { useTranslations } from 'next-intl';
import type { Level } from '@/lib/domain/types';
import type { XrayView } from '@/lib/services/portfolio-xray';
import { useFmt } from '../useFmt';
import type { AvailableWindow } from './logic';

// What the figures are, over which period, and what they leave out. Always on screen: a result without its limits
// reads as more certain than it is.
export default function Limits({ view, window, level }: { view: XrayView; window: AvailableWindow | null; level: Level }) {
    const t = useTranslations('Xray');
    const fmt = useFmt();
    const coverage = window?.coverage;

    return (
        <section className="border-t border-line pt-5 text-[12px] leading-relaxed text-faint">
            <h3 className="mb-1 text-[12px] font-bold uppercase tracking-[0.06em] text-muted-foreground">{t('limits.title')}</h3>
            <ul className="flex flex-col gap-0.5">
                {window && <li>{t('limits.period', { from: fmt.when(window.from), to: fmt.when(window.to), count: window.observations })}</li>}
                <li>{t('limits.scenario')}</li>
                <li>{t('limits.priceOnly')}</li>
                <li>{t('limits.currency')}</li>
                <li>{t('limits.notForecast')}</li>
                {coverage && coverage.excluded.length > 0 && <li className="text-down">{t('limits.coverage', { share: fmt.share(coverage.sharePct), list: coverage.excluded.join(', ') })}</li>}
                {view.noHistory.length > 0 && <li className="text-down">{t('limits.noHistory', { list: view.noHistory.join(', ') })}</li>}
                {view.unpriced.length > 0 && <li className="text-down">{t('limits.unpriced', { list: view.unpriced.join(', ') })}</li>}
                <li>{t('limits.computed', { when: fmt.when(view.computedAt) })}</li>
            </ul>
            {level === 'Expert' && (
                <div className="mt-3 flex flex-col gap-3">
                    <div>
                        <p className="font-semibold text-muted-foreground">{t('limits.methodLabel')}</p>
                        <p className="mono mt-0.5 text-[11px]">{view.method}</p>
                    </div>
                    <div>
                        <p className="font-semibold text-muted-foreground">{t('limits.sourcesLabel')}</p>
                        <ul className="mono mt-0.5 flex flex-col gap-0.5 text-[11px]">
                            {view.sources.map((source) => <li key={source.value}>{source.value} · {fmt.sourceLine(source)}</li>)}
                        </ul>
                    </div>
                </div>
            )}
        </section>
    );
}
