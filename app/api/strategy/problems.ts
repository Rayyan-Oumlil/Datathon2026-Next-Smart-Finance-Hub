import { NextResponse } from 'next/server';
import { requestLocale } from '@/lib/services/http';
import { StrategyInvalidError } from '@/lib/services/rules-engine';
import { renderText } from '@/lib/services/text';

type RequestLike = Parameters<typeof requestLocale>[0];

/**
 * Runs a route body; a strategy refused by validation is answered 400 with every problem as a code, its place and
 * its values, plus the sentence in the request's language: { error, issues: [{ code, path, values, message }] }.
 */
export async function strategyProblems(req: RequestLike, run: () => Promise<unknown>): Promise<unknown> {
    try {
        return await run();
    } catch (error) {
        if (!(error instanceof StrategyInvalidError)) throw error;
        const locale = await requestLocale(req);
        const issues = error.issues.map((issue) => ({ code: issue.code, path: issue.path, values: issue.values, message: renderText(issue.textRef, locale) }));
        return NextResponse.json({ error: error.messageIn(locale), issues }, { status: 400 });
    }
}
