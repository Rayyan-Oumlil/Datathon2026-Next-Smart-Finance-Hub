import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { ServiceError, issueText } from './errors';

/** Runs a route body and turns what it throws into the contract's { error } with a 4xx / 5xx status. */
export async function respond(run: () => Promise<unknown>): Promise<NextResponse> {
    try {
        const body = await run();
        return body instanceof NextResponse ? body : NextResponse.json(body);
    } catch (error) {
        if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status });
        if (error instanceof ZodError) {
            const text = error.issues.map((issue) => issueText(issue)).join('; ');
            return NextResponse.json({ error: text }, { status: 400 });
        }
        if (error instanceof SyntaxError) return NextResponse.json({ error: 'The request body is not valid JSON.' }, { status: 400 });
        console.error('api error:', error instanceof Error ? error.message : error);
        return NextResponse.json({ error: 'The server could not complete the request.' }, { status: 500 });
    }
}
