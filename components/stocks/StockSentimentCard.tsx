import { useLocale, useTranslations, type Messages } from 'next-intl';
import type { StockSentimentInsights } from '@/lib/actions/adanos.helpers';
import { cn } from '@/lib/utils';
import { toMessageKey } from '@/i18n/config';
import { formatNumber, formatPercent } from '@/i18n/format';

interface StockSentimentCardProps {
    insight: StockSentimentInsights | null;
}

const ONE_DECIMAL: Intl.NumberFormatOptions = { minimumFractionDigits: 1, maximumFractionDigits: 1 };

type AlignmentKey = keyof Messages['StockSentiment']['alignment'];
type MetricKey = keyof Messages['StockSentiment']['metric'];

const TREND_CLASS: Record<string, string> = {
    rising: 'is-up',
    falling: 'is-down',
    stable: '',
};

function getAlignmentClass(alignment: string): string {
    if (alignment === 'Bullish alignment') return 'text-up';
    if (alignment === 'Bearish alignment' || alignment === 'Wide divergence') return 'text-down';
    if (alignment === 'Mixed') return 'text-warn';
    return 'text-muted-foreground';
}

export default function StockSentimentCard({ insight }: StockSentimentCardProps) {
    const t = useTranslations('StockSentiment');
    const te = useTranslations('StockExtra');
    const locale = useLocale();
    const score = (value: number | null) => (value === null ? '—' : formatNumber(value, locale, ONE_DECIMAL));
    if (!insight) {
        return null;
    }

    const summary = [
        { label: t('avgBuzz'), value: insight.averageBuzz === null ? '—' : te('sentiment.outOf100', { value: score(insight.averageBuzz) }) },
        { label: t('bullishAvg'), value: insight.bullishAverage === null ? '—' : formatPercent(insight.bullishAverage, locale, ONE_DECIMAL) },
        { label: t('coverage'), value: t('coverageValue', { count: formatNumber(insight.availableSources, locale), total: formatNumber(4, locale) }) },
    ];

    return (
        <div className="flex flex-col">
            <div className="grid grid-cols-3 gap-2 p-3">
                {summary.map(({ label, value }) => (
                    <div key={label} className="min-w-0">
                        <p className="kicker">{label}</p>
                        <p className="num mt-1 truncate font-bold text-foreground">{value}</p>
                    </div>
                ))}
            </div>
            <p className="border-t border-line px-3 py-2.5 text-[12.5px] text-faint">
                {t.rich('sourceAlignment', {
                    // Alignment text comes from lib/actions/adanos.helpers ("Bullish alignment" -> alignment.bullishAlignment)
                    alignment: t(`alignment.${toMessageKey(insight.sourceAlignment) as AlignmentKey}`),
                    value: (chunks) => <span className={cn('font-semibold', getAlignmentClass(insight.sourceAlignment))}>{chunks}</span>,
                })}
            </p>

            <ul className="row-list border-t border-line">
                {insight.sources.map((source) => (
                    <li key={source.source} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-2.5">
                        <div className="min-w-0">
                            <p className="truncate font-semibold text-foreground">{source.source === 'news' ? t('newsSource') : source.label}</p>
                            <p className="num truncate text-[12px] text-faint">
                                {t(`metric.${toMessageKey(source.metricLabel) as MetricKey}`, { value: formatNumber(source.metricValue, locale, { notation: 'compact', maximumFractionDigits: 1 }), count: source.metricValue })}
                            </p>
                        </div>
                        <div className="num text-end text-[12.5px]">
                            <p className="font-semibold text-foreground">{score(source.buzzScore)}</p>
                            <p className="text-faint">{t('buzz')}</p>
                        </div>
                        <span className={cn('pill w-[74px] justify-center capitalize', TREND_CLASS[source.trend ?? ''])}>
                            {source.bullishPct !== null ? t('bullPct', { pct: formatNumber(source.bullishPct, locale, { maximumFractionDigits: 0 }) }) : (source.trend ? t(`trend.${source.trend}`) : t('noTrend'))}
                        </span>
                    </li>
                ))}
            </ul>
            <p className="border-t border-line px-3 py-2.5 text-[12px] text-faint">
                {te('sentiment.footer')}
            </p>
        </div>
    );
}
