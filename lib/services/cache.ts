// A small keyed cache for computed views, held in this server process only. It never changes a value: it only
// decides when a value is computed. Each entry is stored whole, with the time it was computed, so any timestamp
// inside the value (a Sourced fetchedAt, a computedAt) stays the real one.
//
// - softTtlMs: younger than this, the stored value is returned as is.
// - hardTtlMs: between soft and hard, the stored value is returned at once and one refresh runs in the background
//   (stale-while-revalidate). Older than hard, the caller waits for a new computation.
// - single-flight: concurrent callers of the same key share one computation.
// - invalidate: a write calls it; a computation started before the write is never stored afterwards, and callers
//   after the write never join it.
//
// Per-user values must be keyed by the visitor's scope id (lib/session/scope.ts), which comes from the signed
// session cookie: a key without it must hold only data that is the same for every visitor.
// The maps live on globalThis so a module reload in development keeps them, as the other per-process caches do.

type Entry<T> = { value: T; at: number; epoch: number };
type Flight<T> = { epoch: number; promise: Promise<T> };

export type CacheOptions = {
    softTtlMs: number;
    hardTtlMs?: number;      // default: softTtlMs (no stale serving)
    maxEntries?: number;     // default 500; the least recently stored is dropped first
};

export type ViewCache<T> = {
    /** The value for `key`, computed by `load` when needed (see the header for the rules). */
    get(key: string, load: () => Promise<T>): Promise<T>;
    /** Drops `key`; a computation of it already running is not stored. */
    invalidate(key: string): void;
    /** Drops every key starting with `prefix` (end a prefix with a separator, so `a:f1|` never matches `a:f10|`). */
    invalidatePrefix(prefix: string): void;
    clear(): void;
};

type Store = { entries: Map<string, Entry<unknown>>; flights: Map<string, Flight<unknown>>; epochs: Map<string, number> };
const holder = globalThis as { __viewCaches?: Map<string, Store> };

function storeOf(name: string): Store {
    const all = (holder.__viewCaches ??= new Map());
    let store = all.get(name);
    if (!store) {
        store = { entries: new Map(), flights: new Map(), epochs: new Map() };
        all.set(name, store);
    }
    return store;
}

export function createViewCache<T>(name: string, options: CacheOptions): ViewCache<T> {
    const soft = options.softTtlMs;
    const hard = Math.max(soft, options.hardTtlMs ?? soft);
    const max = options.maxEntries ?? 500;
    const s = storeOf(name);
    const entries = s.entries as Map<string, Entry<T>>;
    const flights = s.flights as Map<string, Flight<T>>;
    const epochOf = (key: string) => s.epochs.get(key) ?? 0;

    const start = (key: string, load: () => Promise<T>): Promise<T> => {
        const epoch = epochOf(key);
        const running = flights.get(key);
        if (running && running.epoch === epoch) return running.promise;
        const promise = load()
            .then((value) => {
                // Stored only if nothing was written meanwhile
                if (epochOf(key) === epoch) {
                    entries.delete(key);
                    if (entries.size >= max) entries.delete(entries.keys().next().value as string);
                    entries.set(key, { value, at: Date.now(), epoch });
                }
                return value;
            })
            .finally(() => {
                if (flights.get(key)?.promise === promise) flights.delete(key);
            });
        flights.set(key, { epoch, promise });
        return promise;
    };

    const bump = (key: string) => {
        s.epochs.set(key, epochOf(key) + 1);
        entries.delete(key);
        flights.delete(key);
    };

    return {
        async get(key, load) {
            const entry = entries.get(key);
            if (entry && entry.epoch === epochOf(key)) {
                const age = Date.now() - entry.at;
                if (age < soft) return entry.value;
                if (age < hard) {
                    start(key, load).catch(() => undefined);   // a failed background refresh keeps the stored value
                    return entry.value;
                }
            }
            return start(key, load);
        },
        invalidate: bump,
        invalidatePrefix(prefix) {
            const keys = new Set([...entries.keys(), ...flights.keys()].filter((key) => key.startsWith(prefix)));
            for (const key of keys) bump(key);
        },
        clear() {
            for (const key of new Set([...entries.keys(), ...flights.keys()])) bump(key);
        },
    };
}
