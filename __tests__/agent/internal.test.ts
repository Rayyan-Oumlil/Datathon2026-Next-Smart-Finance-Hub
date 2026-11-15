import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenMatches } from '@/lib/agent/internal';
import { POST as LAYOUT } from '@/app/api/internal/tools/layout/route';
import { POST as CONFLICT } from '@/app/api/internal/tools/conflict-check/route';
import { POST as PROFILE_PREVIEW } from '@/app/api/internal/tools/profile-preview/route';
import { POST as VALIDATE } from '@/app/api/internal/tools/validate-rule/route';
import { DEMO_USER } from '@/lib/demo-user';
import { listDecisions } from '@/lib/store';
import { freshWorld, market, sourced } from '../services/helpers';

vi.mock('@/lib/services/quotes', async (original) => (await import('../services/market-stub')).quotesMock(await original()));

const TOKEN = 'test-token-0123456789';
const call = (handler: (req: NextRequest) => Promise<Response>, body: unknown, token?: string) =>
    handler(new NextRequest('http://localhost/api/internal/tools/x', {
        method: 'POST', body: JSON.stringify(body), headers: { ...(token === undefined ? {} : { 'x-internal-token': token }), 'x-action-id': 'act_test' },
    }));

beforeEach(async () => {
    process.env.INTERNAL_API_TOKEN = TOKEN;
    await freshWorld();
});

describe('internal token', () => {
    it('refuses a missing, wrong or prefix token with 401', async () => {
        for (const token of [undefined, '', 'wrong', TOKEN.slice(0, -1), `${TOKEN}x`]) {
            const response = await call(LAYOUT, { userId: DEMO_USER.id }, token);
            expect(response.status, String(token)).toBe(401);
            expect(await response.json()).toEqual({ error: 'unauthorized' });
        }
    });

    it('refuses everything when the server has no token set', () => {
        delete process.env.INTERNAL_API_TOKEN;
        expect(tokenMatches('')).toBe(false);
        expect(tokenMatches('undefined')).toBe(false);
    });

    it('accepts the right token and takes the user from the body', async () => {
        const ok = await call(LAYOUT, { userId: DEMO_USER.id }, TOKEN);
        expect(ok.status).toBe(200);
        expect(await ok.json()).toMatchObject({ current: expect.arrayContaining(['total_value']), library: expect.any(Array) });
        expect((await call(LAYOUT, { userId: 'someone-else' }, TOKEN)).status).toBe(404);
        expect((await call(LAYOUT, {}, TOKEN)).status).toBe(200);          // no userId: a readable error for the model
        expect(await (await call(LAYOUT, {}, TOKEN)).json()).toHaveProperty('error');
    });
});

describe('tools', () => {
    it('conflict-check names the failed filter with its values and logs it', async () => {
        market.signals.AAPL = { volatility1y: sourced(0.6, { source: 'derived' }) };
        const body = await (await call(CONFLICT, { userId: DEMO_USER.id, symbol: 'aapl' }, TOKEN)).json();
        expect(body).toMatchObject({ symbol: 'AAPL', level: 'Intermediate', risk: 'Medium', conflicts: [{ filter: 'volatility', pass: false }] });
        // Only the value behind the conflict comes back, with its source; the full signal set does not
        expect(body).not.toHaveProperty('signals');
        expect(body.sources).toEqual({ volatility1y: expect.objectContaining({ value: 0.6, source: 'derived' }) });
        const [row] = await listDecisions(DEMO_USER.id, { kind: 'profile_conflict' });
        expect(row).toMatchObject({ symbol: 'AAPL', payload: { origin: 'agent', actionId: 'act_test', proceeded: false } });
        expect(await (await call(CONFLICT, { userId: DEMO_USER.id, symbol: 'NOPE' }, TOKEN)).json()).toEqual({ error: expect.stringContaining('not in the app') });
    });

    it('validate-rule and profile-preview save nothing', async () => {
        const rule = { text: 'x', symbol: 'AAPL', trigger: { type: 'price_below', value: 90 }, action: { side: 'buy', amountCad: 200 }, once: true };
        expect(await (await call(VALIDATE, { userId: DEMO_USER.id, rule }, TOKEN)).json()).toMatchObject({ ok: true, rule: { symbol: 'AAPL' }, currentPrice: { value: 100 } });
        const preview = await (await call(PROFILE_PREVIEW, { userId: DEMO_USER.id, changes: { drop20: 'buy_more', echeance: '5+ yrs' } }, TOKEN)).json();
        expect(preview).toMatchObject({ before: { risk: 'Medium' }, after: { risk: 'High' }, riskResult: { ruleVersion: 'risk-v1' } });
        expect(await listDecisions(DEMO_USER.id, { kind: 'profile_change' })).toEqual([]);
    });
});
