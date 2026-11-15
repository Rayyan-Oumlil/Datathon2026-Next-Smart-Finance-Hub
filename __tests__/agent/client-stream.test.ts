import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callAgent, type AgentPayload } from '@/lib/agent/client';
import { encodeEvent } from '@/lib/agent/sse';

const send = vi.hoisted(() => vi.fn());
vi.mock('@aws-sdk/client-bedrock-agentcore', () => ({
    BedrockAgentCoreClient: class { send = send; },
    InvokeAgentRuntimeCommand: class { constructor(public input: unknown) {} },
}));

const payload: AgentPayload = { actionId: 'act_1', userId: 'demo-user', message: 'hi', history: [], context: { locale: 'en', holdings: [], watchlist: [], layout: [] } };
const REPLY = { text: 'An ETF is a fund.', sources: [], refused: false, modelCalls: [] };
const encoder = new TextEncoder();

const stream = (...events: unknown[]) => new Response(
    new ReadableStream<Uint8Array>({ start(controller) { for (const e of events) controller.enqueue(encoder.encode(encodeEvent(e))); controller.close(); } }),
    { headers: { 'content-type': 'text/event-stream' } },
);
const raw = (text: string) => new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(encoder.encode(text)); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
const stage = { type: 'stage', stage: 'subagent', name: 'glossary', state: 'start' } as const;

let fetchMock: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    delete process.env.AGENT_RUNTIME_ARN;
    fetchMock = vi.spyOn(globalThis, 'fetch');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); send.mockReset(); delete process.env.AGENT_RUNTIME_ARN; });

const sentBody = () => JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));

describe('callAgent over HTTP', () => {
    it('asks for a stream, passes each stage on, and returns the reply of the final event', async () => {
        fetchMock.mockResolvedValue(stream(stage, { type: 'heartbeat' }, { type: 'final', reply: REPLY }));
        const seen: unknown[] = [];
        const reply = await callAgent(payload, 'c1', (event) => seen.push(event));
        expect(sentBody()).toMatchObject({ stream: true, actionId: 'act_1' });
        expect(seen).toEqual([stage, { type: 'heartbeat' }]);
        expect(reply.text).toBe(REPLY.text);
    });

    it('does not ask for a stream when nobody listens', async () => {
        fetchMock.mockResolvedValue(Response.json(REPLY));
        await expect(callAgent(payload)).resolves.toMatchObject({ text: REPLY.text });
        expect(sentBody()).not.toHaveProperty('stream');
    });

    it('accepts a plain JSON reply from an agent service that does not stream yet', async () => {
        fetchMock.mockResolvedValue(Response.json(REPLY));
        const onEvent = vi.fn();
        await expect(callAgent(payload, 'c1', onEvent)).resolves.toMatchObject({ text: REPLY.text });
        expect(onEvent).not.toHaveBeenCalled();
    });

    it('ignores an event type it does not know', async () => {
        fetchMock.mockResolvedValue(stream({ type: 'future' }, { type: 'final', reply: REPLY }));
        await expect(callAgent(payload, 'c1', vi.fn())).resolves.toMatchObject({ text: REPLY.text });
    });

    it('reports an error event of the agent service as unreachable', async () => {
        fetchMock.mockResolvedValue(stream(stage, { type: 'error', message: 'KeyError: boom' }));
        await expect(callAgent(payload, 'c1', vi.fn())).rejects.toMatchObject({ status: 503 });
    });

    it('reports a stream that ends without a reply as unreadable', async () => {
        fetchMock.mockResolvedValue(stream(stage));
        await expect(callAgent(payload, 'c1', vi.fn())).rejects.toMatchObject({ status: 502, message: expect.stringContaining('could not read') });
    });

    it('reports a line that is not JSON as unreadable', async () => {
        fetchMock.mockResolvedValue(raw('data: not json\n\n'));
        await expect(callAgent(payload, 'c1', vi.fn())).rejects.toMatchObject({ status: 502 });
    });

    it('reports a final reply of the wrong shape as unreadable', async () => {
        fetchMock.mockResolvedValue(stream({ type: 'final', reply: { text: 42 } }));
        await expect(callAgent(payload, 'c1', vi.fn())).rejects.toMatchObject({ status: 502 });
    });

    it('keeps the 503 for a service that cannot be reached', async () => {
        fetchMock.mockRejectedValue(new TypeError('fetch failed'));
        await expect(callAgent(payload, 'c1', vi.fn())).rejects.toMatchObject({ status: 503 });
    });
});

describe('callAgent through AgentCore', () => {
    const chunks = async function* (...events: unknown[]) { for (const e of events) yield encoder.encode(encodeEvent(e)); };

    it('reads the event stream of the runtime', async () => {
        process.env.AGENT_RUNTIME_ARN = 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/test';
        send.mockResolvedValue({ contentType: 'text/event-stream', response: chunks(stage, { type: 'final', reply: REPLY }) });
        const seen: unknown[] = [];
        const reply = await callAgent(payload, 'c1', (event) => seen.push(event));
        expect(seen).toEqual([stage]);
        expect(reply.text).toBe(REPLY.text);
        const input = send.mock.calls[0][0].input;
        expect(JSON.parse(Buffer.from(input.payload).toString('utf8'))).toMatchObject({ stream: true });
    });

    it('still reads a JSON reply from a runtime that does not stream yet', async () => {
        process.env.AGENT_RUNTIME_ARN = 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/test';
        send.mockResolvedValue({ contentType: 'application/json', response: { transformToString: async () => JSON.stringify(REPLY) } });
        await expect(callAgent(payload, 'c1', vi.fn())).resolves.toMatchObject({ text: REPLY.text });
    });
});
