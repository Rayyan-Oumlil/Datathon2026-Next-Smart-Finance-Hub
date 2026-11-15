import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProfile } from '@/lib/rules/profile';
import { getPortfolioState, simulateTrade } from '@/lib/services/portfolio';
import { ZERO_GENERATIONS, scopeFor } from '@/lib/session';
import { putProfile } from '@/lib/store';
import { NOW, answers, freshWorld } from './helpers';

vi.mock('@/lib/services/quotes', async (original) => (await import('./market-stub')).quotesMock(await original()));

beforeEach(() => freshWorld(false));

describe('visitor sessions', () => {
    it('do not see each other\'s simulated portfolio', async () => {
        const a = scopeFor('11111111-1111-4111-8111-111111111111', ZERO_GENERATIONS);
        const b = scopeFor('22222222-2222-4222-8222-222222222222', ZERO_GENERATIONS);
        for (const scope of [a, b]) await putProfile(buildProfile(scope.profileUserId, answers(), NOW));
        const outcome = await simulateTrade({ symbol: 'RY.TO', side: 'buy', amountCad: 500 }, 'en', a);
        expect(outcome.status).toBe('filled');
        expect((await getPortfolioState(a)).positions.map((p) => p.symbol)).toEqual(['RY.TO']);
        expect(await getPortfolioState(b)).toMatchObject({ positions: [], trades: [], cashCad: 10000 });
    });
});
