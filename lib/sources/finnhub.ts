// Finnhub, free key: US quote, company profile, metrics and news count. The key travels in a header, never in
// the URL, so the endpoint stored with each value is safe to show. Free terms: personal use, 60 calls a minute.

import type { Sourced } from '@/lib/domain/types';
import rules from '@/rules/v1.json';
import { DAY_MS, QUOTE_TTL_MS, remember, type LastKnown } from './cache';
import { fetchJson } from './http';
import { isNumber, isoDate, type Quote } from './types';

const BASE_URL = 'https://finnhub.io/api/v1';
export const FINNHUB = 'Finnhub';

// Read at call time through an alias so a key set after the build is still seen
const env = process.env;
const keys = () => (env.FINNHUB_API_KEYS || env.FINNHUB_API_KEY || '').split(',').map((k) => k.trim()).filter(Boolean);
let nextKey = 0;

// 60 calls a minute per key. FINNHUB_SPACING_MS (default 1050) sets the budget: 60 000 / spacing calls in any
// rolling minute per key, so 57 with one key, a few under the limit. Within that budget calls may start together
// (at most 4 at a time, 60 ms apart), so a portfolio's quotes arrive in about a second instead of one per second.
// Quotes are 'screen' calls: they go first, and the background work (watchlist profiles, metrics, news) leaves
// RESERVED of the minute's budget to them, so a page never waits behind a watchlist build.
// A 429 is retried once inside fetchJson after the wait the provider asks for. Spacing 0 (tests): no budget.
const spacingMs = () => Number(env.FINNHUB_SPACING_MS ?? 1050);
const WINDOW_MS = 60_000;
const MAX_ACTIVE = 4;
const MIN_GAP_MS = 60;
const RESERVED = 8;

type Lane = 'screen' | 'background';
type Job = { run: () => Promise<unknown>; resolve: (value: unknown) => void; reject: (error: unknown) => void };
const lanes: Record<Lane, Job[]> = { screen: [], background: [] };
const started: number[] = [];      // start times within the last minute
let active = 0;
let lastStartAt = 0;
let wake: ReturnType<typeof setTimeout> | undefined;

function budget(): number {
    const spacing = spacingMs();
    if (!(spacing > 0)) return Infinity;
    return Math.max(1, Math.floor(WINDOW_MS / spacing) * Math.max(1, keys().length));
}

function pump(): void {
    if (wake) return;
    while (active < MAX_ACTIVE && (lanes.screen.length > 0 || lanes.background.length > 0)) {
        const now = Date.now();
        while (started.length > 0 && started[0] <= now - WINDOW_MS) started.shift();
        const limit = budget();
        const reserved = limit === Infinity ? 0 : Math.min(RESERVED, Math.floor(limit / 4));
        const lane: Lane | null = lanes.screen.length > 0 && started.length < limit ? 'screen'
            : lanes.background.length > 0 && started.length < limit - reserved ? 'background' : null;
        const gap = limit === Infinity ? 0 : lastStartAt + MIN_GAP_MS - now;
        if (!lane || gap > 0) {
            // Wait for the gap, or for the oldest call to leave the window
            const until = !lane && started.length > 0 ? started[0] + WINDOW_MS - now : gap;
            wake = setTimeout(() => { wake = undefined; pump(); }, Math.max(until, 1));
            return;
        }
        const job = lanes[lane].shift()!;
        active += 1;
        started.push(now);
        lastStartAt = now;
        job.run().then(job.resolve, job.reject).finally(() => {
            active -= 1;
            pump();
        });
    }
}

function call<T>(pathAndQuery: string, lane: Lane = 'background'): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const run = async () => {
            const pool = keys();
            if (pool.length === 0) throw new Error('No Finnhub key configured (FINNHUB_API_KEY)');
            return fetchJson<T>(`${BASE_URL}${pathAndQuery}`, { headers: { 'X-Finnhub-Token': pool[nextKey++ % pool.length] } });
        };
        lanes[lane].push({ run, resolve: resolve as (value: unknown) => void, reject });
        // A timer may be waiting for the background budget while this call could start now
        if (wake) {
            clearTimeout(wake);
            wake = undefined;
        }
        pump();
    });
}

