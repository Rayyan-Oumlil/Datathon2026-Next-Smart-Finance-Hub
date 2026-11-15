import '@/__tests__/test-user';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apply, route, ruleSentence, undo } from '@/lib/agent/router';
import { agentText } from '@/lib/agent/text';
import { JUDGEMENT_WORDS, JUDGEMENT_WORDS_FR, NEVER_WORDS_FR_DEFAULT, failsWordCheck, neverWordsFr } from '@/lib/agent/wording';
import { RULES } from '@/lib/rules';
import { createRule } from '@/lib/services/rules-engine';
import { getProfile } from '@/lib/services/profile';
import { freshWorld } from '../services/helpers';

vi.mock('@/lib/services/quotes', async (original) => (await import('../services/market-stub')).quotesMock(await original()));

beforeEach(() => freshWorld());

// Intl writes a no-break or narrow no-break space in French figures; the tests compare plain spaces
const plain = (text: string) => text.replace(/[  ]/g, ' ');
const rule = { text: 'sous 90, ajouter 200 $ de AAPL', symbol: 'AAPL', trigger: { type: 'price_below', value: 90 }, action: { side: 'buy', amountCad: 200 }, once: true };
const preview = async (actionId: string, type: string, params: unknown) => {
    const routed = await route(actionId, { type, summary: 'from the model', params }, 'fr');
    if (routed.outcome !== 'preview') throw new Error(`expected a preview, got ${JSON.stringify(routed)}`);
    return routed.preview;
};

describe('router in French', () => {
    it('words a simulated trade preview in French, with French figures', async () => {
        const shown = await preview('t1', 'simulated_trade', { symbol: 'AAPL', side: 'buy', amountCad: 142 });
        expect(plain(shown.summary)).toBe('Acquisition simulée d’environ 142,00 $ de AAPL (Apple Inc.). Aucun ordre réel n’existe.');
        expect(shown.rows.map((row) => plain(`${row.label}: ${row.before} -> ${row.after}`))).toEqual([
            'Liquidités simulées: 10 000,00 $ -> environ 9 858,00 $',
            'Position en AAPL: 0 unités -> environ 1 unités',
        ]);
        expect(plain(shown.facts[0].value)).toBe('100,00 $ US');
        expect(shown.facts.at(-1)).toMatchObject({ label: 'Exécution', source: 'calculé' });
        const applied = await apply('t1', 'fr');
        expect(plain(applied.message)).toMatch(/^Opération simulée : 1 unités de AAPL à 100,00 \$ US \(stub quotes\), 142,00 \$\. Les liquidités simulées sont maintenant de 9 858,00 \$\.$/);
        expect(plain((await undo('t1', 'fr')).message)).toMatch(/^Annulation : une opération simulée inverse de 1 unités de AAPL/);
    });

    it('words a rule, its pause and the profile preview in French', async () => {
        const created = await preview('r1', 'rule_create', { rule });
        expect(plain(created.rows[0].after)).toBe('Lorsque le cours de AAPL est inférieur à 90,00 $ US, simuler une acquisition de 200,00 $ de AAPL, une seule fois.');
        expect(created.summary).toBe('Nouvelle règle simulée sur AAPL. Elle s’applique seulement dans la simulation.');

        const saved = await createRule(rule);
        const paused = await preview('p1', 'rule_pause', { ruleId: saved.id, status: 'paused' });
        expect(paused.rows[0]).toEqual({ label: 'Statut', before: 'active', after: 'suspendue' });
        expect(paused.summary).toBe('Suspend la règle simulée sur AAPL.');

        const risk = await preview('f1', 'profile_change', { changes: { risk: 'High' } });
        expect(risk.rows[1]).toEqual({ label: 'Profil de risque', before: 'Moyen', after: 'Élevé' });
        expect(risk.summary).toBe('Modification du profil : Profil de risque. Les règles de niveau et de risque ont été appliquées de nouveau.');
        const start = (await getProfile())!;
        const answers = await preview('f2', 'profile_change', { changes: { drop20: start.answers.drop20 === 'sell' ? 'buy_more' : 'sell' } });
        const shown = answers.rows.flatMap((row) => [row.label, row.before, row.after]).join(' | ');
        expect(shown).toContain('Réduire ma position');
        expect(shown).not.toMatch(/Reduce my position|If it dropped/);
    });

    it('keeps the English sentences as they were', () => {
        expect(ruleSentence({ symbol: 'AAPL', trigger: { type: 'change_pct_below', value: -5 }, action: { side: 'buy', amountCad: 50 }, once: true }))
            .toBe('When the change today of AAPL is below -5.00%, simulate a purchase of 50.00 CAD of AAPL, one time only.');
        expect(plain(ruleSentence({ symbol: 'AAPL', trigger: { type: 'change_pct_below', value: -5 }, action: { side: 'sell', quantity: 2 }, once: false }, '', 'fr')))
            .toBe('Lorsque la variation du jour de AAPL est inférieure à -5,00 %, réduire la position simulée en AAPL de 2 unités, au plus une fois par jour de bourse.');
    });

    it('replaces a refusal worded elsewhere in English by a French sentence, and keeps it as the detail', async () => {
        const routed = await route('d1', { type: 'layout_change', summary: 's', params: { layout: ['holdings'] } }, 'fr');
        expect(routed).toMatchObject({ outcome: 'dropped', reason: 'La modification proposée ne peut pas être prévisualisée avec les données actuelles.', detail: expect.stringContaining('Fixed widgets') });
        expect(await route('d2', { type: 'simulated_trade', summary: 's', params: { symbol: 'NOPE', side: 'buy', amountCad: 5 } }, 'fr'))
            .toMatchObject({ reason: 'NOPE ne figure pas dans la liste d’actifs de l’application; il ne peut donc pas être simulé.' });
    });
});

