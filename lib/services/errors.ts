import type { ZodIssue } from 'zod';

/** A refusal the caller can show as is: the message is plain text for the user, the status is the HTTP status. */
export class ServiceError extends Error {
    constructor(public status: number, message: string) {
        super(message);
        this.name = 'ServiceError';
    }
}

export const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * One validation problem in plain words. A value outside a fixed list is not answered with the list itself:
 * zod would quote the internal option names, some of which are words the app never shows.
 */
export const issueText = (issue: ZodIssue, root = 'body'): string =>
    `${issue.path.join('.') || root}: ${/^invalid_(enum_)?value$/.test(issue.code) ? 'not one of the accepted values' : issue.message}`;
