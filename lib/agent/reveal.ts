// The reply is already checked when it reaches the browser; showing it a few words at a time is only how it
// appears. Pure helpers, so the pacing is tested without a browser.

export const TICK_MS = 30;
export const REVEAL_MS = 2500;      // a long reply speeds up rather than keep the reader waiting

/** The words of a text, each with the space or line break that follows it, so the pieces join back to the text. */
export const wordsOf = (text: string): string[] => text.match(/\S+\s*/g) ?? [];

/** How many words to add on each tick so that the whole text is shown within REVEAL_MS. */
export const wordsPerTick = (wordCount: number): number => Math.max(1, Math.ceil(wordCount / (REVEAL_MS / TICK_MS)));

export const revealedText = (words: readonly string[], count: number): string => words.slice(0, Math.max(0, count)).join('');
