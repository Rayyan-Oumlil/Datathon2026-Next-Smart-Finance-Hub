import { z } from 'zod';
import { internalTool } from '@/lib/agent/internal';
import type { SignalSet } from '@/lib/domain/types';
import { isTradable, liveQuote, signalsFor } from '@/lib/services/quotes';
import { getEntry } from '@/lib/universe';

const schema = z.object({ symbols: z.array(z.string().trim().min(1).max(20)).min(1).max(10) });

// The day's signals per symbol, with the last quote on top when the asset has a live source. Every value is Sourced.
export const POST = internalTool(schema, async ({ symbols }) => {
    const items: SignalSet[] = [];
    const unknown: string[] = [];
    for (const symbol of symbols) {
        const entry = getEntry(symbol);
        if (!entry) {
            unknown.push(symbol);
            continue;
        }
        const { signals } = await signalsFor(entry);
        const quote = isTradable(entry) ? await liveQuote(entry).catch(() => null) : null;
        items.push(quote ? { ...signals, price: quote.price, ...(quote.changePercent ? { changePercent: quote.changePercent } : {}) } : signals);
    }
    return { items, ...(unknown.length > 0 ? { unknown, note: `Not in the app's list of assets: ${unknown.join(', ')}. No data exists for them here.` } : {}) };
});
