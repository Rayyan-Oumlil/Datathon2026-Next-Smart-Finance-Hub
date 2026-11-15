// The width of the agent panel on a wide screen: the limits, the steps a swipe moves between, and the drag math.
// Pure functions, so the behaviour is tested without a browser (__tests__/agent/panel-width.test.ts).

export const PANEL_MIN = 300;
export const PANEL_MAX = 720;
export const PANEL_DEFAULT = 380;
export const PANEL_STORAGE_KEY = 'agent-panel-width';
/** What a swipe moves between: compact, normal, wide, extra wide. */
export const PANEL_STEPS = [300, 380, 520, 680] as const;
/** The arrow keys move the width by this much. */
export const KEY_STEP = 40;
/** The workspace keeps at least this share of the screen, whatever the panel's width. */
const MAX_SCREEN_SHARE = 0.6;

export const clampWidth = (width: number, screenWidth = Infinity): number => {
    const max = Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.floor(screenWidth * MAX_SCREEN_SHARE)));
    return Math.round(Math.min(max, Math.max(PANEL_MIN, width)));
};

/** A saved width read back from storage: a number inside the limits, else the default. */
export function readStoredWidth(raw: string | null | undefined): number {
    const value = Number(raw);
    return raw != null && raw !== '' && Number.isFinite(value) && value >= PANEL_MIN && value <= PANEL_MAX ? Math.round(value) : PANEL_DEFAULT;
}

/**
 * The width while dragging the panel's inner edge. Moving the pointer away from the panel (left on the right-hand
 * side of the screen, right in a right-to-left language) widens it.
 */
export function widthFromDrag(startWidth: number, startX: number, x: number, rtl: boolean, screenWidth = Infinity): number {
    const delta = rtl ? x - startX : startX - x;
    return clampWidth(startWidth + delta, screenWidth);
}

/** The next step wider (direction 1) or narrower (-1) than the current width; the current width when there is none. */
export function stepWidth(width: number, direction: 1 | -1, screenWidth = Infinity): number {
    const steps = PANEL_STEPS.map((step) => clampWidth(step, screenWidth));
    const next = direction === 1 ? steps.find((step) => step > width + 1) : [...steps].reverse().find((step) => step < width - 1);
    return next ?? clampWidth(width, screenWidth);
}

/**
 * A horizontal swipe, from where it started to where it ended: 'wider', 'narrower', or null when it was too short or
 * more vertical than horizontal. Swiping toward the screen's inner side (left on the right-hand panel) widens.
 */
export function swipeOf(dx: number, dy: number, rtl: boolean, threshold = 56): 'wider' | 'narrower' | null {
    if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
    const towardInside = rtl ? dx > 0 : dx < 0;
    return towardInside ? 'wider' : 'narrower';
}
