import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getAppLocale } from '@/i18n/locale';
import { chat } from '@/lib/agent/chat';
import { agentText } from '@/lib/agent/text';
import { DEMO_USER } from '@/lib/demo-user';
import { isRateLimited } from '@/lib/rate-limit';
import { ServiceError } from '@/lib/services/errors';
import { respond } from '@/lib/services/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 150;

// Each request costs several model calls and up to two guardrail passes.
const MAX_PER_MINUTE = 10;

const schemaFor = (emptyMessage: string) => z.object({
    message: z.string().trim().min(1, emptyMessage).max(2000),
    history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string() })).max(40).optional(),
    conversationId: z.string().min(1).max(80).optional(),
    // The page the user is on; the server turns it into a name from a fixed list (lib/agent/page.ts)
    page: z.object({ path: z.string().max(120), xrayWindow: z.string().max(20).optional() }).optional(),
});

// The web side of one agent request. The reply never applies anything: a change comes back as a preview.
export const POST = (req: NextRequest) => respond(async () => {
    const words = agentText(await getAppLocale());
    const input = schemaFor(words.emptyMessage).parse(await req.json());
    if (await isRateLimited(`agent:user:${DEMO_USER.id}`, MAX_PER_MINUTE, 60)) {
        throw new ServiceError(429, words.tooMany);
    }
    return chat(input);
});
