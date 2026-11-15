import { describe, expect, it } from 'vitest';
import { presignTranscribeUrl } from '@/lib/voice/presign';

const credentials = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', sessionToken: 'tok+/=en' };
const now = new Date('2026-11-15T08:30:00Z');
const make = (over: object = {}) => presignTranscribeUrl({ credentials, region: 'us-east-1', language: { code: 'fr-CA' }, sampleRate: 16000, now, ...over });

describe('presignTranscribeUrl', () => {
    it('targets the streaming WebSocket endpoint with the stream settings', () => {
        const url = new URL(make());
        expect(url.protocol).toBe('wss:');
        expect(url.host).toBe('transcribestreaming.us-east-1.amazonaws.com:8443');
        expect(url.pathname).toBe('/stream-transcription-websocket');
        expect(url.searchParams.get('language-code')).toBe('fr-CA');
        expect(url.searchParams.get('media-encoding')).toBe('pcm');
        expect(url.searchParams.get('sample-rate')).toBe('16000');
    });

    it('asks Transcribe to identify the language between the ones given, with a preferred one', () => {
        const url = new URL(make({ language: { identify: ['en-US', 'fr-CA'], preferred: 'fr-CA' } }));
        expect(url.searchParams.get('identify-language')).toBe('true');
        expect(url.searchParams.get('language-options')).toBe('en-US,fr-CA');
        expect(url.searchParams.get('preferred-language')).toBe('fr-CA');
        expect(url.searchParams.has('language-code')).toBe(false);
    });

    it('leaves out the preferred language when none is given, and never sends a fixed code along with identification', () => {
        const url = new URL(make({ language: { identify: ['en-US', 'fr-CA'] } }));
        expect(url.searchParams.has('preferred-language')).toBe(false);
        expect(url.searchParams.has('language-code')).toBe(false);
    });

    it('signs the identification settings, so they cannot be changed in the browser', () => {
        const a = make({ language: { identify: ['en-US', 'fr-CA'], preferred: 'en-US' } });
        const b = make({ language: { identify: ['en-US', 'fr-CA'], preferred: 'fr-CA' } });
        expect(new URL(a).searchParams.get('X-Amz-Signature')).not.toBe(new URL(b).searchParams.get('X-Amz-Signature'));
    });

    it('refuses identification between fewer than two languages, and a preferred one that is not an option', () => {
        expect(() => make({ language: { identify: ['en-US'] } })).toThrow(/two languages/i);
        expect(() => make({ language: { identify: ['en-US', 'fr-CA'], preferred: 'de-DE' } })).toThrow(/preferred/i);
    });

    it('carries a SigV4 signature scoped to the Transcribe service and a short expiry', () => {
        const url = new URL(make());
        expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
        expect(url.searchParams.get('X-Amz-Credential')).toBe('AKIDEXAMPLE/20261115/us-east-1/transcribe/aws4_request');
        expect(url.searchParams.get('X-Amz-Date')).toBe('20261115T083000Z');
        expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
        expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
        expect(url.searchParams.get('X-Amz-Security-Token')).toBe('tok+/=en');
        expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    });

    it('never puts the secret key in the URL', () => {
        expect(make()).not.toContain('wJalrXUtnFEMI');
    });

    it('is deterministic for the same inputs and changes with the language', () => {
        expect(make()).toBe(make());
        expect(make({ language: { code: 'en-US' } })).not.toBe(make());
    });

    it('refuses a region that is not an AWS region name', () => {
        expect(() => make({ region: 'x.evil.com/#' })).toThrow(/region/i);
    });

    it('omits the token parameter for long-lived credentials', () => {
        const url = new URL(make({ credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' } }));
        expect(url.searchParams.has('X-Amz-Security-Token')).toBe(false);
    });
});
