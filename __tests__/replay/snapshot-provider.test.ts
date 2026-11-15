import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    ReplayDataError,
    SnapshotProvider,
    YahooLiveProvider,
    alignedTotalReturn,
    asOf,
    listSnapshots,
    toCad,
} from '@/lib/replay';

const ROOT = path.join(process.cwd(), '__tests__', 'replay', 'fixtures', 'root');
const ID = 'yf-2021-01-10';
const fresh = (root = ROOT) => new SnapshotProvider({ root, memo: false });

const tmp: string[] = [];
afterEach(() => {
    for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});
function copyRoot(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'replay-snap-'));
    tmp.push(dir);
    cpSync(ROOT, dir, { recursive: true });
    return dir;
}

describe('SnapshotProvider on the fixture snapshot', () => {
    it('picks the newest snapshot and describes it from the manifest', async () => {
        expect(listSnapshots(ROOT).map((s) => s.id)).toEqual([ID]);
        const d = await fresh().describe();
        expect(d.snapshotId).toBe(ID);
        expect(d.provider).toBe('snapshot');
        expect(d.frozen).toBe(true);
        expect(d.window).toEqual({ from: '2021-01-02', to: '2021-01-09' });
        expect(d.files.map((f) => f.name)).toEqual(['prices.csv', 'actions.csv', 'fx.csv']);
        expect(d.excluded?.[0].yahooSymbol).toBe('SPCX');
        expect(d.limitationsText?.fr.length).toBe(d.limitations.length);
        expect(d.manifest?.snapshotId).toBe(ID);
    });

    it('accepts the app symbol and the Yahoo symbol, and explains a missing one', async () => {
        const p = fresh();
        const [btc, btcUsd] = await p.getDailyPrices(['BTC', 'BTC-USD']);
        expect(btc.id).toBe('BTC');
        expect(btc.rows.every((r) => r.ticker === 'BTC')).toBe(true);
        expect(btc.rows.map((r) => r.adjClose)).toEqual(btcUsd.rows.map((r) => r.adjClose));
        await expect(p.getDailyPrices(['SPCX'])).rejects.toThrow(/ends early/);
        await expect(p.getDailyPrices(['CA10Y'])).rejects.toThrow(/yield is not a price/);
        await expect(p.getDailyPrices(['NOPE'])).rejects.toBeInstanceOf(ReplayDataError);
        const symbols = await p.listSymbols();
        expect(symbols.map((s) => s.symbol)).toEqual(['AAPL', 'BTC', 'RY.TO']);
        expect(symbols.find((s) => s.symbol === 'BTC')).toMatchObject({ yahooSymbol: 'BTC-USD', assetClass: 'crypto', firstDate: '2021-01-02' });
        expect(await p.getCalendar()).toEqual(['2021-01-04', '2021-01-05', '2021-01-06', '2021-01-07', '2021-01-08']);
        const actions = await p.getActions(['RY.TO']);
        expect(actions.rows).toEqual([{ exDate: '2021-01-05', ticker: 'RY.TO', action: 'dividend', value: 1.08, unit: 'CAD per share', appliesToPrices: false }]);
    });

    it('refuses a data file whose sha256 differs from the manifest', async () => {
        const root = copyRoot();
        const file = path.join(root, ID, 'prices.csv');
        writeFileSync(file, readFileSync(file, 'utf8').replace('2021-01-06,AAPL,100,', '2021-01-06,AAPL,99,'));
        await expect(fresh(root).describe()).rejects.toThrow(/SHA-256 .* does not match the manifest/);
    });

    it('never looks ahead: an as-of lookup ignores later rows, and changing a later price changes nothing before it', async () => {
        const [aapl] = await fresh().getDailyPrices(['AAPL']);
        expect(asOf(aapl.rows, '2021-01-06')?.adjClose).toBe(100);
        expect(asOf(aapl.rows, '2021-01-03')).toBeUndefined();
        const altered = aapl.rows.map((r) => (r.date === '2021-01-08' ? { ...r, adjClose: 1 } : r));
        const cal = ['2021-01-04', '2021-01-05', '2021-01-06', '2021-01-07', '2021-01-08'];
        const asset = { ticker: 'AAPL', assetClass: 'equity' as const, currency: 'USD' as const };
        const a = alignedTotalReturn(cal, aapl.rows, asset).points.slice(0, 4);
        const b = alignedTotalReturn(cal, altered, asset).points.slice(0, 4);
        expect(b).toEqual(a);
    });

    it('converts to CAD with the day rate, or the last known one (hand-checked)', async () => {
        const p = fresh();
        const [aapl] = await p.getDailyPrices(['AAPL']);
        const fx = await p.getFx();
        const cal = ['2021-01-05', '2021-01-06', '2021-01-07'];
        const cad = toCad(alignedTotalReturn(cal, aapl.rows, { ticker: 'AAPL', assetClass: 'equity', currency: 'USD' }), fx.rows);
        // 01-05: 102 x 1.268 = 129.336; 01-06 has no rate, so the 01-05 rate: 100 x 1.268 = 126.8; 01-07: 105 x 1.272 = 133.56
        expect(cad.points.map((x) => x.value)).toEqual([129.336, 126.8, 133.56].map((v) => expect.closeTo(v, 9)));
        expect(fx.rows.find((r) => r.date === '2021-01-04')?.cadusd).toBe(0.787402);
    });

    it('is deterministic: two independent loads return identical data', async () => {
        const read = async () => {
            const p = fresh();
            return JSON.stringify([await p.getAssets(), await p.getDailyPrices(['AAPL', 'BTC', 'RY.TO']), await p.getFx(), await p.getCorporateActions()]);
        };
        expect(await read()).toBe(await read());
    });

    it('the live provider is off unless REPLAY_ALLOW_LIVE=1, and says its data is not frozen', async () => {
        const live = new YahooLiveProvider();
        await expect(live.getDailyPrices(['AAPL'])).rejects.toThrow(/not enabled in the demo/);
        expect((await live.describe()).frozen).toBe(false);
    });
});
