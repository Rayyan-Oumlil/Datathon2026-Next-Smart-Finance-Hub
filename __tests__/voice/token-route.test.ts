import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/voice/token/route';
import { isRateLimited } from '@/lib/rate-limit';
import { signingCredentials } from '@/lib/voice/credentials';

vi.mock('@/lib/rate-limit', () => ({ isRateLimited: vi.fn(async () => false) }));
vi.mock('@/lib/voice/credentials', () => ({ AWS_REGION: 'us-east-1', signingCredentials: vi.fn() }));

const limited = vi.mocked(isRateLimited);
const credentials = vi.mocked(signingCredentials);
const call = (headers: Record<string, string> = {}) => POST(new NextRequest('http://localhost/api/voice/token', { method: 'POST', headers }));

beforeEach(() => {
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
});
