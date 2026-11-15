import { Suspense } from "react";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import type { Messages } from "next-intl";
import TradingViewWidget from "@/components/TradingViewWidget";
import Panel from "@/components/Panel";
import IndexPulse, { PulseSkeleton } from "@/components/IndexPulse";
import { LocalizedDataFreshness } from "@/components/DataFreshness";
import MarketSwitcher from "@/components/MarketSwitcher";
import SmartWatchlist from "@/components/watchlist/SmartWatchlist";
import type { WatchlistRulesView } from "@/components/watchlist/format";
import { RULES } from "@/lib/rules";
import YahooQuotesTable, { YahooMovers } from "@/components/YahooQuotes";
import {
    CRYPTO_HEATMAP_CONFIG,
    STOCK_HEATMAP_CONFIG,
    marketOverviewConfig,
    marketQuotesConfig,
    timelineConfig,
} from "@/lib/constants";
import { MARKETS, MARKET_COOKIE, getMarket, isMarketOpen, marketForCountry } from "@/lib/markets";
import { WIDGET_LIBRARY, getLayout } from "@/lib/services/layout";
import { toMessageKey } from "@/i18n/config";

const scriptUrl = `https://s3.tradingview.com/external-embedding/embed-widget-`;

type GroupKey = keyof Messages['Markets']['groups'];
type FeedKey = keyof Messages['Markets']['feed'];

// What the watchlist UI states about the rules, read from rules/v1.json so no weight or limit is repeated in a component
const { score, selection, reasons, data_freshness } = RULES;
const watchlistRules: WatchlistRulesView = {
    scoreVersion: score.version,
    weights: score.weights,
    totalFormula: score.total,
    factors: {
        profile_fit: { meaning: score.factor_formulas.profile_fit.meaning, formula: score.factor_formulas.profile_fit.formula },
        risk_fit: { meaning: score.factor_formulas.risk_fit.meaning, formula: score.factor_formulas.risk_fit.formula },
        fundamentals: { meaning: score.factor_formulas.fundamentals.meaning, formula: score.factor_formulas.fundamentals.formula },
        diversification: { meaning: score.factor_formulas.diversification.meaning, formula: score.factor_formulas.diversification.formula },
    },
    removedFromScore: score.removed_from_score,
    neverAnInput: score.never_an_input,
    topN: selection.top_n_by_level,
    maxPerSector: selection.max_per_sector,
    maxCrypto: selection.max_crypto,
    quoteStaleSeconds: data_freshness.quote_stale_after_seconds,
    reasonTemplates: reasons.allowed_templates,
};

