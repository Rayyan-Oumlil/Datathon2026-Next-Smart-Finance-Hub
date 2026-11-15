import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPollyRequest, synthesizeSpeech } from '@/lib/voice/polly';

const credentials = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', sessionToken: 'session-token' };
const now = new Date('2026-11-15T08:30:00Z');
const make = (over: object = {}) => buildPollyRequest({ credentials, region: 'us-east-1', text: 'Hello there.', locale: 'en', now, ...over });

describe('buildPollyRequest', () => {
    it('posts to the Polly speech endpoint in the region', () => {
        const request = make();
        expect(request.url).toBe('https://polly.us-east-1.amazonaws.com/v1/speech');
        expect(make({ region: 'ca-central-1' }).url).toBe('https://polly.ca-central-1.amazonaws.com/v1/speech');
    });

    it('asks for an English neural voice as MP3', () => {
        expect(JSON.parse(make().body)).toEqual({ Engine: 'neural', LanguageCode: 'en-US', OutputFormat: 'mp3', Text: 'Hello there.', TextType: 'text', VoiceId: 'Joanna' });
    });

    it('asks for a Canadian French voice in French', () => {
        expect(JSON.parse(make({ locale: 'fr', text: 'Bonjour.' }).body)).toMatchObject({ LanguageCode: 'fr-CA', VoiceId: 'Gabrielle', Text: 'Bonjour.' });
    });

    it('signs the request with SigV4 for the Polly service', () => {
        const { headers } = make();
        expect(headers['X-Amz-Date']).toBe('20261115T083000Z');
        expect(headers['X-Amz-Security-Token']).toBe('session-token');
        expect(headers.Authorization).toMatch(
            /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20261115\/us-east-1\/polly\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-security-token, Signature=[0-9a-f]{64}$/,
        );
    });

    it('leaves out the token for long-lived credentials', () => {
        const { headers } = make({ credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' } });
        expect(headers['X-Amz-Security-Token']).toBeUndefined();
        expect(headers.Authorization).toContain('SignedHeaders=content-type;host;x-amz-date,');
    });

    it('is deterministic, and the signature covers the body', () => {
        expect(make().headers.Authorization).toBe(make().headers.Authorization);
        expect(make({ text: 'Different text.' }).headers.Authorization).not.toBe(make().headers.Authorization);
    });

    it('never puts the secret key in a header or the body', () => {
        const request = make();
        expect(JSON.stringify(request)).not.toContain('wJalrXUtnFEMI');
    });
});

describe('synthesizeSpeech', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    it('returns the audio bytes Polly sends back', async () => {
        const fetchMock = vi.fn(async () => new Response(Uint8Array.from([0xff, 0xfb, 0x90]), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const audio = await synthesizeSpeech({ credentials, region: 'us-east-1', text: 'Hi.', locale: 'en', now });
        expect([...audio]).toEqual([0xff, 0xfb, 0x90]);
        expect(fetchMock).toHaveBeenCalledWith('https://polly.us-east-1.amazonaws.com/v1/speech', expect.objectContaining({ method: 'POST' }));
    });

    it('throws with the service status and message when Polly refuses', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('{"message":"not authorized"}', { status: 403 })));
        await expect(synthesizeSpeech({ credentials, region: 'us-east-1', text: 'Hi.', locale: 'en', now })).rejects.toThrow(/Polly 403.*not authorized/);
    });
});
