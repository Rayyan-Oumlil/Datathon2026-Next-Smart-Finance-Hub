import { describe, expect, it } from 'vitest';
import { ServiceError } from '@/lib/services/errors';
import { readLimitedText } from '@/lib/voice/body';

const post = (body: string, headers: Record<string, string> = {}) => new Request('http://localhost/x', { method: 'POST', headers, body });

describe('readLimitedText', () => {
    it('returns a body that fits', async () => {
        expect(await readLimitedText(post('{"text":"hello"}'), 1000)).toBe('{"text":"hello"}');
    });

    it('reads multi-byte text as UTF-8', async () => {
        expect(await readLimitedText(post('{"text":"é à ç – ”"}'), 1000)).toBe('{"text":"é à ç – ”"}');
    });

    it('returns an empty string when there is no body', async () => {
        expect(await readLimitedText(new Request('http://localhost/x', { method: 'POST' }), 1000)).toBe('');
    });

    it('refuses with a 413, without reading, when the declared length is over the limit', async () => {
        const request = post('x', { 'content-length': '5000' });
        const error = await readLimitedText(request, 1000).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ServiceError);
        expect((error as ServiceError).status).toBe(413);
    });

    it('refuses with a 413 when a body with no declared length turns out too long', async () => {
        const error = await readLimitedText(post('x'.repeat(5000)), 1000).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ServiceError);
        expect((error as ServiceError).status).toBe(413);
    });

    it('accepts a body of exactly the limit', async () => {
        expect((await readLimitedText(post('x'.repeat(1000)), 1000)).length).toBe(1000);
    });
});
