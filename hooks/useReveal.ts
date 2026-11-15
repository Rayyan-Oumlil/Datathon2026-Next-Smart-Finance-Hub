'use client';

import { useEffect, useMemo, useState } from 'react';
import { TICK_MS, revealedText, wordsOf, wordsPerTick } from '@/lib/agent/reveal';

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The text shown so far. With `animate` off, or when the reader asked for less motion, it is the whole text at once.
 * `onDone` is called once the whole text is shown.
 */
export function useReveal(text: string, animate: boolean, onDone?: () => void): string {
    const words = useMemo(() => wordsOf(text), [text]);
    const instant = !animate || prefersReducedMotion();
    const [count, setCount] = useState(instant ? words.length : 0);

    useEffect(() => {
        if (instant) return;
        if (count >= words.length) {
            onDone?.();
            return;
        }
        const step = wordsPerTick(words.length);
        const timer = window.setTimeout(() => setCount((n) => n + step), TICK_MS);
        return () => window.clearTimeout(timer);
    }, [instant, count, words.length, onDone]);

    return instant ? text : revealedText(words, count);
}
