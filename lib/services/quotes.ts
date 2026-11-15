// Live values for one universe entry, each with its source. The source modules cache a quote for 60 s and
// daily closes for 24 h, so nothing here keeps a cache of its own.

import type { SignalSet, Sourced, UniverseEntry } from '@/lib/domain/types';
import * as boc from '@/lib/sources/boc';
import { loadDailySignals } from '@/lib/sources/daily-signals';
import * as finnhub from '@/lib/sources/finnhub';
import * as kraken from '@/lib/sources/kraken';
import * as tmx from '@/lib/sources/tmx';
import type { DailyClose, Quote } from '@/lib/sources/types';
import * as yahoo from '@/lib/sources/yahoo';

/** Gold and bond yields are reference values: a yield is not a price, and neither is held in the simulation. */
export const isTradable = (entry: UniverseEntry): boolean =>
    entry.assetClass === 'stock' || entry.assetClass === 'etf' || entry.assetClass === 'crypto';

/** Last price and % change today from the entry's provider. Throws when the provider gives none. */
export function liveQuote(entry: UniverseEntry): Promise<Quote> {
    const symbol = entry.symbol.toUpperCase();
    if (entry.assetClass === 'crypto' && (symbol === 'BTC' || symbol === 'ETH')) return kraken.quote(symbol);
    if ((entry.assetClass === 'stock' || entry.assetClass === 'etf') && entry.market === 'US') return finnhub.quote(entry.symbol);
    if ((entry.assetClass === 'stock' || entry.assetClass === 'etf') && entry.market === 'Canada') return tmx.quote(entry.symbol);
    return Promise.reject(new Error(`no live quote source for ${entry.symbol}`));
}

/**
 * One year of daily closes. US names: TMX Money first, then the Yahoo chart. The signal snapshot asks Yahoo
 * first, but Yahoo refuses most calls and each refusal costs a retry wait, which a page load cannot afford.
 */
export async function dailyClosesFor(entry: UniverseEntry): Promise<Sourced<DailyClose[]>> {
    const symbol = entry.symbol.toUpperCase();
    if (entry.assetClass === 'crypto' && (symbol === 'BTC' || symbol === 'ETH')) return kraken.dailyCloses(symbol);
    if (entry.market === 'Canada') return tmx.dailyCloses(entry.symbol);
    if (entry.market === 'US') {
        try {
            return await tmx.dailyCloses(`${entry.symbol}:US`);
        } catch {
            return yahoo.dailyCloses(entry.symbol.replace('.', '-'));
        }
    }
    throw new Error(`no daily closes source for ${entry.symbol}`);
}

export const fxUsdCad = (): Promise<Sourced> => boc.fxUsdCad();

/** An amount in CAD. USD is multiplied by the Bank of Canada rate (CAD per USD); any other currency is not converted. */
export function toCad(amount: number, currency: string | undefined, fx: Sourced | undefined): number | null {
    if (currency === 'CAD') return amount;
    if (currency === 'USD' && fx && fx.value > 0) return amount * fx.value;
    return null;
}

/** The day's signal set for one entry (collected now when the day's file does not hold it). */
export async function signalsFor(entry: UniverseEntry): Promise<{ signals: SignalSet; fxUsdCad?: Sourced }> {
    const daily = await loadDailySignals([entry]);
    return { signals: daily.signals[0], fxUsdCad: daily.fxUsdCad };
}
