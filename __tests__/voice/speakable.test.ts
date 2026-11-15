import { describe, expect, it } from 'vitest';
import { SPEAK_MAX_CHARS, speakable } from '@/lib/voice/speakable';

describe('speakable', () => {
    it('keeps a plain answer as it is', () => {
        expect(speakable('An ETF is a fund whose units trade on a stock exchange.')).toBe('An ETF is a fund whose units trade on a stock exchange.');
    });

    it('drops the source line and the file path, keeps the rest', () => {
        const reply = 'An ETF is a fund.\n\nSource: glossary, "ETF (exchange-traded fund)", at agent/glossary/etf.md.\n\nNext, you could look at the entry for the MER.';
        expect(speakable(reply)).toBe('An ETF is a fund.\nNext, you could look at the entry for the MER.');
    });

    it('drops a French source line, with the space before the colon', () => {
        expect(speakable('Un FNB est un fonds.\n\nSource : glossaire de l’application, agent/glossary/fr/etf.md.')).toBe('Un FNB est un fonds.');
    });

    it('removes a path written inline, with its brackets', () => {
        expect(speakable('The entry (agent/glossary/index-fund.md) explains it.')).toBe('The entry explains it.');
    });

    it('removes markdown marks and list dashes', () => {
        expect(speakable('Two points:\n- **MER** is a yearly fee.\n- Price follows `holdings`.')).toBe('Two points:\nMER is a yearly fee.\nPrice follows holdings.');
    });

    it('does not touch numbers, percentages or prices', () => {
        expect(speakable('The balance is 10,000.00 CAD, up 2.5 %, at 251.30 $ US.')).toBe('The balance is 10,000.00 CAD, up 2.5 %, at 251.30 $ US.');
    });

    it('cuts a long reply at the last whole sentence that fits', () => {
        const sentence = 'This is one sentence of the reply. ';
        const out = speakable(sentence.repeat(200));
        expect(out.length).toBeLessThanOrEqual(SPEAK_MAX_CHARS);
        expect(out.endsWith('reply.')).toBe(true);
    });

    it('cuts at a word when there is no sentence end to cut at', () => {
        const out = speakable('word '.repeat(1000), 100);
        expect(out.length).toBeLessThanOrEqual(100);
        expect(out.endsWith('word')).toBe(true);
    });

    it('returns an empty string when nothing is left to read', () => {
        expect(speakable('Source: app glossary, agent/glossary/etf.md.')).toBe('');
        expect(speakable('   ')).toBe('');
    });
});
