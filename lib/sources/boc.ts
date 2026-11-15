// Bank of Canada Valet: Government of Canada benchmark bond yields, the daily USD/CAD rate and the policy rate.
// Official, keyless, and each observation carries its own date.

import type { Sourced } from '@/lib/domain/types';
import { DAY_MS, remember } from './cache';
import { fetchJson } from './http';

export const BANK_OF_CANADA = 'Bank of Canada';
const BASE_URL = 'https://www.bankofcanada.ca/valet/observations';

export const YIELD_SERIES = {
    '2Y': 'BD.CDN.2YR.DQ.YLD',
    '5Y': 'BD.CDN.5YR.DQ.YLD',
    '10Y': 'BD.CDN.10YR.DQ.YLD',
    LONG: 'BD.CDN.LONG.DQ.YLD',
} as const;
export type YieldTerm = keyof typeof YIELD_SERIES;

type Observations = {
    seriesDetail?: Record<string, { label?: string }>;
    observations?: Array<{ d: string } & Record<string, { v?: string } | string>>;
};

// The latest observation of each series, as one call. Series can lag each other by a day, so each keeps its own date.
async function latest(series: string[], unit: string): Promise<Record<string, Sourced>> {
    const endpoint = `${BASE_URL}/${series.join(',')}/json?recent=5`;
    const json = await fetchJson<Observations>(endpoint);
    const fetchedAt = new Date().toISOString();
    const result: Record<string, Sourced> = {};
    for (const observation of json.observations ?? []) {
        for (const name of series) {
            const cell = observation[name];
            // Number('') is 0: an empty or absent cell must stay absent, never become a 0 % yield or a 0 rate
            const value = typeof cell === 'object' && typeof cell.v === 'string' && cell.v.trim() !== '' ? Number(cell.v) : NaN;
            // Keep the most recent date per series, whatever order the rows come in
            if (Number.isFinite(value) && observation.d > (result[name]?.asOf ?? '')) {
                result[name] = { value, unit, source: BANK_OF_CANADA, endpoint, fetchedAt, asOf: observation.d, note: json.seriesDetail?.[name]?.label };
            }
        }
    }
    return result;
}

/** Benchmark yields in percent. A term the Bank did not publish is absent from the result. */
export function bondYields(): Promise<Partial<Record<YieldTerm, Sourced>>> {
    return remember('boc-bond-yields', DAY_MS, async () => {
        const bySeries = await latest(Object.values(YIELD_SERIES), '%');
        const result: Partial<Record<YieldTerm, Sourced>> = {};
        for (const [term, series] of Object.entries(YIELD_SERIES) as Array<[YieldTerm, string]>) {
            if (bySeries[series]) result[term] = bySeries[series];
        }
        if (Object.keys(result).length === 0) throw new Error('Bank of Canada returned no bond yield');
        return result;
    });
}

async function single(series: string, unit: string, what: string): Promise<Sourced> {
    const value = (await latest([series], unit))[series];
    if (!value) throw new Error(`Bank of Canada returned no ${what}`);
    return value;
}

async function positive(series: string, unit: string, what: string): Promise<Sourced> {
    const value = await single(series, unit, what);
    // Amounts are divided by this rate
    if (!(value.value > 0)) throw new Error(`Bank of Canada returned an unusable ${what}: ${value.value}`);
    return value;
}

/** Canadian dollars for one US dollar (daily average rate). USD = CAD / rate. */
export const fxUsdCad = (): Promise<Sourced> => remember('boc-fx-usdcad', DAY_MS, () => positive('FXUSDCAD', 'CAD per USD', 'USD/CAD rate'));

/** Target for the overnight rate, in percent. */
export const policyRate = (): Promise<Sourced> => remember('boc-policy-rate', DAY_MS, () => single('V39079', '%', 'policy rate'));
