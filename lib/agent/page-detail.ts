'use client';

// Browser side of "the agent knows which page this is": a page tells the agent panel what it is showing (the X-ray
// page, its period) and can ask the agent a ready-made question. Nothing here is sent anywhere by itself: the
// agent panel reads the detail when the user sends a message.

import type { XrayWindowId } from './page';

export type PageDetail = { xrayWindow?: XrayWindowId };

let detail: PageDetail = {};
export const setPageDetail = (next: PageDetail) => { detail = next; };
export const getPageDetail = (): PageDetail => detail;

export const AGENT_ASK_EVENT = 'agent:ask';

/** Opens the agent panel and sends it `message`, as if the user had typed it. */
export function askAgent(message: string): void {
    window.dispatchEvent(new CustomEvent(AGENT_ASK_EVENT, { detail: { message } }));
}
