import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAppLocale } from '@/i18n/locale';
import { NEUTRAL_REPLY, chat, resetReplyCache } from '@/lib/agent/chat';
import { callAgent, type AgentProgress } from '@/lib/agent/client';
import { TEST_SCOPE } from '@/__tests__/test-user';
import { listAgentActions } from '@/lib/store';
import { freshWorld } from '../services/helpers';

vi.mock('@/lib/services/quotes', async (original) => (await import('../services/market-stub')).quotesMock(await original()));
vi.mock('@/lib/services/watchlist', () => ({
    getWatchlist: async () => ({ result: { snapshotId: 'snap_test', picks: [{ rank: 1, symbol: 'AAPL', name: 'Apple Inc.', total: 76.1, signals: {} }] } }),
    resetWatchlistMemory: () => undefined,
}));
vi.mock('@/lib/agent/client', async (original) => ({ ...(await original<typeof import('@/lib/agent/client')>()), callAgent: vi.fn() }));
vi.mock('@/i18n/locale', () => ({ getAppLocale: vi.fn(async () => 'en'), resolveLocale: vi.fn(async () => 'en') }));

const agent = vi.mocked(callAgent);
const locale = vi.mocked(getAppLocale);
const glossaryReply = (over: object = {}) => ({
    text: 'An ETF is a fund whose units trade on an exchange.', sources: [{ label: 'Glossary: ETF', source: 'agent/glossary/etf.md', fetchedAt: null }],
    refused: false, promptVersion: 'p1', modelCalls: [{ actor: 'orchestrator', awsRequestId: 'req-1' }], ...over,
});
const resultRow = async (actionId: string) => (await listAgentActions(TEST_SCOPE.scopeId, { actionId })).find((row) => row.step === 'result')!;

beforeEach(async () => {
    await freshWorld();
    resetReplyCache();
    agent.mockReset();
    locale.mockResolvedValue('en');
});

describe('reply cache in chat', () => {
    it('answers the same glossary question again without calling the agent', async () => {
        agent.mockResolvedValue(glossaryReply() as never);
        const first = await chat({ message: 'What is an ETF?' });
        const second = await chat({ message: '  what is an  ETF? ' });
        expect(agent).toHaveBeenCalledTimes(1);
        expect(second.text).toBe(first.text);
        expect(second.actionId).not.toBe(first.actionId);
        expect(second.modelCalls).toEqual([]);
        expect(second.sources).toEqual(first.sources);
    });

    it('leaves a row that says where the reply came from', async () => {
        agent.mockResolvedValue(glossaryReply() as never);
        const first = await chat({ message: 'What is an ETF?' });
        const second = await chat({ message: 'What is an ETF?' });
        expect((await resultRow(second.actionId)).result).toMatchObject({ cache: { hit: true, fromActionId: first.actionId }, modelCalls: 0 });
        expect((await resultRow(first.actionId)).result).not.toHaveProperty('cache');
    });

    it('tells the listener that the reply came from the cache', async () => {
        agent.mockResolvedValue(glossaryReply() as never);
        await chat({ message: 'What is an ETF?' });
        const seen: AgentProgress[] = [];
        await chat({ message: 'What is an ETF?' }, (event) => seen.push(event));
        expect(seen).toEqual([{ type: 'stage', stage: 'cache', state: 'done', ok: true, ms: 0 }]);
    });

    it('does not cache a question asked in the middle of a conversation', async () => {
        agent.mockResolvedValue(glossaryReply() as never);
        await chat({ message: 'What is an ETF?' });
        await chat({ message: 'What is an ETF?', history: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello' }] });
        expect(agent).toHaveBeenCalledTimes(2);
    });

    it('keeps languages apart', async () => {
        agent.mockResolvedValue(glossaryReply() as never);
        // A bare word has no language of its own, so the reply takes the app's language, and each language has its own entry
        await chat({ message: 'ETF' });
        locale.mockResolvedValue('fr');
        await chat({ message: 'ETF' });
        expect(agent).toHaveBeenCalledTimes(2);
    });

    it('answers a message in its own language whatever the app language is, and caches it per language', async () => {
        agent.mockResolvedValue(glossaryReply() as never);
        locale.mockResolvedValue('fr');
        await chat({ message: 'What is an ETF?' });
        await chat({ message: 'What is an ETF?' });
        expect(agent).toHaveBeenCalledTimes(1);
        expect(agent.mock.calls[0][0].context.locale).toBe('en');
    });

    it('does not cache a reply that holds live data, a proposal or a refusal', async () => {
        for (const reply of [
            glossaryReply({ sources: [{ label: 'AAPL price', source: 'Finnhub', fetchedAt: null }] }),
            glossaryReply({ proposed: { type: 'layout_change', summary: 's', params: { layout: ['total_value'] } } }),
            glossaryReply({ refused: true }),
        ]) {
            resetReplyCache();
            agent.mockReset();
            agent.mockResolvedValue(reply as never);
            await chat({ message: 'What is an ETF?' });
            await chat({ message: 'What is an ETF?' });
            expect(agent).toHaveBeenCalledTimes(2);
        }
    });

    it('does not cache a reply that the wording check withholds', async () => {
        agent.mockResolvedValue(glossaryReply({ text: 'You should buy an ETF, it is a good pick.' }) as never);
        expect((await chat({ message: 'What is an ETF?' })).text).toBe(NEUTRAL_REPLY);
        await chat({ message: 'What is an ETF?' });
        expect(agent).toHaveBeenCalledTimes(2);
    });

    it('checks the wording of a stored reply again', async () => {
        agent.mockResolvedValue(glossaryReply() as never);
        await chat({ message: 'What is an ETF?' });
        // The vetted lists can change between two deploys; here the stored text is made to break one
        agent.mockResolvedValue(glossaryReply({ text: 'An ETF is a good fund.' }) as never);
        resetReplyCache();
        await chat({ message: 'What is an ETF?' });
        expect(agent).toHaveBeenCalledTimes(2);
    });

    it('can be switched off', async () => {
        process.env.AGENT_REPLY_CACHE = 'off';
        try {
            agent.mockResolvedValue(glossaryReply() as never);
            await chat({ message: 'What is an ETF?' });
            await chat({ message: 'What is an ETF?' });
            expect(agent).toHaveBeenCalledTimes(2);
        } finally {
            delete process.env.AGENT_REPLY_CACHE;
        }
    });
});
