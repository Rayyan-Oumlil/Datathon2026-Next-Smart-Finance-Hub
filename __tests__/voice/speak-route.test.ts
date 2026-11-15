import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/voice/speak/route';
import { isRateLimited } from '@/lib/rate-limit';
import { signingCredentials } from '@/lib/voice/credentials';
import { synthesizeSpeech } from '@/lib/voice/polly';

vi.mock('@/lib/rate-limit', () => ({ isRateLimited: vi.fn(async () => false) }));
vi.mock('@/lib/voice/credentials', () => ({ AWS_REGION: 'us-east-1', signingCredentials: vi.fn() }));
vi.mock('@/lib/voice/polly', () => ({ synthesizeSpeech: vi.fn() }));

const limited = vi.mocked(isRateLimited);
const credentials = vi.mocked(signingCredentials);
const synthesize = vi.mocked(synthesizeSpeech);
const MP3 = Uint8Array.from([0xff, 0xfb, 0x90, 0x00]);

const call = (body: unknown, headers: Record<string, string> = {}) =>
    POST(new NextRequest('http://localhost/api/voice/speak', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }));

beforeEach(() => {
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
});