// Widgets come from TradingView (live, no Finnhub quota) and render immediately; the tiles stream in.
export default async function Dashboard({ searchParams }: { searchParams: Promise<{ market?: string }> }) {
    const { market: requested } = await searchParams;
    // Explicit choice, then the remembered one, then the default market
    const saved = (await cookies()).get(MARKET_COOKIE)?.value;
    const market = getMarket(requested ?? saved ?? marketForCountry(null));
    const [t, tm, tw, to, locale, { layout }] = await Promise.all([getTranslations('Dashboard'), getTranslations('Markets'), getTranslations('TradingViewWidget'), getTranslations('Overview'), getLocale(), getLayout()]);
    // A panel is shown when its id is in the saved layout (the agent or the visitor can hide it and bring it back)
    const shown = (id: string) => layout.includes(id);
    const hiddenCount = WIDGET_LIBRARY.filter((widget) => widget.tab === 'overview' && !shown(widget.id)).length;
    const name = tm(`names.${market.id}`);
    const feed = toMessageKey(market.feed) as FeedKey;
    // Translated tab and group titles inside the TradingView widgets
    const groups = market.groups.map((g) => ({ ...g, title: tm(`groups.${toMessageKey(g.title) as GroupKey}`) }));
    const expandLabels = { fullScreen: tw('fullScreen'), exitFullScreen: tw('exitFullScreen'), exitFullScreenHint: tw('exitFullScreenHint') };
    const open = isMarketOpen(market);
    const native = market.pulse.some((p) => p.finnhub);
    const pulseSub = native ? t('pulseSubFinnhub') : market.yahoo ? t('pulseSubYahoo') : t('pulseSubTradingView', { feed });
    const heatmap = !shown('overview_heatmap') ? null : market.heatmap === 'stocks'
        ? { script: 'stock-heatmap.js', config: { ...STOCK_HEATMAP_CONFIG, locale }, title: t('stockHeatmapTitle') }
        : market.heatmap === 'crypto'
            ? { script: 'crypto-coins-heatmap.js', config: { ...CRYPTO_HEATMAP_CONFIG, locale }, title: t('cryptoHeatmapTitle') }
            : null;

    return (
        <>
            <header className="page-head">
                <div>
                    <h1 className="page-title">{to('title')}</h1>
                    <p className="page-sub">{to('sub')}</p>
                </div>
            </header>

            {shown('overview_watchlist') && <SmartWatchlist rules={watchlistRules} />}

            <header className="page-head mt-4">
                <div>
                    <h2 className="page-title">{t('title')}</h2>
                    <p className="page-sub">{t('sub', { market: name, status: open ? 'open' : 'closed', feed })}</p>
                </div>
            </header>

            <MarketSwitcher active={market.id} openIds={MARKETS.filter((m) => isMarketOpen(m)).map((m) => m.id)} />

            {hiddenCount > 0 && <p role="note" className="px-1 text-[12.5px] text-faint">{to('hiddenNote', { count: hiddenCount })}</p>}

            {shown('overview_pulse') && <section className="hatch">
                <div className="section-head">
                    <div>
                        <h2 className="section-title">{t('pulseTitle')}</h2>
                        <p className="section-sub">{pulseSub}</p>
                    </div>
                    {native && <LocalizedDataFreshness />}
                </div>
                {/* Keyed so switching markets swaps the tiles instead of reusing old widgets */}
                <Suspense key={market.id} fallback={<PulseSkeleton />}>
                    <IndexPulse market={market} locale={locale} />
                </Suspense>
            </section>}

            {/* Narrow (the agent panel open, or a small screen): one column. Container queries follow the workspace width, not the screen's. */}
            <div key={market.id} className="flex flex-col gap-3">
                {(() => {
                    const leaders = shown('overview_leaders') && (
                        market.yahoo ? (
                            <Panel title={t('moversTitle')} sub={t('moversSub')}>
                                <YahooMovers market={market} />
                            </Panel>
                        ) : (
                            <Panel title={t('leadersTitle')} sub={t('leadersSub')}>
                                <TradingViewWidget scriptUrl={`${scriptUrl}market-overview.js`} config={marketOverviewConfig(groups, locale)} height={560} />
                            </Panel>
                        )
                    );
                    const quotes = shown('overview_quotes') && (
                        <Panel title={t('quotesTitle')} sub={t('quotesSub', { market: name })}>
                            {market.yahoo
                                ? <YahooQuotesTable market={market} />
                                : <TradingViewWidget scriptUrl={`${scriptUrl}market-quotes.js`} config={marketQuotesConfig(groups, locale)} height={560} />}
                        </Panel>
                    );
                    const heatmapPanel = heatmap && (
                        <Panel title={heatmap.title} sub={t('heatmapSub')}>
                            <TradingViewWidget scriptUrl={`${scriptUrl}${heatmap.script}`} config={heatmap.config} height={560} allowExpand labels={expandLabels} />
                        </Panel>
                    );
                    const news = shown('overview_news') && (
                        <Panel title={t('storiesTitle')} sub={t('storiesSub')}>
                            <TradingViewWidget scriptUrl={`${scriptUrl}timeline.js`} config={timelineConfig(market.news, locale)} height={560} />
                        </Panel>
                    );
                    // With a heatmap, the quotes sit beside the news below it; without one (none for this market, or hidden), beside the leaders
                    const row1 = [leaders, heatmapPanel || quotes].filter(Boolean);
                    const row2 = [heatmapPanel ? quotes : null, news].filter(Boolean);
                    return (
                        <>
                            {row1.length > 0 && <div className={row1.length === 2 ? 'grid gap-3 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]' : 'grid gap-3'}>{row1.map((panel, i) => <div key={i} className="min-w-0">{panel}</div>)}</div>}
                            {row2.length > 0 && <div className={row2.length === 2 ? 'grid gap-3 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]' : 'grid gap-3'}>{row2.map((panel, i) => <div key={i} className="min-w-0">{panel}</div>)}</div>}
                        </>
                    );
                })()}
            </div>
        </>
    );
}
