// A small cache, in memory and on disk (one JSON file per key), so a daily value fetched once is reused across
// restarts and the demo never waits on a provider. Entries are stored whole: a Sourced value keeps the fetchedAt
// it was fetched with, so a cached or stale value never looks fresher than it is.

import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises';
import path from 'path';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const QUOTE_TTL_MS = 60 * 1000;

type Entry<T> = { key: string; storedAt: string; value: T };
export type Cached<T> = { value: T; storedAt: string; stale: boolean };

const memory = new Map<string, Entry<unknown>>();
const inFlight = new Map<string, Promise<Cached<unknown>>>();

export const cacheDir = () => process.env.DATA_CACHE_DIR || path.join(process.cwd(), '.data', 'cache');
const fileFor = (key: string) => path.join(cacheDir(), `${key.replace(/[^A-Za-z0-9._-]+/g, '_')}.json`);

export async function readJsonFile<T>(file: string): Promise<T | null> {
    try {
        return JSON.parse(await readFile(file, 'utf8')) as T;
    } catch {
        return null;   // absent or unreadable: treated as not cached
    }
}

// Written to a temporary name first, so a crash mid-write never leaves half a file behind.
// The name is unique per write: two writes of the same file at once must not share it.
let writes = 0;
export async function writeJsonFile(file: string, data: unknown): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${++writes}.tmp`;
    await writeFile(temporary, JSON.stringify(data));
    // On Windows, renaming onto a file another write is replacing at that moment fails with EPERM / EBUSY / EACCES:
    // trying again a moment later succeeds, and the last write wins as it does elsewhere
    for (let attempt = 0; ; attempt++) {
        try {
            await rename(temporary, file);
            return;
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (attempt >= 5 || !(code === 'EPERM' || code === 'EBUSY' || code === 'EACCES')) {
                await rm(temporary, { force: true }).catch(() => undefined);
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
        }
    }
}

async function readEntry<T>(key: string): Promise<Entry<T> | null> {
    const held = memory.get(key) as Entry<T> | undefined;
    if (held) return held;
    const onDisk = await readJsonFile<Entry<T>>(fileFor(key));
    if (!onDisk || onDisk.key !== key) return null;
    memory.set(key, onDisk);
    return onDisk;
}

/**
 * For screens only (never for a trade): when the held value is older than the TTL but younger than TTL + forMs,
 * wait at most waitMs for the refresh, then answer with the held value (its fetchedAt unchanged).
 */
export type LastKnown = { forMs: number; waitMs: number };

/** Screens wait at most 1.5 s for a fresh quote, then show the last one held (up to a day old, with its own time). */
export const SCREEN_QUOTE: LastKnown = { forMs: DAY_MS, waitMs: 1500 };

/**
 * Returns the cached value while it is younger than ttlMs; otherwise calls load() and stores the result.
 * If load() fails and an older entry exists, that entry comes back with stale: true and the caller decides
 * what to do with it. With no entry at all, the error from load() is thrown.
 */
export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>, lastKnown?: LastKnown): Promise<Cached<T>> {
    const entry = await readEntry<T>(key);
    const age = entry ? Date.now() - Date.parse(entry.storedAt) : Infinity;
    if (entry && age < ttlMs) return { value: entry.value, storedAt: entry.storedAt, stale: false };

    // One provider call per key at a time, however many callers ask
    let pending = inFlight.get(key) as Promise<Cached<T>> | undefined;
    if (!pending) {
        pending = (async () => {
            try {
                const fresh: Entry<T> = { key, storedAt: new Date().toISOString(), value: await load() };
                memory.set(key, fresh);
                await writeJsonFile(fileFor(key), fresh).catch(() => undefined);   // a read-only disk must not lose the value
                return { value: fresh.value, storedAt: fresh.storedAt, stale: false };
            } catch (e) {
                if (entry) return { value: entry.value, storedAt: entry.storedAt, stale: true };
                throw e;
            }
        })().finally(() => inFlight.delete(key));
        inFlight.set(key, pending);
    }
    // A screen may show the last value held while the provider is slow: it keeps its own fetchedAt, so its age shows.
    // The refresh goes on in the background and the next read gets it.
    if (lastKnown && entry && age < ttlMs + lastKnown.forMs) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), lastKnown.waitMs); });
        const failed: Cached<T> = { value: entry.value, storedAt: entry.storedAt, stale: true };
        const first = await Promise.race([pending.catch(() => failed), late]);
        clearTimeout(timer);
        if (first) return first;
        return { value: entry.value, storedAt: entry.storedAt, stale: false };
    }
    return pending;
}

/** Forgets what is held in memory (the files stay). Used by tests to simulate a restart. */
export function clearMemoryCache(): void {
    memory.clear();
}

export const STALE_NOTE = 'the provider did not answer at the last refresh; this is the last value we hold, see fetchedAt';

const withStaleNote = <V extends { fetchedAt: string; note?: string }>(sourced: V): V =>
    ({ ...sourced, note: sourced.note ? `${sourced.note}; ${STALE_NOTE}` : STALE_NOTE });
const isSourced = (x: unknown): x is { fetchedAt: string; note?: string } =>
    typeof x === 'object' && x !== null && typeof (x as { fetchedAt?: unknown }).fetchedAt === 'string';

/**
 * cached() for what the source modules return: one Sourced value, or an object whose fields are Sourced values.
 * A stale result keeps its original fetchedAt and gets a note saying the provider failed, so it can be shown as such.
 */
export async function remember<T>(key: string, ttlMs: number, load: () => Promise<T>, lastKnown?: LastKnown): Promise<T> {
    const hit = await cached(key, ttlMs, load, lastKnown);
    if (!hit.stale) return hit.value;
    if (isSourced(hit.value)) return withStaleNote(hit.value);
    const marked = Object.entries(hit.value as Record<string, unknown>).map(([field, x]) => [field, isSourced(x) ? withStaleNote(x) : x]);
    return Object.fromEntries(marked) as T;
}
