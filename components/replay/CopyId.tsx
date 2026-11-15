'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** A labelled id (snapshot, replay) that copies itself on click. */
export default function CopyId({ label, value }: { label: string; value: string }) {
    const t = useTranslations('Replay');
    const [done, setDone] = useState(false);
    return (
        <button
            type="button"
            onClick={() => { void navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }); }}
            className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-card px-2.5 py-1 text-[11.5px] text-faint transition-colors hover:text-foreground"
            aria-label={t('ids.copy', { label, value })}
        >
            <span>{label}</span>
            <span className="mono truncate text-muted-foreground">{value}</span>
            {done ? <Check className="size-3 flex-none text-up" /> : <Copy className="size-3 flex-none" />}
        </button>
    );
}
