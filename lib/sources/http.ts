// One way to call a provider: a timeout, one retry when it says "slow down" or fails on its side, and errors
// that name the status. URLs passed here never carry a key (keys travel in headers), so they are safe to log.

export class HttpError extends Error {
    constructor(public status: number, public url: string, body = '') {
        super(`HTTP ${status} from ${url}${body ? `: ${body.slice(0, 200)}` : ''}`);
    }
}

export const BROWSER_USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export type FetchJsonOptions = {
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: unknown;                 // sent as JSON
    timeoutMs?: number;
    browserUserAgent?: boolean;     // Yahoo and TMX refuse the default Node agent
    retryDelayMs?: number;          // backoff before the single retry, unless the provider sends Retry-After
};

const MAX_RETRY_WAIT_MS = 10_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const retryable = (status: number) => status === 429 || status >= 500;

export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<T> {
    const { method = 'GET', body, timeoutMs = 10_000, retryDelayMs = 1500 } = options;
    const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
    if (options.browserUserAgent) headers['User-Agent'] = BROWSER_USER_AGENT;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    for (let attempt = 0; ; attempt++) {
        let res: Response;
        try {
            res = await fetch(url, {
                method,
                headers,
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: AbortSignal.timeout(timeoutMs),
                cache: 'no-store',
            });
        } catch (e) {
            throw new Error(`No answer from ${url}: ${e instanceof Error ? e.message : String(e)}`);
        }
        if (res.ok) return (await res.json()) as T;
        if (attempt === 0 && retryable(res.status)) {
            const retryAfterSeconds = Number(res.headers.get('retry-after'));
            const wait = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : retryDelayMs;
            await sleep(Math.min(wait, MAX_RETRY_WAIT_MS));
            continue;
        }
        throw new HttpError(res.status, url, await res.text().catch(() => ''));
    }
}
