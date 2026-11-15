// The generations of one visitor session, newest first: the current one and every earlier one a reset left behind.
// Read from the session record (lib/store session-record), whose history lists each reset's from / to generations.
// Nothing here writes: the old rows stay where they were, under the old ids.

import { readSessionItem } from '@/lib/store';
import { scopeIdOf, ZERO_GENERATIONS, type Generations } from '@/lib/session';

export type GenerationEntry = { profile: number; portfolio: number; scopeId: string; current: boolean; since: string | null; until: string | null };

export async function sessionGenerations(sessionId: string): Promise<GenerationEntry[]> {
    const record = await readSessionItem(sessionId);
    const current: Generations = record ? { profile: record.profileGeneration, portfolio: record.portfolioGeneration } : { ...ZERO_GENERATIONS };
    const history = record?.history ?? [];
    const key = (g: Generations) => `${g.profile}/${g.portfolio}`;
    const seen = new Map<string, GenerationEntry>();
    const add = (g: Generations, since: string | null, until: string | null) => {
        if (seen.has(key(g))) return;
        seen.set(key(g), { profile: g.profile, portfolio: g.portfolio, scopeId: scopeIdOf(sessionId, g), current: key(g) === key(current), since, until });
    };
    // Each reset closes the generation it came from and opens the one it went to
    history.forEach((entry, index) => add(entry.from, index > 0 ? history[index - 1].at : null, entry.at));
    add(current, history.length ? history[history.length - 1].at : null, null);
    return [...seen.values()].reverse();
}
