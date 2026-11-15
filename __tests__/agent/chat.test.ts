import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as AGENT } from '@/app/api/agent/route';
import { NEUTRAL_REPLY, chat, confirm, undoAction } from '@/lib/agent/chat';
import { callAgent, runtimeSessionId } from '@/lib/agent/client';
import { DEMO_USER } from '@/lib/demo-user';
import { getLayout } from '@/lib/services/layout';
import { ServiceError } from '@/lib/services/errors';
import { listAgentActions } from '@/lib/store';
import { containsNeverWord } from '@/lib/watchlist/reasons';
import { freshWorld } from '../services/helpers';

vi.mock('@/lib/services/quotes', async (original) => (await import('../services/market-stub')).quotesMock(await original()));
vi.mock('@/lib/services/watchlist', () => ({
    getWatchlist: async () => ({ result: { snapshotId: 'snap_test', picks: [{ rank: 1, symbol: 'AAPL', name: 'Apple Inc.', total: 76.1, signals: { newsCount7d: { value: 9 } } }] } }),
    resetWatchlistMemory: () => undefined,
}));
vi.mock('@/lib/agent/client', async (original) => ({ ...(await original<typeof import('@/lib/agent/client')>()), callAgent: vi.fn() }));

const agent = vi.mocked(callAgent);
const answer = (over: object = {}) => ({ text: 'An ETF is a fund whose units trade on an exchange.', sources: [{ label: 'Glossary: ETF', source: 'agent/glossary/etf.md', fetchedAt: null }], refused: false, promptVersion: 'p1', modelCalls: [{ actor: 'orchestrator', awsRequestId: 'req-1' }], ...over });
const steps = async (actionId: string) => (await listAgentActions(DEMO_USER.id, { actionId })).map((row) => row.step);

beforeEach(async () => {
    await freshWorld();
    agent.mockReset();
});

