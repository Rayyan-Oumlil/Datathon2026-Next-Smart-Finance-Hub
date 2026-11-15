import { NextResponse, type NextRequest } from 'next/server';
import { appPathForTradingViewSymbol, STOCK_LINK_PARAM } from '@/lib/tradingview-link';

// Landing URL for clicks inside TradingView embeds: /api/stock-link?tvwidgetsymbol=NASDAQ:AAPL → /stocks/AAPL
export function GET(request: NextRequest) {
    const symbol = request.nextUrl.searchParams.get(STOCK_LINK_PARAM) ?? '';
    // A relative Location: behind the load balancer request.url carries the container's own host name,
    // which the browser cannot reach.
    return new NextResponse(null, { status: 307, headers: { Location: appPathForTradingViewSymbol(symbol) } });
}
