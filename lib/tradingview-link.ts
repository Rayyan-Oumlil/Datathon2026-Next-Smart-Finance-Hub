import { getUniverse } from '@/lib/universe';
import { formatSymbolForTradingView } from '@/lib/utils';

// TradingView widgets open tradingview.com when a symbol is clicked. Quote-style widgets take a `largeChartUrl`,
// heatmaps a `symbolUrl`; either way TradingView appends `?tvwidgetsymbol=EXCHANGE:TICKER` to it. We point both at
// a route of ours that turns that symbol into our own /stocks/<symbol> page.
export const STOCK_LINK_PATH = '/api/stock-link';
export const STOCK_LINK_PARAM = 'tvwidgetsymbol';

const OVERVIEW = '/overview';
const US_EXCHANGES = new Set(['NASDAQ', 'NYSE', 'AMEX', 'NYSEARCA', 'NYSEAMERICAN', 'BATS', 'CBOE']);

// Which config key each embed reads its click-through URL from, keyed by the embed script name
const LINK_KEY: Record<string, 'largeChartUrl' | 'symbolUrl'> = {
    'market-overview': 'largeChartUrl',
    'market-quotes': 'largeChartUrl',
    'single-quote': 'largeChartUrl',
    'symbol-info': 'largeChartUrl',
    'financials': 'largeChartUrl',
    'stock-heatmap': 'symbolUrl',
    'crypto-coins-heatmap': 'symbolUrl',
};

// TradingView spelling → our symbol, built once from the universe so BSE:TCS-style reverse guesses are never needed
let byTradingView: Map<string, string> | undefined;
function tradingViewIndex(): Map<string, string> {
    byTradingView ??= new Map(getUniverse().map((entry) => [formatSymbolForTradingView(entry.symbol), entry.symbol]));
    return byTradingView;
}

/** Our page for a TradingView symbol, or the overview when we have none (forex, indices, unlisted exchanges). */
export function appPathForTradingViewSymbol(tvSymbol: string): string {
    const wanted = tvSymbol.trim().toUpperCase();
    if (!wanted) return OVERVIEW;

    const known = tradingViewIndex().get(wanted);
    if (known) return `/stocks/${encodeURIComponent(known)}`;

    const [exchange, ticker] = wanted.includes(':') ? wanted.split(':') : ['', wanted];
    if (ticker && (exchange === '' || US_EXCHANGES.has(exchange))) return `/stocks/${encodeURIComponent(ticker)}`;
    return OVERVIEW;
}

/** Copy of an embed's config with its click-through URL pointed at this app. Other embeds come back unchanged. */
export function withAppLinks(scriptUrl: string, config: Record<string, unknown>, origin: string): Record<string, unknown> {
    const name = scriptUrl.split('embed-widget-')[1]?.replace(/\.js.*$/, '');
    const key = name ? LINK_KEY[name] : undefined;
    return key ? { ...config, [key]: `${origin}${STOCK_LINK_PATH}` } : config;
}
