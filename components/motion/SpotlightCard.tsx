'use client';

import { useRef, type PointerEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type SpotlightCardProps = {
    children: ReactNode;
    className?: string;
};

/**
 * A card with a soft brand-coloured light that follows the pointer (CSS in globals.css, .motion-spotlight).
 * The position goes into two CSS variables on pointer move: no re-render, no layout work. Touch screens and
 * keyboard users see the plain card; reduced motion only drops the fade.
 */
export default function SpotlightCard({ children, className }: SpotlightCardProps) {
    const ref = useRef<HTMLDivElement>(null);
    const move = (e: PointerEvent<HTMLDivElement>) => {
        const el = ref.current;
        if (!el || e.pointerType === 'touch') return;
        const box = el.getBoundingClientRect();
        el.style.setProperty('--mx', `${e.clientX - box.left}px`);
        el.style.setProperty('--my', `${e.clientY - box.top}px`);
    };
    return (
        <div ref={ref} onPointerMove={move} className={cn('motion-spotlight', className)}>
            {children}
        </div>
    );
}
