'use client';

import { useEffect } from "react";

// The proposals already brought into view in this tab. A proposal is shown once, when it arrives: saving, cancelling,
// undoing, a refresh or a new render of the page never scrolls again.
const shown = new Set<string>();

/**
 * Brings the first previewed part of the page (a DraftFrame) into view when a new proposal arrives, so the visitor
 * sees what would change without scrolling to look for it. `id` is the proposal's id.
 * The page keeps growing for a moment as its charts load, so the scroll is repeated a few times, and it stops as soon
 * as the visitor scrolls, presses a key or clicks. A part whose top (the tag and the buttons) is already in view is
 * left where it is.
 */
export default function ScrollToDraft({ id }: { id: string }) {
    useEffect(() => {
        if (shown.has(id)) return;
        let stopped = false;
        const go = () => {
            if (stopped) return;
            const target = document.querySelector('[data-draft]');
            if (!target) return;
            // From the first try on, this proposal counts as shown (not before: in development the effect runs twice)
            shown.add(id);
            const rect = target.getBoundingClientRect();
            const view = (target.closest('main') ?? document.documentElement).getBoundingClientRect();
            // A module taller than most of the screen is lined up by its top (where the tag and the buttons are)
            const tall = rect.height > view.height * 0.7;
            const topInView = rect.top >= view.top && rect.top <= view.bottom - 160;
            if (topInView) {
                // Already there: at most the few pixels needed to show a small module whole
                if (!tall && rect.bottom > view.bottom) target.scrollIntoView({ block: 'nearest', behavior: 'auto' });
                return;
            }
            target.scrollIntoView({ block: tall ? 'start' : 'center', behavior: 'auto' });
        };
        const stop = () => { stopped = true; shown.add(id); };
        const timers = [500, 1500, 3000].map((ms) => setTimeout(go, ms));
        window.addEventListener('wheel', stop, { passive: true });
        window.addEventListener('touchstart', stop, { passive: true });
        window.addEventListener('pointerdown', stop, { passive: true });
        window.addEventListener('keydown', stop);
        return () => {
            timers.forEach(clearTimeout);
            window.removeEventListener('wheel', stop);
            window.removeEventListener('touchstart', stop);
            window.removeEventListener('pointerdown', stop);
            window.removeEventListener('keydown', stop);
        };
    }, [id]);
    return null;
}
