// A reply to a glossary question ("What is an ETF?") holds no live figure, so the same question in the same
// language, level, risk and style can be answered again from the first reply instead of three more model calls.
// Only replies that already passed every check are stored, and a stored reply goes through the web app's own
// wording check again. Held in this server's memory: a restart or a second container starts empty.

import { createHash } from 'node:crypto';

export const TTL_MS = 60 * 60 * 1000;
export const MAX_ENTRIES = 100;
const GLOSSARY_PREFIX = 'agent/glossary/';

export const normalizeMessage = (message: string): string => message.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

type KeyParts = { message: string; locale: string; level?: string | null; risk?: string | null; agentStyle?: string | null };

/** What the reply depends on: the question and the settings that shape the prompt. Not the holdings or the picks. */
export const cacheKey = ({ message, locale, level, risk, agentStyle }: KeyParts): string =>
    createHash('sha256').update(JSON.stringify([normalizeMessage(message), locale, level ?? null, risk ?? null, agentStyle ?? null]), 'utf8').digest('hex');

type Cacheable = { refused?: boolean; proposed?: unknown; conflict?: unknown; logComplete?: boolean; sources: ReadonlyArray<{ source: string }> };

/** Only a reply made of the vetted glossary alone: no quote, no proposal, no conflict, nothing refused. */
export const isCacheable = (reply: Cacheable): boolean =>
    !reply.refused && !reply.proposed && !reply.conflict && reply.logComplete !== false
    && reply.sources.length > 0 && reply.sources.every((item) => item.source.startsWith(GLOSSARY_PREFIX));

type Entry<T> = { value: T; actionId: string; expiresAt: number };

export class ReplyCache<T> {
    private readonly entries = new Map<string, Entry<T>>();
    constructor(private readonly now: () => number = Date.now) {}

    get size(): number {
        return this.entries.size;
    }

    /** A copy of the stored reply and the action that produced it; reading refreshes the entry's place. */
    get(key: string): { value: T; actionId: string } | undefined {
        const entry = this.entries.get(key);
        if (!entry) return undefined;
        this.entries.delete(key);
        if (entry.expiresAt <= this.now()) return undefined;
        this.entries.set(key, entry);
        return { value: structuredClone(entry.value), actionId: entry.actionId };
    }

    set(key: string, value: T, actionId: string): void {
        this.entries.delete(key);
        if (this.entries.size >= MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value as string);
        this.entries.set(key, { value: structuredClone(value), actionId, expiresAt: this.now() + TTL_MS });
    }

    clear(): void {
        this.entries.clear();
    }
}
