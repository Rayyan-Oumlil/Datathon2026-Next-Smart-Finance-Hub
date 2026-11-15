import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as XRAY } from '@/app/api/portfolio/xray/route';
import { POST as WHAT_IF } from '@/app/api/portfolio/xray/what-if/route';
import { POST as TOOL } from '@/app/api/internal/tools/portfolio-xray/route';
import { DEMO_USER } from '@/lib/demo-user';
import { simulateTrade } from '@/lib/services/portfolio';
import { freshWorld, market, sourced } from './helpers';

vi.mock('@/lib/services/quotes', async (original) => (await import('./market-stub')).quotesMock(await original()));

const TOKEN = 'test-token-0123456789';
const DAY = 24 * 60 * 60 * 1000;
const dates = (() => {
    const out: string[] = [];
    for (let ms = Date.parse('2026-11-13T00:00:00Z'); out.length < 100; ms -= DAY) {
        const d = new Date(ms).getUTCDay();
        if (d !== 0 && d !== 6) out.unshift(new Date(ms).toISOString().slice(0, 10));
    }
    return out;
})();
const closes = sourced(dates.map((date, i) => ({ date, close: 100 + (i % 3) })), { source: 'closes stub', currency: 'CAD' });

const get = (headers: Record<string, string> = {}) => XRAY(new NextRequest('http://localhost/api/portfolio/xray', { headers }));
const post = (body: unknown, headers: Record<string, string> = {}) =>
    WHAT_IF(new NextRequest('http://localhost/api/portfolio/xray/what-if', { method: 'POST', body: JSON.stringify(body), headers }));
const tool = (body: unknown, token: string | null = TOKEN) =>
    TOOL(new NextRequest('http://localhost/api/internal/tools/portfolio-xray', {
        method: 'POST', body: JSON.stringify({ userId: DEMO_USER.id, ...(body as object) }), headers: token === null ? {} : { 'x-internal-token': token },
    }));

beforeEach(async () => {
    process.env.INTERNAL_API_TOKEN = TOKEN;
    await freshWorld();
    await simulateTrade({ symbol: 'RY.TO', side: 'buy', amountCad: 2000 });
    market.closes['RY.TO'] = closes;
});

describe('GET /api/portfolio/xray', () => {
    it('answers the X-ray of the simulated portfolio', async () => {
        const response = await get();
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ version: 'xray-v1', simulated: true, holdings: [{ symbol: 'RY.TO', sharePct: 20 }] });
    });
    it('writes group names in the language of the request', async () => {
        const fr = await (await get({ 'accept-language': 'fr' })).json();
        expect(fr.holdings[0].group).toBe('Services financiers');
    });
});

describe('POST /api/portfolio/xray/what-if', () => {
    it('answers before and after for a valid change', async () => {
        const response = await post({ symbol: 'RY.TO', amountCad: 500, direction: 'add' });
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body).toMatchObject({ simulated: true, change: { symbol: 'RY.TO', amountCad: 500, direction: 'add' } });
        expect(body.before.cashSharePct).toBeGreaterThan(body.after.cashSharePct);
    });
    it('refuses a body that is not a change, with 400 and no stack', async () => {
        for (const body of [{}, { symbol: 'RY.TO', amountCad: -5, direction: 'add' }, { symbol: 'RY.TO', amountCad: 5, direction: 'sell' }, { symbol: '', amountCad: 5, direction: 'add' }, { symbol: 'RY.TO', amountCad: '5', direction: 'add' }]) {
            const response = await post(body);
            expect(response.status, JSON.stringify(body)).toBe(400);
            expect(Object.keys(await response.json())).toEqual(['error']);
        }
    });
    it('answers what a trade would answer: 404 for an unknown asset, 400 for too much cash, in French when asked', async () => {
        expect((await post({ symbol: 'NOPE', amountCad: 5, direction: 'add' })).status).toBe(404);
        const short = await post({ symbol: 'RY.TO', amountCad: 99999, direction: 'add' }, { 'accept-language': 'fr' });
        expect(short.status).toBe(400);
        expect((await short.json()).error).toMatch(/liquidités simulées/);
    });
    it('is capped per minute', async () => {
        let last = 200;
        for (let i = 0; i < 25; i++) last = (await post({ symbol: 'RY.TO', amountCad: 1, direction: 'add' })).status;
        expect(last).toBe(429);
    });
});

describe('POST /api/internal/tools/portfolio-xray', () => {
    it('refuses a missing or wrong token', async () => {
        expect((await tool({}, null)).status).toBe(401);
        expect((await tool({}, 'wrong')).status).toBe(401);
    });
    it('gives the agent the numbers without the chart curve', async () => {
        const body = await (await tool({})).json();
        expect(body.version).toBe('xray-v1');
        const full = body.windows.full;
        expect(full.available).toBe(true);
        expect(full).not.toHaveProperty('curve');
        expect(full.volatilityPct).toEqual(expect.any(Number));
        expect(body.method).toContain('xray-v1');
        // every headline figure is also given as a sourced value, so a reply that states it can cite where it comes from
        expect(body.figures.volatility_full).toMatchObject({ unit: '%', fetchedAt: expect.any(String), source: expect.stringContaining('derived (xray-v1)') });
        expect(body.figures.holdings_full[0]).toMatchObject({ symbol: 'RY.TO' });
    });
    it('reports only the window asked for (whole history by default), figures included', async () => {
        const whole = await (await tool({})).json();
        expect(Object.keys(whole.windows)).toEqual(['full']);
        expect(Object.keys(whole.figures).some((key) => key.endsWith('_last1y'))).toBe(false);
        const year = await (await tool({ window: 'last1y' })).json();
        expect(Object.keys(year.windows)).toEqual(['last1y']);
        expect(year.figures.volatility_last1y).toBeDefined();
        expect(year.figures.volatility_full).toBeUndefined();
        expect((await tool({ window: '2022' })).status).toBe(200);
        expect(await (await tool({ window: '2022' })).json()).toEqual({ error: expect.stringContaining('window') });
    });
    it('answers a what-if with before and after, curve-free, and refuses a bad change as { error }', async () => {
        const body = await (await tool({ change: { symbol: 'RY.TO', amountCad: 500, direction: 'reduce' } })).json();
        expect(body.after.windows.full).not.toHaveProperty('curve');
        expect(body.change.direction).toBe('reduce');
        const refused = await tool({ change: { symbol: 'MSFT', amountCad: 500, direction: 'reduce' } });
        expect(refused.status).toBe(200);
        expect(await refused.json()).toEqual({ error: expect.stringContaining('MSFT') });
    });
});
