// Shared by the tool endpoints the agent service calls (docs/agent-api.md section 2).

import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { DEMO_USER } from '@/lib/demo-user';
import { ServiceError } from '@/lib/services/errors';

/** Constant-time comparison; both sides are hashed first so their lengths never differ. */
export function tokenMatches(given: string | null): boolean {
    const expected = process.env.INTERNAL_API_TOKEN;
    if (!expected || !given) return false;
    const digest = (value: string) => createHash('sha256').update(value).digest();
    return timingSafeEqual(digest(given), digest(expected));
}

/**
 * One tool endpoint: token check, userId from the body, then the tool. A refusal the model can act on (unknown
 * symbol, bad arguments) is answered as 200 { error }, because the agent's HTTP client keeps only the status
 * of a 4xx and the model would never see the reason.
 */
export function internalTool<S extends z.ZodTypeAny>(schema: S, run: (input: z.infer<S>, actionId: string | null) => Promise<unknown>) {
    return async (req: NextRequest): Promise<NextResponse> => {
        if (!tokenMatches(req.headers.get('x-internal-token'))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
        try {
            const body: unknown = await req.json();
            const { userId } = z.object({ userId: z.string().min(1) }).parse(body);
            if (userId !== DEMO_USER.id) return NextResponse.json({ error: 'unknown user' }, { status: 404 });
            return NextResponse.json(await run(schema.parse(body), req.headers.get('x-action-id')));
        } catch (error) {
            if (error instanceof ServiceError && error.status < 500) return NextResponse.json({ error: error.message });
            if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status });
            if (error instanceof ZodError) return NextResponse.json({ error: error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ') });
            if (error instanceof SyntaxError) return NextResponse.json({ error: 'The request body is not valid JSON.' }, { status: 400 });
            console.error('internal tool error:', error instanceof Error ? error.message : error);
            return NextResponse.json({ error: 'The tool could not complete the request.' }, { status: 500 });
        }
    };
}
