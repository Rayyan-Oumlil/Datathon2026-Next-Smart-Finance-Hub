import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PATCH, POST } from '@/app/api/profile/route';
import { POST as TRADE } from '@/app/api/trade/route';
import { containsNeverWord } from '@/lib/watchlist/reasons';
import { answers, freshWorld, market, sourced } from './helpers';

vi.mock('@/lib/services/quotes', async (original) => (await import('./market-stub')).quotesMock(await original()));

const request = (method: string, body: unknown) => new NextRequest('http://localhost/api', { method, body: JSON.stringify(body) });

beforeEach(() => freshWorld(false));

describe('routes', () => {
    it('PATCH /api/profile changes only the fields it names', async () => {
        expect((await POST(request('POST', { answers: answers() }))).status).toBe(200);
        const edited = await (await PATCH(request('PATCH', { answers: { agentStyle: 'teach me' } }))).json();
        expect(edited.profile.answers).toEqual({ ...answers(), agentStyle: 'teach me' });
        expect((await PATCH(request('PATCH', { level: 'Guru' }))).status).toBe(400);
        expect((await PATCH(request('PATCH', { answers: { unknown: 1 } }))).status).toBe(400);
    });

    it('POST /api/profile drops experience and tools for someone who has not traded, and refuses a bad answer', async () => {
        const saved = await (await POST(request('POST', { answers: { ...answers(), traded: false } }))).json();
        expect(saved.profile.level).toBe('Novice');
        expect(saved.profile.answers).not.toHaveProperty('experience');
        const refused = await POST(request('POST', { answers: { ...answers(), drop20: 'panic' } }));
        expect(refused.status).toBe(400);
        expect(await refused.json()).toEqual({ error: expect.stringContaining('answers.drop20') });
    });

    it('POST /api/trade answers 409 with the conflicts and signals, then 200 once acknowledged', async () => {
        await POST(request('POST', { answers: answers() }));
        market.signals.AAPL = { volatility1y: sourced(0.5, { source: 'derived' }) };
        const conflict = await TRADE(request('POST', { symbol: 'AAPL', side: 'buy', amountCad: 142 }));
        expect(conflict.status).toBe(409);
        expect(await conflict.json()).toMatchObject({ conflicts: [{ filter: 'volatility' }], signals: { symbol: 'AAPL' }, message: expect.stringContaining('35.0%') });
        const done = await TRADE(request('POST', { symbol: 'AAPL', side: 'buy', amountCad: 142, acknowledgeConflict: true }));
        expect(done.status).toBe(200);
        expect(await done.json()).toMatchObject({ trade: { quantity: 1, simulated: true }, portfolio: { cashCad: 9858 } });
        expect((await TRADE(request('POST', { symbol: 'AAPL', side: 'buy', origin: 'rule', amountCad: 1 }))).status).toBe(400);
    });

    it('POST /api/trade accepts only card trades: an agent origin is refused', async () => {
        await POST(request('POST', { answers: answers() }));
        const refused = await TRADE(request('POST', { symbol: 'AAPL', side: 'buy', origin: 'agent', amountCad: 142 }));
        expect(refused.status).toBe(400);
        expect(await refused.json()).toEqual({ error: 'origin: not one of the accepted values' });
        const done = await (await TRADE(request('POST', { symbol: 'AAPL', side: 'buy', amountCad: 142, acknowledgeConflict: true }))).json();
        expect(done.trade.origin).toBe('card');
    });

    it('PATCH /api/profile refuses a risk override above the cap with the answer that limits it', async () => {
        await POST(request('POST', { answers: { ...answers(), drop20: 'sell' } }));
        const refused = await PATCH(request('PATCH', { risk: 'High' }));
        expect(refused.status).toBe(400);
        expect(await refused.json()).toEqual({ error: 'High is not available: you answered "reduce my position" to the 20% drop question, which limits the risk profile to Medium.' });
        expect(containsNeverWord('High is not available: you answered "reduce my position" to the 20% drop question, which limits the risk profile to Medium.')).toBe(false);
    });

    it('answers a value outside a fixed list without quoting the list, which holds words the app never shows', async () => {
        const refused = await TRADE(request('POST', { symbol: 'AAPL', side: 'hold', amountCad: 1 }));
        expect(refused.status).toBe(400);
        const { error } = await refused.json();
        expect(error).toBe('side: not one of the accepted values');
        expect(containsNeverWord(error)).toBe(false);
    });

    it('PATCH /api/profile to "has not traded" drops experience and tools and re-runs the Level rule', async () => {
        await POST(request('POST', { answers: answers() }));
        const edited = await (await PATCH(request('PATCH', { answers: { traded: false } }))).json();
        expect(edited).toMatchObject({ before: { level: 'Intermediate' }, after: { level: 'Novice' } });
        expect(edited.profile.answers).not.toHaveProperty('experience');
        expect(edited.profile.answers).not.toHaveProperty('tools');
    });
});
