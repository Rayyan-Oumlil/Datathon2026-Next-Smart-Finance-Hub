import { describe, expect, it } from 'vitest';
import { PANEL_DEFAULT, PANEL_MAX, PANEL_MIN, clampWidth, readStoredWidth, stepWidth, swipeOf, widthFromDrag } from '@/components/agent/panel-width';

describe('agent panel width', () => {
    it('keeps the width inside the limits and leaves the workspace most of a small screen', () => {
        expect(clampWidth(100)).toBe(PANEL_MIN);
        expect(clampWidth(5000)).toBe(PANEL_MAX);
        expect(clampWidth(500)).toBe(500);
        // On a 1100 px screen the panel may take 60 % at most: 660 px
        expect(clampWidth(700, 1100)).toBe(660);
        // On a screen so small that 60 % is under the minimum, the minimum still holds
        expect(clampWidth(400, 400)).toBe(PANEL_MIN);
    });

    it('reads a saved width back only when it is a number inside the limits', () => {
        expect(readStoredWidth('520')).toBe(520);
        for (const bad of [null, undefined, '', 'abc', '10', '9000', 'NaN']) expect(readStoredWidth(bad)).toBe(PANEL_DEFAULT);
    });

    it('widens when the pointer moves away from the panel and narrows when it moves toward it', () => {
        expect(widthFromDrag(380, 1000, 900, false)).toBe(480);   // left on a right-hand panel: wider
        expect(widthFromDrag(380, 1000, 1060, false)).toBe(320);  // right: narrower
        expect(widthFromDrag(380, 1000, 100, false)).toBe(PANEL_MAX);
        expect(widthFromDrag(380, 1000, 2000, false)).toBe(PANEL_MIN);
        // Right-to-left: the panel is on the left, so the directions flip
        expect(widthFromDrag(380, 200, 300, true)).toBe(480);
    });

    it('steps between the presets and stops at the ends', () => {
        expect(stepWidth(380, 1)).toBe(520);
        expect(stepWidth(380, -1)).toBe(300);
        expect(stepWidth(300, -1)).toBe(300);
        expect(stepWidth(680, 1)).toBe(680);
        // A width between two presets moves to the next one in the direction asked
        expect(stepWidth(450, 1)).toBe(520);
        expect(stepWidth(450, -1)).toBe(380);
        // On a small screen the presets are clamped too
        expect(stepWidth(380, 1, 900)).toBe(520);
        expect(stepWidth(520, 1, 900)).toBe(540);
    });

    it('reads a swipe: long and mostly horizontal, toward the inside to widen', () => {
        expect(swipeOf(-120, 10, false)).toBe('wider');
        expect(swipeOf(120, 10, false)).toBe('narrower');
        expect(swipeOf(-20, 0, false)).toBeNull();      // too short
        expect(swipeOf(-100, 90, false)).toBeNull();    // more vertical than horizontal
        expect(swipeOf(120, 0, true)).toBe('wider');    // right-to-left flips it
        expect(swipeOf(-120, 0, true)).toBe('narrower');
    });
});
