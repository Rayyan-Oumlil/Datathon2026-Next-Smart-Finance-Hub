// Stage 1 of the watchlist pipeline: collect every input for every candidate once, each value with its source
// and fetch time. Nothing is estimated: what a provider does not give is named in SignalSet.missing.

import type { AssetClass, Sourced, SignalSet, UniverseEntry } from '@/lib/domain/types';
import * as boc from './boc';
import { STALE_NOTE } from './cache';
import * as finnhub from './finnhub';
import * as gold from './gold';
import * as kraken from './kraken';
import * as tmx from './tmx';
import * as yahoo from './yahoo';
import type { DailyClose, Quote } from './types';
import { annualizedVolatility } from './volatility';

export type CollectOptions = {
    concurrency?: number;                                                   // candidates in progress at once (default 4)
    onProgress?: (done: number, total: number, symbol: string) => void;
    onError?: (symbol: string, what: string, error: unknown) => void;      // a provider refused or failed; the value goes to missing
};
export type CollectedSignals = { signals: SignalSet[]; fxUsdCad?: Sourced };

type SignalName = Exclude<keyof SignalSet, 'symbol' | 'entry' | 'missing'>;
type Values = Partial<Pick<SignalSet, SignalName>>;

// What each asset class is expected to carry. A fund has no company market cap, P/E or revenue; crypto, gold
// and yields have no fundamentals; a yield is a single number. Anything expected and not obtained is "missing".
const EXPECTED: Record<AssetClass, SignalName[]> = {
    stock: ['price', 'changePercent', 'marketCapUsd', 'avgDailyTradedValueUsd', 'volatility1y', 'beta', 'pe', 'revenueGrowthPct', 'sectorLabel', 'closes1m', 'newsCount7d'],
    etf: ['price', 'changePercent', 'avgDailyTradedValueUsd', 'volatility1y', 'beta', 'closes1m'],
    crypto: ['price', 'changePercent', 'volatility1y', 'closes1m'],
    gold: ['price', 'changePercent', 'volatility1y', 'closes1m'],
    bond_yield: ['price'],
};

// App symbols for the Bank of Canada benchmark yields
const YIELD_TERMS: Record<string, boc.YieldTerm> = { CA2Y: '2Y', CA5Y: '5Y', CA10Y: '10Y', CALONG: 'LONG' };

// After this many Yahoo refusals in a row, the rest of the run stops asking it (it rate-limits by address)
const YAHOO_REFUSALS_BEFORE_SKIPPING = 3;

type Run = { fx?: Sourced; yahooRefusals: number; onError: NonNullable<CollectOptions['onError']> };

async function attempt<T>(run: Run, symbol: string, what: string, load: () => Promise<T>): Promise<T | undefined> {
    try {
        return await load();
    } catch (e) {
        run.onError(symbol, what, e);
        return undefined;
    }
}

// A derived value built on an input the provider failed to refresh says so too
const staleNote = (...inputs: Array<{ note?: string } | undefined>) => (inputs.some((input) => input?.note?.includes(STALE_NOTE)) ? `; ${STALE_NOTE}` : '');

function volatilityFrom(closes: Sourced<DailyClose[]>): Sourced | undefined {
    const rows = closes.value;
    const value = annualizedVolatility(rows.map((row) => row.close));
    if (value === null) return undefined;
    return {
        value,
        unit: 'fraction per year',
        source: 'derived',
        endpoint: closes.endpoint,
        fetchedAt: closes.fetchedAt,
        asOf: closes.asOf,
        note: `sample standard deviation of ${rows.length - 1} daily returns x sqrt(252); daily closes ${rows[0].date} to ${rows[rows.length - 1].date} from ${closes.source}${staleNote(closes)}`,
    };
}

function lastMonth(closes: Sourced<DailyClose[]>): Sourced<number[]> {
    const last = closes.value[closes.value.length - 1].date;
    const from = new Date(`${last}T00:00:00Z`);
    from.setUTCMonth(from.getUTCMonth() - 1);
    const rows = closes.value.filter((row) => row.date >= from.toISOString().slice(0, 10));
    return { ...closes, value: rows.map((row) => row.close), note: `daily closes ${rows[0].date} to ${last}${staleNote(closes)}` };
}

