// What both agent routes (JSON and event stream) do before the agent is called: read and check the body, and
// count the request against the visitor session's limit.

import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { getAppLocale } from '@/i18n/locale';
import { clientIp, isRateLimited } from '@/lib/rate-limit';
import { ServiceError } from '@/lib/services/errors';
import type { Scope } from '@/lib/session';
import type { ChatInput } from './chat';
import { agentText } from './text';

// Each request costs several model calls and up to two guardrail passes.
const MAX_PER_MINUTE = 10;
// A new session is one cookie away, so the address keeps a ceiling of its own (a few visitors may share one)
const MAX_PER_MINUTE_PER_IP = 30;

const schemaFor = (emptyMessage: string) => z.object({
    message: z.string().trim().min(1, emptyMessage).max(2000),
    history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string() })).max(40).optional(),
    conversationId: z.string().min(1).max(80).optional(),
    // The page the user is on; the server turns it into a name from a fixed list (lib/agent/page.ts). Only context:
    // an over-long or malformed page is dropped (as if absent) rather than failing the whole request.
    page: z.object({ path: z.string().max(120), xrayWindow: z.string().max(20).optional() }).optional().catch(undefined),
});

/** The checked chat input of a request. Throws what `respond` turns into a 400, or a 429 over the limit. */
export async function readAgentRequest(req: NextRequest, scope: Pick<Scope, 'sessionId'>): Promise<ChatInput> {
    const words = agentText(await getAppLocale());
    const input = schemaFor(words.emptyMessage).parse(await req.json());
    if (await isRateLimited(`agent:session:${scope.sessionId}`, MAX_PER_MINUTE, 60)
        || await isRateLimited(`agent:ip:${clientIp(req)}`, MAX_PER_MINUTE_PER_IP, 60)) throw new ServiceError(429, words.tooMany);
    return input;
}
