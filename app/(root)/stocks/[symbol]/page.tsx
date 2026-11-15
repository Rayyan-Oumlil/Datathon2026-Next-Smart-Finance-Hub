import { Suspense } from "react";
import Link from "next/link";
import { CandlestickChart } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import TradingViewWidget from "@/components/TradingViewWidget";
import StockHeader, { StockHeaderSkeleton } from "@/components/stocks/StockHeader";
import StockSentimentCard from "@/components/stocks/StockSentimentCard";
import StockChart from "@/components/stocks/StockChart";
import Panel from "@/components/Panel";
import {
    COMPANY_PROFILE_WIDGET_CONFIG,
    COMPANY_FINANCIALS_WIDGET_CONFIG,
} from "@/lib/constants";
import { getStockSentimentInsights } from '@/lib/actions/adanos.actions';
import { getStockMetrics } from '@/lib/actions/finnhub.actions';
import { hasFinnhubCompanyData } from '@/lib/markets';
import { getEntry } from '@/lib/universe';
import { signalsFor } from '@/lib/services/quotes';
import type { UniverseEntry } from '@/lib/domain/types';
import { formatSymbolForTradingView, isChartEmbeddable, tradingViewSymbolUrl } from '@/lib/utils';
import { formatNumber, formatPercent } from '@/i18n/format';
import { formatMoment, sourceLabel } from '@/components/agent/time';

const scriptUrl = `https://s3.tradingview.com/external-embedding/embed-widget-`;

async function Sentiment({ symbol }: { symbol: string }) {
    const [insight, t, te] = await Promise.all([getStockSentimentInsights(symbol), getTranslations('StockPage'), getTranslations('StockExtra.page')]);
    if (!insight) return null;
    return (
        // Display only: this card never feeds a filter, a score or the agent
        <Panel title={t('sentimentTitle')} sub={te('sentimentSubFull', { sub: t('sentimentSub') })}>
            <StockSentimentCard insight={insight} />
        </Panel>
    );
}

