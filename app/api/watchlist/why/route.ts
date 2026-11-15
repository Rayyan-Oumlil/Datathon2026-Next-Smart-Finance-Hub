import { NextRequest } from 'next/server';
import { ServiceError } from '@/lib/services/errors';
import { respond } from '@/lib/services/http';
import { explainSymbol } from '@/lib/services/watchlist';

export const dynamic = 'force-dynamic';

export const GET = (req: NextRequest) => respond(async () => {
    const symbol = (req.nextUrl.searchParams.get('symbol') ?? '').trim();
    if (!symbol || symbol.length > 20) throw new ServiceError(400, 'Give a symbol.');
    return explainSymbol(symbol);
});
