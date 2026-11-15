import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chat, resetReplyCache } from '@/lib/agent/chat';
import { callAgent } from '@/lib/agent/client';
import { quotedUserText } from '@/lib/agent/wording';
import { freshWorld } from '../services/helpers';

vi.mock('@/lib/services/quotes', async (original) => (await import('../services/market-stub')).quotesMock(await original()));
vi.mock('@/lib/services/watchlist', () => ({
    getWatchlist: async () => ({ result: { snapshotId: 'snap_test', picks: [] } }),
    resetWatchlistMemory: () => undefined,
}));
vi.mock('@/lib/agent/client', async (original) => ({ ...(await original<typeof import('@/lib/agent/client')>()), callAgent: vi.fn() }));
vi.mock('@/i18n/locale', () => ({ getAppLocale: vi.fn(async () => 'fr'), resolveLocale: vi.fn(async () => 'fr') }));

const agent = vi.mocked(callAgent);
const strategy = { name: 'Bon départ', rules: [{ kind: 'weight_cap', maxWeightPct: 20 }] };
const answer = (text: string, proposed?: object) => ({ text, sources: [], refused: false, promptVersion: 'p8', modelCalls: [], ...(proposed ? { proposed } : {}) });

beforeEach(async () => {
    await freshWorld();
    resetReplyCache();
    agent.mockReset();
});

describe('wording check on replies about a settings change', () => {
    it('finds short quotes of the user text only', () => {
        expect(quotedUserText('Votre stratégie « Bon départ » est prête.', ['Crée la stratégie Bon départ'])).toEqual(['Bon départ']);
        expect(quotedUserText('« vous devriez acheter » ici', ['bonjour'])).toEqual([]);
    });

    it('lets a strategy name the user gave through, and still withholds advice wording', async () => {
        agent.mockResolvedValue(answer('Votre stratégie « Bon départ » plafonne chaque position.', { type: 'strategy_propose', summary: 's', params: { strategy } }));
        const named = await chat({ message: 'Crée une stratégie « Bon départ » avec un plafond de 20 %' });
        expect(named.refused).toBe(false);
        expect(named.text).toContain('Bon départ');

        agent.mockResolvedValue(answer('Vous devriez acheter plus.', { type: 'layout_change', summary: 's', params: { layout: ['total_value'] } }));
        expect((await chat({ message: 'masque tout' })).refused).toBe(true);
    });

    it('sends the conversation id to the agent service for its memory', async () => {
        agent.mockResolvedValue(answer('Bonjour.'));
        await chat({ message: 'salut', conversationId: 'conv-42' });
        expect(agent.mock.calls[0][0]).toMatchObject({ conversationId: 'conv-42' });
    });
});
