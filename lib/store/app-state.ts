import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { InvestmentRule, ProposedAction } from '@/lib/domain/types';

// The spec gives these no table: they "live in the app". One small JSON file holds them.

export type LayoutWidget = { slot: string; widget: string; settings?: Record<string, unknown> };
export type SavedLayout = { widgets: LayoutWidget[]; updatedAt: string };

export type WatchlistState = {
    listedSince: Record<string, string>;    // symbol -> ISO time it entered the list
    pinned: string[];
    dismissed: string[];
    previousPicks: string[];                // symbols of the last computed list, in rank order
};

export type PendingPreview = { actionId: string; createdAt: string; proposed: ProposedAction };

export type AppState = {
    rules: InvestmentRule[];
    layout: SavedLayout | null;             // null until the user or the agent saves one
    watchlist: WatchlistState;
    pendingPreviews: PendingPreview[];
};

const emptyState = (): AppState => ({
    rules: [],
    layout: null,
    watchlist: { listedSince: {}, pinned: [], dismissed: [], previousPicks: [] },
    pendingPreviews: [],
});

const stateFile = () => process.env.APP_STATE_FILE || path.join(process.cwd(), '.data', 'app-state.json');

export async function readState(): Promise<AppState> {
    let text: string;
    try {
        text = await readFile(stateFile(), 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyState();
        throw error;
    }
    const empty = emptyState();
    const stored = JSON.parse(text) as Partial<AppState>;
    return { ...empty, ...stored, watchlist: { ...empty.watchlist, ...stored.watchlist } };
}

// Updates run one after another. The queue sits on globalThis so every copy of this module shares it.
const holder = globalThis as { __appStateQueue?: Promise<unknown> };

/**
 * Reads the state, lets `change` edit it (in place, or by returning a new state) and saves the result.
 * Concurrent calls in this process are queued, so none of them overwrites another's change.
 */
export function updateState(change: (state: AppState) => AppState | void | Promise<AppState | void>): Promise<AppState> {
    const run = async () => {
        const state = await readState();
        const next = (await change(state)) ?? state;
        const file = stateFile();
        await mkdir(path.dirname(file), { recursive: true });
        // Write beside the file, then rename: a reader sees the old file or the new one, never half of one.
        const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
        await writeFile(temp, JSON.stringify(next, null, 2), 'utf8');
        await rename(temp, file);
        return next;
    };
    const result = (holder.__appStateQueue ?? Promise.resolve()).then(run, run);
    holder.__appStateQueue = result.catch(() => undefined);
    return result;
}
