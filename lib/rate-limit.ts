type Counter = { count: number; expiresAt: number };
const counters = new Map<string, Counter>();
const MAX_KEYS = 5000;

// Fixed-window counters in memory. With one demo user and one web container this protects the shared
// Finnhub quota well enough; several containers would each keep their own count.
export async function isRateLimited(key: string, max: number, windowSeconds: number, cost = 1): Promise<boolean> {
    const now = Date.now();
    const counter = counters.get(key);
    if (counter && counter.expiresAt > now) {
        counter.count += cost;
        return counter.count > max;
    }
    if (counters.size >= MAX_KEYS) {
        for (const [k, c] of counters) if (c.expiresAt <= now) counters.delete(k);
    }
    counters.set(key, { count: cost, expiresAt: now + windowSeconds * 1000 });
    return cost > max;
}
