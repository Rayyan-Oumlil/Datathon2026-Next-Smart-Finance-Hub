'use client';

import { useEffect } from "react";

/**
 * Brings the first previewed part of the page (a DraftFrame) into view when a proposal arrives, so the visitor sees
 * what would change without scrolling to look for it. `id` is the proposal's id: a new proposal scrolls again.
 * The page keeps growing for a moment as its charts load, so the scroll is repeated a few times, and it stops as soon
 * as the visitor scrolls or presses a key themselves.
 */
export default function ScrollToDraft({ id }: { id: string }) {
    useEffect(() => {
        let stopped = false;
        const go = () => {
            if (stopped) return;
            const target = document.querySelector('[data-draft]');
            if (!target) return;
            // A module taller than most of the screen is lined up by its top (where the tag and the buttons are)
            const tall = target.getBoundingClientRect().height > window.innerHeight * 0.7;
            target.scrollIntoView({ block: tall ? 'start' : 'center', behavior: 'auto' });
        };
        const stop = () => { stopped = true; };
        const timers = [500, 1500, 3000].map((ms) => setTimeout(go, ms));
        window.addEventListener('wheel', stop, { passive: true });
        window.addEventListener('touchstart', stop, { passive: true });
        window.addEventListener('keydown', stop);
        return () => {
            timers.forEach(clearTimeout);
            window.removeEventListener('wheel', stop);
            window.removeEventListener('touchstart', stop);
            window.removeEventListener('keydown', stop);
        };
    }, [id]);
    return null;
}
