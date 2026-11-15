import type { InvestmentRule, ProposedAction } from '@/lib/domain/types';
import { VersionConflictError, getBackend, tables } from './client';

// The spec gives these no table: they "live in the app". Each session generation (a scope, lib/session/scope.ts)
// has one small mutable document, kept in the profile table under its own key. It is not a log: it may change.
// Concurrent writers are kept apart by a version number and a conditional write, not by a lock in one process,
// so several web containers can share it.

export type LayoutWidget = { slot: string; widget: string; settings?: Record<string, unknown> };
// overview: true once the saved list covers the Overview modules too (a module left out is hidden). A layout saved
// before those modules existed has no marker, and every Overview module is then shown.
export type SavedLayout = { widgets: LayoutWidget[]; updatedAt: string; overview?: true };

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

/** What the document is keyed by: the scope id of a session generation. */
export type StateScope = { scopeId: string };

export const emptyState = (): AppState => ({
    rules: [],
    layout: null,
    watchlist: { listedSince: {}, pinned: [], dismissed: [], previousPicks: [] },
    pendingPreviews: [],
});

// DynamoDB refuses an item over 400 KB. The state is stored as one JSON string, so its size is known before the
// write; this leaves room for the key and the other attributes.
export const MAX_STATE_BYTES = 350_000;
const MAX_ATTEMPTS = 8;

export class StateTooLargeError extends Error {
    constructor(bytes: number) {
        super(`the app state would be ${bytes} bytes, over the ${MAX_STATE_BYTES}-byte limit`);
        this.name = 'StateTooLargeError';
    }
}

const keyOf = (scope: StateScope) => `state#${scope.scopeId}`;
const bytesOf = (state: AppState) => new TextEncoder().encode(JSON.stringify(state)).length;

// A preview the user can still act on (pending, or applied and so undoable) is dropped only after every other one
const settled = (preview: PendingPreview) => {
    const status = (preview as { status?: string }).status;
    return status !== 'pending' && status !== 'applied';
};

/**
 * The state as it can be stored: when it is over the size limit, the oldest agent previews are dropped (settled
 * ones first) until it fits. Rules, layout and watchlist state are never dropped; a state too large even without
 * any preview throws StateTooLargeError.
 */
export function fitState(state: AppState, maxBytes = MAX_STATE_BYTES): AppState {
    let size = bytesOf(state);
    if (size <= maxBytes) return state;
    const previews = [...state.pendingPreviews];
    const order = [...previews.filter(settled), ...previews.filter((p) => !settled(p))];    // oldest first in each group
    const dropped = new Set<PendingPreview>();
    for (const preview of order) {
        dropped.add(preview);
        size = bytesOf({ ...state, pendingPreviews: previews.filter((p) => !dropped.has(p)) });
        if (size <= maxBytes) break;
    }
    if (size > maxBytes) throw new StateTooLargeError(size);
    return { ...state, pendingPreviews: previews.filter((p) => !dropped.has(p)) };
}

function parse(item: Record<string, unknown> | undefined): { state: AppState; version: number } {
    const empty = emptyState();
    if (!item) return { state: empty, version: 0 };
    const stored = JSON.parse(String(item.state ?? '{}')) as Partial<AppState>;
    return { state: { ...empty, ...stored, watchlist: { ...empty.watchlist, ...stored.watchlist } }, version: Number(item.version) };
}

async function load(scope: StateScope) {
    return parse(await getBackend().get(tables.profile(), { userId: keyOf(scope) }));
}

async function write(scope: StateScope, state: AppState, expected: number): Promise<void> {
    await getBackend().putIfVersion(tables.profile(), {
        userId: keyOf(scope),
        scopeId: scope.scopeId,
        version: expected + 1,
        updatedAt: new Date().toISOString(),
        state: JSON.stringify(state),
    }, expected);
}

export async function readState(scope: StateScope): Promise<AppState> {
    return (await load(scope)).state;
}

/**
 * Reads the state, lets `change` edit it (in place, or by returning a new state) and saves the result, only if
 * nobody saved in between; otherwise it reads again and re-runs `change`. So `change` may run more than once and
 * must only compute from the state it is given. No write is lost to a concurrent one.
 */
export async function updateState(scope: StateScope, change: (state: AppState) => AppState | void | Promise<AppState | void>): Promise<AppState> {
    for (let attempt = 1; ; attempt++) {
        const { state, version } = await load(scope);
        const next = fitState((await change(state)) ?? state);
        try {
            await write(scope, next, version);
            return next;
        } catch (error) {
            if (!(error instanceof VersionConflictError) || attempt >= MAX_ATTEMPTS) throw error;
            // Spread out writers that collided, so they do not collide again at once
            await new Promise((resolve) => setTimeout(resolve, Math.random() * 10 * attempt));
        }
    }
}

/**
 * Writes the first document of a new generation (what a reset carries over). Does nothing when the generation
 * already has one: a document is never replaced wholesale.
 */
export async function seedState(scope: StateScope, state: AppState): Promise<boolean> {
    try {
        await write(scope, fitState(state), 0);
        return true;
    } catch (error) {
        if (error instanceof VersionConflictError) return false;
        throw error;
    }
}
