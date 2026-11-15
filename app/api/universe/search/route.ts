import { NextRequest } from 'next/server';
import { respond } from '@/lib/services/http';
import { UNIVERSE_KINDS, filterUniverse, hasUniverseFilter, listSectors, searchUniverse, type UniverseFilter, type UniverseKind } from '@/lib/universe';

// GET /api/universe/search?q=&type=&market=&sector=
// Only q: the first 12 matches, as before. With a filter: up to 60 matches; without text they are sorted by name.
export const GET = (req: NextRequest) => respond(async () => {
    const params = req.nextUrl.searchParams;
    const q = (params.get('q') ?? '').slice(0, 40);
    const type = params.get('type') ?? '';
    const market = params.get('market') ?? '';
    const sector = params.get('sector') ?? '';
    const filter: UniverseFilter = {
        kind: (UNIVERSE_KINDS as readonly string[]).includes(type) ? type as UniverseKind : undefined,
        market: market === 'US' || market === 'Canada' ? market : undefined,
        sector: listSectors().some((row) => row.sector === sector) ? sector : undefined,
    };
    const found = hasUniverseFilter(filter) ? filterUniverse(q, filter, 60) : searchUniverse(q, 12);
    return { entries: found.map(({ symbol, name, assetClass, sector, market }) => ({ symbol, name, assetClass, sector, market })) };
}, req);
