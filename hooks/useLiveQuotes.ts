'use client';

import { useEffect, useState } from "react";
import { cachedJson } from "@/lib/client-cache";
import { isRealtime } from "@/lib/market-data";

export type LiveQuote = { c?: number; d?: number; dp?: number; h?: number; l?: number; o?: number; pc?: number; t?: number };

// Realtime mode only: polls the shared /api/quotes cache while the tab is visible.
// In cached mode prices come from the server render and refresh hourly for everyone.
// Components polling the same symbols share one request (lib/client-cache.ts), reused for 5 s like the route's max-age.
export function useLiveQuotes(symbols: string[], intervalMs = 15_000) {
    const [quotes, setQuotes] = useState<Record<string, LiveQuote | null>>({});
    const key = symbols.join(",");

    useEffect(() => {
        if (!key || !isRealtime) return;
        let cancelled = false;

        const load = async () => {
            if (document.visibilityState !== "visible") return;
            try {
                const next = await cachedJson<Record<string, LiveQuote | null>>(`/api/quotes?symbols=${encodeURIComponent(key)}`);
                if (!cancelled) setQuotes(next);
            } catch { /* keep the last good prices */ }
        };
        const onVisibility = () => { if (document.visibilityState === "visible") load(); };

        const interval = setInterval(load, intervalMs);
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            cancelled = true;
            clearInterval(interval);
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, [key, intervalMs]);

    return quotes;
}
