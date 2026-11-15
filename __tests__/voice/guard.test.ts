import { describe, expect, it, vi } from 'vitest';
import { clientIp, isRateLimited } from '@/lib/rate-limit';
import { assertSameOrigin, voiceEnabled } from '@/lib/voice/guard';
import { fetchVoiceEnabled, resetVoiceEnabled } from '@/lib/voice/enabled';

const headers = (values: Record<string, string>) => ({ headers: new Headers(values) });

describe('clientIp', () => {
    it('takes the last address of x-forwarded-for (the one the load balancer appended)', () => {
        expect(clientIp(headers({ 'x-forwarded-for': ' 203.0.113.7 , 10.0.0.2' }))).toBe('10.0.0.2');
        expect(clientIp(headers({ 'x-forwarded-for': '2001:db8::1' }))).toBe('2001:db8::1');
    });

    it('does not let a forged first entry change the key', () => {
        const real = clientIp(headers({ 'x-forwarded-for': '10.0.0.2' }));
        expect(clientIp(headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.2' }))).toBe(real);
        expect(clientIp(headers({ 'x-forwarded-for': '5.6.7.8, 9.9.9.9, 10.0.0.2' }))).toBe(real);
    });

    it("falls back to 'unknown' without the header or with an empty last entry", () => {
        expect(clientIp(headers({}))).toBe('unknown');
        expect(clientIp(headers({ 'x-forwarded-for': '10.0.0.2, ' }))).toBe('unknown');
    });

    it('keeps a forged, very long value short', () => {
        expect(clientIp(headers({ 'x-forwarded-for': 'x'.repeat(1000) })).length).toBe(64);
    });

    it('leaves isRateLimited as it was for other callers', async () => {
        const key = `guard-test:${Math.random()}`;
        expect(await isRateLimited(key, 2, 60)).toBe(false);
        expect(await isRateLimited(key, 2, 60)).toBe(false);
        expect(await isRateLimited(key, 2, 60)).toBe(true);
    });
});

describe('voiceEnabled', () => {
    it("is on only for 'true' when the variable is set", () => {
        expect(voiceEnabled({ VOICE_ENABLED: 'true', NODE_ENV: 'production' })).toBe(true);
        expect(voiceEnabled({ VOICE_ENABLED: 'false', NODE_ENV: 'development' })).toBe(false);
        expect(voiceEnabled({ VOICE_ENABLED: '1', NODE_ENV: 'development' })).toBe(false);
    });

    it('defaults to on in development and off in production', () => {
        expect(voiceEnabled({ NODE_ENV: 'development' })).toBe(true);
        expect(voiceEnabled({ VOICE_ENABLED: '', NODE_ENV: 'test' })).toBe(true);
        expect(voiceEnabled({ NODE_ENV: 'production' })).toBe(false);
    });
});

describe('assertSameOrigin', () => {
    it('passes without an Origin, or with an Origin on the same host and port', () => {
        expect(() => assertSameOrigin(headers({ host: 'app.example' }), 'en')).not.toThrow();
        expect(() => assertSameOrigin(headers({ host: 'app.example', origin: 'https://app.example' }), 'en')).not.toThrow();
        expect(() => assertSameOrigin(headers({ host: 'localhost:3000', origin: 'http://localhost:3000' }), 'en')).not.toThrow();
    });

    it('refuses another host, another port, or an unreadable Origin with a 403', () => {
        for (const origin of ['https://evil.example', 'http://localhost:4000', 'null']) {
            expect(() => assertSameOrigin(headers({ host: 'localhost:3000', origin }), 'en')).toThrow(expect.objectContaining({ status: 403 }));
        }
    });
});

describe('fetchVoiceEnabled (client)', () => {
    const answer = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as Response);

    it('asks GET /api/voice/token once and caches the answer', async () => {
        resetVoiceEnabled();
        const fetcher = answer({ enabled: true });
        expect(await fetchVoiceEnabled(fetcher)).toBe(true);
        expect(await fetchVoiceEnabled(fetcher)).toBe(true);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetcher).toHaveBeenCalledWith('/api/voice/token', expect.objectContaining({ method: 'GET' }));
    });

    it('counts voice as off when the server says so, answers an error, or cannot be reached', async () => {
        resetVoiceEnabled();
        expect(await fetchVoiceEnabled(answer({ enabled: false }))).toBe(false);
        resetVoiceEnabled();
        expect(await fetchVoiceEnabled(answer({ error: 'x' }, false))).toBe(false);
        resetVoiceEnabled();
        expect(await fetchVoiceEnabled(vi.fn(async () => { throw new Error('offline'); }))).toBe(false);
        // A failure to reach the server is asked again next time
        expect(await fetchVoiceEnabled(answer({ enabled: true }))).toBe(true);
    });
});
