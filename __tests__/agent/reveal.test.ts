import { describe, expect, it } from 'vitest';
import { REVEAL_MS, TICK_MS, revealedText, wordsOf, wordsPerTick } from '@/lib/agent/reveal';

describe('wordsOf', () => {
    it('splits into words that keep their trailing space, so the pieces join back to the text', () => {
        const text = 'An ETF is a fund.\nIt trades on an exchange.';
        const words = wordsOf(text);
        expect(words[0]).toBe('An ');
        expect(words.join('')).toBe(text.trimStart());
    });

    it('does not lose or change a figure written the French way', () => {
        expect(wordsOf('Le cours est de 1 500,00 $ US.').join('')).toBe('Le cours est de 1 500,00 $ US.');
        expect(wordsOf('Volatilité : 58,4 %.')).toContain('58,4 ');
    });

    it('gives nothing for an empty text', () => {
        expect(wordsOf('')).toEqual([]);
    });
});

describe('wordsPerTick', () => {
    it('shows one word at a time for a short reply', () => {
        expect(wordsPerTick(20)).toBe(1);
    });

    it('speeds up a long reply so that it is all shown within the time limit', () => {
        const count = 600;
        const ticks = Math.ceil(count / wordsPerTick(count));
        expect(ticks * TICK_MS).toBeLessThanOrEqual(REVEAL_MS);
    });
});

describe('revealedText', () => {
    it('is the first n words, and the whole text once n reaches the end', () => {
        const words = wordsOf('one two three');
        expect(revealedText(words, 2)).toBe('one two ');
        expect(revealedText(words, 99)).toBe('one two three');
        expect(revealedText(words, 0)).toBe('');
    });
});
