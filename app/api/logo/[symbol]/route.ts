import { NextRequest, NextResponse } from 'next/server';
import { cachedLogo, getLogo, normalizeLogoSymbol, type LogoEntry } from '@/lib/logo';
import { clientIp, isRateLimited } from '@/lib/rate-limit';

// Serves a company logo from our own origin: the browser never loads a remote image (next.config.ts allows none).
// 200 with the image bytes, or a quick 404 when there is no logo (the AssetLogo component then draws a monogram
// or a class icon). Both answers are cached by the browser; misses are also cached on the server.

const DAY_SECONDS = 24 * 60 * 60;

// An SVG served from this origin must not run anything if opened on its own
const IMAGE_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
};

function notFound(maxAgeSeconds: number): NextResponse {
    return new NextResponse(null, { status: 404, headers: { 'Cache-Control': `public, max-age=${maxAgeSeconds}`, ...IMAGE_HEADERS } });
}

function answer(entry: LogoEntry): NextResponse {
    if (entry.kind === 'miss') return notFound(entry.transient ? 300 : DAY_SECONDS);
    return new NextResponse(new Uint8Array(entry.bytes), {
        status: 200,
        headers: {
            'Content-Type': entry.contentType,
            'Content-Length': String(entry.bytes.length),
            'Cache-Control': `public, max-age=${DAY_SECONDS}, stale-while-revalidate=${7 * DAY_SECONDS}, immutable`,
            ...IMAGE_HEADERS,
        },
    });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
    const symbol = normalizeLogoSymbol((await params).symbol);
    if (!symbol) return notFound(DAY_SECONDS);

    const held = await cachedLogo(symbol);
    if (held) return answer(held);

    // Only lookups that may reach the provider are counted: each unseen symbol can cost one Finnhub call
    if (await isRateLimited(`logo:ip:${clientIp(req)}`, 120, 60) || await isRateLimited('logo:all', 600, 60)) {
        return new NextResponse(null, { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } });
    }
    return answer(await getLogo(symbol));
}
