// The signal snapshot is collected once a day and kept on disk (.data/cache/signals/YYYY-MM-DD.json), so the
// watchlist never waits on a provider. When today's file is not there yet, the newest earlier one is served:
// every value in it still carries the time it was really fetched, which is how its age is shown.

import { readdir } from 'fs/promises';
import path from 'path';
import type { Sourced, SignalSet, UniverseEntry } from '@/lib/domain/types';
import { cacheDir, readJsonFile, writeJsonFile } from './cache';
import { collectSignals, type CollectOptions } from './signals';

export type DailySignals = {
    date: string;               // the day the file was collected for (Toronto date)
    collectedAt: string;
    stale: boolean;             // true when the file is from an earlier day
    fxUsdCad?: Sourced;
    signals: SignalSet[];
};
type DailyFile = Omit<DailySignals, 'stale'>;

const signalsDir = () => path.join(cacheDir(), 'signals');
const fileFor = (date: string) => path.join(signalsDir(), `${date}.json`);

// The day turns over with the Toronto market, not at midnight UTC
export const marketDate = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(now);

async function newestFile(upTo: string): Promise<DailyFile | null> {
    const names = await readdir(signalsDir()).catch(() => [] as string[]);
    const dates = names.filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).map((name) => name.slice(0, 10)).filter((date) => date <= upTo).sort();
    for (const date of dates.reverse()) {
        const file = await readJsonFile<DailyFile>(fileFor(date));
        if (file && Array.isArray(file.signals)) return file;
    }
    return null;
}

/** Collects every entry now and writes today's file. Used to warm the cache before the demo. */
export async function refreshDailySignals(entries: UniverseEntry[], options: CollectOptions = {}): Promise<DailySignals> {
    const collected = await collectSignals(entries, options);
    const file: DailyFile = { date: marketDate(), collectedAt: new Date().toISOString(), ...collected };
    await writeJsonFile(fileFor(file.date), file);
    return { ...file, stale: false };
}

/**
 * Signals for these entries, in their order: from today's file, else from the newest earlier file (stale: true),
 * else collected now. Entries a file does not hold are collected now, and added to the file when it is today's.
 */
export async function loadDailySignals(entries: UniverseEntry[], options: CollectOptions = {}): Promise<DailySignals> {
    const today = marketDate();
    const file = await newestFile(today);
    if (!file) return refreshDailySignals(entries, options);

    const held = new Map(file.signals.map((set) => [set.symbol, set]));
    const absent = entries.filter((entry) => !held.has(entry.symbol));
    if (absent.length > 0) {
        const fresh = await collectSignals(absent, options);
        for (const set of fresh.signals) held.set(set.symbol, set);
        file.fxUsdCad ??= fresh.fxUsdCad;
        if (file.date === today) await writeJsonFile(fileFor(today), { ...file, signals: [...held.values()] });
    }
    // The list row may have been edited since the file was written; the caller's entry is the current one
    return { ...file, stale: file.date !== today, signals: entries.map((entry) => ({ ...held.get(entry.symbol)!, entry })) };
}
