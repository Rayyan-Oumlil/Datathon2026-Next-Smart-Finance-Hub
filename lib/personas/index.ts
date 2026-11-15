// Seeding the stored example users (hidden addresses /u/amira, /u/mateo, /u/robert). Everything goes through the
// normal services: the onboarding answers through saveOnboarding (so level and risk are computed by rules/v1.json),
// the starting portfolio through simulateTrade at the current prices. A holding with no price (or not in the
// universe yet) is skipped and the reason is logged; no price is ever invented.

import { round2 } from '@/lib/services/errors';
import { getProfile, saveOnboarding } from '@/lib/services/profile';
import { simulateTrade } from '@/lib/services/portfolio';
import { performReset, resetSummary } from '@/lib/session/reset';
import { personaSessionId, scopeOfSession, type Scope } from '@/lib/session';
import { appendDecision } from '@/lib/store';
import { getEntry } from '@/lib/universe';
import { PERSONAS, type PersonaName } from './presets';

export { PERSONAS, isPersonaName, type PersonaName, type PersonaPreset } from './presets';

export type SeedResult = {
    persona: PersonaName;
    seeded: boolean;                                        // false: it already existed in this generation
    placed: Array<{ symbol: string; amountCad: number; valueCad: number }>;
    skipped: Array<{ symbol: string; reason: string }>;
};

/** The persona behind a session id, or null for an ordinary visitor. */
export function personaOfSession(sessionId: string): PersonaName | null {
    const match = /^persona-([a-z]+)$/.exec(sessionId);
    return match && Object.hasOwn(PERSONAS, match[1]) ? (match[1] as PersonaName) : null;
}

/** Creates the persona's profile and starting portfolio in `scope`. */
export async function seedPersona(name: PersonaName, scope: Scope): Promise<SeedResult> {
    const preset = PERSONAS[name];
    await saveOnboarding(structuredClone(preset.answers), scope);
    const placed: SeedResult['placed'] = [];
    const skipped: SeedResult['skipped'] = [];
    for (const [symbol, weight] of Object.entries(preset.weights)) {
        if (!getEntry(symbol)) {
            skipped.push({ symbol, reason: 'not in the app universe yet' });
            continue;
        }
        // One cent below the exact share, so rounding never asks for more cash than is left
        const amountCad = round2(Math.max(0, (preset.capitalCad * weight) / 100 - 0.01));
        try {
            const outcome = await simulateTrade({ symbol, side: 'buy', amountCad, origin: 'card', acknowledgeConflict: true }, 'fr', scope);
            if (outcome.status === 'filled') placed.push({ symbol, amountCad, valueCad: outcome.trade.valueCad });
            else skipped.push({ symbol, reason: `profile conflict: ${outcome.message}` });
        } catch (error) {
            skipped.push({ symbol, reason: error instanceof Error ? error.message : String(error) });
        }
    }
    await appendDecision({
        userId: scope.sessionLogId,
        kind: 'user_action',
        payload: { action: 'persona_seeded', persona: name, scopeId: scope.scopeId, capitalCad: preset.capitalCad, weights: preset.weights, placed, skipped, origin: 'user', simulated: true },
    });
    if (skipped.length > 0) console.warn(`persona ${name}: ${skipped.length} holding(s) skipped`, skipped);
    return { persona: name, seeded: true, placed, skipped };
}

// One seeding at a time per persona in this process, so two quick visits cannot seed twice
const running = new Map<PersonaName, Promise<{ scope: Scope; result: SeedResult }>>();

/**
 * The persona's scope, seeded on first use. A visit to a persona that exists only switches to it. With `fresh`, an
 * existing persona moves to a new generation (a reset at the "all" level: nothing is deleted) and is seeded again.
 */
export function ensurePersona(name: PersonaName, options: { fresh?: boolean } = {}): Promise<{ scope: Scope; result: SeedResult }> {
    const pending = running.get(name);
    if (pending) return pending;
    const work = (async () => {
        let scope = await scopeOfSession(personaSessionId(name));
        let exists = Boolean(await getProfile('fr', scope));
        if (exists && options.fresh) {
            scope = (await performReset(scope, 'all', await resetSummary(scope, 'all'))).scope;
            exists = false;
        }
        if (exists) return { scope, result: { persona: name, seeded: false, placed: [], skipped: [] } };
        return { scope, result: await seedPersona(name, scope) };
    })().finally(() => running.delete(name));
    running.set(name, work);
    return work;
}
