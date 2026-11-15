import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { ensurePersona, personaOfAddress } from '@/lib/personas';
import { personaSessionId, sessionCookieFor } from '@/lib/session';
import { isHttps } from '@/lib/session/token';

export const dynamic = 'force-dynamic';

// Profile addresses (also linked from the sidebar's profile menu):
//   /u/new                        a brand-new user (new session cookie), sent to onboarding
//   /u/amira | /u/mateo | /u/robert  switch this browser to the stored example user, seeded on first use
//   /u/demo-novice | /u/demo-expert  the two demo profiles (also /u/novice, /u/expert)
//   /u/<persona>?fresh=1          the example user again from its preset, under a new generation (nothing deleted)
export async function GET(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
    const { name } = await params;
    const target = name.toLowerCase();
    const persona = personaOfAddress(target);
    let sessionId: string;
    let to: string;
    if (target === 'new') {
        sessionId = randomUUID();
        to = '/onboarding';
    } else if (persona) {
        await ensurePersona(persona, { fresh: req.nextUrl.searchParams.get('fresh') === '1' });
        sessionId = personaSessionId(persona);
        to = '/portfolio';
    } else {
        return new NextResponse(null, { status: 307, headers: { Location: '/' } });
    }
    const res = new NextResponse(null, { status: 307, headers: { Location: to } });
    const cookie = await sessionCookieFor(sessionId, isHttps(req.headers, req.url));
    res.cookies.set(cookie.name, cookie.value, cookie.options);
    res.headers.set('cache-control', 'no-store');
    return res;
}
