import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERSONAS, PERSONA_ALIASES, personaOfAddress, type PersonaName } from '@/lib/personas/presets';
import { personaOfSession } from '@/lib/personas';
import { personaSessionId, isSessionId } from '@/lib/session';
import { RULES } from '@/lib/rules';
import { buildProfile } from '@/lib/rules/profile';
import { getEntry } from '@/lib/universe';

// The level and risk of each example user are computed by rules/v1.json from its onboarding answers, never forced
const computed = (name: PersonaName) => buildProfile(`persona-${name}:p0`, PERSONAS[name].answers, '2026-11-15T00:00:00.000Z');
const NAMES = Object.keys(PERSONAS) as PersonaName[];

// The app symbols the frozen replay snapshot holds, so every example portfolio can run in the time machine
const ROOT = path.join(__dirname, '..', '..');
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'data/replay/yf-2026-11-15/manifest.json'), 'utf8')) as {
    symbols: Array<{ appSymbols: string[] }>;
};
const REPLAYABLE = new Set(manifest.symbols.flatMap((s) => s.appSymbols));

describe('example users', () => {
    it('Amira computes to High risk', () => {
        expect(computed('amira')).toMatchObject({ risk: 'High', riskOverridden: false });
    });

    it('Mateo computes to Medium risk', () => {
        expect(computed('mateo')).toMatchObject({ risk: 'Medium', riskOverridden: false });
    });

    it('Robert computes to Low risk', () => {
        expect(computed('robert')).toMatchObject({ risk: 'Low', riskOverridden: false });
    });

    it('Demo novice computes to Novice level', () => {
        expect(computed('novice')).toMatchObject({ level: 'Novice', levelOverridden: false });
    });

    it('Demo expert computes to Expert level and High risk', () => {
        expect(computed('expert')).toMatchObject({ level: 'Expert', risk: 'High', levelOverridden: false, riskOverridden: false });
    });

    describe.each(NAMES)('%s', (name) => {
        const preset = PERSONAS[name];

        it('answers compute to the expected level and risk', () => {
            expect(computed(name)).toMatchObject({ level: preset.expectedLevel, risk: preset.expectedRisk, levelOverridden: false, riskOverridden: false });
        });

        it('weights sum to 100', () => {
            expect(Object.values(preset.weights).reduce((sum, w) => sum + w, 0)).toBeCloseTo(100, 6);
        });

        it('holds only universe symbols that the replay snapshot covers', () => {
            for (const symbol of Object.keys(preset.weights)) {
                expect(getEntry(symbol), symbol).toBeTruthy();
                expect(REPLAYABLE.has(symbol), symbol).toBe(true);
            }
        });

        it('fits in the simulated starting cash', () => {
            expect(preset.capitalCad).toBeLessThanOrEqual(RULES.simulated_portfolio.starting_cash);
        });

        it('has a session id the session layer accepts and reads back', () => {
            expect(preset.name).toBe(name);
            expect(isSessionId(personaSessionId(name))).toBe(true);
            expect(personaOfSession(personaSessionId(name))).toBe(name);
        });
    });

    it('the demo addresses lead to the demo profiles', () => {
        expect(personaOfAddress('demo-novice')).toBe('novice');
        expect(personaOfAddress('demo-expert')).toBe('expert');
        expect(personaOfAddress('novice')).toBe('novice');
        expect(personaOfAddress('amira')).toBe('amira');
        expect(personaOfAddress('new')).toBeNull();
        expect(personaOfAddress('toString')).toBeNull();
        for (const target of Object.values(PERSONA_ALIASES)) expect(NAMES).toContain(target);
    });
});
