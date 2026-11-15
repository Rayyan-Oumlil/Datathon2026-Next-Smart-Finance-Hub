import { NextRequest } from 'next/server';
import { z } from 'zod';
import { chat } from '@/lib/agent/chat';
import { DEMO_USER } from '@/lib/demo-user';
import { isRateLimited } from '@/lib/rate-limit';
import { ServiceError } from '@/lib/services/errors';
import { respond } from '@/lib/services/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 150;

// Each request costs several model calls and up to two guardrail passes.
const MAX_PER_MINUTE = 10;

const schema = z.object({
    message: z.string().trim().min(1, 'write a message first').max(2000),
    history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string() })).max(40).optional(),
    conversationId: z.string().min(1).max(80).optional(),
});

// The web side of one agent request. The reply never applies anything: a change comes back as a preview.
export const POST = (req: NextRequest) => respond(async () => {
    const input = schema.parse(await req.json());
    if (await isRateLimited(`agent:user:${DEMO_USER.id}`, MAX_PER_MINUTE, 60)) {
        throw new ServiceError(429, 'Too many requests. Wait a minute and try again.');
    }
    return chat(input);
});
