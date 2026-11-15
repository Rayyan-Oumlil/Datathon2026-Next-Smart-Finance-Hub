import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/voice/speak/route';
import { isRateLimited } from '@/lib/rate-limit';
import { signingCredentials } from '@/lib/voice/credentials';
import { synthesizeSpeech } from '@/lib/voice/polly';

vi.mock('@/lib/rate-limit', async (original) => ({ ...(await original<typeof import('@/lib/rate-limit')>()), isRateLimited: vi.fn(async () => false) }));
vi.mock('@/lib/voice/credentials', () => ({ AWS_REGION: 'us-east-1', signingCredentials: vi.fn() }));
vi.mock('@/lib/voice/polly', () => ({ synthesizeSpeech: vi.fn() }));

const limited = vi.mocked(isRateLimited);
const credentials = vi.mocked(signingCredentials);
const synthesize = vi.mocked(synthesizeSpeech);
const MP3 = Uint8Array.from([0xff, 0xfb, 0x90, 0x00]);

const call = (body: unknown, headers: Record<string, string> = {}) =>
    POST(new NextRequest('http://localhost/api/voice/speak', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }));

beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('VOICE_ENABLED', '');
    limited.mockReset().mockResolvedValue(false);
    credentials.mockReset().mockResolvedValue({ accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret-key-value', sessionToken: 'session' });
    synthesize.mockReset().mockResolvedValue(MP3);
});

