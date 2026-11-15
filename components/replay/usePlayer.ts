'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export const SPEEDS = [1, 4, 16] as const;
export type Speed = (typeof SPEEDS)[number];
/** Trading days drawn per second at 1x (a five-year replay takes about 25 s at 4x, 6 s at 16x). */
const DAYS_PER_SECOND = 15;

export function prefersReducedMotion(): boolean {
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/**
 * The date cursor of a replay: an index into result.dates, animated with requestAnimationFrame while playing.
 * `reset(n)` is called for each new result: it plays from the first day, or jumps to the last day when the visitor
 * asked for reduced motion (no autoplay; the slider still works).
 */
export function usePlayer() {
    const [length, setLength] = useState(0);
    const [cursor, setCursorState] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [speed, setSpeed] = useState<Speed>(4);
    const position = useRef(0);
    const last = useRef<number | null>(null);

    const setCursor = useCallback((index: number) => {
        position.current = index;
        setCursorState(index);
    }, []);

    const reset = useCallback((n: number) => {
        setLength(n);
        if (prefersReducedMotion() || n < 2) {
            setPlaying(false);
            setCursor(Math.max(0, n - 1));
        } else {
            setCursor(0);
            setPlaying(true);
        }
    }, [setCursor]);

    const toggle = useCallback(() => {
        setPlaying((now) => {
            if (!now && position.current >= length - 1) setCursor(0);   // play again from the start
            return !now;
        });
    }, [length, setCursor]);

    useEffect(() => {
        if (!playing || length < 2) return;
        let frame = 0;
        last.current = null;
        const step = (time: number) => {
            const previous = last.current ?? time;
            last.current = time;
            const next = Math.min(length - 1, position.current + ((time - previous) / 1000) * DAYS_PER_SECOND * speed);
            position.current = next;
            setCursorState(Math.floor(next));
            if (next >= length - 1) {
                setPlaying(false);
                return;
            }
            frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
        return () => cancelAnimationFrame(frame);
    }, [playing, speed, length]);

    return { cursor, setCursor, playing, setPlaying, toggle, speed, setSpeed, reset, length };
}

export type Player = ReturnType<typeof usePlayer>;
