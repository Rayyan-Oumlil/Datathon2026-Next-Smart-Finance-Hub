import { decodeMessage, encodeAudioEvent, parseTranscriptEvent } from './eventstream';

// One dictation: it feeds microphone audio to Amazon Transcribe over a WebSocket and reports the text as it grows.
// The socket and the URL come from the caller, so the logic runs the same in the browser and in tests.

export interface SocketLike {
    binaryType: string;
    readonly readyState: number;
    send(data: Uint8Array): void;
    close(): void;
    onopen: ((event: Event) => void) | null;
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: Event) => void) | null;
    onclose: ((event: CloseEvent) => void) | null;
}

export interface Session {
    /** Raw 16-bit PCM bytes. Safe to call before the connection is open. */
    push(pcm: Uint8Array): void;
    /** Sends what is left, tells the service the audio ended, and resolves with the final text. */
    finish(): Promise<string>;
    /** Drops the dictation: closes the connection, ignores anything still arriving. */
    abort(): void;
}

export type SessionOptions = {
    getUrl: () => Promise<string>;
    createSocket: (url: string) => SocketLike;
    /** Called with the whole text so far each time the service sends an update. */
    onText: (text: string) => void;
    onError: (error: Error) => void;
    /** Audio is sent in pieces of about this many bytes (100 ms at 16 kHz). */
    chunkBytes?: number;
    /** How long finish() waits for the service to close before it settles with what it has. */
    finishTimeoutMs?: number;
    /**
     * Bytes of silence sent after the last of the audio, before the end of the stream. Language identification
     * commits to a language when it hears a pause after the speech, so without one a short question can end the
     * stream with no text at all.
     */
    tailSilenceBytes?: number;
};

const OPEN = 1;

export function startSession({ getUrl, createSocket, onText, onError, chunkBytes = 3200, finishTimeoutMs = 6000, tailSilenceBytes = 0 }: SessionOptions): Session {
    let socket: SocketLike | null = null;
    let queue: Uint8Array[] = [];
    let queued = 0;
    let finished = false;
    let aborted = false;
    let failure: Error | null = null;
    let settled = false;
    let finalText = '';
    let partialText = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = withResolvers<string>();
    // finish() may never be called (abort, early error); a rejection nobody awaits must not surface as unhandled
    done.promise.catch(() => undefined);

    const text = () => [finalText, partialText].filter(Boolean).join(' ');
    const settle = (run: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        run();
    };
    const fail = (error: Error) => {
        if (settled || aborted) return;
        failure = error;
        onError(error);
        socket?.close();
        settle(() => done.reject(error));
    };

    const take = (bytes: number): Uint8Array => {
        const out = new Uint8Array(bytes);
        let at = 0;
        while (at < bytes) {
            const head = queue[0];
            const part = Math.min(head.length, bytes - at);
            out.set(head.subarray(0, part), at);
            at += part;
            if (part === head.length) queue.shift(); else queue[0] = head.subarray(part);
        }
        queued -= bytes;
        return out;
    };
    const flush = (all: boolean) => {
        if (!socket || socket.readyState !== OPEN || aborted || settled) return;
        while (queued >= chunkBytes) socket.send(encodeAudioEvent(take(chunkBytes)));
        if (all && queued > 0) socket.send(encodeAudioEvent(take(queued)));
        if (all && finished) {
            for (let left = tailSilenceBytes; left > 0; left -= chunkBytes) socket.send(encodeAudioEvent(new Uint8Array(Math.min(left, chunkBytes))));
            socket.send(encodeAudioEvent(new Uint8Array()));
        }
    };

    const onMessage = (event: MessageEvent) => {
        if (aborted || settled) return;
        try {
            let changed = false;
            for (const piece of parseTranscriptEvent(decodeMessage(new Uint8Array(event.data as ArrayBuffer)))) {
                // While the language is a guess the text is not shown: it is often nonsense and then replaced
                if (piece.languagePending && piece.partial) continue;
                changed = true;
                if (piece.partial) {
                    partialText = piece.text;
                } else {
                    finalText = [finalText, piece.text].filter(Boolean).join(' ');
                    partialText = '';
                }
            }
            if (changed) onText(text());
        } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)));
        }
    };

    getUrl().then((url) => {
        if (aborted || settled) return;
        const opened = createSocket(url);
        socket = opened;
        opened.binaryType = 'arraybuffer';
        opened.onopen = () => flush(finished);
        opened.onmessage = onMessage;
        opened.onerror = () => fail(new Error('Could not reach the transcription service'));
        opened.onclose = ({ code, reason }) => {
            if (aborted) return;
            if (code === 1000) settle(() => done.resolve(text()));
            else fail(new Error(`Transcription connection closed (${code}${reason ? `: ${reason}` : ''})`));
        };
    }, (error: unknown) => fail(error instanceof Error ? error : new Error(String(error))));

    return {
        push(pcm) {
            if (aborted || finished || settled || pcm.length === 0) return;
            queue.push(pcm);
            queued += pcm.length;
            flush(false);
        },
        finish() {
            if (aborted) return Promise.resolve('');
            if (failure) return Promise.reject(failure);
            if (!finished) {
                finished = true;
                flush(true);
                timer = setTimeout(() => {
                    socket?.close();
                    settle(() => done.resolve(text()));
                }, finishTimeoutMs);
            }
            return done.promise;
        },
        abort() {
            if (aborted) return;
            aborted = true;
            queue = [];
            queued = 0;
            socket?.close();
            settle(() => done.resolve(''));
        },
    };
}

function withResolvers<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}
