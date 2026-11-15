'use client';

import { useCallback, useEffect, useRef, type RefObject } from 'react';

/** Window event that makes the shell forget the kept position (a view change on the same path that should start at the top). */
export const FORGET_SCROLL_EVENT = 'shell:forget-scroll';
/** Call right before a same-path navigation that should land at the top (the shell only forgets on a path change). */
export const forgetKeptScroll = () => {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(FORGET_SCROLL_EVENT));
};

type Options = {
    /** The element that scrolls (the shell's workspace). */
    scroller: RefObject<HTMLElement | null>;
    /** The page inside it. */
    content: RefObject<HTMLElement | null>;
    /** An empty element placed right after the content: it is given the height the page is missing. */
    room: RefObject<HTMLElement | null>;
    /** Other parts of the scroller whose height can change (the agent's proposal card above the page). */
    watch?: RefObject<HTMLElement | null>[];
};

/**
 * Pressing a button never moves the page. When a part of the page gets shorter (a filter, a list read again, a module
 * hidden, a card that closes) and the page no longer reaches where the visitor is, the browser pulls the view up.
 * This puts the position back before the next paint and adds the missing height under the page; that room goes away
 * as the page grows again or as the visitor scrolls up.
 *
 * What the visitor is looking at is found from the block at the top edge of the view: when something above it changed
 * height (the proposal card closing), the view follows that block instead of the old scroll offset.
 *
 * `reset` forgets the kept position: call it when the visitor goes to another page. A view change on the same path that
 * should start at the top calls `forgetKeptScroll()`, which the shell turns into `reset`.
 */
export function useKeepScroll({ scroller, content, room, watch }: Options) {
    const kept = useRef<{ top: number; anchor: Element | null; anchorTop: number }>({ top: 0, anchor: null, anchorTop: 0 });
    const watched = useRef(watch);
    watched.current = watch;

    const reset = useCallback(() => {
        kept.current = { top: 0, anchor: null, anchorTop: 0 };
        if (room.current) room.current.style.height = '0px';
    }, [room]);

    useEffect(() => {
        const box = scroller.current;
        const page = content.current;
        const spare = room.current;
        if (!box || !page || !spare || typeof ResizeObserver === 'undefined') return;

        // Where an element starts, in the scroller's own coordinates (does not change when the visitor scrolls)
        const place = (element: Element) => element.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
        const setRoom = (px: number) => { spare.style.height = `${Math.max(0, Math.ceil(px))}px`; };
        // The block of the page at the top edge of the view, a few levels deep
        const pickAnchor = (): Element | null => {
            const edge = box.getBoundingClientRect().top;
            let node: Element = page;
            let found: Element | null = null;
            for (let depth = 0; depth < 3; depth++) {
                const next = Array.from(node.children).find((child) => {
                    const rect = child.getBoundingClientRect();
                    return rect.height > 0 && rect.bottom > edge + 1;
                });
                if (!next) break;
                found = next;
                if (next.getBoundingClientRect().top >= edge) break;
                node = next;
            }
            return found;
        };

        const check = () => {
            const state = kept.current;
            const max = box.scrollHeight - box.clientHeight;
            if (state.top > max + 1) {
                if (box.scrollTop < max - 1) {
                    // The view was moved on purpose (scrollIntoView, a navigation to the top), not pinned to the end by
                    // the browser: keep that position instead of the old one.
                    setRoom(0);
                    state.top = Math.max(0, box.scrollTop);
                    state.anchor = pickAnchor();
                    state.anchorTop = state.anchor ? place(state.anchor) : 0;
                    return;
                }
                // The page no longer reaches the kept position. If the block the visitor was looking at moved (something
                // above it changed height), follow it; otherwise stay at the same offset.
                // (a block that left the page, or is no longer drawn, says nothing about what moved)
                const anchor = state.anchor?.isConnected && state.anchor.getClientRects().length > 0 ? state.anchor : null;
                const moved = anchor ? place(anchor) - state.anchorTop : 0;
                const target = Math.max(0, state.top + moved);
                if (target > max + 1) setRoom(target + box.clientHeight - place(spare));
                if (Math.abs(box.scrollTop - target) > 1) box.scrollTop = target;
                state.top = target;
                state.anchorTop += moved;
                return;
            }
            const top = box.scrollTop;
            // An elastic overscroll reports positions past the end: they are not kept
            if (top > max + 1) return;
            if (spare.offsetHeight > 0) setRoom(Math.min(spare.offsetHeight, top + box.clientHeight - place(spare)));
            state.top = Math.max(0, top);
            state.anchor = pickAnchor();
            state.anchorTop = state.anchor ? place(state.anchor) : 0;
        };

        const observer = new ResizeObserver(check);
        observer.observe(box);
        observer.observe(page);
        for (const ref of watched.current ?? []) if (ref.current) observer.observe(ref.current);
        box.addEventListener('scroll', check, { passive: true });
        return () => {
            observer.disconnect();
            box.removeEventListener('scroll', check);
        };
    }, [scroller, content, room]);

    return { reset };
}
