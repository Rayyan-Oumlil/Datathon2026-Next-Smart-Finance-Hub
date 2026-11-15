// Stubbed market data for the service tests. Imports no service, so a vi.mock factory can load it safely.
import type { SignalSet, Sourced, UniverseEntry } from '@/lib/domain/types';

export const NOW = '2026-11-13T15:00:00.000Z';
export const sourced = <T = number>(value: T, extra: Partial<Sourced<T>> = {}): Sourced<T> => ({ value, source: 'test stub', fetchedAt: NOW, ...extra });

/** What the stubbed providers answer. Tests change it between calls. */
export const market = {
    prices: {} as Record<string, { value: number; currency: string; change?: number } | undefined>,
    fx: 1.42 as number | null,
    signals: {} as Record<string, Partial<SignalSet>>,
};

/** A signal set that passes every filter of a Medium-risk Intermediate, unless overridden in market.signals. */
export function passing(entry: UniverseEntry): SignalSet {
    return {
        symbol: entry.symbol,
        entry,
        volatility1y: sourced(0.25, { source: 'derived' }),
        marketCapUsd: sourced(50e9, { currency: 'USD' }),
        avgDailyTradedValueUsd: sourced(100e6, { currency: 'USD' }),
        changePercent: sourced(1.2, { unit: '%' }),
        missing: [],
        ...market.signals[entry.symbol],
    };
}

/** Replaces lib/services/quotes: no network, values from `market`. The pure helpers stay real. */
export function quotesMock(real: typeof import('@/lib/services/quotes')): typeof import('@/lib/services/quotes') {
    return {
        ...real,
        liveQuote: async (entry) => {
            const price = market.prices[entry.symbol];
            if (!price) throw new Error(`no quote for ${entry.symbol}`);
            return {
                price: sourced(price.value, { unit: price.currency, currency: price.currency, source: 'stub quotes' }),
                ...(price.change === undefined ? {} : { changePercent: sourced(price.change, { unit: '%', source: 'stub quotes' }) }),
            };
        },
        dailyClosesFor: async (entry) => {
            throw new Error(`no closes for ${entry.symbol}`);
        },
        fxUsdCad: async () => {
            if (market.fx === null) throw new Error('no rate');
            return sourced(market.fx, { source: 'Bank of Canada', asOf: '2026-11-13' });
        },
        signalsFor: async (entry) => ({ signals: passing(entry) }),
    };
}
