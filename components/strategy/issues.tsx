'use client';

import { CircleAlert } from 'lucide-react';
import type { ServerIssue } from './model';

/** A refused call: the server's sentence, then each issue's sentence (both already in the request's language). */
export function ApiIssues({ message, issues, title }: { message?: string; issues: ServerIssue[]; title?: string }) {
    const lines = issues.length > 0 ? issues.map((issue) => issue.message) : message ? [message] : [];
    if (lines.length === 0) return null;
    return (
        <div role="alert" className="flex gap-2 rounded-[10px] bg-down-soft px-3 py-2.5 text-[13px] text-down">
            <CircleAlert className="mt-0.5 size-4 flex-none" />
            <div className="grid gap-0.5">
                {title && <p className="font-bold">{title}</p>}
                <ul className="grid gap-0.5">{lines.map((line, i) => <li key={`${i}-${line}`}>{line}</li>)}</ul>
            </div>
        </div>
    );
}
