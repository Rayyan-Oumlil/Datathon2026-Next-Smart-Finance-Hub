// The one door to the agent service: a local HTTP call, or AgentCore Runtime when AGENT_RUNTIME_ARN is set.
// Same payload and same response either way (docs/agent-api.md section 1).

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ServiceError } from '@/lib/services/errors';
import type { AgentContext } from './context';

export type AgentPayload = {
    actionId: string;
    userId: string;
    message: string;
    history: Array<{ role: 'user' | 'assistant'; text: string }>;
    context: AgentContext;
};

const TIMEOUT_MS = 120_000;     // one request can be several model calls and two guardrail passes
const DOWN = 'The agent service is not reachable right now. Nothing was changed.';

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
    error: z.string().optional(),
});
export type AgentServiceReply = z.infer<typeof replySchema>;

/** AgentCore wants a session id of 33 characters or more; the same user and conversation always give the same one. */
export function runtimeSessionId(userId: string, conversationId: string): string {
    return `session-${createHash('sha256').update(`${userId}|${conversationId}`).digest('hex').slice(0, 48)}`;
}

async function viaHttp(payload: AgentPayload, signal: AbortSignal): Promise<unknown> {
    const base = (process.env.AGENT_URL || 'http://localhost:8080').replace(/\/+$/, '');
    const response = await fetch(`${base}/invocations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`agent service answered HTTP ${response.status}`);
    return response.json();
}

async function viaAgentCore(arn: string, payload: AgentPayload, conversationId: string, signal: AbortSignal): Promise<unknown> {
    const { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } = await import('@aws-sdk/client-bedrock-agentcore');
    const client = new BedrockAgentCoreClient({ region: process.env.AWS_REGION || 'us-east-1' });
    const out = await client.send(new InvokeAgentRuntimeCommand({
        agentRuntimeArn: arn,
        runtimeSessionId: runtimeSessionId(payload.userId, conversationId),
        contentType: 'application/json',
        accept: 'application/json',
        payload: Buffer.from(JSON.stringify(payload), 'utf8'),
    }), { abortSignal: signal });
    if (!out.response) throw new Error('AgentCore returned no body');
    return JSON.parse(await out.response.transformToString());
}

/** Sends one request to the agent service and checks the shape of what comes back. */
export async function callAgent(payload: AgentPayload, conversationId = 'default'): Promise<AgentServiceReply> {
    const arn = process.env.AGENT_RUNTIME_ARN;
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    let raw: unknown;
    try {
        raw = arn ? await viaAgentCore(arn, payload, conversationId, signal) : await viaHttp(payload, signal);
    } catch (error) {
        const name = error instanceof Error ? error.name : '';
        console.error('agent call failed:', error instanceof Error ? `${error.name}: ${error.message}` : error);
        if (name === 'TimeoutError' || name === 'AbortError') throw new ServiceError(504, `The agent service did not answer within ${TIMEOUT_MS / 1000} seconds. Nothing was changed.`);
        throw new ServiceError(503, DOWN);
    }
    const parsed = replySchema.safeParse(raw);
    if (!parsed.success) throw new ServiceError(502, 'The agent service sent a reply the app could not read. Nothing was changed.');
    return parsed.data;
}
