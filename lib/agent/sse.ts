// Server-sent events, both directions: the agent service to the web app, and the web app to the browser.
// One JSON object per `data:` line. Plain code with no Node-only import, so the browser reads with the same parser.

export const encodeEvent = (event: unknown): string => `data: ${JSON.stringify(event)}\n\n`;

const dataOf = (block: string): string | null => {
    const lines = block.split('\n')
        .filter((line) => line.startsWith('data:'))        // comments (": …") and other fields are not events
        .map((line) => line.slice(line.startsWith('data: ') ? 6 : 5));
    return lines.length > 0 ? lines.join('\n') : null;
};

/** The bytes of a stream do not follow the format: the caller reports an unreadable reply, not a timeout. */
export class SseFormatError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SseFormatError';
    }
}

const parse = (data: string): unknown => {
    try {
        return JSON.parse(data);
    } catch {
        throw new SseFormatError(`An event of the stream is not valid JSON: ${data.slice(0, 80)}`);
    }
};

/** Reads events from a byte stream, however the network cut it. A line that is not JSON is an error, not skipped. */
export async function* readSse(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<unknown> {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of chunks) {
        buffer = (buffer + decoder.decode(chunk, { stream: true })).replace(/\r\n/g, '\n');
        for (let end = buffer.indexOf('\n\n'); end !== -1; end = buffer.indexOf('\n\n')) {
            const data = dataOf(buffer.slice(0, end));
            buffer = buffer.slice(end + 2);
            if (data !== null) yield parse(data);
        }
    }
    const data = dataOf((buffer + decoder.decode()).replace(/\r\n/g, '\n'));
    if (data !== null) yield parse(data);
}

/** The chunks of a fetch body as an async iterable (a ReadableStream is not one in every runtime and TS lib). */
export async function* bodyChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
    const reader = body.getReader();
    try {
        for (let next = await reader.read(); !next.done; next = await reader.read()) yield next.value;
    } finally {
        reader.releaseLock();
    }
}