describe('web-side word check', () => {
    it('reads the French list from the rules file when it is there', () => {
        const listed = (RULES.reasons as { never_words_fr?: string[] }).never_words_fr;
        expect(neverWordsFr()).toEqual(listed && listed.length > 0 ? listed : NEVER_WORDS_FR_DEFAULT);
    });

    it.each([...NEVER_WORDS_FR_DEFAULT, ...JUDGEMENT_WORDS_FR, ...JUDGEMENT_WORDS, ...RULES.reasons.never_words])('fails a reply holding "%s", in any case', (word) => {
        expect(failsWordCheck(`Alors, ${word.toUpperCase()} ici.`)).toBe(true);
    });

    it.each([
        'Le bonus, la bonification et Bonjour : seulement des parties de mots.',
        'Une obligation; Bombardier et Bonterra sont des noms.',
        'Le cours est sur le graphique; c’est sûrement affiché vendredi.',
        'Bien sûr, voici la volatilité : 24,3 %.',
        'Les bons du Trésor et les bons de souscription.',
        'Une acquisition simulée, puis réduire la position.',
        'The best bid is 251.20; the volatility is higher than the cap.',
    ])('passes factual text: %s', (text) => {
        expect(failsWordCheck(text)).toBe(false);
    });

    it('lets the exact name of a watchlist pick be quoted, and nothing more', () => {
        // No asset of data/universe.json holds a listed word today; a watchlist name stands in for one
        const names = ['Best Buy Co., Inc.'];
        expect(failsWordCheck('Best Buy Co., Inc. is on your smart watchlist.', names)).toBe(false);
        expect(failsWordCheck('Best Buy Co., Inc. is on your smart watchlist.')).toBe(true);
        expect(failsWordCheck('Best Buy Co., Inc. is a buy.', names)).toBe(true);
        expect(failsWordCheck('Buy', ['Buy'])).toBe(true);                          // a one-word name is not exempt
        expect(failsWordCheck('Bonne Santé Inc. est dans la liste.', ['Bonne Santé Inc.'])).toBe(false);
        expect(failsWordCheck('Bonne Santé Inc. est dans la liste.')).toBe(true);
    });

    it('is accent-aware and reads any Unicode form', () => {
        expect(failsWordCheck('Un titre sûr.'.normalize('NFD'))).toBe(true);
        expect(failsWordCheck('Un titre SÛR.')).toBe(true);
        expect(failsWordCheck('Un titre sur la liste.')).toBe(false);
    });

    it('holds the same word lists as the agent service', () => {
        const read = (file: string) => readFileSync(path.join(process.cwd(), 'agent', 'app', file), 'utf8');
        const list = (source: string, name: string) => {
            const block = new RegExp(`${name}(?:: [^=]+)? = \\[([\\s\\S]*?)\\]`).exec(source)?.[1] ?? '';
            return [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
        };
        expect(list(read('checks.py'), 'JUDGEMENT_WORDS')).toEqual(JUDGEMENT_WORDS);
        expect(list(read('checks.py'), 'JUDGEMENT_WORDS_FR')).toEqual(JUDGEMENT_WORDS_FR);
        expect(list(read('config.py'), 'NEVER_WORDS_FR_DEFAULT')).toEqual(NEVER_WORDS_FR_DEFAULT);
    });
});

describe('fixed sentences', () => {
    it('hold no never-word and no judgement word, in either language', () => {
        for (const locale of ['en', 'fr'] as const) {
            const t = agentText(locale);
            const sentences = [
                ...Object.values(t).filter((value): value is string => typeof value === 'string'),
                t.agentTimeout(120), t.notShown(t.paramsInvalidShort), t.onlyPending('applied'), t.wrongStatus('undone', 'pending', 'applying'),
                t.notAllowed('wire_transfer'), t.paramsInvalid('simulated_trade', 'side: invalid'), t.layoutSummary(['Holdings'], ['Sector allocation']), t.layoutSummary([], []),
                t.ruleSentence({ symbol: 'AAPL', trigger: { type: 'price_above', value: 10 }, action: { side: 'sell', quantity: 2 }, once: false }, 'USD'),
                t.ruleSentence({ symbol: 'AAPL', trigger: { type: 'price_below', value: 10 }, action: { side: 'buy', amountCad: 50 }, once: true }, 'CAD'),
                t.ruleSummary('AAPL'), t.lastPrice('AAPL'), t.noRuleWithId('r1'), t.ruleAlready('paused'), t.pauseSummary('paused', 'AAPL'), t.pauseSummary('active', 'AAPL'),
                t.ruleCreated('AAPL', 'r1'), t.ruleNowStatus('AAPL', 'paused'), t.ruleAgain('active'), t.profileSummary(['Level']), t.levelRule('v1'), t.rulePoints('Expert', 9, true),
                t.profileApplied('Expert', 'High'), t.profileRestored('Novice', 'Low'), t.notInList('X'), t.referenceOnly('Gold'), t.noPrice('X'), t.noCad('X'),
                t.notEnoughCash(100, 200), t.notEnoughUnits('X', 1, 2), t.purchaseSummary(142, 'AAPL', 'Apple Inc.'), t.reductionSummary(142, 'AAPL', 'Apple Inc.'),
                t.tradeApplied(1, 'AAPL', '100.00 USD', 'Finnhub', 142, 9858), t.tradeUndone(1, 'AAPL', '100.00 USD', 'Finnhub', 142), t.ruleInvalid(['bad trigger']),
            ];
            for (const sentence of sentences) expect(failsWordCheck(sentence), `${locale}: ${sentence}`).toBe(false);
        }
    });

    it('formats French figures with Intl: decimal comma, space before % and $ after the amount', () => {
        const t = agentText('fr');
        expect(plain(t.cad(1500))).toBe('1 500,00 $');
        expect(plain(t.price(251.3, 'USD'))).toBe('251,30 $ US');
        expect(plain(t.notEnoughCash(100, 2500.5))).toBe('Les liquidités simulées sont de 100,00 $; cette acquisition demande 2 500,50 $.');
    });
});
