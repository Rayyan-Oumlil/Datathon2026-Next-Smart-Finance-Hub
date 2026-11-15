// Environment for the visitor session. Edge-safe (no Node imports): the middleware reads it too.

const DEV_SECRET = 'dev-only-session-secret-change-me-0123456789';
const MIN_SECRET_CHARS = 32;

export class SessionConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SessionConfigError';
    }
}

let warned = false;

/**
 * SESSION_SECRET signs the session cookie and the reset confirmation token. In production a missing or short value
 * stops every request (a known default would let anyone forge a session); in development a fixed default is used,
 * with a warning.
 */
export function getSessionSecret(): string {
    const secret = process.env.SESSION_SECRET;
    if (secret && secret.length >= MIN_SECRET_CHARS) return secret;
    if (process.env.NODE_ENV === 'production') {
        throw new SessionConfigError(secret ? `SESSION_SECRET is shorter than ${MIN_SECRET_CHARS} characters` : 'SESSION_SECRET is not set');
    }
    if (!warned && !process.env.VITEST) {
        warned = true;
        console.warn(`SESSION_SECRET is ${secret ? 'too short' : 'not set'}: using the development default. Never deploy without it.`);
    }
    return DEV_SECRET;
}

const OVERRIDE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * DEMO_USER_ID: an explicit override for local development and scripted tests. When set, every browser without a
 * valid session cookie shares this one session id (no cookie is written for it), as the single demo user did before
 * sessions existed. A cookie set by a hidden profile address (/u/new, /u/amira...) still wins.
 */
export function demoUserOverride(): string | null {
    const value = process.env.DEMO_USER_ID?.trim();
    if (!value) return null;
    if (!OVERRIDE.test(value)) throw new SessionConfigError('DEMO_USER_ID may hold only letters, digits, "-" and "_" (at most 64)');
    return value;
}
