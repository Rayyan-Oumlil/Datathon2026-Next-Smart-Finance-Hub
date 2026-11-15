'use client';

import { Fragment, useLayoutEffect, useRef, type ElementType } from 'react';
import { cn } from '@/lib/utils';
import { gsap, prefersReducedMotion } from './reduced-motion';

type SplitHeadingProps = {
    text: string;
    as?: ElementType;
    className?: string;
    /** Words wrapped in the brand gradient, by their position in the text (0-based) */
    accentWords?: number[];
    delay?: number;
    stagger?: number;
};

/**
 * A heading whose words rise in one after the other. The text is read once, from aria-label; the word spans are
 * hidden from assistive technology. Each word only moves (transform and opacity), so nothing around it shifts.
 * The CSS in globals.css hides the words until this runs, with a timed fallback if the script never loads.
 */
export default function SplitHeading({ text, as: Tag = 'h1', className, accentWords = [], delay = 0.05, stagger = 0.06 }: SplitHeadingProps) {
    const ref = useRef<HTMLElement>(null);
    const words = text.split(/\s+/).filter(Boolean);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el || prefersReducedMotion()) return;
        const ctx = gsap.context(() => {
            const targets = el.querySelectorAll('.motion-split-word');
            gsap.set(targets, { opacity: 0, yPercent: 60, rotate: 2 });
            el.classList.add('motion-ready');
            gsap.to(targets, { opacity: 1, yPercent: 0, rotate: 0, duration: 0.8, ease: 'power3.out', stagger, delay });
        }, el);
        return () => ctx.revert();
    }, [text, delay, stagger]);

    return (
        <Tag ref={ref} aria-label={text} className={cn('motion-split', className)}>
            {words.map((word, i) => (
                <Fragment key={`${word}-${i}`}>
                    <span aria-hidden className={cn('motion-split-word', accentWords.includes(i) && 'motion-gradient-text')}>{word}</span>
                    {i < words.length - 1 ? ' ' : null}
                </Fragment>
            ))}
        </Tag>
    );
}
