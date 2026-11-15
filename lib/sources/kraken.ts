// Kraken public market data: BTC and ETH priced in CAD on its own order books, and daily closes. Keyless.

import type { Sourced } from '@/lib/domain/types';
import { DAY_MS, QUOTE_TTL_MS, remember } from './cache';
import { fetchJson } from './http';
import { isoDate, type DailyClose, type Quote } from './types';

export const KRAKEN = 'Kraken';
const BASE_URL = 'https://api.kraken.com/0/public';
const PAIRS = { BTC: 'XBTCAD', ETH: 'ETHCAD' } as const;
export type CryptoAsset = keyof typeof PAIRS;

type KrakenAnswer<T> = { error?: string[]; result?: Record<string, T | number> };

// Kraken answers under its own pair name ('XXBTZCAD'); OHLC adds 'last', the time of the last finished bar
async function call<T>(endpoint: string): Promise<{ data: T; last?: number }> {
    const json = await fetchJson<KrakenAnswer<T>>(endpoint);
    const data = Object.entries(json.result ?? {}).find(([name]) => name !== 'last')?.[1] as T | undefined;
    if (json.error?.length || data === undefined) throw new Error(`Kraken: ${json.error?.join(', ') || 'empty answer'}`);
    const last = json.result?.last;
    return { data, last: typeof last === 'number' ? last : undefined };
}

export function quote(asset: CryptoAsset): Promise<Quote> {
    const endpoint = `${BASE_URL}/Ticker?pair=${PAIRS[asset]}`;
    return remember(`kraken-quote-${asset}`, QUOTE_TTL_MS, async () => {
        const { data: ticker } = await call<{ c?: string[]; o?: string }>(endpoint);
        const last = Number(ticker.c?.[0]);
        const open = Number(ticker.o);
        if (!(last > 0)) throw new Error(`Kraken has no last trade for ${asset}`);
        const stamp = { source: KRAKEN, endpoint, fetchedAt: new Date().toISOString() };
        const result: Quote = { price: { value: last, unit: 'CAD', currency: 'CAD', ...stamp, note: 'last trade on the CAD pair' } };
        if (open > 0) result.changePercent = { value: (last / open - 1) * 100, unit: '%', ...stamp, note: "change since today's opening price (00:00 UTC), computed from Kraken's last and open" };
        return result;
    });
}

async function closesOf(asset: CryptoAsset, keep: number): Promise<Sourced<DailyClose[]>> {
    const endpoint = `${BASE_URL}/OHLC?pair=${PAIRS[asset]}&interval=1440`;
    const { data: bars, last = Infinity } = await call<Array<[number, string, string, string, string, ...unknown[]]>>(endpoint);
    const rows: DailyClose[] = bars
        .filter((bar) => bar[0] <= last && Number(bar[4]) > 0)
        .map((bar) => ({ date: isoDate(new Date(bar[0] * 1000)), close: Number(bar[4]) }))
        .slice(-keep);
    if (rows.length === 0) throw new Error(`Kraken has no daily closes for ${asset}`);
    return { value: rows, unit: 'CAD', currency: 'CAD', source: KRAKEN, endpoint, fetchedAt: new Date().toISOString(), asOf: rows[rows.length - 1].date };
}

/** Up to one year of daily closes in CAD (UTC days), oldest first. The day still in progress is left out. */
export function dailyCloses(asset: CryptoAsset): Promise<Sourced<DailyClose[]>> {
    return remember(`kraken-closes-${asset}`, DAY_MS, () => closesOf(asset, 365));
}

/** Every daily close Kraken keeps (720 bars, about two years), for the portfolio X-ray. */
export function dailyClosesMax(asset: CryptoAsset): Promise<Sourced<DailyClose[]>> {
    return remember(`kraken-closes-${asset}-max`, DAY_MS, () => closesOf(asset, 720));
}
