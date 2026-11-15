// The agent's X-ray tool reads the same service as the page: its what-if JSON carries the same common window,
// coverage and reasons as the page's.

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as TOOL } from '@/app/api/internal/tools/portfolio-xray/route';
import { DEMO_USER } from '@/lib/demo-user';
import { simulateTrade } from '@/lib/services/portfolio';
import { freshWorld, market, sourced } from '../services/helpers';

vi.mock('@/lib/services/quotes', async (original) => (await import('../services/market-stub')).quotesMock(await original()));

const TOKEN = 'test-token-0123456789';
const DAY = 24 * 60 * 60 * 1000;
const dates = (() => {
    const out: string[] = [];
    for (let ms = Date.parse('2026-11-13T00:00:00Z'); out.length < 130; ms -= DAY) {
        const d = new Date(ms).getUTCDay();
        if (d !== 0 && d !== 6) out.unshift(new Date(ms).toISOString().slice(0, 10));
    }
    return out;
})();
const closesOf = (list: string[], currency: string) => sourced(list.map((date, i) => ({ date, close: 100 + (i % 3) })), { source: 'closes stub', currency });

const tool = (body: unknown) =>
    TOOL(new NextRequest('http://localhost/api/internal/tools/portfolio-xray', {
        method: 'POST', body: JSON.stringify({ userId: DEMO_USER.id, ...(body as object) }), headers: { 'x-internal-token': TOKEN },
    }));

beforeEach(async () => {
    process.env.INTERNAL_API_TOKEN = TOKEN;
    await freshWorld();
    await simulateTrade({ symbol: 'RY.TO', side: 'buy', amountCad: 2000 });
    market.closes['RY.TO'] = closesOf(dates, 'CAD');
});

describe('the agent tool, what-if', () => {
    it('gives before and after over the same period, with coverage and the calendar', async () => {
        market.prices.MSFT = { value: 200, currency: 'USD' };
        market.closes.MSFT = closesOf(dates.slice(-90), 'USD');
        market.fxHistory = [{ date: dates[0], rate: 1.4 }];
        const body = await (await tool({ change: { symbol: 'MSFT', amountCad: 500, direction: 'add' } })).json();
        const before = body.before.windows.full;
        const after = body.after.windows.full;
        expect([before.from, before.to]).toEqual([after.from, after.to]);
        expect(after.from).toBe(dates[40]);
        expect(after.coverage).toMatchObject({ sharePct: 100, excluded: [], gaps: [] });
        expect(after.calendar).toBe('exchange');
        expect(after.periodsPerYear).toEqual(expect.any(Number));
        expect(body.after.figures.volatility_full.note).toContain(`${after.from} to ${after.to}`);
    });

    it('says the after side is unavailable, and why, when the added asset has no history', async () => {
        market.prices.MSFT = { value: 200, currency: 'USD' };
        const body = await (await tool({ change: { symbol: 'MSFT', amountCad: 500, direction: 'add' } })).json();
        expect(body.after.windows.full).toEqual({ id: 'full', available: false, reason: 'changed_asset_no_history', gap: { symbol: 'MSFT', reason: 'no_history', firstDate: null, lastDate: null } });
        expect(body.before.windows.full.available).toBe(true);
    });
});
