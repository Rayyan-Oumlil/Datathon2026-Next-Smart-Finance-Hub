import { NextRequest } from 'next/server';
import { z } from 'zod';
import { respond } from '@/lib/services/http';
import { userAction } from '@/lib/services/watchlist';

const schema = z.object({ symbol: z.string().trim().min(1).max(20), action: z.enum(['add', 'dismiss', 'pin', 'unpin']) });

export const POST = (req: NextRequest) => respond(async () => {
    const { symbol, action } = schema.parse(await req.json());
    return userAction(symbol, action);
});
