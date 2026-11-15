import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { ensurePersona, isPersonaName } from '@/lib/personas';
import { personaSessionId, sessionCookieFor } from '@/lib/session';
import { isHttps } from '@/lib/session/token';

export const dynamic = 'force-dynamic';

// Hidden profile addresses, typed by hand (no link to them anywhere in the UI):
//   /u/new                        a brand-new user (new session cookie), sent to onboarding
//   /u/amira | /u/mateo | /u/robert  switch this browser to the stored example user, seeded on first use
//   /u/<persona>?fresh=1          the example user again from its preset, under a new generation (nothing deleted)
export async function GET(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
    const { name } = await params;
    const target = name.toLowerCase();
    let sessionId: string;
    let to: string;
    if (target === 'new') {
        sessionId = randomUUID();
        to = '/onboarding';
    } else if (isPersonaName(target)) {
        await ensurePersona(target, { fresh: req.nextUrl.searchParams.get('fresh') === '1' });
        sessionId = personaSessionId(target);
        to = '/portfolio';
    } else {
        return NextResponse.redirect(new URL('/', req.url));
    }
    const res = NextResponse.redirect(new URL(to, req.url));
    const cookie = await sessionCookieFor(sessionId, isHttps(req.headers, req.url));
    res.cookies.set(cookie.name, cookie.value, cookie.options);
    res.headers.set('cache-control', 'no-store');
    return res;
}
