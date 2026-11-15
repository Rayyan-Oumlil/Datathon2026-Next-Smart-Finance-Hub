// Yahoo chart: daily closes and a daily quote for symbols Finnhub cannot price. Unofficial and keyless; Yahoo's
// terms forbid automated access without permission and it often answers HTTP 429, so every value is labelled
// unofficial, fetched at most once a day per symbol, and callers must cope with it being absent.

import type { Sourced } from '@/lib/domain/types';
import { dailyQuoteFromChart } from '@/lib/yahoo';
import { DAY_MS, QUOTE_TTL_MS, remember } from './cache';
import { fetchJson } from './http';
import { isNumber, isoDate, type DailyClose, type Quote } from './types';

export const YAHOO = 'Yahoo chart (unofficial)';
const BASE_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';

type Chart = {
    chart?: {
        result?: Array<{
            meta?: { currency?: string; regularMarketTime?: number; gmtoffset?: number; regularMarketChangePercent?: number };
            timestamp?: number[];
            indicators?: { quote?: Array<{ close?: (number | null)[] }> };
        }> | null;
        error?: { description?: string } | null;
    };
};

async function chart(symbol: string, range: string) {
    const endpoint = `${BASE_URL}/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
    const json = await fetchJson<Chart>(endpoint, { browserUserAgent: true });
    const result = json.chart?.result?.[0];
    if (!result) throw new Error(`Yahoo chart has no data for ${symbol}${json.chart?.error?.description ? `: ${json.chart.error.description}` : ''}`);
    return { json, result, endpoint };
}

/** Daily closes, oldest first; days Yahoo leaves empty are skipped. `source` lets gold.ts say what the symbol is. */
export function dailyCloses(symbol: string, range: '1y' | '1mo' = '1y', source = YAHOO): Promise<Sourced<DailyClose[]>> {
    return remember(`yahoo-closes-${symbol}-${range}`, DAY_MS, async () => {
        const { result, endpoint } = await chart(symbol, range);
        const offset = result.meta?.gmtoffset ?? 0;   // seconds; turns the bar time into the exchange's own date
        const closes = result.indicators?.quote?.[0]?.close ?? [];
        const rows: DailyClose[] = [];
        (result.timestamp ?? []).forEach((time, i) => {
            const close = closes[i];
            if (isNumber(close)) rows.push({ date: isoDate(new Date((time + offset) * 1000)), close });
        });
        if (rows.length === 0) throw new Error(`Yahoo chart has no closes for ${symbol}`);
        return {
            value: rows,
            unit: result.meta?.currency,
            currency: result.meta?.currency,
            source,
            endpoint,
            fetchedAt: new Date().toISOString(),
            asOf: rows[rows.length - 1].date,
        };
    });
}

export function quote(symbol: string, source = YAHOO): Promise<Quote> {
    return remember(`yahoo-quote-${symbol}`, QUOTE_TTL_MS, async () => {
        const { json, result, endpoint } = await chart(symbol, '5d');
        const daily = dailyQuoteFromChart(json, result.meta?.currency);
        if (!daily || !result.meta?.currency) throw new Error(`Yahoo chart has no price for ${symbol}`);
        const time = result.meta.regularMarketTime;
        const stamp = { source, endpoint, fetchedAt: new Date().toISOString(), asOf: isNumber(time) ? new Date(time * 1000).toISOString() : undefined };
        const quoted: Quote = { price: { value: daily.price, unit: daily.currency, currency: daily.currency, ...stamp } };
        // With a single daily bar and no change from Yahoo there is no previous close: the change is absent, not 0
        const closes = (result.indicators?.quote?.[0]?.close ?? []).filter(isNumber);
        if (closes.length > 1 || isNumber(result.meta.regularMarketChangePercent)) {
            quoted.changePercent = { value: daily.changePercent, unit: '%', ...stamp, note: 'change since the previous daily close' };
        }
        return quoted;
    });
}
