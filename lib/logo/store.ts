// Logo bytes kept in memory and on disk (.data/cache/logos, or DATA_CACHE_DIR/logos), so each image is fetched
// from the provider once a month at most. A symbol without a logo is remembered as a miss, so the cards that ask
// for it again get a fast 404 instead of a new provider call.

import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises';
import path from 'path';
import { cacheDir } from '@/lib/sources/cache';
import type { LogoContentType } from './fetch-image';

export const LOGO_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MISS_TTL_MS = 24 * 60 * 60 * 1000;
export const TRANSIENT_MISS_TTL_MS = 10 * 60 * 1000;   // the provider was down or busy: try again soon
const MAX_MEMORY_ENTRIES = 2000;

export type LogoHit = { kind: 'hit'; symbol: string; contentType: LogoContentType; bytes: Buffer; storedAt: string; sourceUrl: string };
export type LogoMiss = { kind: 'miss'; symbol: string; storedAt: string; transient: boolean; reason: string };
export type LogoEntry = LogoHit | LogoMiss;

type Meta = Omit<LogoHit, 'bytes'> | LogoMiss;

const memory = new Map<string, LogoEntry>();

const logoDir = () => path.join(cacheDir(), 'logos');
const safe = (symbol: string) => symbol.replace(/[^A-Z0-9.-]+/g, '_');
const metaFile = (symbol: string) => path.join(logoDir(), `${safe(symbol)}.json`);
const bytesFile = (symbol: string) => path.join(logoDir(), `${safe(symbol)}.img`);

export const entryTtl = (entry: LogoEntry) => (entry.kind === 'hit' ? LOGO_TTL_MS : entry.transient ? TRANSIENT_MISS_TTL_MS : MISS_TTL_MS);
export const isFresh = (entry: LogoEntry, now = Date.now()) => now - Date.parse(entry.storedAt) < entryTtl(entry);

function remember(entry: LogoEntry): void {
    if (memory.size >= MAX_MEMORY_ENTRIES && !memory.has(entry.symbol)) {
        const oldest = memory.keys().next().value;
        if (oldest !== undefined) memory.delete(oldest);
    }
    memory.set(entry.symbol, entry);
}

/** The entry held for this symbol, fresh or not, or null. Memory first, then disk. */
export async function readLogoEntry(symbol: string): Promise<LogoEntry | null> {
    const held = memory.get(symbol);
    if (held) return held;
    try {
        const meta = JSON.parse(await readFile(metaFile(symbol), 'utf8')) as Meta;
        if (meta.symbol !== symbol) return null;
        const entry: LogoEntry = meta.kind === 'hit' ? { ...meta, bytes: await readFile(bytesFile(symbol)) } : meta;
        remember(entry);
        return entry;
    } catch {
        return null;   // absent or unreadable: not cached
    }
}

let writes = 0;
async function writeAtomic(file: string, data: Buffer | string): Promise<void> {
    const temporary = `${file}.${process.pid}.${++writes}.tmp`;
    await writeFile(temporary, data);
    try {
        await rename(temporary, file);
    } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw error;
    }
}

export async function writeLogoEntry(entry: LogoEntry): Promise<void> {
    remember(entry);
    try {
        await mkdir(logoDir(), { recursive: true });
        if (entry.kind === 'hit') {
            const { bytes, ...meta } = entry;
            await writeAtomic(bytesFile(entry.symbol), bytes);   // bytes first: a meta file never points at nothing
            await writeAtomic(metaFile(entry.symbol), JSON.stringify(meta));
        } else {
            await writeAtomic(metaFile(entry.symbol), JSON.stringify(entry));
        }
    } catch {
        // A read-only disk keeps the entry in memory only
    }
}

/** Forgets what is held in memory (the files stay). Used by tests. */
export function clearLogoMemory(): void {
    memory.clear();
}
