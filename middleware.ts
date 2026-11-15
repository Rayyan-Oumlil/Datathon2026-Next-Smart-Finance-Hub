import { NextResponse, type NextRequest } from 'next/server';
import { demoUserOverride, getSessionSecret } from '@/lib/session/config';
import { SESSION_COOKIE, isHttps, needsRefresh, newSessionPayload, refreshPayload, sessionCookieOptions, signSession, verifySession } from '@/lib/session/token';

// Gives every browser its anonymous session cookie on the first visit, and slides it once a day. The new cookie is
// also put on the request itself, so the server components rendering this same request read the same session.
// Without a valid cookie and with DEMO_USER_ID set, nothing is written: the browser is the DEMO_USER_ID user.
export async function middleware(req: NextRequest) {
    const secret = getSessionSecret();
    const now = Date.now();
    const payload = await verifySession(req.cookies.get(SESSION_COOKIE)?.value, secret, now);
    if (payload && !needsRefresh(payload, now)) return NextResponse.next();
    if (!payload && demoUserOverride()) return NextResponse.next();

    const signed = await signSession(payload ? refreshPayload(payload, now) : newSessionPayload(now), secret);
    req.cookies.set(SESSION_COOKIE, signed);
    const headers = new Headers(req.headers);
    headers.set('cookie', req.cookies.toString());
    const res = NextResponse.next({ request: { headers } });
    res.cookies.set(SESSION_COOKIE, signed, sessionCookieOptions(isHttps(req.headers, req.url)));
    return res;
}

export const config = {
    // Not the hidden profile addresses (/u/...: they set the cookie themselves), nor static files
    matcher: ['/((?!u/|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp|txt|xml)$).*)'],
};
