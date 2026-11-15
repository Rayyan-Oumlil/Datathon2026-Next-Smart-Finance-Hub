import type { ZodIssue } from 'zod';
import { issueMessage, renderOr, renderText, type Locale, type TextRef } from './text';

/**
 * A refusal the caller can show as is: the message is plain text for the user, the status is the HTTP status.
 * Given a catalog reference (TextRef) instead of text, `message` is its English sentence and messageIn(locale)
 * gives it in the user's language; the public API routes answer with messageIn (lib/services/http.ts).
 */
export class ServiceError extends Error {
    public textRef?: TextRef;
    constructor(public status: number, message: string | TextRef) {
        super(typeof message === 'string' ? message : renderText(message, 'en'));
        this.name = 'ServiceError';
        if (typeof message !== 'string') this.textRef = message;
    }

    /** The message in a language; a refusal given as plain text is returned as given. */
    messageIn(locale: Locale): string {
        return renderOr(this.textRef, locale, this.message);
    }
}

export const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * One validation problem in plain words, in `locale` (default English). A value outside a fixed list is not
 * answered with the list itself: zod would quote the internal option names, some of which are words the app never shows.
 */
export const issueText = (issue: ZodIssue, root = 'body', locale: Locale = 'en'): string => issueMessage(issue, root, locale);
