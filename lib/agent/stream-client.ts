// The browser side of /api/agent/stream: posts the request, hands each stage to the caller as it arrives, and
// returns the reply of the final event. Any failure is thrown with a text the panel can show; nothing falls back.

import { SseFormatError, bodyChunks, readSse } from './sse';
import { isStageEvent, type StageEvent } from './stages';

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const stopped = () => new DOMException('The request was stopped.', 'AbortError');

/** `signal` stops the request: the call then throws an AbortError, which is not a failure to report. */
export async function streamChat<T>(body: unknown, onStage: (event: StageEvent) => void, fallbackError: string, signal?: AbortSignal): Promise<T> {
    const response = await fetch('/api/agent/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
    if (!response.ok) {
        // A request that is refused before the stream starts (bad body, too many requests) is a JSON { error }
        const data = await response.json().catch(() => null);
        throw new Error(isObject(data) && typeof data.error === 'string' && data.error ? data.error : fallbackError);
    }
    if (!response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) throw new Error(fallbackError);
    try {
        for await (const event of readSse(bodyChunks(response.body))) {
            if (signal?.aborted) throw stopped();
            if (isStageEvent(event)) onStage(event);
            else if (isObject(event) && event.type === 'final') return event.reply as T;
            else if (isObject(event) && event.type === 'error') throw new Error(typeof event.message === 'string' && event.message ? event.message : fallbackError);
        }
    } catch (error) {
        if (signal?.aborted) throw stopped();
        if (error instanceof SseFormatError) throw new Error(fallbackError);
        throw error;
    }
    if (signal?.aborted) throw stopped();
    throw new Error(fallbackError);
}
