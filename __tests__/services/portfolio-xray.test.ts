import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyClose } from '@/lib/sources/types';
import { ServiceError } from '@/lib/services/errors';
import { simulateTrade } from '@/lib/services/portfolio';
import { getPortfolioXray, getXrayWhatIf } from '@/lib/services/portfolio-xray';
import { freshWorld, market, sourced } from './helpers';

vi.mock('@/lib/services/quotes', async (original) => (await import('./market-stub')).quotesMock(await original()));

const DAY = 24 * 60 * 60 * 1000;
const END = Date.parse('2026-11-13T00:00:00Z');
const dates = (() => {
    const out: string[] = [];
    for (let ms = END; out.length < 130; ms -= DAY) {
        const day = new Date(ms).getUTCDay();
        if (day !== 0 && day !== 6) out.unshift(new Date(ms).toISOString().slice(0, 10));
    }
    return out;
})();
const series = (kind: 'A' | 'B', currency: 'USD' | 'CAD'): ReturnType<typeof sourced<DailyClose[]>> => {
    let level = 100;
    const rows = dates.map((date, i) => {
        if (i > 0) level *= 1 + ((kind === 'A' ? i % 2 : Math.floor(i / 2) % 2) === 0 ? 0.01 : -0.01);
        return { date, close: level };
    });
    return sourced(rows, { source: 'closes stub', currency, endpoint: 'stub://closes', asOf: dates[dates.length - 1] });
};

async function holdTwo() {
    // AAPL: 100 USD at 1.42 = 142 CAD a unit, 20 units = 2840 CAD. RY.TO: 50 CAD, 40 units = 2000 CAD. Cash left: 5160.
    await simulateTrade({ symbol: 'AAPL', side: 'buy', amountCad: 2840 });
    await simulateTrade({ symbol: 'RY.TO', side: 'buy', amountCad: 2000 });
    market.closes.AAPL = series('A', 'USD');
    market.closes['RY.TO'] = series('B', 'CAD');
    market.fxHistory = [{ date: dates[0], rate: 1.4 }, { date: dates[60], rate: 1.42 }];
}

beforeEach(async () => {
    await freshWorld();
});

describe('getPortfolioXray', () => {
    it('is cash only for an empty portfolio, with the profile band and the answer to the drop question', async () => {
        const xray = await getPortfolioXray('en');
        expect(xray).toMatchObject({ version: 'xray-v1', simulated: true, totalValueCad: 10000, cashSharePct: 100, asOf: null, sources: [] });
        expect(xray.holdings).toEqual([]);
        expect(xray.windows.full).toEqual({ id: 'full', available: false, reason: 'no_holdings' });
        expect(xray.band).toEqual({ risk: 'Medium', volatilityLimitPct: 35 });   // rules/v1.json: Medium cap 0.35
        expect(xray.dropAnswer).toBe('wait');
    });

    it('reads the holdings, replays them in CAD and cites every series it used', async () => {
        await holdTwo();
        const xray = await getPortfolioXray('en');
        expect(xray.holdings.map((h) => [h.symbol, h.sharePct, h.currency])).toEqual([['AAPL', 28.4, 'USD'], ['RY.TO', 20, 'CAD']]);
        expect(xray.cashSharePct).toBe(51.6);
        const full = xray.windows.full;
        if (!full.available) throw new Error('expected the full window');
        expect(full.coverage).toEqual({ sharePct: 100, included: expect.arrayContaining(['AAPL', 'RY.TO']), excluded: [], gaps: [] });
        expect(full.risk.reduce((sum, r) => sum + (r.riskSharePct ?? 0), 0)).toBeCloseTo(100, 1);
        expect(full.volatilityPct).toBeGreaterThan(0);
        expect(xray.asOf).toBe(dates[dates.length - 1]);
        const named = xray.sources.map((s) => s.value.split(':')[0]).sort();
        expect(named).toEqual(['AAPL', 'RY.TO', 'USD/CAD']);
        expect(xray.sources.find((s) => s.value.startsWith('AAPL'))).toMatchObject({ source: 'closes stub', endpoint: 'stub://closes', fetchedAt: expect.any(String) });
        expect(xray.method).toContain('xray-v1');
        expect(xray.assumptions.length).toBeGreaterThan(3);
    });

    it('does not convert a USD series it has no exchange rates for: the symbol is listed as having no history', async () => {
        await holdTwo();
        market.fxHistory = [];
        const xray = await getPortfolioXray('en');
        expect(xray.noHistory).toEqual(['AAPL']);
        expect(xray.sources.map((s) => s.value.split(':')[0])).toEqual(['RY.TO']);
    });

    it('lists a held symbol whose provider gave no closes, and replays the rest', async () => {
        await holdTwo();
        delete market.closes['RY.TO'];
        const xray = await getPortfolioXray('en');
        expect(xray.noHistory).toEqual(['RY.TO']);
        const full = xray.windows.full;
        expect(full.available && full.coverage.included).toEqual(['AAPL']);
    });

    it('names the groups in the request language', async () => {
        await holdTwo();
        const en = await getPortfolioXray('en');
        const fr = await getPortfolioXray('fr');
        const apple = (view: typeof en) => view.holdings.find((h) => h.symbol === 'AAPL')!.group;
        expect(apple(en)).toBe('Information Technology');
        expect(apple(fr)).toBe('Technologies de l’information');
        expect(fr.concentration.groups.map((g) => g.name)).toContain('Technologies de l’information');
    });
});

