import { getBackend, plain, tables } from './client';

// The small mutable record of a visitor session: its current generations and how it got there. Kept in the profile
// table under its own key. The decision log holds the same reset events as append-only rows; this record is only
// the fast way to know the current generation.

export type SessionHistoryEntry = {
    at: string;
    level: 'portfolio' | 'profile' | 'all';
    from: { profile: number; portfolio: number };
    to: { profile: number; portfolio: number };
};

export type SessionItem = {
    sessionId: string;
    profileGeneration: number;
    portfolioGeneration: number;
    createdAt: string;
    history: SessionHistoryEntry[];
    version: number;            // 0 for a session that has never been reset (no row written yet)
};

const keyOf = (sessionId: string) => `session#${sessionId}`;

/** The stored record, or null for a session that has never been reset. */
export async function readSessionItem(sessionId: string): Promise<SessionItem | null> {
    const item = await getBackend().get(tables.profile(), { userId: keyOf(sessionId) });
    if (!item) return null;
    const { userId: _key, ...record } = item;
    return record as SessionItem;
}

/** Writes the record only if its stored version is `expected` (0: none yet); throws VersionConflictError otherwise. */
export async function writeSessionItem(record: Omit<SessionItem, 'version'>, expected: number): Promise<SessionItem> {
    const full: SessionItem = plain({ ...record, version: expected + 1 });
    await getBackend().putIfVersion(tables.profile(), { userId: keyOf(record.sessionId), ...full }, expected);
    return full;
}