const symbolQuery = (symbol: string) => `symbol=${encodeURIComponent(symbol.toUpperCase())}`;
const fromUnix = (seconds: unknown) => (isNumber(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : undefined);

/**
 * Last price and % change today. Finnhub answers an unknown symbol with zeros, and refuses .TO with HTTP 403.
 * lastKnown: for screens only (lib/sources/cache.ts); a trade always waits for a quote under 60 s old.
 */
export function quote(symbol: string, lastKnown?: LastKnown): Promise<Quote> {
    const endpoint = `${BASE_URL}/quote?${symbolQuery(symbol)}`;
    return remember(`finnhub-quote-${symbol}`, QUOTE_TTL_MS, async () => {
        const json = await call<{ c?: number; dp?: number | null; t?: number }>(`/quote?${symbolQuery(symbol)}`, 'screen');
        if (!isNumber(json.c) || json.c <= 0) throw new Error(`Finnhub has no quote for ${symbol}`);
        const stamp = { source: FINNHUB, endpoint, fetchedAt: new Date().toISOString(), asOf: fromUnix(json.t) };
        // The quote endpoint does not name a currency; the free key only prices US listings
        const result: Quote = { price: { value: json.c, unit: 'USD', currency: 'USD', ...stamp } };
        if (isNumber(json.dp)) result.changePercent = { value: json.dp, unit: '%', ...stamp, note: 'change since the previous close' };
        return result;
    }, lastKnown);
}

export type FinnhubProfile = {
    name?: string;
    ticker?: string;                    // Finnhub's own ticker: 'RY' answers as 'RY.TO'
    currency?: string;
    exchange?: Sourced<string>;
    industry?: Sourced<string>;         // Finnhub's classification, not GICS
    marketCapMillions?: Sourced;        // in millions of the profile currency
    logo?: string;                      // image URL on Finnhub's static host; '' when Finnhub has none. Shown, never scored
};

export function profile(symbol: string): Promise<FinnhubProfile> {
    const endpoint = `${BASE_URL}/stock/profile2?${symbolQuery(symbol)}`;
    return remember(`finnhub-profile-${symbol}`, DAY_MS, async () => {
        const json = await call<{ name?: string; ticker?: string; currency?: string; exchange?: string; finnhubIndustry?: string; marketCapitalization?: number; logo?: string }>(
            `/stock/profile2?${symbolQuery(symbol)}`,
        );
        if (!json.ticker) throw new Error(`Finnhub has no profile for ${symbol}`);
        const stamp = { source: FINNHUB, endpoint, fetchedAt: new Date().toISOString() };
        const result: FinnhubProfile = { name: json.name, ticker: json.ticker, currency: json.currency, logo: typeof json.logo === 'string' ? json.logo : '' };
        if (json.exchange) result.exchange = { value: json.exchange, ...stamp };
        if (json.finnhubIndustry) result.industry = { value: json.finnhubIndustry, ...stamp, note: 'Finnhub industry (its own classification, not GICS)' };
        if (isNumber(json.marketCapitalization) && json.marketCapitalization > 0 && json.currency) {
            result.marketCapMillions = { value: json.marketCapitalization, unit: `${json.currency} millions`, currency: json.currency, ...stamp };
        }
        return result;
    });
}

export type FinnhubMetrics = {
    pe?: Sourced;                       // peTTM
    revenueGrowthPct?: Sourced;         // revenueGrowthTTMYoy
    beta?: Sourced;
    avgVolume10dShares?: Sourced;       // 10DayAverageTradingVolume, converted from millions of shares to shares
};

export function metrics(symbol: string): Promise<FinnhubMetrics> {
    const endpoint = `${BASE_URL}/stock/metric?${symbolQuery(symbol)}&metric=all`;
    return remember(`finnhub-metrics-${symbol}`, DAY_MS, async () => {
        const json = await call<{ metric?: Record<string, unknown> }>(`/stock/metric?${symbolQuery(symbol)}&metric=all`);
        const metric = json.metric ?? {};
        const stamp = { source: FINNHUB, endpoint, fetchedAt: new Date().toISOString() };
        const result: FinnhubMetrics = {};
        if (isNumber(metric.peTTM)) result.pe = { value: metric.peTTM, unit: 'ratio', ...stamp, note: 'peTTM: price / earnings, trailing twelve months' };
        if (isNumber(metric.revenueGrowthTTMYoy)) {
            result.revenueGrowthPct = { value: metric.revenueGrowthTTMYoy, unit: '%', ...stamp, note: 'revenueGrowthTTMYoy: revenue, trailing twelve months, year over year' };
        }
        if (isNumber(metric.beta)) result.beta = { value: metric.beta, unit: 'ratio', ...stamp };
        const volumeMillions = metric['10DayAverageTradingVolume'];
        if (isNumber(volumeMillions) && volumeMillions > 0) {
            result.avgVolume10dShares = { value: volumeMillions * 1e6, unit: 'shares per day', ...stamp, note: '10DayAverageTradingVolume, given in millions of shares' };
        }
        return result;
    });
}

/** Number of headlines over the last 7 days (rules: data_freshness.news_count_window_days). Shown, never scored. */
export function newsCount7d(symbol: string): Promise<Sourced> {
    const days = rules.data_freshness.news_count_window_days;
    const to = new Date();
    const from = new Date(to.getTime() - days * DAY_MS);
    const pathAndQuery = `/company-news?${symbolQuery(symbol)}&from=${isoDate(from)}&to=${isoDate(to)}`;
    return remember(`finnhub-news-${symbol}`, DAY_MS, async () => {
        const articles = await call<Array<{ datetime?: number }>>(pathAndQuery);
        if (!Array.isArray(articles)) throw new Error(`Finnhub news for ${symbol}: unexpected answer`);
        const since = from.getTime() / 1000;
        return {
            value: articles.filter((a) => isNumber(a.datetime) && a.datetime >= since).length,
            unit: 'headlines',
            source: FINNHUB,
            endpoint: `${BASE_URL}${pathAndQuery}`,
            fetchedAt: new Date().toISOString(),
            note: `headlines published in the ${days} days before ${to.toISOString()}`,
        };
    });
}
