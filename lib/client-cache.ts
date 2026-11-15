'use client';

// A small cache for GET calls to the app's own API from the browser. It never changes a value: an answer is kept
// whole, as the server sent it, with the time it arrived.
//
// - Calls of the same URL in flight at the same time share one request.
// - An answer younger than maxAgeMs (default 5 s) is reused as is.
// - useCachedJson shows an answer up to staleMs old (default 5 min) at once and asks the server again in the
//   background, then shows the new answer.
// - Held in memory only (never in browser storage), so a full page load, which a switch of profile through /u/...
//   always is, starts empty. Call invalidateJson() after any change made through the API (a trade, a reset, a save).

import { useCallback, useEffect, useRef, useState } from 'react';

type Entry = { at: number; value: unknown };
type Listener = (value: unknown) => void;

const answers = new Map<string, Entry>();
const inFlight = new Map<string, { generation: number; promise: Promise<unknown> }>();
const listeners = new Map<string, Set<Listener>>();
let generation = 0;            // bumped by invalidateJson: a request sent before it is not stored after it

export class CachedJsonError extends Error {
    constructor(public status: number, public body: unknown) {
        super(typeof (body as { error?: unknown })?.error === 'string' ? (body as { error: string }).error : `HTTP ${status}`);
        this.name = 'CachedJsonError';
    }
}

const isApiGet = (url: string) => url.startsWith('/api/');

function request<T>(url: string): Promise<T> {
    const running = inFlight.get(url);
    if (running && running.generation === generation) return running.promise as Promise<T>;
    const sentIn = generation;
    const promise = (async () => {
        const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new CachedJsonError(response.status, body);
        if (sentIn === generation) {
            answers.set(url, { at: Date.now(), value: body });
            listeners.get(url)?.forEach((listener) => listener(body));
        }
        return body as T;
    })().finally(() => {
        if (inFlight.get(url)?.promise === promise) inFlight.delete(url);
    });
    inFlight.set(url, { generation: sentIn, promise });
    return promise;
}

export type CachedJsonOptions = { maxAgeMs?: number };

/** GET `url` (same-origin /api/ only) as JSON: reuses an answer younger than maxAgeMs, and a request in flight. */
export async function cachedJson<T>(url: string, options: CachedJsonOptions = {}): Promise<T> {
    if (!isApiGet(url)) throw new Error(`cachedJson only reads the app's own /api/ routes, not ${url}`);
    const held = answers.get(url);
    if (held && Date.now() - held.at < (options.maxAgeMs ?? 5_000)) return held.value as T;
    return request<T>(url);
}

/** The held answer for `url`, whatever its age, or undefined. */
export function peekJson<T>(url: string): { value: T; at: number } | undefined {
    const held = answers.get(url);
    return held ? { value: held.value as T, at: held.at } : undefined;
}

/** Forgets held answers (all, or those whose URL starts with `prefix`); requests already sent are not stored. */
export function invalidateJson(prefix = '/api/'): void {
    generation += 1;
    for (const url of [...answers.keys()]) if (url.startsWith(prefix)) answers.delete(url);
}

// ---------------------------------------------------------------- prefetch

// What each page reads first, all GET calls without side effects (the watchlist is left out: reading it can start
// a build). A prefetch also warms the server's own caches, so the page's first call answers sooner.
const PAGE_DATA: Record<string, string[]> = {
    '/portfolio': ['/api/portfolio', '/api/portfolio/xray'],
    '/strategy': ['/api/portfolio', '/api/strategy'],
    '/time-machine': ['/api/model-portfolios', '/api/strategy', '/api/replay/dataset'],
    '/start': ['/api/model-portfolios'],
    '/profile': ['/api/profile'],
};
const PREFETCH_EVERY_MS = 10_000;
const prefetchedAt = new Map<string, number>();

/** Warms one GET /api/ URL (at most once per 10 s); errors are ignored. */
export function prefetchJson(url: string): void {
    if (!isApiGet(url)) return;
    const last = prefetchedAt.get(url) ?? 0;
    if (Date.now() - last < PREFETCH_EVERY_MS) return;
    prefetchedAt.set(url, Date.now());
    request(url).catch(() => undefined);
}

/**
 * For a link's onMouseEnter / onFocus: asks the router to prefetch the page (when given) and warms the data the page
 * reads first. Example in components/shell/Sidebar.tsx:
 *   const router = useRouter();
 *   <Link href={href} onMouseEnter={() => prefetchRoute(href, router)} onFocus={() => prefetchRoute(href, router)}>
 */
export function prefetchRoute(href: string, router?: { prefetch: (href: string) => void }): void {
    try {
        router?.prefetch(href);
    } catch {
        // prefetching is only a hint
    }
    const path = href.split(/[?#]/)[0];
    for (const url of PAGE_DATA[path] ?? []) prefetchJson(url);
}

// ---------------------------------------------------------------- hook

export type CachedJsonState<T> = { data: T | undefined; error: unknown; loading: boolean; refresh: () => Promise<void> };

/**
 * The answer of GET `url` (null: nothing to load). A held answer up to staleMs old (default 5 min) is shown at once
 * and refreshed in the background; any other component reading the same URL gets the new answer too.
 */
export function useCachedJson<T>(url: string | null, options: { staleMs?: number; maxAgeMs?: number } = {}): CachedJsonState<T> {
    const staleMs = options.staleMs ?? 5 * 60_000;
    const maxAgeMs = options.maxAgeMs ?? 5_000;
    const initial = url ? answers.get(url) : undefined;
    const [data, setData] = useState<T | undefined>(initial && Date.now() - initial.at < staleMs ? (initial.value as T) : undefined);
    const [error, setError] = useState<unknown>(null);
    const [loading, setLoading] = useState<boolean>(Boolean(url));
    const current = useRef(url);
    current.current = url;

    const refresh = useCallback(async () => {
        if (!url) return;
        setLoading(true);
        try {
            const value = await request<T>(url);
            if (current.current === url) {
                setData(value);
                setError(null);
            }
        } catch (failure) {
            if (current.current === url) setError(failure);
        } finally {
            if (current.current === url) setLoading(false);
        }
    }, [url]);

    useEffect(() => {
        if (!url) {
            setLoading(false);
            return;
        }
        const listener: Listener = (value) => {
            if (current.current === url) setData(value as T);
        };
        const set = listeners.get(url) ?? new Set<Listener>();
        set.add(listener);
        listeners.set(url, set);

        const held = answers.get(url);
        const age = held ? Date.now() - held.at : Infinity;
        if (held && age < staleMs) setData(held.value as T);
        else setData(undefined);
        if (held && age < maxAgeMs) setLoading(false);
        else void refresh();

        return () => {
            set.delete(listener);
            if (set.size === 0) listeners.delete(url);
        };
    }, [url, staleMs, maxAgeMs, refresh]);

    return { data, error, loading, refresh };
}
