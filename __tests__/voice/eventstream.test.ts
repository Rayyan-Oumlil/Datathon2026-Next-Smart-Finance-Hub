import { describe, expect, it } from 'vitest';
import { crc32, decodeMessage, encodeAudioEvent, parseTranscriptEvent } from '@/lib/voice/eventstream';

const utf8 = new TextEncoder();

// A server-style message built by hand, so the decoder is checked against the format and not only against our encoder
const frame = (headers: Array<[string, string]>, payload: Uint8Array): Uint8Array => {
    const head = headers.flatMap(([name, value]) => {
        const n = utf8.encode(name);
        const v = utf8.encode(value);
        return [n.length, ...n, 7, v.length >> 8, v.length & 255, ...v];
    });
    const total = 12 + head.length + payload.length + 4;
    const out = new Uint8Array(total);
    const view = new DataView(out.buffer);
    view.setUint32(0, total);
    view.setUint32(4, head.length);
    view.setUint32(8, crc32(out.subarray(0, 8)));
    out.set(head, 12);
    out.set(payload, 12 + head.length);
    view.setUint32(total - 4, crc32(out.subarray(0, total - 4)));
    return out;
};

describe('crc32', () => {
    it('matches the standard check value', () => {
        expect(crc32(utf8.encode('123456789'))).toBe(0xcbf43926);
        expect(crc32(new Uint8Array())).toBe(0);
    });
});

describe('encodeAudioEvent', () => {
    it('writes an AudioEvent frame that decodes back to the same audio', () => {
        const audio = Uint8Array.from([1, 2, 3, 4, 5, 6]);
        const message = decodeMessage(encodeAudioEvent(audio));
        expect(message.headers).toMatchObject({ ':message-type': 'event', ':event-type': 'AudioEvent', ':content-type': 'application/octet-stream' });
        expect([...message.body]).toEqual([...audio]);
    });

    it('encodes the empty frame that ends a stream', () => {
        expect(decodeMessage(encodeAudioEvent(new Uint8Array())).body.length).toBe(0);
    });
});

describe('decodeMessage', () => {
    it('reads headers and payload of a service frame', () => {
        const body = utf8.encode('{"hello":1}');
        const message = decodeMessage(frame([[':message-type', 'event'], [':event-type', 'TranscriptEvent']], body));
        expect(message.headers[':event-type']).toBe('TranscriptEvent');
        expect(new TextDecoder().decode(message.body)).toBe('{"hello":1}');
    });

    it('rejects a frame whose checksum is wrong', () => {
        const bytes = frame([[':message-type', 'event']], utf8.encode('abc'));
        bytes[bytes.length - 6] ^= 0xff;
        expect(() => decodeMessage(bytes)).toThrow(/checksum/i);
    });

    it('rejects a frame whose length does not match', () => {
        const bytes = frame([[':message-type', 'event']], utf8.encode('abc'));
        expect(() => decodeMessage(bytes.subarray(0, bytes.length - 2))).toThrow(/length/i);
    });
});

describe('parseTranscriptEvent', () => {
    const event = (results: unknown) => decodeMessage(frame([[':message-type', 'event'], [':event-type', 'TranscriptEvent']], utf8.encode(JSON.stringify({ Transcript: { Results: results } }))));

    it('returns partial and final results with their text', () => {
        const parsed = parseTranscriptEvent(event([
            { IsPartial: false, Alternatives: [{ Transcript: 'I want to add Tesla' }] },
            { IsPartial: true, Alternatives: [{ Transcript: 'to my' }] },
        ]));
        expect(parsed).toEqual([{ partial: false, text: 'I want to add Tesla' }, { partial: true, text: 'to my' }]);
    });

    it('returns nothing for an event without results', () => {
        expect(parseTranscriptEvent(event([]))).toEqual([]);
    });

    it('throws the code and message of an error frame, which carries them in headers', () => {
        const error = decodeMessage(frame([[':message-type', 'error'], [':error-code', 'InternalFailure'], [':error-message', 'try again']], new Uint8Array()));
        expect(() => parseTranscriptEvent(error)).toThrow(/InternalFailure: try again/);
    });

    it('throws the service message for an exception frame', () => {
        const exception = decodeMessage(frame([[':message-type', 'exception'], [':exception-type', 'BadRequestException']], utf8.encode('{"Message":"bad audio"}')));
        expect(() => parseTranscriptEvent(exception)).toThrow(/BadRequestException: bad audio/);
    });
});
