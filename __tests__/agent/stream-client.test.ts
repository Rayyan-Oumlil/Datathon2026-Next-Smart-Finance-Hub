import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeEvent } from '@/lib/agent/sse';
import { streamChat } from '@/lib/agent/stream-client';

const encoder = new TextEncoder();
const events = (...list: unknown[]) => new Response(
    new ReadableStream<Uint8Array>({ start(c) { for (const e of list) c.enqueue(encoder.encode(encodeEvent(e))); c.close(); } }),
    { headers: { 'content-type': 'text/event-stream' } },
);
const stage = { type: 'stage', stage: 'orchestrator', state: 'start' } as const;
const body = { message: 'hi' };
const FALLBACK = 'The request could not be completed.';

const fetchReturns = (response: Response) => vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
afterEach(() => vi.restoreAllMocks());

describe('streamChat', () => {
    it('posts the body, passes each stage on and returns the reply of the final event', async () => {
        const spy = fetchReturns(events(stage, { type: 'heartbeat' }, { type: 'final', reply: { text: 'done' } }));
        const seen: unknown[] = [];
        await expect(streamChat(body, (e) => seen.push(e), FALLBACK)).resolves.toEqual({ text: 'done' });
        expect(seen).toEqual([stage]);                                 // a heartbeat is for the network, not the screen
        const [url, init] = spy.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('/api/agent/stream');
        expect(JSON.parse(String(init.body))).toEqual(body);
    });

    it('throws the message of an error event', async () => {
        fetchReturns(events(stage, { type: 'error', status: 503, message: 'The agent service is not reachable right now.' }));
        await expect(streamChat(body, vi.fn(), FALLBACK)).rejects.toThrow('The agent service is not reachable right now.');
    });

    it('throws the error text of a JSON answer sent before the stream (bad request, too many requests)', async () => {
        fetchReturns(Response.json({ error: 'Too many requests. Wait a minute and try again.' }, { status: 429 }));
        await expect(streamChat(body, vi.fn(), FALLBACK)).rejects.toThrow('Too many requests. Wait a minute and try again.');
    });

    it('uses the fallback text when the error answer has none', async () => {
        fetchReturns(new Response('Bad gateway', { status: 502 }));
        await expect(streamChat(body, vi.fn(), FALLBACK)).rejects.toThrow(FALLBACK);
    });

    it('throws the fallback text when the stream ends without a reply', async () => {
        fetchReturns(events(stage));
        await expect(streamChat(body, vi.fn(), FALLBACK)).rejects.toThrow(FALLBACK);
    });

    it('throws the fallback text when something other than an event stream comes back', async () => {
        fetchReturns(new Response('<html>login</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
        await expect(streamChat(body, vi.fn(), FALLBACK)).rejects.toThrow(FALLBACK);
    });

    it('throws the fallback text on a line that is not JSON', async () => {
        fetchReturns(new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(encoder.encode('data: nope\n\n')); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } }));
        await expect(streamChat(body, vi.fn(), FALLBACK)).rejects.toThrow(FALLBACK);
    });
});
