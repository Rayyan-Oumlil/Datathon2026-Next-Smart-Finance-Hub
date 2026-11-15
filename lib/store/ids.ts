import { randomBytes } from 'node:crypto';

let lastTime = 0;

/**
 * The time for a new log row. Two rows written in the same millisecond would sort in random order,
 * so within one process each new row is at least 1 ms after the previous one.
 */
export function nextTimestamp(): string {
    lastTime = Math.max(Date.now(), lastTime + 1);
    return new Date(lastTime).toISOString();
}

/**
 * A caller's own time, in the one form ids sort by. '10:00:00Z' and '10:00:00.500Z' are both valid ISO,
 * but as text the first sorts after the second, and a log row can never be re-sorted later.
 */
export function isoTime(at: string): string {
    const time = new Date(at);
    if (Number.isNaN(time.getTime())) throw new Error(`log time is not a valid date: ${at}`);
    return time.toISOString();
}

/** Sortable row id: ISO time + '#' + 8 random hex characters. */
export function newId(at: string): string {
    return `${at}#${randomBytes(4).toString('hex')}`;
}
