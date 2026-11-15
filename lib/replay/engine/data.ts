// Builds the engine's input from the DataProvider: one read of the frozen snapshot, then no I/O at all. The provider
// is the only door to the data (lib/replay/provider.ts); this file never knows where the snapshot lives.

import { buildCommonCalendar } from '../calendar';
import type { DataProvider } from '../provider';
import { addDays, asOf, fxAsOf } from '../series';
import type { ReplayAsset } from '../types';
import type { ReplayData, ReplaySymbolData } from './types';

/** The references every replay is compared with (docs/v2-plan.md): XIU.TO, and 60/40 XIU.TO / XBB.TO. */
export const BENCHMARK_SYMBOLS = ['XIU.TO', 'XBB.TO'] as const;

/**
 * Loads the symbols (and the benchmark symbols) on the snapshot's common calendar. A symbol the snapshot does not
 * hold is listed in `missing`, never invented. Crypto uses the close of the previous UTC day, the last one complete
 * at the North American close (same rule as series.ts).
 */
export async function loadReplayData(provider: DataProvider, symbols: string[]): Promise<ReplayData> {
    const description = await provider.describe();
    const assets = new Map<string, ReplayAsset>((await provider.getAssets()).rows.map((asset) => [asset.ticker, asset]));
    const wanted = [...new Set([...symbols, ...BENCHMARK_SYMBOLS])].sort();
    const present = wanted.filter((s) => assets.has(s));
    const missing = wanted.filter((s) => !assets.has(s));
    const tables = present.length > 0 ? await provider.getDailyPrices(present) : [];
    const rowsOf = new Map(present.map((s, i) => [s, tables[i].rows]));

    const calendarInput = { assets: present.map((s) => ({ ...assets.get(s)!, ticker: s })), prices: present.map((s) => ({ id: s, rows: rowsOf.get(s)! })) };
    // The snapshot's own common calendar when the provider gives one (the same days for every replay); else the one of the symbols read
    let calendar = (await provider.getCalendar?.()) ?? buildCommonCalendar(calendarInput);
    // Crypto alone adds no exchange date: such a replay steps through the crypto days themselves
    if (calendar.length === 0) calendar = [...new Set(present.flatMap((s) => rowsOf.get(s)!.map((row) => row.date)))].sort();

    const fx = (await provider.getFx()).rows;
    const usdcad = calendar.map((date) => (fxAsOf(fx, date) ?? fx[0])?.usdcad ?? NaN);

    const out: Record<string, ReplaySymbolData> = {};
    for (const s of present) {
        const asset = assets.get(s)!;
        const rows = rowsOf.get(s)!;
        const lag = asset.assetClass === 'crypto' ? 1 : 0;
        const picked = calendar.map((date) => asOf(rows, lag ? addDays(date, -lag) : date));
        out[s] = {
            currency: asset.currency,
            adj: picked.map((row) => row?.adjClose ?? null),
            close: picked.map((row) => row?.close ?? null),
            firstDate: rows[0]?.date ?? null,
            lastDate: rows[rows.length - 1]?.date ?? null,
        };
        if (asset.currency === 'USD' && usdcad.some((rate) => !(rate > 0))) throw new Error(`replay data: no USD/CAD rate in the snapshot, needed for ${s}`);
    }
    return { snapshotId: description.datasetId, extractedOn: description.extractedOn, calendar, symbols: out, usdcad, missing, limitations: description.limitations };
}
