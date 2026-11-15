import { NextRequest } from 'next/server';
import { z } from 'zod';
import { clientIp, isRateLimited } from '@/lib/rate-limit';
import { ServiceError } from '@/lib/services/errors';
import { requestLocale, respond } from '@/lib/services/http';
import { renderText, serviceRef } from '@/lib/services/text';
import { RESET_LEVELS, requestScope } from '@/lib/session';
import { requestReset } from '@/lib/session/reset';

export const dynamic = 'force-dynamic';

const schema = z.object({
    level: z.enum(RESET_LEVELS as [string, ...string[]]),
    confirm: z.string().max(1024).optional(),
}).strict();

const MAX_PER_MINUTE = 10;

/**
 * Reset by new generation, in two steps (lib/session/reset.ts). Without a valid `confirm`: { needsConfirmation, token,
 * summary } describing what the visitor will no longer see. With the token: the new generation is opened and one
 * session_reset row is appended; no row of any log is changed or removed.
 * Only the visitor's own browser can do this: the agent has no such action, and a call carrying the internal tool
 * token (the agent service's credential) is refused outright.
 */
export const POST = (req: NextRequest) => respond(async () => {
    const locale = await requestLocale(req);
    if (req.headers.has('x-internal-token')) throw new ServiceError(403, renderText(serviceRef('svc.http.reset_refused', {}), locale));
    const scope = await requestScope(req);
    if (await isRateLimited(`reset:session:${scope.sessionId}`, MAX_PER_MINUTE, 60)
        || await isRateLimited(`reset:ip:${clientIp(req)}`, MAX_PER_MINUTE * 3, 60)) {
        throw new ServiceError(429, renderText(serviceRef('svc.http.too_many', {}), locale));
    }
    const { level, confirm } = schema.parse(await req.json());
    return requestReset(scope, { level: level as (typeof RESET_LEVELS)[number], confirm });
}, req);
