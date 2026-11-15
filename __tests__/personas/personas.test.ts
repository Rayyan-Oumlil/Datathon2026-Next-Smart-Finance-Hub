import { describe, expect, it } from 'vitest';
import { PERSONAS } from '@/lib/personas/presets';
import { buildProfile } from '@/lib/rules/profile';

// The risk of each example user is computed by rules/v1.json from its onboarding answers, never forced
const computed = (name: keyof typeof PERSONAS) => buildProfile(`persona-${name}:p0`, PERSONAS[name].answers, '2026-11-15T00:00:00.000Z');

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
});