const historySignals = (closes: Sourced<DailyClose[]> | undefined): Values =>
    closes ? { volatility1y: volatilityFrom(closes), closes1m: lastMonth(closes) } : {};

// USD stays as it is; CAD is divided by the Bank of Canada rate of the day; any other currency is not converted
function toUsd(amount: number, currency: string | undefined, fx: Sourced | undefined): { value: number; how: string } | undefined {
    if (currency === 'USD') return { value: amount, how: '' };
    if (currency === 'CAD' && fx) return { value: amount / fx.value, how: `; converted from CAD at ${fx.value} CAD per USD (Bank of Canada FXUSDCAD, ${fx.asOf})` };
    return undefined;
}

function marketCapUsd(cap: Sourced | undefined, amount: number | undefined, fx: Sourced | undefined): Sourced | undefined {
    if (!cap || amount === undefined) return undefined;
    const usd = toUsd(amount, cap.currency, fx);
    return usd && { ...cap, value: usd.value, unit: 'USD', currency: 'USD', note: `market capitalization ${cap.value} ${cap.unit}${usd.how}${staleNote(cap, usd.how ? fx : undefined)}` };
}

function tradedValueUsd(volume: Sourced | undefined, price: Sourced | undefined, fx: Sourced | undefined): Sourced | undefined {
    if (!volume || !price) return undefined;
    const usd = toUsd(volume.value * price.value, price.currency, fx);
    return usd && {
        value: usd.value,
        unit: 'USD per day',
        currency: 'USD',
        source: 'derived',
        endpoint: volume.endpoint,
        fetchedAt: price.fetchedAt,
        asOf: price.asOf,
        note: `10-day average volume ${Math.round(volume.value)} shares (${volume.source}) x last price ${price.value} ${price.currency} (${price.source})${usd.how}${staleNote(volume, price, usd.how ? fx : undefined)}`,
    };
}

const listSector = (entry: UniverseEntry, fetchedAt: string): Sourced<string> | undefined =>
    entry.sector ? { value: entry.sector, source: entry.listSource, fetchedAt, note: 'sector from the candidate list' } : undefined;

async function usHistory(entry: UniverseEntry, run: Run): Promise<Sourced<DailyClose[]> | undefined> {
    if (run.yahooRefusals < YAHOO_REFUSALS_BEFORE_SKIPPING) {
        // Yahoo writes share classes with a dash: BRK.B -> BRK-B
        const closes = await attempt(run, entry.symbol, 'Yahoo daily closes', () => yahoo.dailyCloses(entry.symbol.replace('.', '-')));
        run.yahooRefusals = closes ? 0 : run.yahooRefusals + 1;
        if (closes) return closes;
    }
    // TMX Money also carries US listings, as SYMBOL:US
    return attempt(run, entry.symbol, 'TMX Money daily closes', () => tmx.dailyCloses(`${entry.symbol}:US`));
}

async function usEquity(entry: UniverseEntry, run: Run): Promise<Values> {
    const isStock = entry.assetClass === 'stock';
    const quote = await attempt(run, entry.symbol, 'Finnhub quote', () => finnhub.quote(entry.symbol));
    // Finnhub has no profile for a fund on the free key, and a fund needs neither market cap nor sector from it
    const profile = isStock ? await attempt(run, entry.symbol, 'Finnhub profile', () => finnhub.profile(entry.symbol)) : undefined;
    const metrics = await attempt(run, entry.symbol, 'Finnhub metrics', () => finnhub.metrics(entry.symbol));
    const news = isStock ? await attempt(run, entry.symbol, 'Finnhub news', () => finnhub.newsCount7d(entry.symbol)) : undefined;
    const closes = await usHistory(entry, run);
    const cap = profile?.marketCapMillions;
    return {
        price: quote?.price,
        changePercent: quote?.changePercent,
        marketCapUsd: isStock ? marketCapUsd(cap, cap && cap.value * 1e6, run.fx) : undefined,
        avgDailyTradedValueUsd: tradedValueUsd(metrics?.avgVolume10dShares, quote?.price, run.fx),
        beta: metrics?.beta,
        pe: isStock ? metrics?.pe : undefined,
        revenueGrowthPct: isStock ? metrics?.revenueGrowthPct : undefined,
        sectorLabel: isStock ? profile?.industry ?? listSector(entry, new Date().toISOString()) : undefined,
        newsCount7d: news,
        ...historySignals(closes),
    };
}

