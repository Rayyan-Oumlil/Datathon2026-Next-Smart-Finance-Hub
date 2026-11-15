import { describe, expect, it } from 'vitest';
import { encodeEvent, readSse } from '@/lib/agent/sse';

const bytes = (text: string) => new TextEncoder().encode(text);
async function* chunked(...parts: Uint8Array[]): AsyncGenerator<Uint8Array> {
    for (const part of parts) yield part;
}
const collect = async (source: AsyncIterable<Uint8Array>) => {
    const out: unknown[] = [];
    for await (const event of readSse(source)) out.push(event);
    return out;
};

describe('encodeEvent', () => {
    it('writes one JSON object as one data line ended by a blank line', () => {
        expect(encodeEvent({ type: 'heartbeat' })).toBe('data: {"type":"heartbeat"}\n\n');
    });
});

describe('readSse', () => {
    it('reads each data line as one event', async () => {
        const events = await collect(chunked(bytes('data: {"a":1}\n\ndata: {"b":2}\n\n')));
        expect(events).toEqual([{ a: 1 }, { b: 2 }]);
    });

    it('joins an event cut across chunks', async () => {
        const events = await collect(chunked(bytes('data: {"a"'), bytes(':1}\n'), bytes('\ndata: {"b":2}\n\n')));
        expect(events).toEqual([{ a: 1 }, { b: 2 }]);
    });

    it('keeps a character whose bytes are split across two chunks', async () => {
        const all = bytes('data: {"text":"vérifié"}\n\n');
        const cut = all.indexOf(0xc3) + 1;               // between the two bytes of "é"
        const events = await collect(chunked(all.slice(0, cut), all.slice(cut)));
        expect(events).toEqual([{ text: 'vérifié' }]);
    });

    it('accepts CRLF line ends', async () => {
        expect(await collect(chunked(bytes('data: {"a":1}\r\n\r\n')))).toEqual([{ a: 1 }]);
    });

    it('skips comments and blank lines', async () => {
        expect(await collect(chunked(bytes(': keep-alive\n\ndata: {"a":1}\n\n\n')))).toEqual([{ a: 1 }]);
    });

    it('joins a data field written over several lines', async () => {
        expect(await collect(chunked(bytes('data: {"a":\ndata: 1}\n\n')))).toEqual([{ a: 1 }]);
    });

    it('reads a last event that has no closing blank line', async () => {
        expect(await collect(chunked(bytes('data: {"a":1}\n')))).toEqual([{ a: 1 }]);
    });

    it('fails on a data line that is not JSON instead of dropping it', async () => {
        await expect(collect(chunked(bytes('data: not json\n\n')))).rejects.toThrow(/not valid JSON/);
    });
});
