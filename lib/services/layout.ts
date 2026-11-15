// The widget library (the dashboard modules of spec section 10), the starting layout of each level, and the
// saved layout. A layout is the ordered list of widget ids shown; each widget belongs to one tab.

import { DEMO_USER } from '@/lib/demo-user';
import type { Level } from '@/lib/domain/types';
import { getProfile, readState, updateState } from '@/lib/store';
import { ServiceError } from './errors';

export type Widget = { id: string; title: string; tab: 'portfolio' | 'overview'; fixed: boolean; minLevel: Level };

// Fixed widgets cannot be removed: the simulated balance, and the smart watchlist the Overview tab is built around.
export const WIDGET_LIBRARY: Widget[] = [
    { id: 'total_value', title: 'Total value (simulated)', tab: 'portfolio', fixed: true, minLevel: 'Novice' },
    { id: 'performance', title: 'Performance chart', tab: 'portfolio', fixed: false, minLevel: 'Novice' },
    { id: 'holdings', title: 'Holdings', tab: 'portfolio', fixed: false, minLevel: 'Novice' },
    { id: 'sector_allocation', title: 'Sector allocation', tab: 'portfolio', fixed: false, minLevel: 'Intermediate' },
    { id: 'investment_rules', title: 'Investment rules (simulated)', tab: 'portfolio', fixed: false, minLevel: 'Intermediate' },
    { id: 'price_alerts', title: 'Price alerts', tab: 'portfolio', fixed: false, minLevel: 'Expert' },
    { id: 'smart_watchlist', title: 'Smart watchlist', tab: 'overview', fixed: true, minLevel: 'Novice' },
    { id: 'quote_lookup', title: 'Quote lookup', tab: 'overview', fixed: false, minLevel: 'Novice' },
    { id: 'charts', title: 'Charts', tab: 'overview', fixed: false, minLevel: 'Intermediate' },
    { id: 'indices_sentiment', title: 'Indices & sentiment', tab: 'overview', fixed: false, minLevel: 'Intermediate' },
    { id: 'market_movers', title: 'Market movers', tab: 'overview', fixed: false, minLevel: 'Expert' },
    { id: 'earnings_calendar', title: 'Earnings calendar', tab: 'overview', fixed: false, minLevel: 'Expert' },
];

const LEVELS: Level[] = ['Novice', 'Intermediate', 'Expert'];

/** The level template: a Novice starts with fewer modules, an Expert with all of them. Any level may add the others. */
export function defaultLayout(level: Level): string[] {
    const rank = LEVELS.indexOf(level);
    return WIDGET_LIBRARY.filter((widget) => LEVELS.indexOf(widget.minLevel) <= rank).map((widget) => widget.id);
}

/** Problems with a proposed layout, in plain words; an empty list means it can be saved. */
export function validateLayout(layout: unknown): string[] {
    if (!Array.isArray(layout) || layout.some((id) => typeof id !== 'string')) return ['A layout is a list of widget ids.'];
    const ids = layout as string[];
    const known = new Set(WIDGET_LIBRARY.map((widget) => widget.id));
    const errors: string[] = [];
    const unknown = [...new Set(ids.filter((id) => !known.has(id)))];
    if (unknown.length > 0) errors.push(`Not in the widget library: ${unknown.join(', ')}.`);
    const repeated = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    if (repeated.length > 0) errors.push(`Listed more than once: ${repeated.join(', ')}.`);
    const missing = WIDGET_LIBRARY.filter((widget) => widget.fixed && !ids.includes(widget.id));
    if (missing.length > 0) errors.push(`Fixed widgets cannot be removed: ${missing.map((widget) => widget.title).join(', ')}.`);
    return errors;
}

export async function getLayout(): Promise<{ layout: string[]; library: Widget[]; saved: boolean }> {
    const { layout } = await readState();
    if (layout) return { layout: layout.widgets.map((widget) => widget.widget), library: WIDGET_LIBRARY, saved: true };
    const profile = await getProfile(DEMO_USER.id);
    return { layout: defaultLayout(profile?.level ?? 'Novice'), library: WIDGET_LIBRARY, saved: false };
}

export async function putLayout(layout: unknown): Promise<{ layout: string[] }> {
    const errors = validateLayout(layout);
    if (errors.length > 0) throw new ServiceError(400, errors.join(' '));
    const ids = layout as string[];
    const tabOf = new Map(WIDGET_LIBRARY.map((widget) => [widget.id, widget.tab]));
    const count: Record<string, number> = {};
    await updateState((state) => {
        state.layout = {
            widgets: ids.map((id) => {
                const tab = tabOf.get(id)!;
                count[tab] = (count[tab] ?? 0) + 1;
                return { slot: `${tab}-${count[tab]}`, widget: id };
            }),
            updatedAt: new Date().toISOString(),
        };
    });
    return { layout: ids };
}
