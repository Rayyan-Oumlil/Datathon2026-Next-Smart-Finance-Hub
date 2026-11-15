'use client';

import { useEffect, useRef } from 'react';

/** Fired by the agent panel after a change it saved or undid. */
export const DATA_CHANGED_EVENT = 'agent:data-changed';

/**
 * Runs `onChange` when the agent says the visitor's data changed, so a page reads its data again in place: what is on
 * screen stays until the new data is there. (The shell does not mount the page again: that would empty it for a
 * moment, and an emptied page loses its scroll position.)
 */
export function useDataChanged(onChange: () => void) {
    const latest = useRef(onChange);
    latest.current = onChange;
    useEffect(() => {
        const run = () => latest.current();
        window.addEventListener(DATA_CHANGED_EVENT, run);
        return () => window.removeEventListener(DATA_CHANGED_EVENT, run);
    }, []);
}
