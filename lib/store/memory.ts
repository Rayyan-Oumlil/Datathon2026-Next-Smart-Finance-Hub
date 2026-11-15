import { AlreadyExistsError, VersionConflictError, assertOverwritable, type Backend, type Item } from './client';

// Kept on globalThis so a dev-server module reload does not empty the store.
const holder = globalThis as { __storeMemoryTables?: Map<string, Map<string, Item>> };

function rows(table: string): Map<string, Item> {
    const all = (holder.__storeMemoryTables ??= new Map());
    let found = all.get(table);
    if (!found) all.set(table, (found = new Map()));
    return found;
}

const keyOf = (item: Item) => `${String(item.userId)}|${String(item.id ?? '')}`;
const copy = (item: Item): Item => structuredClone(item);

/** Same behaviour as the DynamoDB backend, held in process memory. For tests and offline runs. */
export const memoryBackend: Backend = {
    async get(table, key) {
        const found = rows(table).get(keyOf(key));
        return found && copy(found);
    },

    async put(table, item) {
        assertOverwritable(table);
        rows(table).set(keyOf(item), copy(item));
    },

    async putIfVersion(table, item, expected) {
        assertOverwritable(table);
        // Read and write with no await between them: no other call can run in the middle
        const stored = rows(table).get(keyOf(item));
        const current = stored === undefined ? 0 : Number(stored.version ?? NaN);
        if (current !== expected) throw new VersionConflictError(table, item.userId);
        rows(table).set(keyOf(item), copy(item));
    },

    async putNew(table, item) {
        if (rows(table).has(keyOf(item))) throw new AlreadyExistsError(table, item.id);
        rows(table).set(keyOf(item), copy(item));
    },

    async query({ table, keyName, keyValue, filter }) {
        const wanted = Object.entries(filter ?? {});
        return [...rows(table).values()]
            .filter((item) => item[keyName] === keyValue && wanted.every(([name, value]) => item[name] === value))
            .sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1))
            .map(copy);
    },
};

/** Test helper: empties the in-memory tables. Has no effect on DynamoDB. */
export function resetMemoryStore(): void {
    holder.__storeMemoryTables = new Map();
}

/** Test helper: a deep copy of every row of a table, in key order, to compare the store before and after a change. */
export function memorySnapshot(table: string): Item[] {
    return [...rows(table).entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, item]) => copy(item));
}
