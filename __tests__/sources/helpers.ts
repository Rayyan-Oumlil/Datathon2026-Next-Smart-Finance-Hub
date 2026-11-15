import { mkdtempSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';
import { clearMemoryCache } from '@/lib/sources/cache';

export const fixture = (name: string) => JSON.parse(readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));

/** A fresh, empty cache (memory and disk) and no wait between Finnhub calls. Returns the cache directory. */
export function freshCache(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'sources-test-'));
    process.env.DATA_CACHE_DIR = dir;
    process.env.FINNHUB_API_KEY = 'test-key';
    process.env.FINNHUB_SPACING_MS = '0';
    delete process.env.FINNHUB_API_KEYS;
    clearMemoryCache();
    return dir;
}

type Answer = { status?: number; json?: unknown; headers?: Record<string, string> };
export type Call = { url: string; init?: RequestInit };

/** Replaces fetch: `answer` decides per call. Returns the list of calls made. */
export function mockFetch(answer: (call: Call, index: number) => Answer): Call[] {
    const calls: Call[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
        const call = { url: String(url), init };
        calls.push(call);
        const { status = 200, json = {}, headers } = answer(call, calls.length - 1);
        return new Response(JSON.stringify(json), { status, headers });
    }));
    return calls;
}

/** Every provider answering from the recorded fixtures. `override` can answer first (return undefined to pass). */
export function mockProviders(override: (call: Call) => Answer | undefined = () => undefined): Call[] {
    return mockFetch((call) => {
        const overridden = override(call);
        if (overridden) return overridden;
        const { url } = call;
        if (url.includes('finnhub.io')) {
            if (url.includes('symbol=AAPL')) {
                if (url.includes('/quote?')) return { json: fixture('finnhub-quote-AAPL.json') };
                if (url.includes('/stock/profile2?')) return { json: fixture('finnhub-profile-AAPL.json') };
                if (url.includes('/stock/metric?')) return { json: fixture('finnhub-metric-AAPL.json') };
                if (url.includes('/company-news?')) return { json: fixture('finnhub-news-AAPL.json') };
            }
            if (url.includes('/stock/profile2?symbol=RY')) return { json: fixture('finnhub-profile-RY.json') };
            return { status: 403, json: fixture('finnhub-quote-RY.TO-403.json') };
        }
        if (url.includes('finance.yahoo.com')) return { json: fixture('yahoo-chart.hand-written.json') };
        if (url.includes('app-money.tmx.com')) {
            const body = JSON.parse(String(call.init?.body)) as { operationName: string; variables: { symbol: string } };
            if (body.operationName === 'getTimeSeriesData') return { json: fixture('tmx-timeseries-RY.json') };
            if (body.variables.symbol === 'RY') return { json: fixture('tmx-quote-RY.json') };
            if (body.variables.symbol === 'XIU') return { json: fixture('tmx-quote-XIU.json') };
            return { json: fixture('tmx-quote-notfound.json') };
        }
        if (url.includes('bankofcanada.ca')) {
            if (url.includes('FXUSDCAD')) return { json: fixture('boc-fx.json') };
            if (url.includes('V39079')) return { json: fixture('boc-policy.json') };
            return { json: fixture('boc-yields.json') };
        }
        if (url.includes('api.kraken.com')) {
            if (url.includes('/OHLC')) return { json: fixture('kraken-ohlc-XBTCAD.json') };
            return { json: fixture(url.includes('ETHCAD') ? 'kraken-ticker-ETHCAD.json' : 'kraken-ticker-XBTCAD.json') };
        }
        return { status: 404 };
    });
}
