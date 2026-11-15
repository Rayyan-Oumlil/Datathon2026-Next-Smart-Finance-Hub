import { describe, it, expect } from 'vitest';
import { appPathForTradingViewSymbol, withAppLinks } from '@/lib/tradingview-link';

describe('appPathForTradingViewSymbol', () => {
    it('sends a US listing to its stock page', () => {
        expect(appPathForTradingViewSymbol('NASDAQ:AAPL')).toBe('/stocks/AAPL');
        expect(appPathForTradingViewSymbol('NYSE:JPM')).toBe('/stocks/JPM');
    });

    it('keeps the class-share dot', () => {
        expect(appPathForTradingViewSymbol('NYSE:BRK.B')).toBe('/stocks/BRK.B');
    });

    it('maps a Toronto listing back to our .TO symbol', () => {
        expect(appPathForTradingViewSymbol('TSX:RY')).toBe('/stocks/RY.TO');
    });

    it('is case-insensitive and tolerates a bare ticker', () => {
        expect(appPathForTradingViewSymbol('nasdaq:msft')).toBe('/stocks/MSFT');
        expect(appPathForTradingViewSymbol('AAPL')).toBe('/stocks/AAPL');
    });

    it('falls back to the overview when the symbol has no page of ours', () => {
        expect(appPathForTradingViewSymbol('')).toBe('/overview');
        expect(appPathForTradingViewSymbol('FX:EURUSD')).toBe('/overview');
        expect(appPathForTradingViewSymbol('TADAWUL:ZZZZ')).toBe('/overview');
    });
});

describe('withAppLinks', () => {
    const origin = 'https://app.example';

    it('points quote-style widgets at our stock route through largeChartUrl', () => {
        const out = withAppLinks('https://s3.tradingview.com/external-embedding/embed-widget-market-quotes.js', { a: 1 }, origin);
        expect(out).toEqual({ a: 1, largeChartUrl: 'https://app.example/api/stock-link' });
    });

    it('points heatmaps at our stock route through symbolUrl', () => {
        const out = withAppLinks('https://s3.tradingview.com/external-embedding/embed-widget-stock-heatmap.js', {}, origin);
        expect(out).toEqual({ symbolUrl: 'https://app.example/api/stock-link' });
    });

    it('leaves other widgets untouched and does not mutate the input', () => {
        const config = { symbol: 'AAPL' };
        const out = withAppLinks('https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js', config, origin);
        expect(out).toBe(config);
    });
});
