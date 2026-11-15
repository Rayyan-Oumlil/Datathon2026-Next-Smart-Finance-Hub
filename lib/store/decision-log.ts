import type { DecisionLogEntry, DecisionLogKind } from '@/lib/domain/types';
import { getBackend, plain, tables, type Item } from './client';
import { isoTime, newId, nextTimestamp } from './ids';

// DynamoDB rejects items over 400 KB. A watchlist snapshot can be larger, so a payload whose JSON is
// over this many bytes is stored as numbered chunk rows next to a head row that carries no payload.
export const CHUNK_BYTES = 300_000;

export type NewDecision = Omit<DecisionLogEntry, 'id' | 'at'> & Partial<Pick<DecisionLogEntry, 'at'>>;

export type DecisionQuery = {
    kind?: DecisionLogKind;
    symbol?: string;
    snapshotId?: string;
    limit?: number;
    newestFirst?: boolean;      // default false: oldest first
};

const chunkId = (id: string, index: number) => `${id}#chunk-${String(index).padStart(4, '0')}`;

/** Cuts text into pieces of at most `size` UTF-8 bytes without splitting a character. */
function splitByBytes(text: string, size: number): string[] {
    const bytes = Buffer.from(text, 'utf8');
    const parts: string[] = [];
    let start = 0;
    while (start < bytes.length) {
        let end = Math.min(start + size, bytes.length);
        while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;   // step back off a continuation byte
        parts.push(bytes.subarray(start, end).toString('utf8'));
        start = end;
    }
    return parts;
}

/** Appends one row to the decision log. Rows are never changed or removed afterwards. */
export async function appendDecision(entry: NewDecision): Promise<DecisionLogEntry> {
    const at = entry.at === undefined ? nextTimestamp() : isoTime(entry.at);
    const json = JSON.stringify(entry.payload ?? null);
    const full: DecisionLogEntry = plain({ ...entry, at, id: newId(at), payload: JSON.parse(json) });
    const backend = getBackend();
    const table = tables.decisionLog();

    if (Buffer.byteLength(json, 'utf8') <= CHUNK_BYTES) {
        await backend.putNew(table, full);
        return full;
    }

    const head: Item = { ...full };
    delete head.payload;
    const parts = splitByBytes(json, CHUNK_BYTES);
    for (let i = 0; i < parts.length; i++) {
        await backend.putNew(table, { ...head, id: chunkId(full.id, i), chunk: i, chunkOf: full.id, data: parts[i] });
    }
    // The head row goes last: an entry exists only once all of its chunks do.
    await backend.putNew(table, { ...head, chunks: parts.length });
    return full;
}

function assemble(head: Item, chunkRows: Item[]): DecisionLogEntry {
    const { chunks, ...entry } = head;
    if (chunks === undefined) return entry as DecisionLogEntry;
    const parts = [...chunkRows].sort((a, b) => Number(a.chunk) - Number(b.chunk));
    if (parts.length !== chunks || parts.some((part, i) => part.chunk !== i)) {
        throw new Error(`decision log entry ${String(head.id)}: expected ${String(chunks)} payload chunks, found ${parts.length}`);
    }
    return { ...entry, payload: JSON.parse(parts.map((part) => part.data).join('')) } as DecisionLogEntry;
}

export async function listDecisions(userId: string, query: DecisionQuery = {}): Promise<DecisionLogEntry[]> {
    const filter: Record<string, string> = {};
    if (query.kind) filter.kind = query.kind;
    if (query.symbol) filter.symbol = query.symbol;
    if (query.snapshotId) filter.snapshotId = query.snapshotId;

    // Chunk rows carry the same kind, symbol and snapshotId as their head, so the filter keeps them together.
    const rows = await getBackend().query({ table: tables.decisionLog(), keyName: 'userId', keyValue: userId, filter });
    const chunkRows = new Map<string, Item[]>();
    for (const row of rows) {
        if (row.chunk === undefined) continue;
        const of = String(row.chunkOf);
        chunkRows.set(of, [...(chunkRows.get(of) ?? []), row]);
    }
    // A chunk without a head row is a write that did not finish; it is not an entry.
    const entries = rows
        .filter((row) => row.chunk === undefined)
        .map((head) => assemble(head, chunkRows.get(String(head.id)) ?? []));
    if (query.newestFirst) entries.reverse();
    return query.limit === undefined ? entries : entries.slice(0, query.limit);
}

export async function getDecision(userId: string, id: string): Promise<DecisionLogEntry | null> {
    const backend = getBackend();
    const table = tables.decisionLog();
    const head = await backend.get(table, { userId, id });
    if (!head || head.chunk !== undefined) return null;
    const count = typeof head.chunks === 'number' ? head.chunks : 0;
    const chunkRows = await Promise.all(Array.from({ length: count }, (_, i) => backend.get(table, { userId, id: chunkId(id, i) })));
    return assemble(head, chunkRows.filter((row): row is Item => row !== undefined));
}