// TMX Money gives no revenue growth and this module asks it for no news: both stay missing for Canadian stocks
async function canadaEquity(entry: UniverseEntry, run: Run): Promise<Values> {
    const isStock = entry.assetClass === 'stock';
    const quote = await attempt(run, entry.symbol, 'TMX Money quote', () => tmx.quote(entry.symbol));
    const closes = await attempt(run, entry.symbol, 'TMX Money daily closes', () => tmx.dailyCloses(entry.symbol));
    return {
        price: quote?.price,
        changePercent: quote?.changePercent,
        marketCapUsd: isStock ? marketCapUsd(quote?.marketCap, quote?.marketCap?.value, run.fx) : undefined,
        avgDailyTradedValueUsd: tradedValueUsd(quote?.avgVolume10dShares, quote?.price, run.fx),
        beta: quote?.beta,
        pe: isStock ? quote?.pe : undefined,
        sectorLabel: isStock ? quote?.sector ?? listSector(entry, new Date().toISOString()) : undefined,
        ...historySignals(closes),
    };
}

async function fromQuoteAndCloses(entry: UniverseEntry, run: Run, name: string, quote: () => Promise<Quote>, dailyCloses: () => Promise<Sourced<DailyClose[]>>): Promise<Values> {
    const q = await attempt(run, entry.symbol, `${name} quote`, quote);
    const closes = await attempt(run, entry.symbol, `${name} daily closes`, dailyCloses);
    return { price: q?.price, changePercent: q?.changePercent, ...historySignals(closes) };
}

// A yield is not a price: it sits in `price` with unit '%' so the reference card has one value to show
async function bondYield(entry: UniverseEntry, run: Run): Promise<Values> {
    const term = YIELD_TERMS[entry.symbol.toUpperCase()];
    const yields = term && await attempt(run, entry.symbol, 'Bank of Canada yields', () => boc.bondYields());
    const value = term && yields?.[term];
    return value ? { price: { ...value, note: `${value.note ?? 'benchmark bond yield'} (a yield, not a price)` } } : {};
}

function collectOne(entry: UniverseEntry, run: Run): Promise<Values> {
    const symbol = entry.symbol.toUpperCase();
    switch (entry.assetClass) {
        case 'stock':
        case 'etf':
            if (entry.market === 'US') return usEquity(entry, run);
            if (entry.market === 'Canada') return canadaEquity(entry, run);
            return Promise.resolve({});
        case 'crypto':
            if (symbol !== 'BTC' && symbol !== 'ETH') return Promise.resolve({});
            return fromQuoteAndCloses(entry, run, 'Kraken', () => kraken.quote(symbol), () => kraken.dailyCloses(symbol));
        case 'gold':
            return fromQuoteAndCloses(entry, run, 'Gold', gold.quote, gold.dailyCloses);
        case 'bond_yield':
            return bondYield(entry, run);
    }
}

export async function collectSignals(entries: UniverseEntry[], options: CollectOptions = {}): Promise<CollectedSignals> {
    const run: Run = { yahooRefusals: 0, onError: options.onError ?? (() => undefined) };
    run.fx = await attempt(run, 'FXUSDCAD', 'Bank of Canada USD/CAD rate', () => boc.fxUsdCad());

    const signals = new Array<SignalSet>(entries.length);
    let next = 0;
    let done = 0;
    const worker = async () => {
        while (next < entries.length) {
            const index = next++;
            const entry = entries[index];
            // A failure nobody foresaw must not sink the other candidates: this one comes back with everything missing
            const values = await Promise.resolve().then(() => collectOne(entry, run)).catch((e): Values => {
                run.onError(entry.symbol, 'collect', e);
                return {};
            });
            const kept = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Values;
            signals[index] = { symbol: entry.symbol, entry, ...kept, missing: EXPECTED[entry.assetClass].filter((name) => kept[name] === undefined) };
            options.onProgress?.(++done, entries.length, entry.symbol);
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 4, entries.length)) }, worker));
    return { signals, fxUsdCad: run.fx };
}
