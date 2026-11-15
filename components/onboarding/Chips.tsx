'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Option } from './labels';

type ChipsProps = {
    labelledBy: string;
    options: Option[];
    selected: string[];
    multi?: boolean;
    disabled?: boolean;
    onToggle: (value: string) => void;
};

// Tap-to-answer chips. One choice behaves as a radio group, several as a set of checkboxes.
export default function Chips({ labelledBy, options, selected, multi = false, disabled, onToggle }: ChipsProps) {
    return (
        <div role={multi ? 'group' : 'radiogroup'} aria-labelledby={labelledBy} className="flex flex-wrap gap-2">
            {options.map((option) => {
                const on = selected.includes(option.value);
                return (
                    <button
                        key={option.value}
                        type="button"
                        role={multi ? 'checkbox' : 'radio'}
                        aria-checked={on}
                        disabled={disabled}
                        onClick={() => onToggle(option.value)}
                        className={cn(
                            'inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 py-2 text-left text-[14.5px] font-semibold',
                            'transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.97]',
                            'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-55',
                            on
                                ? 'bg-brand-soft text-brand-ink shadow-[inset_0_0_0_1.5px_var(--brand)]'
                                : 'bg-card text-muted-foreground shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-hover hover:text-foreground',
                        )}
                    >
                        {on && <Check className="size-4 flex-none" aria-hidden />}
                        <span>
                            {option.label}
                            {option.hint && <span className="ml-1.5 font-medium text-faint">{option.hint}</span>}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
