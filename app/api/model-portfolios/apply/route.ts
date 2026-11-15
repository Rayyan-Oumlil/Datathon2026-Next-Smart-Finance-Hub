import { NextRequest } from 'next/server';
import { z } from 'zod';
import { clientIp, isRateLimited } from '@/lib/rate-limit';
import { ServiceError } from '@/lib/services/errors';
import { requestLocale, respond } from '@/lib/services/http';
import { applyModelPortfolio } from '@/lib/services/model-portfolio';
import { renderText, serviceRef } from '@/lib/services/text';
import { requestScope } from '@/lib/session';

export const dynamic = 'force-dynamic';

const schema = z.object({
    optionId: z.string().min(1).max(64),
    amountCad: z.number().finite().positive(),
    replace: z.boolean().optional(),
}).strict();

const MAX_PER_MINUTE = 6;

/**
 * Creates the simulated portfolio of one option through the normal trade path. Refused (409) when a simulated
 * portfolio already exists, unless replace=true, which first opens a new portfolio generation (nothing is deleted).
 * Only the visitor's own browser can do this: a call carrying the internal tool token is refused.
 */
export const POST = (req: NextRequest) => respond(async () => {
    const locale = await requestLocale(req);
    if (req.headers.has('x-internal-token')) throw new ServiceError(403, 'Only the visitor can choose a portfolio, from the app.');
    const scope = await requestScope(req);
    if (await isRateLimited(`model-apply:session:${scope.sessionId}`, MAX_PER_MINUTE, 60)
        || await isRateLimited(`model-apply:ip:${clientIp(req)}`, MAX_PER_MINUTE * 3, 60)) {
        throw new ServiceError(429, renderText(serviceRef('svc.http.too_many', {}), locale));
    }
    const body = schema.parse(await req.json());
    return applyModelPortfolio(body, scope);
}, req);
