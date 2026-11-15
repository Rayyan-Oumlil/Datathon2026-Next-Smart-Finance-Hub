import { NextRequest } from 'next/server';
import { ServiceError } from '@/lib/services/errors';
import { requestLocale, respond } from '@/lib/services/http';
import { serviceRef } from '@/lib/services/text';
import { explainSymbol } from '@/lib/services/watchlist';

export const dynamic = 'force-dynamic';

export const GET = (req: NextRequest) => respond(async () => {
    const symbol = (req.nextUrl.searchParams.get('symbol') ?? '').trim();
    if (!symbol || symbol.length > 20) throw new ServiceError(400, serviceRef('svc.http.give_symbol', {}));
    // In the request's language, re-rendered from the logged run whatever language it was computed in
    return explainSymbol(symbol, await requestLocale(req));
}, req);
