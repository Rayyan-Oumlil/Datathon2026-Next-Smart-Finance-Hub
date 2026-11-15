import { describe, expect, it } from 'vitest';
import { detectLanguage, replyLanguage } from '@/lib/agent/language';

describe('detectLanguage', () => {
    it.each([
        'What is an ETF?',
        'Why is NVDA on my list, and what about TSLA versus Royal Bank?',
        'Add Enbridge, CNQ and Shopify to my watchlist.',
        'Show me less',
        'Create a rule: when AAPL is below 150, simulate a purchase of 200 CAD',
        'Explain a pick on my list',
        'how much cash do I have left?',
        'Thanks, that is clear.',
        "I don't understand the risk score",
        "What's the difference between an ETF and an index fund?",
    ])('reads "%s" as English', (text) => {
        expect(detectLanguage(text)).toBe('en');
    });

    it.each([
        'Qu’est-ce qu’un FNB?',
        "Qu'est-ce qu'un FNB?",
        'Pourquoi NVDA est sur ma liste, et que dire de TSLA par rapport à la Banque Royale?',
        'Ajoutez Enbridge, CNQ et Shopify à ma liste de suivi.',
        'Montre-moi moins',
        'Je veux ajouter Tesla à mon portefeuille simulé',
        "c'est quoi un FNB",
        'combien de liquidités me reste-t-il ?',
        'Merci, c’est clair.',
        'Expliquez-moi un titre de ma liste',
        'bonjour',
        'Quelle est la différence entre un FNB et un fonds indiciel?',
    ])('reads "%s" as French', (text) => {
        expect(detectLanguage(text)).toBe('fr');
    });

    it('reads French typed without accents', () => {
        expect(detectLanguage('ou est mon portefeuille et a quoi sert un fnb')).toBe('fr');
        expect(detectLanguage('pourquoi ce titre est sur ma liste')).toBe('fr');
    });

    it('does not read the suffix of a symbol as a word', () => {
        expect(detectLanguage('XIU.TO')).toBeNull();
        expect(detectLanguage('BTC-USD')).toBeNull();
        expect(detectLanguage('SHOP.TO vs BRK.B')).toBeNull();
        expect(detectLanguage('Pourquoi XIU.TO est sur ma liste')).toBe('fr');
        expect(detectLanguage('Why is ZEB.TO on my list')).toBe('en');
    });

    it('reads a message by its majority when it holds both languages', () => {
        expect(detectLanguage('Je veux comparer TSLA et NVDA dans mon portfolio')).toBe('fr');
        expect(detectLanguage('Please add the Banque Royale to my list')).toBe('en');
    });

    it.each(['ETF', 'TSLA', 'NVDA vs TSLA', 'Tesla', 'Apple', 'ok', '2026', '10 000 $', '', '   ', '???'])(
        'says nothing about "%s", which has no language of its own',
        (text) => { expect(detectLanguage(text)).toBeNull(); },
    );

    it('says nothing about a message that is as much English as French', () => {
        expect(detectLanguage('Explique-moi what is an ETF')).toBeNull();
    });

    it('does not read English contractions as French ones', () => {
        expect(detectLanguage("it's fine, I'm sure")).toBe('en');
        expect(detectLanguage("don't sell, can't wait")).toBe('en');
    });

    it('reads any Unicode form of an accent', () => {
        expect(detectLanguage('liquidite'.normalize('NFD') + ' élevée et prix')).toBe('fr');
    });

    it('stays fast on long input', () => {
        const started = Date.now();
        detectLanguage('word '.repeat(20_000));
        detectLanguage("l'".repeat(20_000));
        expect(Date.now() - started).toBeLessThan(500);
    });
});

describe('replyLanguage', () => {
    const turn = (role: 'user' | 'assistant', text: string) => ({ role, text });

    it('follows the language of the message, whatever the app is set to', () => {
        expect(replyLanguage('What is an ETF?', [], 'fr')).toEqual({ locale: 'en', basis: 'message' });
        expect(replyLanguage('Qu’est-ce qu’un FNB?', [], 'en')).toEqual({ locale: 'fr', basis: 'message' });
    });

    it('lets the message win over the rest of the conversation', () => {
        const history = [turn('user', 'Bonjour, je veux voir mon portefeuille'), turn('assistant', 'Voici votre portefeuille simulé.')];
        expect(replyLanguage('Now explain what an ETF is', history, 'fr')).toEqual({ locale: 'en', basis: 'message' });
    });

    it('falls back to the conversation when the message has no language of its own', () => {
        const french = [turn('user', 'Qu’est-ce qu’un FNB?'), turn('assistant', 'Un FNB est un fonds négocié en bourse.')];
        expect(replyLanguage('TSLA', french, 'en')).toEqual({ locale: 'fr', basis: 'conversation' });
        const english = [turn('user', 'What is an ETF?'), turn('assistant', 'An ETF is an exchange-traded fund.')];
        expect(replyLanguage('XIU.TO', english, 'fr')).toEqual({ locale: 'en', basis: 'conversation' });
    });

    it('uses the most recent turn that has a language', () => {
        const history = [turn('user', 'What is an ETF?'), turn('assistant', 'An ETF is a fund.'), turn('user', 'Et un fonds indiciel?'), turn('assistant', 'Un fonds indiciel suit un indice.')];
        expect(replyLanguage('NVDA', history, 'en').locale).toBe('fr');
    });

    it('falls back to the app language when nothing in the conversation has one', () => {
        expect(replyLanguage('TSLA', [], 'fr')).toEqual({ locale: 'fr', basis: 'app' });
        expect(replyLanguage('TSLA', [turn('user', 'NVDA'), turn('assistant', '…')], 'en')).toEqual({ locale: 'en', basis: 'app' });
    });
});
