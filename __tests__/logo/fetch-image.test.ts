import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLogoImage, isAllowedLogoUrl, LogoRefused, MAX_LOGO_BYTES } from '@/lib/logo/fetch-image';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const LOGO_URL = 'https://static2.finnhub.io/file/publicdatany/finnhubimage/stock_logo/AAPL.png';

function mockFetch(answer: (url: string) => Response) {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
        calls.push(String(url));
        return answer(String(url));
    }));
    return calls;
}

const refusal = async (promise: Promise<unknown>) => {
    const error = await promise.then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(LogoRefused);
    return error as LogoRefused;
};

afterEach(() => vi.unstubAllGlobals());

describe('logo host allow-list', () => {
    it('accepts only https on the Finnhub static hosts', () => {
        expect(isAllowedLogoUrl(LOGO_URL)).toBe(true);
        expect(isAllowedLogoUrl('http://static2.finnhub.io/x.png')).toBe(false);
        expect(isAllowedLogoUrl('https://evil.example/x.png')).toBe(false);
        expect(isAllowedLogoUrl('https://static2.finnhub.io.evil.example/x.png')).toBe(false);
        expect(isAllowedLogoUrl('https://user@static2.finnhub.io/x.png')).toBe(false);
        expect(isAllowedLogoUrl('https://static2.finnhub.io:8443/x.png')).toBe(false);
        expect(isAllowedLogoUrl('not a url')).toBe(false);
    });

    it('never calls a host outside the list', async () => {
        const calls = mockFetch(() => new Response(PNG, { headers: { 'content-type': 'image/png' } }));
        expect((await refusal(fetchLogoImage('https://evil.example/logo.png'))).definitive).toBe(true);
        expect(calls).toHaveLength(0);
    });

    it('refuses a redirect to another host', async () => {
        const calls = mockFetch(() => new Response(null, { status: 302, headers: { location: 'https://evil.example/logo.png' } }));
        await refusal(fetchLogoImage(LOGO_URL));
        expect(calls).toEqual([LOGO_URL]);
    });
});

describe('logo content checks', () => {
    it('returns a PNG that is labelled and shaped as one', async () => {
        mockFetch(() => new Response(PNG, { headers: { 'content-type': 'image/png' } }));
        const image = await fetchLogoImage(LOGO_URL);
        expect(image.contentType).toBe('image/png');
        expect(image.bytes.equals(PNG)).toBe(true);
    });

    it('refuses a type that is not an allowed image', async () => {
        mockFetch(() => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }));
        expect((await refusal(fetchLogoImage(LOGO_URL))).definitive).toBe(true);
    });

    it('refuses bytes that do not match the declared type', async () => {
        mockFetch(() => new Response('<script>alert(1)</script>', { headers: { 'content-type': 'image/png' } }));
        await refusal(fetchLogoImage(LOGO_URL));
    });

    it('refuses an image over the size limit, declared or not', async () => {
        const big = Buffer.concat([PNG, Buffer.alloc(MAX_LOGO_BYTES)]);
        mockFetch(() => new Response(big, { headers: { 'content-type': 'image/png' } }));
        expect((await refusal(fetchLogoImage(LOGO_URL))).message).toMatch(/larger than/);
        mockFetch(() => new Response(PNG, { headers: { 'content-type': 'image/png', 'content-length': String(MAX_LOGO_BYTES + 1) } }));
        expect((await refusal(fetchLogoImage(LOGO_URL))).message).toMatch(/larger than/);
    });

    it('marks a provider error as passing, so it is retried sooner', async () => {
        mockFetch(() => new Response('oops', { status: 503 }));
        expect((await refusal(fetchLogoImage(LOGO_URL))).definitive).toBe(false);
        mockFetch(() => new Response('', { status: 404 }));
        expect((await refusal(fetchLogoImage(LOGO_URL))).definitive).toBe(true);
    });
});
