'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { gsap, prefersReducedMotion, ScrollTrigger } from './reduced-motion';

type MotionStageProps = {
    children: ReactNode;
    className?: string;
    /** Seconds before the hero items start, so a split heading can lead */
    heroDelay?: number;
};

/**
 * Plays the motion of a marketing page from data attributes on its children:
 * - data-hero: rises in once on load, in document order;
 * - data-draw: an SVG path (pathLength="1") traced from start to end with the hero;
 * - data-reveal: rises in when it scrolls into view; siblings entering together are staggered.
 * Only transform and opacity move, so nothing shifts. With reduced motion nothing is hidden or animated.
 */
export default function MotionStage({ children, className, heroDelay = 0.35 }: MotionStageProps) {
    const ref = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const root = ref.current;
        if (!root || prefersReducedMotion()) return;
        const ctx = gsap.context(() => {
            const hero = gsap.utils.toArray<HTMLElement>('[data-hero]');
            const draw = gsap.utils.toArray<SVGPathElement>('[data-draw]');
            const reveal = gsap.utils.toArray<HTMLElement>('[data-reveal]');
            gsap.set(hero, { opacity: 0, y: 18 });
            gsap.set(draw, { strokeDasharray: 1, strokeDashoffset: 1 });
            gsap.set(reveal, { opacity: 0, y: 28 });
            root.classList.add('motion-ready');

            gsap.timeline({ delay: heroDelay, defaults: { ease: 'power3.out' } })
                .to(hero, { opacity: 1, y: 0, duration: 0.7, stagger: 0.08 })
                .to(draw, { strokeDashoffset: 0, duration: 1.6, ease: 'power2.inOut', stagger: 0.2 }, 0.2);

            ScrollTrigger.batch(reveal, {
                start: 'top 88%',
                once: true,
                onEnter: (batch) => gsap.to(batch, { opacity: 1, y: 0, duration: 0.75, ease: 'power3.out', stagger: 0.1 }),
            });
        }, root);
        return () => ctx.revert();
    }, [heroDelay]);

    return <div ref={ref} className={cn('motion-stage', className)}>{children}</div>;
}
