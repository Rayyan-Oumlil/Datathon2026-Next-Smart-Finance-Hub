'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useLocale } from 'next-intl';
import { cn } from '@/lib/utils';
import { gsap, prefersReducedMotion, ScrollTrigger } from './reduced-motion';

type CountUpProps = {
    value: number;
    /** 'percent' takes the value in percent (100 means 100 %) */
    format?: 'number' | 'percent';
    duration?: number;
    className?: string;
};

const TAGS = { en: 'en-CA', fr: 'fr-CA' } as const;

/**
 * A number that counts up from zero the first time it scrolls into view. The server renders the final value, so
 * the text is right without JavaScript, for reduced motion and for screen readers (the moving digits are hidden
 * from them). The box keeps the width of the final value, so counting never moves the text around it.
 */
export default function CountUp({ value, format = 'number', duration = 1.4, className }: CountUpProps) {
    const locale = useLocale();
    const ref = useRef<HTMLSpanElement>(null);
    const fmt = useMemo(() => {
        const nf = new Intl.NumberFormat(TAGS[locale as keyof typeof TAGS] ?? 'fr-CA', format === 'percent' ? { style: 'percent', maximumFractionDigits: 0 } : { maximumFractionDigits: 0 });
        return (n: number) => nf.format(format === 'percent' ? n / 100 : n);
    }, [locale, format]);
    const final = fmt(value);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el || prefersReducedMotion()) return;
        const state = { n: 0 };
        el.textContent = fmt(0);
        const tween = gsap.to(state, {
            n: value,
            duration,
            ease: 'power2.out',
            paused: true,
            onUpdate: () => { el.textContent = fmt(Math.round(state.n)); },
        });
        const trigger = ScrollTrigger.create({ trigger: el, start: 'top 90%', once: true, onEnter: () => tween.play() });
        return () => {
            trigger.kill();
            tween.kill();
            el.textContent = final;
        };
    }, [value, duration, fmt, final]);

    return (
        <span className={cn('relative inline-block tabular-nums', className)}>
            <span className="sr-only">{final}</span>
            {/* Holds the width of the final value */}
            <span aria-hidden className="invisible">{final}</span>
            <span ref={ref} aria-hidden className="absolute inset-0 text-start">{final}</span>
        </span>
    );
}
