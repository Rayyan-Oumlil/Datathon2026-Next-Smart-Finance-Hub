import '@/__tests__/test-user';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as STREAM } from '@/app/api/agent/stream/route';
import { getAppLocale } from '@/i18n/locale';
import { NEUTRAL_REPLY, resetReplyCache } from '@/lib/agent/chat';
import { callAgent, type AgentProgress } from '@/lib/agent/client';
import { bodyChunks, readSse } from '@/lib/agent/sse';
import { ServiceError } from '@/lib/services/errors';
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
const answer = (over: object = {}) => ({ text: 'An ETF is a fund whose units trade on an exchange.', sources: [], refused: false, promptVersion: 'p1', modelCalls: [], ...over });
const stage: AgentProgress = { type: 'stage', stage: 'subagent', name: 'glossary', state: 'start' };

// The agent service reports each event to the listener it was given, then answers
const agentSays = (events: AgentProgress[], reply: object = answer()) =>
    agent.mockImplementation(async (_payload, _conversation, onEvent) => { for (const e of events) onEvent?.(e); return reply as never; });

const post = (body: unknown = { message: 'What is an ETF?' }) => STREAM(new NextRequest('http://localhost/api/agent/stream', { method: 'POST', body: JSON.stringify(body) }));
const eventsOf = async (response: Response) => {
    const out: Array<Record<string, unknown>> = [];
    for await (const event of readSse(bodyChunks(response.body!))) out.push(event as Record<string, unknown>);
    return out;
};

beforeEach(async () => {
    await freshWorld();
    resetReplyCache();
    agent.mockReset();
    locale.mockResolvedValue('en');
});

describe('POST /api/agent/stream', () => {
    it('answers with an event stream that no proxy or compression layer may hold back', async () => {
        agentSays([]);
        const response = await post();
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toMatch(/^text\/event-stream/);
        expect(response.headers.get('cache-control')).toBe('no-cache, no-transform');
        expect(response.headers.get('x-accel-buffering')).toBe('no');
        await eventsOf(response);
    });

    it('sends the stages as they come, then the checked reply last', async () => {
        agentSays([stage, { type: 'heartbeat' }]);
        const events = await eventsOf(await post());
        expect(events.slice(0, 2)).toEqual([stage, { type: 'heartbeat' }]);
        const last = events.at(-1)!;
        expect(last.type).toBe('final');
        expect(last.reply).toMatchObject({ text: 'An ETF is a fund whose units trade on an exchange.', refused: false, actionId: expect.stringMatching(/^act_/) });
        expect(events.filter((e) => e.type === 'final')).toHaveLength(1);
    });

    it('never streams a reply that the wording check withholds', async () => {
        agentSays([stage], answer({ text: 'You should buy AAPL, it is a good pick.' }));
        const last = (await eventsOf(await post())).at(-1)!;
        expect(last.reply).toMatchObject({ text: NEUTRAL_REPLY, refused: true });
        expect(JSON.stringify(last)).not.toMatch(/should buy/);
    });

    it('asks the agent service for progress events', async () => {
        agentSays([]);
        await eventsOf(await post());
        expect(agent.mock.calls[0][2]).toBeTypeOf('function');
    });

    it('answers a bad request as JSON before any stream starts', async () => {
        const response = await post({ message: '   ' });
        expect(response.status).toBe(400);
        expect(response.headers.get('content-type')).toMatch(/application\/json/);
        expect(agent).not.toHaveBeenCalled();
    });

    it('reports a failure of the agent service as an error event in the request language', async () => {
        locale.mockResolvedValue('fr');
        agent.mockRejectedValue(new ServiceError(503, 'The agent service is not reachable right now. Nothing was changed.'));
        const events = await eventsOf(await post());
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ type: 'error', status: 503, message: expect.any(String) });
    });

    it('shares its 10 requests a minute with the JSON route and then answers 429 as JSON', async () => {
        agentSays([]);
        for (let i = 0; i < 5; i += 1) await eventsOf(await post());             // the earlier tests used five of the ten
        const over = await post();
        expect(over.status).toBe(429);
        expect(over.headers.get('content-type')).toMatch(/application\/json/);
        expect(await over.json()).toEqual({ error: 'Too many requests. Wait a minute and try again.' });
    });
});
