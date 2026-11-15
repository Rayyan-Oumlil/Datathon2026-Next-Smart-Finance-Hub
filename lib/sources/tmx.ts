// TMX Money: the data behind money.tmx.com, for Canadian quotes and one year of daily closes. Keyless and
// undocumented; TMX's site terms allow personal, non-commercial viewing only. Market information there is
// delayed 15 minutes or more and the response does not say so, hence the label.

import type { Sourced } from '@/lib/domain/types';
import { DAY_MS, QUOTE_TTL_MS, remember } from './cache';
import { fetchJson } from './http';
import { isNumber, isoDate, type DailyClose, type Quote } from './types';

export const TMX = 'TMX Money (delayed 15 min or more)';
export const TMX_ENDPOINT = 'https://app-money.tmx.com/graphql';

type GraphQlAnswer<T> = { data?: T | null; errors?: Array<{ message?: string }> };

async function graphql<T>(operationName: string, query: string, variables: Record<string, unknown>): Promise<T> {
    const json = await fetchJson<GraphQlAnswer<T>>(TMX_ENDPOINT, { method: 'POST', browserUserAgent: true, body: { operationName, variables, query } });
    if (json.errors?.length || !json.data) throw new Error(`TMX Money ${operationName}: ${json.errors?.[0]?.message ?? 'empty answer'}`);
    return json.data;
}

/** 'RY.TO' -> 'RY', 'BIP-UN.TO' -> 'BIP.UN'. Other symbols pass through ('AAPL:US' is TMX's form for a US listing). */
export const tmxSymbol = (symbol: string) => {
    const upper = symbol.trim().toUpperCase();
    return upper.endsWith('.TO') ? upper.slice(0, -3).replace(/-/g, '.') : upper;
};

const QUOTE_QUERY = `query getQuoteBySymbol($symbol: String, $locale: String) {
  getQuoteBySymbol(symbol: $symbol, locale: $locale) {
    symbol name price percentChange sector industry MarketCap peRatio beta averageVolume10D issueType currency
  }
}`;

type TmxQuoteJson = {
    symbol?: string; name?: string; price?: number | null; percentChange?: number | null; sector?: string | null; industry?: string | null;
    MarketCap?: number | null; peRatio?: number | null; beta?: number | null; averageVolume10D?: number | null; issueType?: string | null; currency?: string | null;
};

export type TmxQuote = Quote & {
    name?: string;
    issueType?: string;                 // 'CS' common share, 'ET' exchange-traded fund
    marketCap?: Sourced;                // in the listing currency, not millions
    pe?: Sourced;
    beta?: Sourced;
    avgVolume10dShares?: Sourced;
    sector?: Sourced<string>;           // TMX's own label; empty for ETFs, then absent here
};

export function quote(symbolTO: string): Promise<TmxQuote> {
    const symbol = tmxSymbol(symbolTO);
    return remember(`tmx-quote-${symbol}`, QUOTE_TTL_MS, async () => {
        const { getQuoteBySymbol: q } = await graphql<{ getQuoteBySymbol: TmxQuoteJson | null }>('getQuoteBySymbol', QUOTE_QUERY, { symbol, locale: 'en' });
        if (!q || !isNumber(q.price) || q.price <= 0 || !q.currency) throw new Error(`TMX Money has no quote for ${symbol}`);
        const stamp = { source: TMX, endpoint: `${TMX_ENDPOINT} getQuoteBySymbol(symbol: "${symbol}")`, fetchedAt: new Date().toISOString() };
        const result: TmxQuote = { price: { value: q.price, unit: q.currency, currency: q.currency, ...stamp }, name: q.name, issueType: q.issueType ?? undefined };
        if (isNumber(q.percentChange)) result.changePercent = { value: q.percentChange, unit: '%', ...stamp, note: 'change since the previous close' };
        if (isNumber(q.MarketCap) && q.MarketCap > 0) result.marketCap = { value: q.MarketCap, unit: q.currency, currency: q.currency, ...stamp };
        if (isNumber(q.peRatio)) result.pe = { value: q.peRatio, unit: 'ratio', ...stamp, note: 'peRatio as given by TMX Money' };
        if (isNumber(q.beta)) result.beta = { value: q.beta, unit: 'ratio', ...stamp };
        if (isNumber(q.averageVolume10D) && q.averageVolume10D > 0) result.avgVolume10dShares = { value: q.averageVolume10D, unit: 'shares per day', ...stamp, note: 'averageVolume10D' };
        if (q.sector) result.sector = { value: q.sector, ...stamp, note: 'TMX Money sector (its own classification, not GICS)' };
        return result;
    });
}

const HISTORY_QUERY = `query getTimeSeriesData($symbol: String!, $freq: String, $start: String) {
  getTimeSeriesData(symbol: $symbol, freq: $freq, start: $start) { dateTime close }
}`;

/** About one year of daily closes, oldest first. (getCompanyPriceHistory is capped at 25 rows, so it is not used.) */
export function dailyCloses(symbolTO: string): Promise<Sourced<DailyClose[]>> {
    const symbol = tmxSymbol(symbolTO);
    return remember(`tmx-closes-${symbol}`, DAY_MS, async () => {
        const start = isoDate(new Date(Date.now() - 366 * DAY_MS));
        const data = await graphql<{ getTimeSeriesData: Array<{ dateTime?: string; close?: number | null }> | null }>(
            'getTimeSeriesData', HISTORY_QUERY, { symbol, freq: 'day', start },
        );
        // dateTime is the close in Toronto time ('2026-11-13T16:00:00-05:00'): its first ten characters are the trading day
        const rows: DailyClose[] = (data.getTimeSeriesData ?? [])
            .filter((row): row is { dateTime: string; close: number } => typeof row.dateTime === 'string' && isNumber(row.close))
            .map((row) => ({ date: row.dateTime.slice(0, 10), close: row.close }))
            .sort((a, b) => a.date.localeCompare(b.date));
        if (rows.length === 0) throw new Error(`TMX Money has no daily closes for ${symbol}`);
        return {
            value: rows,
            source: TMX,
            endpoint: `${TMX_ENDPOINT} getTimeSeriesData(symbol: "${symbol}", freq: "day", start: "${start}")`,
            fetchedAt: new Date().toISOString(),
            asOf: rows[rows.length - 1].date,
        };
    });
}
