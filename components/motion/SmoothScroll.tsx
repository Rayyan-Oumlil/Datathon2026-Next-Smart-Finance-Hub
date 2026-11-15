'use client';

import { useEffect } from 'react';
import Lenis from 'lenis';
import { gsap, prefersReducedMotion, ScrollTrigger } from './reduced-motion';

/**
 * Lenis smooth scrolling for the page it is mounted on, driven by the GSAP ticker so ScrollTrigger reveals stay in
 * step with it. Mounted only on the landing and onboarding pages, never inside the app shell. Inner scroll areas
 * opt out with data-lenis-prevent. Nothing happens for a visitor who prefers reduced motion.
 */
export default function SmoothScroll() {
    useEffect(() => {
        if (prefersReducedMotion()) return;
        const lenis = new Lenis({ autoRaf: false, anchors: true, lerp: 0.12 });
        lenis.on('scroll', ScrollTrigger.update);
        const tick = (time: number) => lenis.raf(time * 1000);
        gsap.ticker.add(tick);
        gsap.ticker.lagSmoothing(0);
        return () => {
            gsap.ticker.remove(tick);
            gsap.ticker.lagSmoothing(500, 33);
            lenis.destroy();
        };
    }, []);
    return null;
}
