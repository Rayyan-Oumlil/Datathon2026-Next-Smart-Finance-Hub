// What both agent routes (JSON and event stream) do before the agent is called: read and check the body, and
// count the request against the demo user's limit.

import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { getAppLocale } from '@/i18n/locale';
import { DEMO_USER } from '@/lib/demo-user';
import { isRateLimited } from '@/lib/rate-limit';
import { ServiceError } from '@/lib/services/errors';
import type { ChatInput } from './chat';
import { agentText } from './text';

// Each request costs several model calls and up to two guardrail passes.
const MAX_PER_MINUTE = 10;

const schemaFor = (emptyMessage: string) => z.object({
    message: z.string().trim().min(1, emptyMessage).max(2000),
    history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string() })).max(40).optional(),
    conversationId: z.string().min(1).max(80).optional(),
});

/** The checked chat input of a request. Throws what `respond` turns into a 400, or a 429 over the limit. */
export async function readAgentRequest(req: NextRequest): Promise<ChatInput> {
    const words = agentText(await getAppLocale());
    const input = schemaFor(words.emptyMessage).parse(await req.json());
    if (await isRateLimited(`agent:user:${DEMO_USER.id}`, MAX_PER_MINUTE, 60)) throw new ServiceError(429, words.tooMany);
    return input;
}
