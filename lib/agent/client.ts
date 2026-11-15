// The one door to the agent service: a local HTTP call, or AgentCore Runtime when AGENT_RUNTIME_ARN is set.
// Same payload and same response either way (docs/agent-api.md section 1).

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ServiceError } from '@/lib/services/errors';
import type { AgentContext } from './context';
import { SseFormatError, bodyChunks, readSse } from './sse';
import { isStageEvent, type StageEvent } from './stages';
import { agentText } from './text';

/** What the agent service tells the caller while a request runs. The reply itself comes back as the return value. */
export type AgentProgress = StageEvent | { type: 'heartbeat' };

export type AgentPayload = {
    actionId: string;
    userId: string;
    message: string;
    history: Array<{ role: 'user' | 'assistant'; text: string }>;
    context: AgentContext;
    /** The panel's conversation id: the agent's memory session (with userId). A reset starts a new one. */
    conversationId?: string;
};

const TIMEOUT_MS = 120_000;     // one request can be several model calls and two guardrail passes

const replySchema = z.object({
    text: z.string(),
    sources: z.array(z.object({ label: z.string(), source: z.string(), fetchedAt: z.string().nullish(), asOf: z.string().nullish() })).default([]),
    proposed: z.unknown().optional(),
    conflict: z.object({
        symbol: z.string(),
        checks: z.array(z.object({ filter: z.string(), pass: z.boolean(), detail: z.string(), value: z.number().nullish(), limit: z.number().nullish() })),
    }).nullish(),
    refused: z.boolean().default(false),
    promptVersion: z.string().optional(),
    modelCalls: z.array(z.record(z.string(), z.unknown())).default([]),
    logComplete: z.boolean().optional(),      // false when a row of the agent service's action log could not be written
    error: z.string().optional(),
});
export type AgentServiceReply = z.infer<typeof replySchema>;

/** AgentCore wants a session id of 33 characters or more; the same user and conversation always give the same one. */
export function runtimeSessionId(userId: string, conversationId: string): string {
    return `session-${createHash('sha256').update(`${userId}|${conversationId}`).digest('hex').slice(0, 48)}`;
}

/** A stream that ends without its final event, or whose bytes do not follow the format: the reply cannot be read. */
class UnreadableStream extends Error {}

const isEventType = (event: unknown, type: string): event is Record<string, unknown> =>
    typeof event === 'object' && event !== null && (event as { type?: unknown }).type === type;

/**
 * Passes each progress event on and returns the reply of the final event. An event type it does not know is
 * ignored, so the agent service can add event types without breaking an older web app.
 */
async function replyOf(events: AsyncIterable<unknown>, onEvent: (event: AgentProgress) => void): Promise<unknown> {
    try {
        for await (const event of events) {
            if (isStageEvent(event) || isEventType(event, 'heartbeat')) onEvent(event as AgentProgress);
            else if (isEventType(event, 'final')) return event.reply;
            else if (isEventType(event, 'error')) throw new Error(`agent service error: ${String(event.message).slice(0, 200)}`);
        }
    } catch (error) {
        if (error instanceof SseFormatError) throw new UnreadableStream(error.message);
        throw error;
    }
    throw new UnreadableStream('the stream ended without a reply');
}

// A stream is asked for only when someone listens; a service that does not stream yet answers one JSON body.
const bodyOf = (payload: AgentPayload, streaming: boolean) => JSON.stringify(streaming ? { ...payload, stream: true } : payload);

async function viaHttp(payload: AgentPayload, signal: AbortSignal, onEvent?: (event: AgentProgress) => void): Promise<unknown> {
    const base = (process.env.AGENT_URL || 'http://localhost:8080').replace(/\/+$/, '');
    const response = await fetch(`${base}/invocations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: bodyOf(payload, Boolean(onEvent)), signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`agent service answered HTTP ${response.status}`);
    if (onEvent && response.body && response.headers.get('content-type')?.startsWith('text/event-stream')) return replyOf(readSse(bodyChunks(response.body)), onEvent);
    return response.json();
}

const isChunkStream = (body: unknown): body is AsyncIterable<Uint8Array> => typeof body === 'object' && body !== null && Symbol.asyncIterator in body;

async function viaAgentCore(arn: string, payload: AgentPayload, conversationId: string, signal: AbortSignal, onEvent?: (event: AgentProgress) => void): Promise<unknown> {
    const { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } = await import('@aws-sdk/client-bedrock-agentcore');
    const client = new BedrockAgentCoreClient({ region: process.env.AWS_REGION || 'us-east-1' });
    const out = await client.send(new InvokeAgentRuntimeCommand({
        agentRuntimeArn: arn,
        runtimeSessionId: runtimeSessionId(payload.userId, conversationId),
        contentType: 'application/json',
        accept: 'application/json',
        payload: Buffer.from(bodyOf(payload, Boolean(onEvent)), 'utf8'),
    }), { abortSignal: signal });
    if (!out.response) throw new Error('AgentCore returned no body');
    if (onEvent && out.contentType?.startsWith('text/event-stream')) {
        if (!isChunkStream(out.response)) throw new Error('AgentCore sent an event stream the app cannot read in this runtime');
        return replyOf(readSse(out.response), onEvent);
    }
    return JSON.parse(await out.response.transformToString());
}

/**
 * Sends one request to the agent service and checks the shape of what comes back. With `onEvent` the service
 * streams the stages of the request while it runs; the return value is the same reply either way.
 */
export async function callAgent(payload: AgentPayload, conversationId = 'default', onEvent?: (event: AgentProgress) => void): Promise<AgentServiceReply> {
    const arn = process.env.AGENT_RUNTIME_ARN;
    const words = agentText(payload.context.locale);
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    let raw: unknown;
    try {
        raw = arn ? await viaAgentCore(arn, payload, conversationId, signal, onEvent) : await viaHttp(payload, signal, onEvent);
    } catch (error) {
        const name = error instanceof Error ? error.name : '';
        console.error('agent call failed:', error instanceof Error ? `${error.name}: ${error.message}` : error);
        if (error instanceof UnreadableStream) throw new ServiceError(502, words.agentUnreadable);
        if (name === 'TimeoutError' || name === 'AbortError') throw new ServiceError(504, words.agentTimeout(TIMEOUT_MS / 1000));
        throw new ServiceError(503, words.agentDown);
    }
    const parsed = replySchema.safeParse(raw);
    if (!parsed.success) throw new ServiceError(502, words.agentUnreadable);
    return parsed.data;
}
