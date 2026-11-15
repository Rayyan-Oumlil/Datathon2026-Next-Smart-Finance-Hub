// Signed tokens for the anonymous visitor session (and the short-lived reset confirmation). Pure functions on the
// Web Crypto API only, so the same code runs in the middleware (edge runtime), in route handlers and in tests.

export const SESSION_COOKIE = 'nsfh_session';
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 3600;
// The cookie slides: a visit re-issues it once it is a day old, so an active visitor keeps the same session
export const REFRESH_AFTER_SECONDS = 24 * 3600;

export type SessionPayload = { v: 1; sid: string; iat: number; exp: number };   // times in seconds since the epoch

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// The stored example users (lib/personas) have a stable, readable id instead of a random UUID
const PERSONA = /^persona-[a-z]{1,20}$/;
export const personaSessionId = (name: string): string => `persona-${name}`;
export const isSessionId = (value: unknown): value is string => typeof value === 'string' && (UUID.test(value) || PERSONA.test(value));

const seconds = (ms: number) => Math.floor(ms / 1000);

export function newSessionPayload(nowMs: number, sid: string = crypto.randomUUID()): SessionPayload {
    const iat = seconds(nowMs);
    return { v: 1, sid, iat, exp: iat + SESSION_MAX_AGE_SECONDS };
}

/** The same session with a fresh expiry. */
export function refreshPayload(payload: SessionPayload, nowMs: number): SessionPayload {
    return newSessionPayload(nowMs, payload.sid);
}

export const needsRefresh = (payload: SessionPayload, nowMs: number): boolean => seconds(nowMs) - payload.iat >= REFRESH_AFTER_SECONDS;

// ---------------------------------------------------------------- encoding

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array | null {
    if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
    try {
        const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
        return Uint8Array.from(binary, (char) => char.charCodeAt(0));
    } catch {
        return null;
    }
}

const keys = new Map<string, Promise<CryptoKey>>();
function hmacKey(secret: string): Promise<CryptoKey> {
    let key = keys.get(secret);
    if (!key) {
        key = crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
        keys.set(secret, key);
    }
    return key;
}

// The purpose is signed with the body, so a reset token can never pass as a session cookie, nor the reverse
const signedText = (purpose: string, body: string) => encoder.encode(`${purpose}.${body}`);

/** `<base64url(JSON)>.<base64url(HMAC-SHA256)>` */
export async function signToken(payload: object, secret: string, purpose: string): Promise<string> {
    const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), signedText(purpose, body)));
    return `${body}.${toBase64Url(signature)}`;
}

/** The payload when the signature matches (checked in constant time by Web Crypto), else null. Expiry is the caller's. */
export async function verifyToken<T>(token: string | undefined | null, secret: string, purpose: string): Promise<T | null> {
    if (typeof token !== 'string' || token.length > 2048) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [body, sig] = parts;
    const signature = fromBase64Url(sig);
    if (!signature || signature.length !== 32) return null;
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), signature as Uint8Array<ArrayBuffer>, signedText(purpose, body));
    if (!ok) return null;
    const bytes = fromBase64Url(body);
    if (!bytes) return null;
    try {
        const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
        return parsed && typeof parsed === 'object' ? (parsed as T) : null;
    } catch {
        return null;
    }
}

export const signSession = (payload: SessionPayload, secret: string): Promise<string> => signToken(payload, secret, 'session');

/** A session cookie that is intact, well formed and not expired; null for anything else (the caller starts a new one). */
export async function verifySession(token: string | undefined | null, secret: string, nowMs: number): Promise<SessionPayload | null> {
    const payload = await verifyToken<SessionPayload>(token, secret, 'session');
    if (!payload || payload.v !== 1 || !isSessionId(payload.sid)) return null;
    if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) || payload.exp <= seconds(nowMs)) return null;
    // A cookie issued in the future, or living longer than the maximum, was not issued by this code
    if (payload.iat > seconds(nowMs) + 60 || payload.exp - payload.iat > SESSION_MAX_AGE_SECONDS) return null;
    return payload;
}

export type CookieOptions = { httpOnly: true; sameSite: 'lax'; secure: boolean; path: '/'; maxAge: number };

export const sessionCookieOptions = (secure: boolean): CookieOptions => ({ httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: SESSION_MAX_AGE_SECONDS });

/** HTTPS as the visitor sees it: behind the load balancer / CloudFront the scheme comes in x-forwarded-proto. */
export function isHttps(headers: Headers, url?: string): boolean {
    const forwarded = headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
    if (forwarded) return forwarded === 'https';
    return Boolean(url && url.startsWith('https:'));
}
