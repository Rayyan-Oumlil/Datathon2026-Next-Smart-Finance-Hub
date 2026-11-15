import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Messages as AppMessages } from 'next-intl';
import type { Locale } from '@/i18n/config';

// Every file messages/<locale>/<Namespace>.json becomes the top-level namespace <Namespace>, so each
// feature keeps its strings in its own file. The folder is read at run time, so a new file needs no
// registration anywhere (next.config.ts traces messages/ into the standalone build).
const MESSAGES_DIR = path.join(process.cwd(), 'messages');
type Messages = Record<string, unknown>;

async function read(locale: Locale): Promise<Messages> {
    const dir = path.join(MESSAGES_DIR, locale);
    const files = (await readdir(dir)).filter((file) => file.endsWith('.json')).sort();
    const entries = await Promise.all(files.map(async (file) => {
        const text = await readFile(path.join(dir, file), 'utf8');
        try {
            return [file.slice(0, -'.json'.length), JSON.parse(text)] as const;
        } catch (error) {
            throw new Error(`messages/${locale}/${file} is not valid JSON: ${(error as Error).message}`);
        }
    }));
    return Object.fromEntries(entries);
}

// Read once per server in production; in development every request re-reads, so edits show on refresh.
const cache = new Map<Locale, Promise<Messages>>();
export function loadMessages(locale: Locale): Promise<AppMessages> {
    if (process.env.NODE_ENV !== 'production') return read(locale) as Promise<AppMessages>;
    let messages = cache.get(locale);
    if (!messages) {
        messages = read(locale);
        messages.catch(() => cache.delete(locale));
        cache.set(locale, messages);
    }
    // The files are checked against each other by __tests__/messages.test.ts, not at run time
    return messages as Promise<AppMessages>;
}
