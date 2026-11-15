import { describe, expect, it } from 'vitest';
import type { Risk } from '@/lib/domain/types';
import { listReplaySymbols } from '@/lib/replay';
import { getEntry } from '@/lib/universe';
import { isTradable } from '@/lib/services/quotes';
import { MODEL_TABLE, buildModelOptions, type ModelOption, type ProfileInput } from '@/lib/services/model-portfolio';

const RISKS: Risk[] = ['Low', 'Medium', 'High'];
const profile = (risk: Risk, answers: Partial<ProfileInput['answers']> = {}): ProfileInput => ({
    risk,
    answers: { markets: 'global', themes: [], avoid: [], ...answers },
});
const sum = (option: ModelOption) => option.lines.reduce((total, line) => total + line.weightPct, 0);
const weight = (option: ModelOption, symbol: string) => option.lines.find((line) => line.symbol === symbol)?.weightPct ?? 0;
const byId = (options: ModelOption[], id: string) => options.find((option) => option.id === id)!;

describe('model portfolios (rules/v1.json model_portfolios)', () => {
    it('gives three options per level, each summing to 100 with only replayable, tradable symbols', async () => {
        const replayable = new Set((await listReplaySymbols()).map((s) => s.symbol));
        const variations: Array<ProfileInput['answers']> = [
            { markets: 'global', themes: [], avoid: [] },
            { markets: 'Canada', themes: ['ESG', 'AI', 'dividends'], avoid: ['Health Care', 'NVDA'] },
        ];
        for (const risk of RISKS) {
            const raw = (MODEL_TABLE.options as Record<Risk, Array<{ lines: Array<{ symbol: string; weightPct: number }> }>>)[risk];
            expect(raw).toHaveLength(3);
            for (const option of raw) expect(option.lines.reduce((t, l) => t + l.weightPct, 0)).toBe(100);
            for (const answers of variations) {
                const options = buildModelOptions({ risk, answers });
                expect(options).toHaveLength(3);
                for (const option of options) {
                    expect(sum(option), option.id).toBe(100);
                    for (const line of option.lines) {
                        expect(Number.isInteger(line.weightPct)).toBe(true);
                        expect(replayable.has(line.symbol), `${line.symbol} in the snapshot`).toBe(true);
                        const entry = getEntry(line.symbol);
                        expect(entry && isTradable(entry), `${line.symbol} tradable`).toBe(true);
                        expect(line.why.length).toBeGreaterThan(0);
                    }
                }
            }
        }
    });

    it('uses the example portfolios of lib/personas as the middle option of their level', async () => {
        const { PERSONAS } = await import('@/lib/personas/presets');
        for (const [risk, persona] of [['Low', 'robert'], ['Medium', 'mateo'], ['High', 'amira']] as const) {
            const core = (MODEL_TABLE.options as Record<Risk, Array<{ id: string; lines: Array<{ symbol: string; weightPct: number }> }>>)[risk][1];
            expect(Object.fromEntries(core.lines.map((l) => [l.symbol, l.weightPct]))).toEqual(PERSONAS[persona].weights);
        }
    });

    it('crypto_high_only: crypto stays for High and is never in a Low or Medium option', () => {
        expect(weight(byId(buildModelOptions(profile('High')), 'high-core'), 'BTC')).toBe(7);
        for (const risk of ['Low', 'Medium'] as const) {
            for (const option of buildModelOptions(profile(risk))) expect(option.lines.some((l) => getEntry(l.symbol)?.assetClass === 'crypto')).toBe(false);
        }
    });

    it('esg: SPY and QQQ are replaced by ESGV with their weight', () => {
        const core = byId(buildModelOptions(profile('High', { themes: ['ESG'] })), 'high-core');
        expect(weight(core, 'SPY')).toBe(0);
        expect(weight(core, 'QQQ')).toBe(0);
        expect(weight(core, 'ESGV')).toBe(35);
        expect(core.adjustments).toContain('esg');
        expect(core.lines.find((l) => l.symbol === 'ESGV')!.why.map((w) => w.code)).toEqual(['esg_replaced', 'esg_replaced']);
    });

    it('markets_canada: U.S. funds become Canadian-listed ones, U.S. stocks go to the broad fund, GLD is kept with a reason', () => {
        const core = byId(buildModelOptions(profile('Low', { markets: 'Canada' })), 'low-core');
        expect(weight(core, 'SPY')).toBe(0);
        expect(weight(core, 'VFV.TO')).toBe(8);
        expect(weight(core, 'AGG')).toBe(0);
        expect(weight(core, 'XBB.TO')).toBe(30);
        expect(weight(core, 'JNJ')).toBe(0);
        expect(weight(core, 'PG')).toBe(0);
        expect(weight(core, 'XIU.TO')).toBe(27);
        expect(core.lines.find((l) => l.symbol === 'GLD')!.why.at(-1)!.code).toBe('canada_kept');
        expect(core.lines.every((l) => getEntry(l.symbol)!.market !== 'US' || l.symbol === 'GLD')).toBe(true);
    });

    it('avoid: a symbol or a sector on the avoid list is removed and its weight goes to the broad fund', () => {
        const core = byId(buildModelOptions(profile('Medium', { avoid: ['MSFT', 'Consumer Staples'] })), 'medium-core');
        expect(weight(core, 'MSFT')).toBe(0);
        expect(weight(core, 'PG')).toBe(0);
        expect(weight(core, 'ESGV')).toBe(30 + 6 + 5);
        expect(core.lines.find((l) => l.symbol === 'ESGV')!.why.filter((w) => w.code === 'avoid_moved')).toHaveLength(2);
    });

    it('theme_ai: points move from the broad fund to the AI holdings the option already has', () => {
        const core = byId(buildModelOptions(profile('High', { themes: ['AI'] })), 'high-core');
        expect(weight(core, 'SPY')).toBe(10 - 6);
        expect(weight(core, 'QQQ')).toBe(27);
        expect(weight(core, 'NVDA')).toBe(10);
        expect(weight(core, 'GOOGL')).toBe(10);
    });

    it('theme_dividends: points move from the broad fund to the dividend names the option already has', () => {
        const core = byId(buildModelOptions(profile('Low', { themes: ['dividends'] })), 'low-core');
        expect(weight(core, 'XIU.TO')).toBe(15 - 6);
        // RY.TO, JNJ, PG, FTS.TO in the option's order: 6 points split evenly
        for (const symbol of ['RY.TO', 'JNJ', 'PG', 'FTS.TO']) expect(weight(core, symbol)).toBeGreaterThanOrEqual(7);
        expect(weight(core, 'RY.TO') + weight(core, 'JNJ') + weight(core, 'PG') + weight(core, 'FTS.TO')).toBe(24 + 6);
    });

    it('is deterministic', () => {
        const input = profile('Medium', { markets: 'Canada', themes: ['ESG', 'dividends'], avoid: ['Utilities'] });
        expect(buildModelOptions(input)).toEqual(buildModelOptions(input));
    });
});
