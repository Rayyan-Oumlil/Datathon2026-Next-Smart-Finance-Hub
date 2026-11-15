import { NextRequest } from 'next/server';
import { requestLocale, respond } from '@/lib/services/http';
import { compareReplays } from '@/lib/services/replay';
import { requestScope } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Several replays on one chart: illustrative, on the frozen snapshot, never a real order.
// Body: { scenarios: [{ label, portfolio, strategy }] (1 to 5), capitalCad, startDate, feePerOrderCad }. Each scenario is
// run through the same engine as POST /api/replay and keeps its own replay id; one that cannot be replayed comes back
// with its reason instead of failing the request.
export const POST = (req: NextRequest) => respond(async () => {
    const locale = await requestLocale(req);
    return { compare: await compareReplays(await req.json(), { scope: await requestScope(req), locale }) };
}, req);
