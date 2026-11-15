import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crc32, decodeMessage } from '@/lib/voice/eventstream';
import { startSession, type SocketLike } from '@/lib/voice/session';

const utf8 = new TextEncoder();

// A service frame: string headers and a JSON payload
const frame = (headers: Array<[string, string]>, payload: unknown): ArrayBuffer => {
    const head = headers.flatMap(([name, value]) => {
        const n = utf8.encode(name);
        const v = utf8.encode(value);
        return [n.length, ...n, 7, 0, v.length, ...v];
    });
    const body = utf8.encode(JSON.stringify(payload));
    const total = 12 + head.length + body.length + 4;
    const out = new Uint8Array(total);
    const view = new DataView(out.buffer);
    view.setUint32(0, total);
    view.setUint32(4, head.length);
    view.setUint32(8, crc32(out.subarray(0, 8)));
    out.set(head, 12);
    out.set(body, 12 + head.length);
    view.setUint32(total - 4, crc32(out.subarray(0, total - 4)));
    return out.buffer;
};

const transcript = (...results: Array<{ partial: boolean; text: string }>): ArrayBuffer =>
    frame([[':message-type', 'event'], [':event-type', 'TranscriptEvent']], { Transcript: { Results: results.map((r) => ({ IsPartial: r.partial, Alternatives: [{ Transcript: r.text }] })) } });

class FakeSocket implements SocketLike {
    binaryType = 'blob';
    readyState = 0;
    sent: Uint8Array[] = [];
    closed = false;
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;
    send(data: Uint8Array) { this.sent.push(data); }
    close() { this.closed = true; this.readyState = 3; }
    open() { this.readyState = 1; this.onopen?.(new Event('open')); }
    receive(...results: Array<{ partial: boolean; text: string }>) { this.message(transcript(...results)); }
    message(data: ArrayBuffer) { this.onmessage?.({ data } as MessageEvent); }
    end(code = 1000, reason = '') { this.readyState = 3; this.onclose?.({ code, reason } as CloseEvent); }
    /** The audio bytes sent so far, with the frame wrapping removed */
    audioFrames() { return this.sent.map((frame) => decodeMessage(frame).body); }
}

const audio = (n: number) => new Uint8Array(n).fill(7);

describe('startSession', () => {
    let socket: FakeSocket;
    const setup = (over: Partial<Parameters<typeof startSession>[0]> = {}) => {
        const onText = vi.fn();
        const onError = vi.fn();
        const session = startSession({ getUrl: async () => 'wss://example', createSocket: () => (socket = new FakeSocket()), onText, onError, ...over });
        return { session, onText, onError };
    };
    const ready = async () => { await vi.advanceTimersByTimeAsync(0); socket.open(); };

    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('keeps audio pushed before the socket opens and sends it in order once it does', async () => {
        const { session } = setup({ chunkBytes: 100 });
        session.push(audio(150));
        session.push(audio(150));
        await ready();
        expect(socket.audioFrames().map((frame) => frame.length)).toEqual([100, 100, 100]);
    });

    it('sets the socket to binary so frames arrive as ArrayBuffers', async () => {
        setup();
        await ready();
        expect(socket.binaryType).toBe('arraybuffer');
    });

    it('shows finished text followed by the current partial text', async () => {
        const { onText } = setup();
        await ready();
        socket.receive({ partial: true, text: 'I want' });
        socket.receive({ partial: false, text: 'I want to add Tesla.' });
        socket.receive({ partial: true, text: 'to my' });
        expect(onText.mock.calls.map(([text]) => text)).toEqual(['I want', 'I want to add Tesla.', 'I want to add Tesla. to my']);
    });

    it('on finish sends the remaining audio and an empty end frame, then resolves with the final text', async () => {
        const { session } = setup({ chunkBytes: 100 });
        await ready();
        session.push(audio(40));
        const result = session.finish();
        expect(socket.audioFrames().map((frame) => frame.length)).toEqual([40, 0]);
        socket.receive({ partial: false, text: 'Add Tesla.' });
        socket.end();
        await expect(result).resolves.toBe('Add Tesla.');
    });

    it('finishes with the text heard so far if the service does not close in time', async () => {
        const { session } = setup({ finishTimeoutMs: 1000 });
        await ready();
        const result = session.finish();
        socket.receive({ partial: true, text: 'Add Tesla' });
        await vi.advanceTimersByTimeAsync(1000);
        await expect(result).resolves.toBe('Add Tesla');
        expect(socket.closed).toBe(true);
    });

    it('finishes before the socket opened by waiting for it, then sending everything', async () => {
        const { session } = setup();
        session.push(audio(30));
        const result = session.finish();
        await ready();
        expect(socket.audioFrames().map((frame) => frame.length)).toEqual([30, 0]);
        socket.end();
        await expect(result).resolves.toBe('');
    });

    it('reports a service exception and rejects finish with it', async () => {
        const { session, onError } = setup();
        await ready();
        const result = session.finish();
        socket.message(frame([[':message-type', 'exception'], [':exception-type', 'BadRequestException']], { Message: 'bad audio' }));
        await expect(result).rejects.toThrow(/BadRequestException: bad audio/);
        expect(onError).toHaveBeenCalledOnce();
    });

    it('reports an error when the socket closes abnormally', async () => {
        const { session, onError } = setup();
        await ready();
        const result = session.finish();
        socket.end(1006, 'gone');
        await expect(result).rejects.toThrow(/closed/i);
        expect(onError).toHaveBeenCalledOnce();
    });

    it('reports an error when the pre-signed URL cannot be fetched', async () => {
        const { session, onError } = setup({ getUrl: async () => { throw new Error('token request failed'); } });
        await vi.advanceTimersByTimeAsync(0);
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'token request failed' }));
        await expect(session.finish()).rejects.toThrow('token request failed');
    });

    it('does not open a socket if finish gave up before the URL arrived', async () => {
        let release!: (url: string) => void;
        const created = vi.fn(() => (socket = new FakeSocket()));
        const { session } = setup({ getUrl: () => new Promise<string>((resolve) => { release = resolve; }), createSocket: created, finishTimeoutMs: 1000 });
        const result = session.finish();
        await vi.advanceTimersByTimeAsync(1000);
        await expect(result).resolves.toBe('');
        release('wss://late');
        await vi.advanceTimersByTimeAsync(0);
        expect(created).not.toHaveBeenCalled();
    });

    it('abort closes the socket, sends nothing more and resolves with no text', async () => {
        const { session, onText } = setup();
        await ready();
        session.push(audio(500));
        const sentBefore = socket.sent.length;
        session.abort();
        socket.receive({ partial: true, text: 'late' });
        expect(socket.closed).toBe(true);
        expect(socket.sent.length).toBe(sentBefore);
        expect(onText).not.toHaveBeenCalled();
        await expect(session.finish()).resolves.toBe('');
    });
});
