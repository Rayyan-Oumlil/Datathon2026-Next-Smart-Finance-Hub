type Counter = { count: number; expiresAt: number };
const counters = new Map<string, Counter>();
const MAX_KEYS = 5000;

// Longer values are cut: the header is sent by the caller, and a key must stay small
const MAX_IP_CHARS = 64;

/**
 * The caller's address: the last entry of x-forwarded-for (set by the load balancer), else 'unknown'. Used to key
 * per-visitor limits; always pair it with a global ceiling, since the first entry is whatever the client sent.
 */
export function clientIp(request: { headers: Headers }): string {
    // The load balancer appends the address it saw as the LAST entry; anything before it was sent by the client
    // and can be forged, so only the last one is trusted.
    const last = (request.headers.get('x-forwarded-for') ?? '').split(',').pop()?.trim();
    return last ? last.slice(0, MAX_IP_CHARS) : 'unknown';
}

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