describe('POST /api/voice/speak', () => {
    it('returns the spoken reply as MP3 that no cache keeps', async () => {
        const response = await call({ text: 'An ETF is a fund.' });
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('audio/mpeg');
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...MP3]);
    });

    it('reads in the language the app is set to', async () => {
        await call({ text: 'Bonjour.' }, { cookie: 'NEXT_LOCALE=fr' });
        expect(synthesize).toHaveBeenCalledWith(expect.objectContaining({ locale: 'fr', text: 'Bonjour.', region: 'us-east-1' }));
        await call({ text: 'Hello.' });
        expect(synthesize).toHaveBeenLastCalledWith(expect.objectContaining({ locale: 'en' }));
    });

    it('reads in the language of the reply when the body says which, whatever the app is set to', async () => {
        await call({ text: 'Un FNB est un fonds.', language: 'fr' });
        expect(synthesize).toHaveBeenLastCalledWith(expect.objectContaining({ locale: 'fr' }));
        await call({ text: 'An ETF is a fund.', language: 'en' }, { cookie: 'NEXT_LOCALE=fr' });
        expect(synthesize).toHaveBeenLastCalledWith(expect.objectContaining({ locale: 'en' }));
    });

    it('refuses a language the app does not speak', async () => {
        expect((await call({ text: 'Hallo.', language: 'de' })).status).toBe(400);
        expect(synthesize).not.toHaveBeenCalled();
    });

    it('sends Polly only what is worth reading: no source line, no file path', async () => {
        await call({ text: 'An ETF is a fund.\n\nSource: glossary, at agent/glossary/etf.md.' });
        expect(synthesize).toHaveBeenCalledWith(expect.objectContaining({ text: 'An ETF is a fund.' }));
    });

    it('limits what Polly is asked to read', async () => {
        await call({ text: 'This is one sentence of the reply. '.repeat(200) });
        expect(synthesize.mock.calls[0][0].text.length).toBeLessThanOrEqual(1500);
    });

    it('answers 204 and does not call Polly when nothing is left to read', async () => {
        const response = await call({ text: 'Source: app glossary, agent/glossary/etf.md.' });
        expect(response.status).toBe(204);
        expect(synthesize).not.toHaveBeenCalled();
    });

    it.each([
        ['no text', {}],
        ['an empty text', { text: '' }],
        ['a text that is not a string', { text: 42 }],
        ['a very long text', { text: 'x'.repeat(8001) }],
    ])('refuses %s with a 400', async (_name, body) => {
        expect((await call(body)).status).toBe(400);
        expect(synthesize).not.toHaveBeenCalled();
    });

    it('refuses a body that is not JSON', async () => {
        expect((await call('not json')).status).toBe(400);
    });

    it('refuses a body that is not sent as JSON with a 415', async () => {
        const response = await call({ text: 'Hello.' }, { 'content-type': 'text/plain;charset=UTF-8' });
        expect(response.status).toBe(415);
        expect(synthesize).not.toHaveBeenCalled();
    });

    it('refuses a body over 64 KB with a 413, before parsing it', async () => {
        const response = await call(`{"text":"${'x'.repeat(70_000)}"}`);
        expect(response.status).toBe(413);
        expect(synthesize).not.toHaveBeenCalled();
    });

    it('counts the characters it will have read against an hourly budget', async () => {
        await call({ text: 'An ETF is a fund.' });
        const budget = limited.mock.calls.find(([key]) => String(key).startsWith('voice-speak-chars'));
        expect(budget).toEqual([expect.stringContaining('voice-speak-chars'), 60_000, 3600, 'An ETF is a fund.'.length]);
        const keys = limited.mock.calls.map(([key, max, window, cost]) => [key, max, window, cost]);
        expect(keys).toContainEqual([expect.stringMatching(/^voice-speak-chars:user:/), 240_000, 3600, 'An ETF is a fund.'.length]);
    });

    it('refuses with a 429 when the character budget is spent, and does not call Polly', async () => {
        limited.mockImplementation(async (key: string) => String(key).startsWith('voice-speak-chars'));
        const response = await call({ text: 'Hello.' });
        expect(response.status).toBe(429);
        expect(synthesize).not.toHaveBeenCalled();
    });

    it('is rate limited, with the message in the request language', async () => {
        limited.mockResolvedValue(true);
        const response = await call({ text: 'Hello.' }, { cookie: 'NEXT_LOCALE=fr' });
        expect(response.status).toBe(429);
        expect((await response.json()).error).toMatch(/Trop de demandes/);
        expect(synthesize).not.toHaveBeenCalled();
    });

    it('answers a server error without leaking the cause when Polly fails', async () => {
        synthesize.mockRejectedValue(new Error('Polly 403: User arn:aws:sts::891377108451:assumed-role/x is not authorized'));
        const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const response = await call({ text: 'Hello.' });
        expect(response.status).toBe(500);
        expect(JSON.stringify(await response.json())).not.toContain('891377108451');
        spy.mockRestore();
    });

    it('synthesizes nothing and answers 404 with an error when VOICE_ENABLED is not "true"', async () => {
        vi.stubEnv('VOICE_ENABLED', 'false');
        const response = await call({ text: 'Hello.' }, { cookie: 'NEXT_LOCALE=fr' });
        expect(response.status).toBe(404);
        expect((await response.json()).error).toMatch(/désactivée/);
        expect(synthesize).not.toHaveBeenCalled();
        expect(limited).not.toHaveBeenCalled();
    });

    it('is off by default in production', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        expect((await call({ text: 'Hello.' })).status).toBe(404);
        expect(synthesize).not.toHaveBeenCalled();
    });

    it('refuses with a 403 a request whose Origin is another host', async () => {
        const response = await call({ text: 'Hello.' }, { origin: 'https://evil.example', host: 'localhost' });
        expect(response.status).toBe(403);
        expect(synthesize).not.toHaveBeenCalled();
        expect((await call({ text: 'Hello.' }, { origin: 'http://localhost', host: 'localhost' })).status).toBe(200);
    });

    it('limits per visitor address (the last x-forwarded-for entry) (20 a minute, 60 000 characters an hour) and keeps a ceiling for everyone', async () => {
        await call({ text: 'Hello.' }, { 'x-forwarded-for': '203.0.113.7, 10.0.0.2' });
        const keys = limited.mock.calls.map(([key, max, window]) => [key, max, window]);
        expect(keys).toContainEqual(['voice-speak:ip:10.0.0.2', 20, 60]);
        expect(keys).toContainEqual(['voice-speak-chars:ip:10.0.0.2', 60_000, 3600]);
        expect(keys).toContainEqual([expect.stringMatching(/^voice-speak:user:/), 60, 60]);
    });

    it('refuses with a 429 when one address has spent its character budget, and does not call Polly', async () => {
        limited.mockImplementation(async (key: string) => key === 'voice-speak-chars:ip:203.0.113.7');
        expect((await call({ text: 'Hello.' }, { 'x-forwarded-for': '203.0.113.7' })).status).toBe(429);
        expect(synthesize).not.toHaveBeenCalled();
        expect((await call({ text: 'Hello.' }, { 'x-forwarded-for': '198.51.100.4' })).status).toBe(200);
    });

    it.each([
        ['an English never-word', 'You should buy this fund.', 'en'],
        ['a French never-word', 'Vous devriez acheter ce fonds.', 'fr'],
        ['a judgement word', 'This fund is undervalued.', 'en'],
    ])('refuses a text with %s with a 400 and does not call Polly', async (_name, text, language) => {
        const response = await call({ text, language });
        expect(response.status).toBe(400);
        expect((await response.json()).error).toMatch(language === 'fr' ? /lu à voix haute/ : /read aloud/);
        expect(synthesize).not.toHaveBeenCalled();
    });

    it('still reads a text that only holds an exempt phrase', async () => {
        expect((await call({ text: 'Bien sûr, un FNB est un fonds.', language: 'fr' })).status).toBe(200);
    });
});
