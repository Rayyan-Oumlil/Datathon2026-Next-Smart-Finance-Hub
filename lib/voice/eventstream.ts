// The AWS event-stream framing that Amazon Transcribe streaming speaks over a WebSocket: audio goes up as
// AudioEvent frames, transcripts come back as TranscriptEvent frames. Plain TypeScript with no Node API,
// so the same file runs in the browser and in the tests.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});

export function crc32(bytes: Uint8Array): number {
    let c = 0xffffffff;
    for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

const stringHeader = (name: string, value: string): number[] => {
    const n = encoder.encode(name);
    const v = encoder.encode(value);
    return [n.length, ...n, 7, v.length >> 8, v.length & 0xff, ...v];
};

const AUDIO_HEADERS = [
    ...stringHeader(':content-type', 'application/octet-stream'),
    ...stringHeader(':event-type', 'AudioEvent'),
    ...stringHeader(':message-type', 'event'),
];

/** One AudioEvent frame around raw 16-bit PCM bytes. An empty payload tells the service the audio has ended. */
export function encodeAudioEvent(audio: Uint8Array): Uint8Array {
    const total = 12 + AUDIO_HEADERS.length + audio.length + 4;
    const out = new Uint8Array(total);
    const view = new DataView(out.buffer);
    view.setUint32(0, total);
    view.setUint32(4, AUDIO_HEADERS.length);
    view.setUint32(8, crc32(out.subarray(0, 8)));
    out.set(AUDIO_HEADERS, 12);
    out.set(audio, 12 + AUDIO_HEADERS.length);
    view.setUint32(total - 4, crc32(out.subarray(0, total - 4)));
    return out;
}

export type EventMessage = { headers: Record<string, string | number | boolean>; body: Uint8Array };

// Header value types that carry a fixed number of bytes; types 6 and 7 are length-prefixed
const FIXED_SIZE: Record<number, number> = { 2: 1, 3: 2, 4: 4, 5: 8, 8: 8, 9: 16 };

/** One whole frame (a WebSocket message is exactly one frame). Both checksums are verified. */
export function decodeMessage(bytes: Uint8Array): EventMessage {
    if (bytes.length < 16) throw new Error('Event stream frame is too short');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const total = view.getUint32(0);
    const headerLength = view.getUint32(4);
    if (total !== bytes.length) throw new Error(`Event stream frame length ${bytes.length} does not match its prelude (${total})`);
    if (crc32(bytes.subarray(0, 8)) !== view.getUint32(8)) throw new Error('Event stream prelude checksum mismatch');
    if (crc32(bytes.subarray(0, total - 4)) !== view.getUint32(total - 4)) throw new Error('Event stream message checksum mismatch');

    const headers: EventMessage['headers'] = {};
    let at = 12;
    const end = 12 + headerLength;
    while (at < end) {
        const nameLength = bytes[at++];
        const name = decoder.decode(bytes.subarray(at, at + nameLength));
        at += nameLength;
        const type = bytes[at++];
        if (type === 0 || type === 1) {
            headers[name] = type === 0;
        } else if (type === 6 || type === 7) {
            const length = view.getUint16(at);
            at += 2;
            headers[name] = type === 7 ? decoder.decode(bytes.subarray(at, at + length)) : length;
            at += length;
        } else if (type in FIXED_SIZE) {
            at += FIXED_SIZE[type];
        } else {
            throw new Error(`Unknown event stream header type ${type}`);
        }
    }
    return { headers, body: bytes.subarray(end, total - 4) };
}

/**
 * `languagePending`: language identification was asked for and has not decided yet. The service then transcribes with a
 * guess (the preferred language), so the text can be nonsense ("Kesker" for French); it is right once identified.
 */
export type TranscriptPiece = { partial: boolean; text: string; languagePending: boolean };

/** The transcript pieces in a frame. A service exception frame throws with the service's own message. */
export function parseTranscriptEvent(message: EventMessage): TranscriptPiece[] {
    const payload = message.body.length ? JSON.parse(decoder.decode(message.body)) : {};
    if (message.headers[':message-type'] === 'exception') {
        throw new Error(`${String(message.headers[':exception-type'] ?? 'Exception')}: ${payload.Message ?? 'no detail'}`);
    }
    if (message.headers[':message-type'] === 'error') {
        throw new Error(`${String(message.headers[':error-code'] ?? 'Error')}: ${String(message.headers[':error-message'] ?? 'no detail')}`);
    }
    const results: Array<{ IsPartial?: boolean; LanguageCode?: string; LanguageIdentification?: unknown[]; Alternatives?: Array<{ Transcript?: string }> }> = payload.Transcript?.Results ?? [];
    return results.map((result) => ({
        partial: result.IsPartial !== false,
        text: result.Alternatives?.[0]?.Transcript ?? '',
        // A language code with no identification behind it is the service guessing; with a fixed language there is neither
        languagePending: !!result.LanguageCode && !(result.LanguageIdentification && result.LanguageIdentification.length > 0),
    }));
}
