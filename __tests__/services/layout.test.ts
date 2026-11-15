import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_SCOPE } from '@/__tests__/test-user';
import { buildProfile } from '@/lib/rules/profile';
import { putProfile, updateState } from '@/lib/store';
import { WIDGET_LIBRARY, defaultLayout, getLayout, putLayout, validateLayout } from '@/lib/services/layout';
import { NOW, answers, freshWorld } from './helpers';

const OVERVIEW = ['overview_watchlist', 'overview_pulse', 'overview_leaders', 'overview_heatmap', 'overview_quotes', 'overview_news'];

vi.mock('@/lib/services/quotes', async (original) => (await import('./market-stub')).quotesMock(await original()));

beforeEach(() => freshWorld(false));

describe('layout', () => {
    it('gives a Novice fewer modules and an Expert all of them', () => {
        expect(defaultLayout('Novice')).toEqual(['total_value', 'performance', 'holdings', 'xray', ...OVERVIEW]);
        expect(defaultLayout('Intermediate').length).toBeGreaterThan(defaultLayout('Novice').length);
        expect(defaultLayout('Expert')).toEqual(WIDGET_LIBRARY.map((widget) => widget.id));
    });

    it('starts from the level template of the profile, Novice when there is none', async () => {
        expect((await getLayout()).layout).toEqual(defaultLayout('Novice'));
        await putProfile(buildProfile(TEST_SCOPE.profileUserId, answers(), NOW));
        expect(await getLayout()).toMatchObject({ layout: defaultLayout('Intermediate'), saved: false });
    });

    it('refuses unknown ids, repeats and a layout without a fixed widget', async () => {
        expect(validateLayout(['total_value', 'holdings'])).toEqual([]);
        expect(validateLayout(['total_value', 'nope'])[0]).toContain('nope');
        expect(validateLayout(['total_value', 'holdings', 'holdings'])[0]).toContain('more than once');
        expect(validateLayout(['holdings', 'performance'])[0]).toContain('Total value');
        expect(validateLayout('total_value')).toHaveLength(1);
        await expect(putLayout(['holdings'])).rejects.toMatchObject({ status: 400 });
        expect((await getLayout()).saved).toBe(false);
    });

    it('saves a layout and reads it back in order', async () => {
        const layout = ['holdings', 'total_value'];
        expect(await putLayout(layout)).toEqual({ layout });
        expect(await getLayout()).toMatchObject({ layout, saved: true });
    });

    it('offers the Portfolio tab modules and the Overview tab panels, and nothing else', () => {
        expect(WIDGET_LIBRARY.filter((widget) => widget.tab === 'portfolio').map((widget) => widget.id)).toEqual(['total_value', 'performance', 'holdings', 'sector_allocation', 'xray', 'investment_rules']);
        expect(WIDGET_LIBRARY.filter((widget) => widget.tab === 'overview').map((widget) => widget.id)).toEqual(OVERVIEW);
        // An Overview panel can be hidden: none of them is fixed
        expect(WIDGET_LIBRARY.filter((widget) => widget.tab === 'overview').every((widget) => !widget.fixed)).toBe(true);
        for (const id of ['price_alerts', 'smart_watchlist', 'quote_lookup', 'charts', 'indices_sentiment', 'market_movers', 'earnings_calendar']) {
            expect(validateLayout(['total_value', id])[0], id).toContain(id);
        }
    });

    it('drops an id that left the library from a saved layout on read', async () => {
        await updateState(TEST_SCOPE, (state) => {
            state.layout = { widgets: ['total_value', 'smart_watchlist', 'holdings', 'price_alerts'].map((widget, i) => ({ slot: `s-${i}`, widget })), updatedAt: NOW, overview: true };
        });
        expect(await getLayout()).toMatchObject({ layout: ['total_value', 'holdings'], saved: true });
    });

    it('hides an Overview panel that is left out of the saved layout, and shows it again when it is added back', async () => {
        const without = ['total_value', 'holdings', ...OVERVIEW.filter((id) => id !== 'overview_heatmap')];
        await putLayout(without);
        const hidden = (await getLayout()).layout;
        expect(hidden).not.toContain('overview_heatmap');
        expect(hidden).toContain('overview_news');
        await putLayout([...without, 'overview_heatmap']);
        expect((await getLayout()).layout).toContain('overview_heatmap');
    });

    it('keeps every Overview panel shown for a layout saved before the panels existed', async () => {
        await updateState(TEST_SCOPE, (state) => {
            state.layout = { widgets: ['total_value', 'holdings'].map((widget, i) => ({ slot: `portfolio-${i + 1}`, widget })), updatedAt: NOW };
        });
        expect(await getLayout()).toMatchObject({ layout: ['total_value', 'holdings', ...OVERVIEW], saved: true });
    });

    it('can hide every Overview panel at once', async () => {
        await putLayout(['total_value']);
        expect((await getLayout()).layout).toEqual(['total_value']);
    });
});
