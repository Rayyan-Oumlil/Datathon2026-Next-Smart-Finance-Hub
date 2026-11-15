'use client';

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

// One registration for every motion component. ScrollTrigger touches window, so this only runs in the browser.
if (typeof window !== 'undefined') gsap.registerPlugin(ScrollTrigger);

/** True when the visitor asked the system for less motion: no animation and no smooth scroll then. */
export function prefersReducedMotion(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export { gsap, ScrollTrigger };
