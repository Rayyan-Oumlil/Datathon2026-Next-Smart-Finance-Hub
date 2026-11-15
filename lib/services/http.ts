import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from '@/i18n/config';
import { getAppLocale } from '@/i18n/locale';
import { ServiceError, issueText } from './errors';
import { renderText, serviceRef } from './text';

/** Anything a route handler gets that carries the request's cookies and headers (NextRequest, Request). */
type RequestLike = { headers: Headers; cookies?: { get(name: string): { value: string } | undefined } };

/**
 * The language of a request: the saved choice (NEXT_LOCALE cookie) first, then Accept-Language in its order of
 * preference, then English, the same order as i18n/locale.ts. Without a request it asks next/headers
 * (getAppLocale), which answers English outside a request.
 */
export async function requestLocale(req?: RequestLike): Promise<Locale> {
    if (!req) return getAppLocale();
    const saved = req.cookies?.get(LOCALE_COOKIE)?.value
        ?? (req.headers.get('cookie') ?? '').split(';').map((part) => part.trim().split('=')).find(([name]) => name === LOCALE_COOKIE)?.[1];
    if (isLocale(saved)) return saved;
    for (const part of (req.headers.get('accept-language') ?? '').split(',')) {
        const base = part.split(';')[0].trim().toLowerCase().split('-')[0];
        if (isLocale(base)) return base;
    }
    return DEFAULT_LOCALE;
}

/**
 * Runs a route body and turns what it throws into the contract's { error } with a 4xx / 5xx status, the message in
 * the request's language (a ServiceError given as plain text is answered as given).
 */
export async function respond(run: () => Promise<unknown>, req?: RequestLike): Promise<NextResponse> {
    try {
        const body = await run();
        return body instanceof NextResponse ? body : NextResponse.json(body);
    } catch (error) {
        const locale = await requestLocale(req).catch(() => DEFAULT_LOCALE);
        if (error instanceof ServiceError) return NextResponse.json({ error: error.messageIn(locale) }, { status: error.status });
        if (error instanceof ZodError) {
            const text = error.issues.map((issue) => issueText(issue, 'body', locale)).join('; ');
            return NextResponse.json({ error: text }, { status: 400 });
        }
        if (error instanceof SyntaxError) return NextResponse.json({ error: renderText(serviceRef('svc.http.bad_json', {}), locale) }, { status: 400 });
        console.error('api error:', error instanceof Error ? error.message : error);
        return NextResponse.json({ error: renderText(serviceRef('svc.http.server_error', {}), locale) }, { status: 500 });
    }
}
