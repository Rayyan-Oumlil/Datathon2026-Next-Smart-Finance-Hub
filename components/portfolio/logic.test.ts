import { readFileSync } from 'node:fs';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { describeRule, quoteCurrency } from '@/components/rules/describe';
import { cad, chartBox, errorText, ApiError, hasNeverWord, mergeLayout, modulesOf, moveModule, pointsFor, safeMessage, share, signed, signedPct, type ModuleId } from './logic';

const messages = (locale: string) => ({
    Portfolio: JSON.parse(readFileSync(`messages/${locale}/Portfolio.json`, 'utf8')),
    Rules: JSON.parse(readFileSync(`messages/${locale}/Rules.json`, 'utf8')),
});
const rules = (locale: 'en' | 'fr') => createTranslator({ locale, messages: messages(locale), namespace: 'Rules' }) as never as (key: string, values?: Record<string, string | number>) => string;
const portfolio = (locale: 'en' | 'fr') => createTranslator({ locale, messages: messages(locale), namespace: 'Portfolio' }) as never as (key: string, values?: Record<string, string | number>) => string;

const NOW = Date.parse('2026-11-14T12:00:00Z');
const history = [
    { t: '2025-01-01T21:00:00Z', valueCad: 10000 },
    { t: '2026-11-01T21:00:00Z', valueCad: 10100 },
    { t: '2026-11-10T21:00:00Z', valueCad: 10250 },
    { t: '2026-11-14T02:00:00Z', valueCad: 10200 },
    { t: '2026-11-14T11:00:00Z', valueCad: 10300 },
];

describe('pointsFor', () => {
    it('keeps only the points inside the period', () => {
        expect(pointsFor(history, '1D', NOW)).toHaveLength(2);
        expect(pointsFor(history, '1W', NOW)).toHaveLength(3);
        expect(pointsFor(history, '1M', NOW)).toHaveLength(4);
        expect(pointsFor(history, '1Y', NOW)).toHaveLength(4);
        expect(pointsFor(history, 'All', NOW)).toHaveLength(5);
    });
    it('sorts by time and drops unreadable points', () => {
        const points = pointsFor([history[4], { t: 'nope', valueCad: 1 }, history[0]], 'All', NOW);
        expect(points.map((point) => point.valueCad)).toEqual([10000, 10300]);
    });
});

describe('chartBox', () => {
    it('places the points and the baseline inside the box', () => {
        const box = chartBox(history.slice(1), 10000);
        expect(box.dots[0].x).toBe(0);
        expect(box.dots[box.dots.length - 1].x).toBe(1);
        for (const y of [...box.dots.map((dot) => dot.y), box.baselineY]) {
            expect(y).toBeGreaterThan(0);
            expect(y).toBeLessThan(1);
        }
        expect(box.baselineY).toBeGreaterThan(box.dots[0].y);      // a lower value sits lower on the screen
    });
    it('gives a flat series a height', () => {
        const box = chartBox([{ t: '2026-11-14T02:00:00Z', valueCad: 10000 }, { t: '2026-11-14T03:00:00Z', valueCad: 10000 }], 10000);
        expect(box.high).toBeGreaterThan(box.low);
        expect(box.baselineY).toBeCloseTo(0.5);
    });
});

describe('layout', () => {
    const saved = ['total_value', 'smart_watchlist', 'holdings', 'price_alerts', 'performance', 'charts'];
    const fixed = new Set(['total_value', 'smart_watchlist']);
    it('narrows the saved layout to this tab and keeps the rest on save', () => {
        expect(modulesOf(saved)).toEqual(['total_value', 'holdings', 'performance']);
        expect(mergeLayout(saved, ['total_value', 'performance'])).toEqual(['total_value', 'performance', 'smart_watchlist', 'price_alerts', 'charts']);
    });
    it('moves a module one step and never swaps with a fixed one', () => {
        const order: ModuleId[] = ['total_value', 'holdings', 'performance'];
        expect(moveModule(order, 'performance', -1, fixed)).toEqual(['total_value', 'performance', 'holdings']);
        expect(moveModule(order, 'holdings', -1, fixed)).toBe(order);
        expect(moveModule(order, 'performance', 1, fixed)).toBe(order);
        expect(moveModule(order, 'total_value', 1, fixed)).toBe(order);
    });
});