describe('chat', () => {
    it('sends only held data as context and logs each step', async () => {
        agent.mockResolvedValue(answer());
        const reply = await chat({ message: 'What is an ETF?', history: Array.from({ length: 14 }, (_, i) => ({ role: 'user' as const, text: `turn ${i}` })) });
        const payload = agent.mock.calls[0][0];
        expect(payload).toMatchObject({ actionId: reply.actionId, userId: DEMO_USER.id, message: 'What is an ETF?' });
        expect(payload.history).toHaveLength(10);
        expect(Object.keys(payload.context).sort()).toEqual(['agentStyle', 'holdings', 'layout', 'level', 'profile', 'risk', 'watchlist']);
        expect(payload.context.watchlist).toEqual([{ rank: 1, symbol: 'AAPL', name: 'Apple Inc.', total: 76.1 }]);     // no signals, no news
        expect(reply).toMatchObject({ refused: false, sources: [{ label: 'Glossary: ETF', source: 'agent/glossary/etf.md' }] });
        expect(reply).not.toHaveProperty('preview');
        expect(await steps(reply.actionId)).toEqual(['chat_input', 'context_built', 'action_routed', 'result']);
    });

    it('replaces a reply that holds a never-word by the fixed sentence, drops its proposal and logs it', async () => {
        expect(containsNeverWord(NEUTRAL_REPLY)).toBe(false);
        for (const text of ['You should look at AAPL.', 'AAPL is a good pick.', 'I recommend this ETF.', 'Selling now is wise.', 'It will rise.']) {
            agent.mockResolvedValue(answer({ text, proposed: { type: 'layout_change', summary: 's', params: { layout: ['total_value'] } }, conflict: { symbol: 'AAPL', checks: [] } }));
            const reply = await chat({ message: 'hello' });
            expect(reply, text).toMatchObject({ text: NEUTRAL_REPLY, refused: true, sources: [] });
            expect(reply).not.toHaveProperty('proposed');
            expect(reply).not.toHaveProperty('preview');
            expect(reply).not.toHaveProperty('conflict');
            const rows = await listAgentActions(DEMO_USER.id, { actionId: reply.actionId });
            expect(rows.at(-1)).toMatchObject({ step: 'result', result: { withheldByWordCheck: true, refused: true } });
        }
    });

    it('logs and reports a proposal the router dropped', async () => {
        agent.mockResolvedValue(answer({ proposed: { type: 'wire_transfer', summary: 's', params: {} } }));
        const reply = await chat({ message: 'hello' });
        expect(reply.notice).toContain('not an action the app allows');
        expect(reply).not.toHaveProperty('proposed');
        const routed = (await listAgentActions(DEMO_USER.id, { actionId: reply.actionId })).find((row) => row.step === 'action_routed');
        expect(routed).toMatchObject({ result: { outcome: 'dropped', type: 'wire_transfer' }, dataUsed: { proposed: { type: 'wire_transfer' } } });
    });

    it('does not show a drop reason that quotes a never-word; the log keeps it', async () => {
        agent.mockResolvedValue(answer({ proposed: { type: 'simulated_trade', summary: 's', params: { symbol: 'AAPL', side: 'hold', amountCad: 100 } } }));
        const reply = await chat({ message: 'hello' });
        expect(reply.notice).toContain('its parameters are not valid');
        expect(containsNeverWord(reply.notice!)).toBe(false);
        const routed = (await listAgentActions(DEMO_USER.id, { actionId: reply.actionId })).find((row) => row.step === 'action_routed');
        expect(routed!.statedReason).toContain('side');
    });

    it('previews a change, applies it on confirm and restores it on undo, with a row per step', async () => {
        const layout = ['total_value', 'holdings'];
        agent.mockResolvedValue(answer({ text: 'Here is a smaller layout.', proposed: { type: 'layout_change', summary: 'model words', params: { layout } } }));
        const before = (await getLayout()).layout;
        const reply = await chat({ message: 'show me less' });
        expect(reply).toMatchObject({ proposed: { type: 'layout_change', needsConfirm: true }, preview: { before, after: layout } });
        expect(reply.preview!.summary).not.toContain('model words');
        expect((await getLayout()).layout).toEqual(before);

        expect(await confirm(reply.actionId, true)).toMatchObject({ applied: true, undoable: true });
        expect((await getLayout()).layout).toEqual(layout);
        expect(await undoAction(reply.actionId)).toMatchObject({ restored: true });
        expect((await getLayout()).layout).toEqual(before);
        expect(await steps(reply.actionId)).toEqual(['chat_input', 'context_built', 'action_routed', 'preview_shown', 'result', 'confirmed', 'applied', 'result', 'undo']);
        const applied = (await listAgentActions(DEMO_USER.id, { actionId: reply.actionId })).find((row) => row.step === 'applied');
        expect(applied).toMatchObject({ actor: 'web', before, after: layout });
    });

    it('cancels without changing anything', async () => {
        agent.mockResolvedValue(answer({ proposed: { type: 'layout_change', summary: 's', params: { layout: ['total_value'] } } }));
        const reply = await chat({ message: 'show me less' });
        expect(await confirm(reply.actionId, false)).toMatchObject({ applied: false, undoable: false });
        expect((await getLayout()).saved).toBe(false);
        expect((await steps(reply.actionId)).at(-1)).toBe('cancelled');
        await expect(confirm(reply.actionId, true)).rejects.toMatchObject({ status: 409 });
    });

    it('passes on whether the agent service could write its whole action log', async () => {
        agent.mockResolvedValue(answer({ logComplete: false }));
        const reply = await chat({ message: 'hello' });
        expect(reply.logComplete).toBe(false);
        const rows = await listAgentActions(DEMO_USER.id, { actionId: reply.actionId });
        expect(rows.at(-1)).toMatchObject({ step: 'result', result: { agentLogComplete: false } });
        agent.mockResolvedValue(answer({ logComplete: true }));
        expect((await chat({ message: 'hello' })).logComplete).toBe(true);
    });

    it('logs a failed agent call and passes the refusal on', async () => {
        agent.mockRejectedValue(new ServiceError(503, 'The agent service is not reachable right now. Nothing was changed.'));
        await expect(chat({ message: 'hello' })).rejects.toMatchObject({ status: 503 });
        const rows = await listAgentActions(DEMO_USER.id);
        expect(rows.map((row) => row.step)).toEqual(['chat_input', 'context_built', 'result']);
    });
});

describe('agent route', () => {
    it('allows 10 requests a minute, then answers 429', async () => {
        agent.mockResolvedValue(answer());
        const post = () => AGENT(new NextRequest('http://localhost/api/agent', { method: 'POST', body: JSON.stringify({ message: 'hello' }) }));
        for (let i = 0; i < 10; i += 1) expect((await post()).status).toBe(200);
        const over = await post();
        expect(over.status).toBe(429);
        expect(await over.json()).toEqual({ error: 'Too many requests. Wait a minute and try again.' });
        expect(agent).toHaveBeenCalledTimes(10);
    });
});

describe('agent client', () => {
    it('derives a stable AgentCore session id of 33 characters or more', () => {
        const id = runtimeSessionId('demo-user', 'c1');
        expect(id.length).toBeGreaterThanOrEqual(33);
        expect(runtimeSessionId('demo-user', 'c1')).toBe(id);
        expect(runtimeSessionId('demo-user', 'c2')).not.toBe(id);
    });
});
