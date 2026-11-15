import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_USER } from '@/lib/demo-user';
import { buildProfile } from '@/lib/rules/profile';
import { putProfile, updateState } from '@/lib/store';
import { WIDGET_LIBRARY, defaultLayout, getLayout, putLayout, validateLayout } from '@/lib/services/layout';
import { NOW, answers, freshWorld } from './helpers';

vi.mock('@/lib/services/quotes', async (original) => (await import('./market-stub')).quotesMock(await original()));

beforeEach(() => freshWorld(false));

describe('layout', () => {
    it('gives a Novice fewer modules and an Expert all of them', () => {
        expect(defaultLayout('Novice')).toEqual(['total_value', 'performance', 'holdings']);
        expect(defaultLayout('Intermediate').length).toBeGreaterThan(defaultLayout('Novice').length);
        expect(defaultLayout('Expert')).toEqual(WIDGET_LIBRARY.map((widget) => widget.id));
    });

    it('starts from the level template of the profile, Novice when there is none', async () => {
        expect((await getLayout()).layout).toEqual(defaultLayout('Novice'));
        await putProfile(buildProfile(DEMO_USER.id, answers(), NOW));
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

    it('offers only the modules the Portfolio tab draws from the layout', () => {
        expect(WIDGET_LIBRARY.map((widget) => widget.id)).toEqual(['total_value', 'performance', 'holdings', 'sector_allocation', 'investment_rules']);
        expect(WIDGET_LIBRARY.every((widget) => widget.tab === 'portfolio')).toBe(true);
        for (const id of ['price_alerts', 'smart_watchlist', 'quote_lookup', 'charts', 'indices_sentiment', 'market_movers', 'earnings_calendar']) {
            expect(validateLayout(['total_value', id])[0], id).toContain(id);
        }
    });

    it('drops an id that left the library from a saved layout on read', async () => {
        await updateState((state) => {
            state.layout = { widgets: ['total_value', 'smart_watchlist', 'holdings', 'price_alerts'].map((widget, i) => ({ slot: `s-${i}`, widget })), updatedAt: NOW };
        });
        expect(await getLayout()).toMatchObject({ layout: ['total_value', 'holdings'], saved: true });
    });
});
