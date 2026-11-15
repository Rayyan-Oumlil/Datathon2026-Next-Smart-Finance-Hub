import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '@/app/api/voice/token/route';
import { isRateLimited } from '@/lib/rate-limit';
import { signingCredentials } from '@/lib/voice/credentials';
import { MAX_URLS_PER_DAY, resetDailyUrls, takeDailyUrl } from '@/lib/voice/guard';

vi.mock('@/lib/rate-limit', async (original) => ({ ...(await original<typeof import('@/lib/rate-limit')>()), isRateLimited: vi.fn(async () => false) }));
vi.mock('@/lib/voice/credentials', () => ({ AWS_REGION: 'us-east-1', signingCredentials: vi.fn() }));

const limited = vi.mocked(isRateLimited);
const credentials = vi.mocked(signingCredentials);
const call = (headers: Record<string, string> = {}) => POST(new NextRequest('http://localhost/api/voice/token', { method: 'POST', headers }));

beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('VOICE_ENABLED', '');
    resetDailyUrls();
    limited.mockReset().mockResolvedValue(false);
    credentials.mockReset().mockResolvedValue({ accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret-key-value', sessionToken: 'session' });
});

describe('POST /api/voice/token', () => {
    it('returns a pre-signed Transcribe URL that identifies English or French, preferring English by default', async () => {
        const response = await call();
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body).toMatchObject({ languages: ['en-US', 'fr-CA'], preferred: 'en-US', sampleRate: 16000 });
        const url = new URL(body.url);
        expect(url.protocol).toBe('wss:');
        expect(url.searchParams.get('identify-language')).toBe('true');
        expect(url.searchParams.get('language-options')).toBe('en-US,fr-CA');
        expect(url.searchParams.get('preferred-language')).toBe('en-US');
        expect(url.searchParams.has('language-code')).toBe(false);
        expect(url.searchParams.get('sample-rate')).toBe('16000');
    });

    it('prefers the language the app is set to, and still identifies both', async () => {
        const body = await (await call({ cookie: 'NEXT_LOCALE=fr' })).json();
        expect(body).toMatchObject({ languages: ['en-US', 'fr-CA'], preferred: 'fr-CA' });
        const url = new URL(body.url);
        expect(url.searchParams.get('preferred-language')).toBe('fr-CA');
        expect(url.searchParams.get('language-options')).toBe('en-US,fr-CA');
    });

    it('signs a short-lived URL and tells caches not to keep it', async () => {
        const response = await call();
        expect(response.headers.get('cache-control')).toBe('no-store');
        const body = await response.json();
        expect(body.expiresIn).toBe(60);
        expect(new URL(body.url).searchParams.get('X-Amz-Expires')).toBe('60');
    });

    it('never exposes the secret key', async () => {
        expect(JSON.stringify(await (await call()).json())).not.toContain('secret-key-value');
    });

    it('is rate limited, with the message in the request language', async () => {
        limited.mockResolvedValue(true);
        const response = await call({ cookie: 'NEXT_LOCALE=fr' });
        expect(response.status).toBe(429);
        expect((await response.json()).error).toMatch(/Trop de demandes/);
    });

    it('answers a server error without leaking the cause when credentials cannot be resolved', async () => {
        credentials.mockRejectedValue(new Error('CredentialsProviderError: IMDS at 169.254.169.254 unreachable'));
        const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const response = await call();
        expect(response.status).toBe(500);
        expect(JSON.stringify(await response.json())).not.toContain('169.254');
        spy.mockRestore();
    });

    it('mints nothing and answers 404 with an error when VOICE_ENABLED is not "true"', async () => {
        for (const value of ['false', 'no', 'TRUE ']) {
            vi.stubEnv('VOICE_ENABLED', value);
            const response = await call();
            if (value === 'TRUE ') { expect(response.status).toBe(200); continue; }
            expect(response.status).toBe(404);
            expect((await response.json()).error).toMatch(/turned off/);
        }
        vi.stubEnv('VOICE_ENABLED', 'false');
        credentials.mockClear();
        await call();
        expect(credentials).not.toHaveBeenCalled();
    });

    it('is off by default in production and on by default in development', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        expect((await call()).status).toBe(404);
        expect(await (await GET()).json()).toEqual({ enabled: false });
        vi.stubEnv('VOICE_ENABLED', 'true');
        expect((await call()).status).toBe(200);
        vi.stubEnv('VOICE_ENABLED', '');
        vi.stubEnv('NODE_ENV', 'development');
        expect((await call()).status).toBe(200);
    });

    it('tells the client whether voice is offered, read at request time and never cached', async () => {
        vi.stubEnv('VOICE_ENABLED', 'true');
        const on = await GET();
        expect(on.headers.get('cache-control')).toBe('no-store');
        expect(await on.json()).toEqual({ enabled: true });
        vi.stubEnv('VOICE_ENABLED', 'false');
        expect(await (await GET()).json()).toEqual({ enabled: false });
    });

    it('refuses with a 403 a request whose Origin is another host, and mints nothing', async () => {
        const response = await call({ origin: 'https://evil.example', host: 'localhost' });
        expect(response.status).toBe(403);
        expect(credentials).not.toHaveBeenCalled();
        expect((await call({ origin: 'null', host: 'localhost' })).status).toBe(403);
    });

    it('accepts the same origin, and a request without an Origin header', async () => {
        expect((await call({ origin: 'http://localhost:3000', host: 'localhost:3000' })).status).toBe(200);
        expect((await call()).status).toBe(200);
    });

    it('limits per visitor address (the last x-forwarded-for entry) (6 a minute, 60 an hour) and keeps a ceiling for everyone', async () => {
        await call({ 'x-forwarded-for': '203.0.113.7, 10.0.0.2' });
        const keys = limited.mock.calls.map(([key, max, window]) => [key, max, window]);
        expect(keys).toContainEqual(['voice:ip:10.0.0.2:minute', 6, 60]);
        expect(keys).toContainEqual(['voice:ip:10.0.0.2:hour', 60, 3600]);
        expect(keys).toContainEqual([expect.stringMatching(/^voice:user:/), 30, 60]);
    });

    it('refuses with a 429 when one address is over its limit, and mints nothing', async () => {
        limited.mockImplementation(async (key: string) => key.startsWith('voice:ip:203.0.113.7:'));
        expect((await call({ 'x-forwarded-for': '203.0.113.7' })).status).toBe(429);
        expect(credentials).not.toHaveBeenCalled();
        expect((await call({ 'x-forwarded-for': '198.51.100.4' })).status).toBe(200);
    });

    it('stops at the daily ceiling of minted URLs with a translated 429, and mints nothing', async () => {
        for (let i = 0; i < MAX_URLS_PER_DAY; i++) expect(takeDailyUrl()).toBe(true);
        const response = await call({ cookie: 'NEXT_LOCALE=fr' });
        expect(response.status).toBe(429);
        expect((await response.json()).error).toMatch(/limite d'aujourd'hui/);
        expect(credentials).not.toHaveBeenCalled();
        expect((await (await call()).json()).error).toMatch(/today's limit/);
    });

    it('starts a new daily count on the next UTC day', () => {
        const day1 = new Date('2026-11-15T12:00:00Z');
        for (let i = 0; i < MAX_URLS_PER_DAY; i++) takeDailyUrl(day1);
        expect(takeDailyUrl(day1)).toBe(false);
        expect(takeDailyUrl(new Date('2026-11-16T00:00:01Z'))).toBe(true);
    });
});
