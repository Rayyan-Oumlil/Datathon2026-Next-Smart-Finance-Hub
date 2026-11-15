import { describe, expect, it } from 'vitest';
import { SPEAK_MAX_CHARS, speakable } from '@/lib/voice/speakable';

describe('speakable', () => {
    it('keeps a plain answer as it is', () => {
        expect(speakable('An ETF is a fund whose units trade on a stock exchange.')).toBe('An ETF is a fund whose units trade on a stock exchange.');
    });

    describe('what is dropped', () => {
        it('drops the source line and the file path, keeps the rest', () => {
            const reply = 'An ETF is a fund.\n\nSource: glossary, "ETF (exchange-traded fund)", at agent/glossary/etf.md.\n\nNext, you could look at the entry for the MER.';
            expect(speakable(reply)).toBe('An ETF is a fund.\nNext, you could look at the entry for the MER.');
        });

        it('drops a French source line, with the space before the colon', () => {
            expect(speakable('Un FNB est un fonds.\n\nSource : glossaire de l’application, agent/glossary/fr/etf.md.')).toBe('Un FNB est un fonds.');
        });

        it('drops a source line even when it is written in bold or italics', () => {
            expect(speakable('A fund.\n\n**Source:** glossary, at agent/glossary/etf.md.')).toBe('A fund.');
            expect(speakable('A fund.\n\n_Source: glossary_')).toBe('A fund.');
            expect(speakable('A fund.\n\n- **Sources**: glossary')).toBe('A fund.');
        });

        it('removes a file path written inline, with its brackets', () => {
            expect(speakable('The entry (agent/glossary/index-fund.md) explains it.')).toBe('The entry explains it.');
            expect(speakable('See data/universe.json and lib/watchlist/score.ts.')).toBe('See and.');
        });

        it('removes a whole web address instead of leaving "https://"', () => {
            expect(speakable('See https://www.canada.ca/en/revenue-agency/tfsa.html for limits.')).toBe('See for limits.');
        });

        it('removes markdown marks, list dashes and heading marks', () => {
            expect(speakable('## Two points\n- **MER** is a yearly fee.\n- Price follows `holdings`.')).toBe('Two points\nMER is a yearly fee.\nPrice follows holdings.');
        });
    });

    describe('what must not be touched', () => {
        it('keeps tickers written with a slash and an exchange suffix', () => {
            expect(speakable('Compare VOO/VFV.TO before deciding.')).toBe('Compare VOO/VFV.TO before deciding.');
            expect(speakable('XIU.TO and ZEB.TO are listed.')).toBe('XIU.TO and ZEB.TO are listed.');
        });

        it('keeps ratings, fractions and dates', () => {
            expect(speakable('Rated 4.5/5.0 by analysts.')).toBe('Rated 4.5/5.0 by analysts.');
            expect(speakable('From 1.5/2.5 to 3/4, a 50/50 split on 2026/11/15.')).toBe('From 1.5/2.5 to 3/4, a 50/50 split on 2026/11/15.');
        });

        it('keeps numbers, percentages and prices', () => {
            expect(speakable('The balance is 10,000.00 CAD, up 2.5 %, at 251.30 $ US.')).toBe('The balance is 10,000.00 CAD, up 2.5 %, at 251.30 $ US.');
        });

        it('keeps a number sign and underscores inside names', () => {
            expect(speakable('It is ranked #1 by max_position.')).toBe('It is ranked #1 by max position.');
        });
    });

    describe('length', () => {
        it('cuts a long reply at the last whole sentence that fits', () => {
            const out = speakable('This is one sentence of the reply. '.repeat(200));
            expect(out.length).toBeLessThanOrEqual(SPEAK_MAX_CHARS);
            expect(out.endsWith('reply.')).toBe(true);
        });

        it('cuts at a word when there is no sentence end to cut at', () => {
            const out = speakable('word '.repeat(1000), 100);
            expect(out.length).toBeLessThanOrEqual(100);
            expect(out.endsWith('word')).toBe(true);
        });

        it('stays fast on the worst inputs the route accepts', () => {
            const started = Date.now();
            speakable('\n'.repeat(8000));
            speakable('a.'.repeat(4000));
            speakable('a/'.repeat(4000));
            speakable(' '.repeat(8000));
            expect(Date.now() - started).toBeLessThan(500);
        });
    });

    it('returns an empty string when nothing is left to read', () => {
        expect(speakable('Source: app glossary, agent/glossary/etf.md.')).toBe('');
        expect(speakable('   ')).toBe('');
    });
});
