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
