import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { clientIp, isRateLimited } from '@/lib/rate-limit';
import { ServiceError } from '@/lib/services/errors';
import { requestLocale, respond } from '@/lib/services/http';
import { getXrayWhatIf } from '@/lib/services/portfolio-xray';
import { renderText, serviceRef } from '@/lib/services/text';
import { requestScope } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_PER_MINUTE = 20;
const MAX_PER_MINUTE_PER_IP = 60;

const whatIfSchema = z.object({
    symbol: z.string().trim().min(1).max(20),
    amountCad: z.number().positive().max(1_000_000_000),
    direction: z.enum(['add', 'reduce']),
});

// A hypothetical change, shown before and after. Nothing is traded or stored. A first look at an asset fetches its
// history from a provider, so the route is capped.
export const POST = (req: NextRequest) => respond(async () => {
    const locale = await requestLocale(req);
    const change = whatIfSchema.parse(await req.json());
    const scope = await requestScope(req);
    if (await isRateLimited(`xray-what-if:session:${scope.sessionId}`, MAX_PER_MINUTE, 60)
        || await isRateLimited(`xray-what-if:ip:${clientIp(req)}`, MAX_PER_MINUTE_PER_IP, 60)) {
        throw new ServiceError(429, renderText(serviceRef('svc.http.too_many', {}), locale));
    }
    return getXrayWhatIf(change, locale, scope);
}, req);
