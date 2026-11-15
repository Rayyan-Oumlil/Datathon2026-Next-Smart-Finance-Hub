import { NextRequest } from 'next/server';
import { respond } from '@/lib/services/http';
import { searchUniverse } from '@/lib/universe';

export const GET = (req: NextRequest) => respond(async () => {
    const q = (req.nextUrl.searchParams.get('q') ?? '').slice(0, 40);
    return { entries: searchUniverse(q, 12).map(({ symbol, name, assetClass, sector, market }) => ({ symbol, name, assetClass, sector, market })) };
}, req);