describe('getXrayWhatIf', () => {
    it('shows before and after of an addition: it spends cash and raises the share', async () => {
        await holdTwo();
        const result = await getXrayWhatIf({ symbol: 'RY.TO', amountCad: 1000, direction: 'add' }, 'en');
        expect(result.simulated).toBe(true);
        expect(result.change).toEqual({ symbol: 'RY.TO', amountCad: 1000, direction: 'add' });
        expect(result.before.cashSharePct).toBe(51.6);
        expect(result.after.cashSharePct).toBe(41.6);
        expect(result.after.holdings.find((h) => h.symbol === 'RY.TO')?.sharePct).toBe(30);
        expect(result.conflicts).toEqual([]);
        // the real portfolio is untouched
        expect((await getPortfolioXray('en')).cashSharePct).toBe(51.6);
    });

    it('adds an asset not held yet, using its own closes', async () => {
        await holdTwo();
        market.prices.MSFT = { value: 200, currency: 'USD' };
        market.closes.MSFT = series('B', 'USD');
        const result = await getXrayWhatIf({ symbol: 'MSFT', amountCad: 500, direction: 'add' });
        expect(result.after.holdings.map((h) => h.symbol).sort()).toEqual(['AAPL', 'MSFT', 'RY.TO']);
        expect(result.after.holdings.find((h) => h.symbol === 'MSFT')?.sharePct).toBe(5);
    });

    it('compares before and after over the same window when the added asset has a shorter history', async () => {
        await holdTwo();
        market.prices.MSFT = { value: 200, currency: 'USD' };
        const full = series('B', 'USD');
        // the last 90 weekdays only: the before side alone would run over 130
        market.closes.MSFT = { ...full, value: full.value.slice(-90) };
        const result = await getXrayWhatIf({ symbol: 'MSFT', amountCad: 500, direction: 'add' }, 'en');
        const before = result.before.windows.full;
        const after = result.after.windows.full;
        if (!before.available || !after.available) throw new Error('expected both windows');
        expect(before.from).toBe(dates[40]);
        expect(after.from).toBe(before.from);
        expect(after.to).toBe(before.to);
        expect(after.coverage.included.sort()).toEqual(['AAPL', 'MSFT', 'RY.TO']);
        expect(after.coverage.sharePct).toBe(100);
        expect(before.coverage.included.sort()).toEqual(['AAPL', 'RY.TO']);
        // the plain X-ray keeps its own, longer window
        const plain = (await getPortfolioXray('en')).windows.full;
        expect(plain.available && plain.from).toBe(dates[0]);
        // the before side cites only the series it read
        expect(result.before.sources.map((s) => s.value.split(':')[0])).not.toContain('MSFT');
        expect(result.after.sources.map((s) => s.value.split(':')[0])).toContain('MSFT');
    });

    it('marks the after side unavailable, with the reason, when the added asset has no price history', async () => {
        await holdTwo();
        market.prices.MSFT = { value: 200, currency: 'USD' };
        const result = await getXrayWhatIf({ symbol: 'MSFT', amountCad: 500, direction: 'add' }, 'en');
        expect(result.before.windows.full.available).toBe(true);
        expect(result.after.windows.full).toEqual({ id: 'full', available: false, reason: 'changed_asset_no_history', gap: { symbol: 'MSFT', reason: 'no_history', firstDate: null, lastDate: null } });
    });

    it('names the profile conflicts of an addition with their actual values', async () => {
        await holdTwo();
        market.prices.TSLA = { value: 200, currency: 'USD' };
        market.closes.TSLA = series('A', 'USD');
        market.signals.TSLA = { volatility1y: sourced(0.6, { source: 'derived' }) };
        const result = await getXrayWhatIf({ symbol: 'TSLA', amountCad: 500, direction: 'add' }, 'en');
        const volatility = result.conflicts.find((c) => c.filter === 'volatility');
        expect(volatility).toBeDefined();
        expect(volatility!.detail).toMatch(/60/);
    });

    it('reduces a position, returning the amount to cash, and removes it when nothing is left', async () => {
        await holdTwo();
        const half = await getXrayWhatIf({ symbol: 'RY.TO', amountCad: 1000, direction: 'reduce' });
        expect(half.after.cashSharePct).toBe(61.6);
        expect(half.after.holdings.find((h) => h.symbol === 'RY.TO')?.sharePct).toBe(10);
        const all = await getXrayWhatIf({ symbol: 'RY.TO', amountCad: 2000, direction: 'reduce' });
        expect(all.after.holdings.map((h) => h.symbol)).toEqual(['AAPL']);
        expect(all.conflicts).toEqual([]);
    });

    const refused = async (promise: Promise<unknown>, status: number) => {
        const error = await promise.catch((e) => e);
        expect(error).toBeInstanceOf(ServiceError);
        expect((error as ServiceError).status).toBe(status);
        return error as ServiceError;
    };

    it('refuses what a trade would refuse, and what makes no sense', async () => {
        await holdTwo();
        await refused(getXrayWhatIf({ symbol: 'NOPE', amountCad: 100, direction: 'add' }), 404);
        await refused(getXrayWhatIf({ symbol: 'GOLD', amountCad: 100, direction: 'add' }), 400);
        await refused(getXrayWhatIf({ symbol: 'RY.TO', amountCad: 0, direction: 'add' }), 400);
        await refused(getXrayWhatIf({ symbol: 'RY.TO', amountCad: Number.NaN, direction: 'reduce' }), 400);
        const short = await refused(getXrayWhatIf({ symbol: 'RY.TO', amountCad: 6000, direction: 'add' }), 400);
        expect(short.message).toMatch(/cash/i);
        await refused(getXrayWhatIf({ symbol: 'MSFT', amountCad: 100, direction: 'reduce' }), 400);
        await refused(getXrayWhatIf({ symbol: 'RY.TO', amountCad: 2500, direction: 'reduce' }), 400);
        // an asset with no price cannot be added
        await refused(getXrayWhatIf({ symbol: 'MSFT', amountCad: 100, direction: 'add' }), 502);
    });

    it('needs a profile to name conflicts', async () => {
        await freshWorld(false);
        await refused(getXrayWhatIf({ symbol: 'RY.TO', amountCad: 100, direction: 'add' }), 409);
    });
});
