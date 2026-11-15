'use client';

import { AlignLeft, Workflow } from 'lucide-react';
import { useTranslations } from 'next-intl';

export type RuleView = 'sentences' | 'flow';

/** "Phrases | Schéma": two ways to show the same rules. */
export function ViewToggle({ value, onChange }: { value: RuleView; onChange: (view: RuleView) => void }) {
    const t = useTranslations('Strategy');
    const options: Array<[RuleView, string, typeof Workflow]> = [['sentences', t('flow.viewSentences'), AlignLeft], ['flow', t('flow.viewFlow'), Workflow]];
    return (
        <div role="group" aria-label={t('flow.viewLabel')} className="inline-flex flex-none gap-1 rounded-[10px] border border-line bg-card p-0.5">
            {options.map(([id, label, Icon]) => (
                <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)} className={`btn btn-ghost h-8 border-0 px-3 text-[12.5px] ${value === id ? 'is-on' : ''}`}>
                    <Icon />{label}
                </button>
            ))}
        </div>
    );
}

export default ViewToggle;
