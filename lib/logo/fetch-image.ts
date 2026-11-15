// Downloads one logo image on the server, with every check the browser would otherwise skip: an allow-list of
// hosts (https only), no redirect to another host, an image content type that matches the bytes, a size cap and a
// timeout. Anything else is refused, so the logo route can never be used to fetch arbitrary URLs.

export const ALLOWED_LOGO_HOSTS: ReadonlySet<string> = new Set(['static2.finnhub.io', 'static.finnhub.io']);
export const MAX_LOGO_BYTES = 300 * 1024;
export const LOGO_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 2;

export const ALLOWED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const;
export type LogoContentType = (typeof ALLOWED_LOGO_TYPES)[number];

export type LogoImage = { bytes: Buffer; contentType: LogoContentType; url: string };

/**
 * Why a download was refused. `definitive` means trying again later would give the same answer (no such file,
 * wrong type, too big); otherwise the failure may be passing (timeout, provider error) and is retried sooner.
 */
export class LogoRefused extends Error {
    constructor(message: string, public definitive: boolean) {
        super(message);
    }
}

export function isAllowedLogoUrl(raw: string): boolean {
    try {
        const url = new URL(raw);
        return url.protocol === 'https:' && !url.username && !url.password && (url.port === '' || url.port === '443')
            && ALLOWED_LOGO_HOSTS.has(url.hostname.toLowerCase());
    } catch {
        return false;
    }
}

/** The declared type, reduced to one of the allowed ones ('image/png; charset=x' -> 'image/png'), or null. */
export function allowedContentType(header: string | null): LogoContentType | null {
    const type = (header ?? '').split(';')[0].trim().toLowerCase();
    const canonical = type === 'image/jpg' ? 'image/jpeg' : type;
    return (ALLOWED_LOGO_TYPES as readonly string[]).includes(canonical) ? (canonical as LogoContentType) : null;
}

/** True when the first bytes look like the declared type (a server can label anything as image/png). */
export function bytesMatchType(bytes: Buffer, type: LogoContentType): boolean {
    switch (type) {
        case 'image/png':
            return bytes.length > 8 && bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        case 'image/jpeg':
            return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
        case 'image/webp':
            return bytes.length > 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
        case 'image/svg+xml': {
            const head = bytes.subarray(0, 1024).toString('utf8').replace(/^﻿/, '').trimStart();
            return head.startsWith('<') && /<svg[\s>]/i.test(bytes.toString('utf8'));
        }
    }
}

/** Reads the body, stopping as soon as it passes the cap instead of buffering an unbounded answer. */
async function readCapped(res: Response, cap: number, url: string): Promise<Buffer> {
    if (!res.body) return Buffer.alloc(0);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > cap) {
            await reader.cancel().catch(() => undefined);
            throw new LogoRefused(`Logo larger than ${cap} bytes: ${url}`, true);
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks);
}

export async function fetchLogoImage(rawUrl: string): Promise<LogoImage> {
    let url = rawUrl;
    for (let hop = 0; ; hop++) {
        if (!isAllowedLogoUrl(url)) throw new LogoRefused(`Logo host not allowed: ${url}`, true);
        let res: Response;
        try {
            res = await fetch(url, {
                redirect: 'manual',
                signal: AbortSignal.timeout(LOGO_TIMEOUT_MS),
                headers: { Accept: ALLOWED_LOGO_TYPES.join(', ') },
                cache: 'no-store',
            });
        } catch (e) {
            throw new LogoRefused(`No answer from ${url}: ${e instanceof Error ? e.message : String(e)}`, false);
        }

        if (res.status >= 300 && res.status < 400) {
            const location = res.headers.get('location');
            if (!location || hop >= MAX_REDIRECTS) throw new LogoRefused(`Logo redirect refused: ${url}`, true);
            url = new URL(location, url).toString();   // checked against the allow-list at the top of the loop
            continue;
        }
        if (!res.ok) throw new LogoRefused(`HTTP ${res.status} for logo ${url}`, res.status === 403 || res.status === 404 || res.status === 410);

        const contentType = allowedContentType(res.headers.get('content-type'));
        if (!contentType) throw new LogoRefused(`Not an allowed image type (${res.headers.get('content-type')}): ${url}`, true);
        const declared = Number(res.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > MAX_LOGO_BYTES) throw new LogoRefused(`Logo larger than ${MAX_LOGO_BYTES} bytes: ${url}`, true);

        const bytes = await readCapped(res, MAX_LOGO_BYTES, url);
        if (bytes.length === 0) throw new LogoRefused(`Empty logo: ${url}`, true);
        if (!bytesMatchType(bytes, contentType)) throw new LogoRefused(`Logo bytes do not match ${contentType}: ${url}`, true);
        return { bytes, contentType, url };
    }
}