describe('wording', () => {
    it('replaces a server message that carries a word the app never shows, in either language', () => {
        expect(safeMessage('side: Invalid option: expected one of "buy"|"sell"', 'fallback')).toBe('fallback');
        expect(safeMessage('Il est recommandé de patienter', 'fallback')).toBe('fallback');
        expect(safeMessage('Simulated cash is 10.00 CAD; this purchase needs 500.00 CAD.')).toMatch(/^Simulated cash/);
        expect(safeMessage('Le solde sur la période est insuffisant.')).toMatch(/^Le solde sur/);
        expect(safeMessage(undefined, 'fallback')).toBe('fallback');
    });
    it('describes a rule in plain words without those words (English)', () => {
        const t = rules('en');
        const once = describeRule({ symbol: 'AAPL', trigger: { type: 'price_below', value: 150 }, action: { side: 'buy', amountCad: 500 }, once: true }, t, 'en');
        expect(once).toBe('When AAPL is below 150.00 USD, simulate a purchase of 500.00\u00a0CAD, once.');
        const repeating = describeRule({ symbol: 'RY.TO', trigger: { type: 'change_pct_above', value: 2.5 }, action: { side: 'sell', quantity: 1 }, once: false }, t, 'en');
        expect(repeating).toBe('When the day change of RY.TO is above +2.50%, simulate a position reduction of 1 unit, at most once per market day while it stays true.');
        const drop = describeRule({ symbol: 'BTC', trigger: { type: 'change_pct_below', value: -3 }, action: { side: 'buy', quantity: 0.5 }, once: true }, t, 'en');
        expect(drop).toContain('is below -3.00%');
        for (const sentence of [once, repeating, drop]) expect(hasNeverWord(sentence)).toBe(false);
    });
    it('describes a rule in plain words without those words (French)', () => {
        const t = rules('fr');
        const once = describeRule({ symbol: 'AAPL', trigger: { type: 'price_below', value: 150 }, action: { side: 'buy', amountCad: 1500 }, once: true }, t, 'fr');
        expect(once).toBe('Quand AAPL est sous 150,00 USD, simuler l’acquisition de 1\u00a0500,00\u00a0CAD, une seule fois.');
        const repeating = describeRule({ symbol: 'RY.TO', trigger: { type: 'change_pct_above', value: 2.5 }, action: { side: 'sell', quantity: 1 }, once: false }, t, 'fr');
        expect(repeating).toContain('la variation du jour de RY.TO est supérieure à +2,50');
        expect(repeating).toContain('simuler la réduction de la position de 1 unité, au plus une fois par jour de bourse');
        for (const sentence of [once, repeating]) expect(hasNeverWord(sentence)).toBe(false);
    });
    it('reads a price trigger in the quote currency', () => {
        expect(quoteCurrency('AAPL')).toBe('USD');
        expect(quoteCurrency('SHOP.TO')).toBe('CAD');
        expect(quoteCurrency('ETH')).toBe('CAD');
    });
});

describe('formats', () => {
    it('writes numbers in the active language', () => {
        expect(cad(1500, 'en')).toBe('1,500.00\u00a0CAD');
        expect(cad(1500, 'fr').replace(/\s/g, ' ')).toBe('1 500,00 CAD');
        expect(share(12.5, 'en')).toBe('12.5%');
        expect(share(12.5, 'fr').replace(/\s/g, ' ')).toBe('12,5 %');
        expect(signed(-3, 'fr')).toMatch(/^[-−]3,00$/);
        expect(signedPct(2.5, 'en')).toBe('+2.50%');
    });
});

describe('failed calls', () => {
    it('shows the server wording as received, or a translated sentence', () => {
        for (const locale of ['en', 'fr'] as const) {
            const t = portfolio(locale);
            expect(errorText(new ApiError('Solde insuffisant.', 400), t)).toBe('Solde insuffisant.');
            expect(errorText(new ApiError('', 502), t)).toContain('502');
            expect(errorText(new ApiError('', 0), t)).toBe(t('errors.network'));
        }
        expect(errorText(new ApiError('', 502), portfolio('fr'))).toMatch(/^La demande/);
    });
});