async function DividendYield({ symbol }: { symbol: string }) {
    // Outside the US we can't tell "no dividend" from "no data", so show nothing rather than a misleading dash
    if (!hasFinnhubCompanyData(symbol)) return null;
    const [dividendYield, t, te, locale] = await Promise.all([getStockMetrics(symbol), getTranslations('StockPage'), getTranslations('StockExtra.page'), getLocale()]);
    return (
        <Panel title={t('dividendYieldTitle')}>
            <p className="text-2xl font-semibold text-foreground">
                {dividendYield !== null ? formatPercent(dividendYield, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
            </p>
            <p className="mt-2 text-[12px] text-faint">{te('dividendSource')}</p>
        </Panel>
    );
}

// Crypto, gold and bond yields are not Finnhub company tickers: a bare "GOLD" or "BTC" there is an unrelated listing.
async function ReferencePage({ entry }: { entry: UniverseEntry }) {
    const [te, locale] = await Promise.all([getTranslations('StockExtra.page'), getLocale()]);
    let price: Awaited<ReturnType<typeof signalsFor>>['signals']['price'];
    try {
        price = (await signalsFor(entry)).signals.price;
    } catch {
        price = undefined;
    }
    const isYield = entry.assetClass === 'bond_yield';
    return (
        <section className="hatch">
            <div className="card flex flex-col gap-3 p-4">
                <div className="min-w-0">
                    <h1 className="text-xl font-bold tracking-[-0.03em]">{entry.name}</h1>
                    <p className="mono text-[12.5px] text-faint">{entry.symbol} · {te(`referenceKind.${entry.assetClass as 'crypto' | 'gold' | 'bond_yield'}`)}</p>
                </div>
                <p className="text-[13.5px] text-muted-foreground">
                    {te('referenceBody')}
                </p>
                <div>
                    <p className="kicker">{isYield ? te('yield') : te('price')}</p>
                    {price ? (
                        <>
                            <p className="num mt-1 text-2xl font-bold tracking-[-0.03em]">
                                {price.unit === '%'
                                    ? formatPercent(price.value, locale, { maximumFractionDigits: 6 })
                                    : `${formatNumber(price.value, locale, { maximumFractionDigits: 6 })} ${price.currency ?? price.unit ?? ''}`.trimEnd()}
                            </p>
                            <p className="mt-1 text-[12px] text-faint">
                                {price.asOf
                                    ? te('sourceFetchedAsOf', { source: sourceLabel(te, price.source), fetched: formatMoment(price.fetchedAt, locale) || price.fetchedAt, asOf: formatMoment(price.asOf, locale) || price.asOf })
                                    : te('sourceFetched', { source: sourceLabel(te, price.source), fetched: formatMoment(price.fetchedAt, locale) || price.fetchedAt })}
                            </p>
                        </>
                    ) : (
                        <p className="mt-1 text-[15px] text-faint">{te('notAvailable')}</p>
                    )}
                </div>
                <Link href="/overview" className="btn btn-ghost self-start">{te('backToOverview')}</Link>
            </div>
        </section>
    );
}

// Charts come straight from TradingView (live, no quota); only the header waits on Finnhub, and it streams.
export default async function StockDetails({ params }: StockDetailsPageProps) {
    const { symbol: rawSymbol } = await params;
    const symbol = decodeURIComponent(rawSymbol).toUpperCase();
    const entry = getEntry(symbol);
    if (entry && (entry.assetClass === 'crypto' || entry.assetClass === 'gold' || entry.assetClass === 'bond_yield')) {
        return <ReferencePage entry={entry} />;
    }
    // A symbol outside the universe still gets its page (TradingView chart and whatever data answers): a quote
    // failure (rate limit, network) cannot tell an unknown ticker from a provider hiccup, so it never means 404.
    const tvSymbol = formatSymbolForTradingView(symbol);
    const [t, locale] = await Promise.all([getTranslations('StockPage'), getLocale()]);

    return (
        <>
            <Suspense fallback={<StockHeaderSkeleton />}>
                <StockHeader symbol={symbol} />
            </Suspense>

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
                <div className="flex min-w-0 flex-col gap-3">
                    {isChartEmbeddable(tvSymbol) ? (
                        <StockChart tvSymbol={tvSymbol} scriptUrl={`${scriptUrl}advanced-chart.js`} />
                    ) : (
                        // TradingView refuses this exchange's chart in embeds; say so instead of showing its error
                        <Panel title={t('chartTitle')} sub={t('chartUnavailableSub')}>
                            <div className="empty-state py-14">
                                <span className="empty-icon"><CandlestickChart className="size-5" /></span>
                                <h3>{t('chartUnavailableTitle')}</h3>
                                <p className="max-w-80 text-[13px]">
                                    {t('chartUnavailableBody', { exchange: tvSymbol.split(':')[0] })}
                                </p>
                                <a href={tradingViewSymbolUrl(tvSymbol)} target="_blank" rel="noopener noreferrer" className="btn btn-ghost mt-2">
                                    {t('openOnTradingView')}
                                </a>
                            </div>
                        </Panel>
                    )}
                    <Panel title={t('financialsTitle')} sub={t('financialsSub')}>
                        <TradingViewWidget
                            scriptUrl={`${scriptUrl}financials.js`}
                            config={COMPANY_FINANCIALS_WIDGET_CONFIG(tvSymbol, locale)}
                            height={500}
                        />
                    </Panel>
                </div>

                <div className="flex min-w-0 flex-col gap-3">
                    <Suspense fallback={null}>
                        <Sentiment symbol={symbol} />
                    </Suspense>
                    <Suspense fallback={null}>
                        <DividendYield symbol={symbol} />
                    </Suspense>
                    <Panel title={t('profileTitle')} sub={t('profileSub')}>
                        <TradingViewWidget
                            scriptUrl={`${scriptUrl}symbol-profile.js`}
                            config={COMPANY_PROFILE_WIDGET_CONFIG(tvSymbol, locale)}
                            height={440}
                        />
                    </Panel>
                </div>
            </div>
        </>
    );
}
