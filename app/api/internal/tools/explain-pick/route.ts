import { z } from 'zod';
import { internalTool } from '@/lib/agent/internal';
import { explainSymbol } from '@/lib/services/watchlist';

// What the last logged watchlist run says about one symbol; nothing is recomputed.
export const POST = internalTool(z.object({ symbol: z.string().trim().min(1).max(20) }), ({ symbol }, _actionId, scope) => explainSymbol(symbol, 'en', scope));
