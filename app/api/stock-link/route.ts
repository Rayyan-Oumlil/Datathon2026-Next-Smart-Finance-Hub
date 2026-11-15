import { NextResponse, type NextRequest } from 'next/server';
import { appPathForTradingViewSymbol, STOCK_LINK_PARAM } from '@/lib/tradingview-link';

// Landing URL for clicks inside TradingView embeds: /api/stock-link?tvwidgetsymbol=NASDAQ:AAPL → /stocks/AAPL
export function GET(request: NextRequest) {
    const symbol = request.nextUrl.searchParams.get(STOCK_LINK_PARAM) ?? '';
    return NextResponse.redirect(new URL(appPathForTradingViewSymbol(symbol), request.url));
}
