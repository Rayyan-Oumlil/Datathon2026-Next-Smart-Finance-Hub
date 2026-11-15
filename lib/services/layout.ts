// The widget library (the dashboard modules of spec section 10), the starting layout of each level, and the
// saved layout. No widget is gated by level. A layout is the ordered list of widget ids shown. The Portfolio tab draws its modules from it in
// that order; the Overview tab shows or hides its panels (its order is fixed): a module left out of the list is hidden.

import { getAppLocale } from '@/i18n/locale';
import type { Level } from '@/lib/domain/types';
import { currentScope, type Scope } from '@/lib/session';
import { getProfile, readState, updateState } from '@/lib/store';
import type { Locale } from '@/lib/watchlist/text';
import { ServiceError } from './errors';
import { renderText, serviceRef } from './text';

// Every widget is available at every level: the level only picks the layout a new user starts with (defaultLayout).
export type Widget = { id: string; title: string; tab: 'portfolio' | 'overview'; fixed: boolean };

const widgetTitle = (id: string, locale: Locale = 'en') => renderText(serviceRef('svc.layout.widget_title', { id }), locale);

// The modules components/portfolio renders from the layout. The simulated balance is fixed: it cannot be removed.
// Titles here are English (the agent reads this list); widgetLibrary(locale) gives them in a language.
export const WIDGET_LIBRARY: Widget[] = [
    { id: 'total_value', title: widgetTitle('total_value'), tab: 'portfolio', fixed: true },
    { id: 'performance', title: widgetTitle('performance'), tab: 'portfolio', fixed: false },
    { id: 'holdings', title: widgetTitle('holdings'), tab: 'portfolio', fixed: false },
    { id: 'sector_allocation', title: widgetTitle('sector_allocation'), tab: 'portfolio', fixed: false },
    { id: 'xray', title: widgetTitle('xray'), tab: 'portfolio', fixed: false },
    { id: 'investment_rules', title: widgetTitle('investment_rules'), tab: 'portfolio', fixed: false },
    // The panels of the Overview tab. Every level starts with all of them; any may be hidden and shown again.
    { id: 'overview_watchlist', title: widgetTitle('overview_watchlist'), tab: 'overview', fixed: false },
    { id: 'overview_pulse', title: widgetTitle('overview_pulse'), tab: 'overview', fixed: false },
    { id: 'overview_leaders', title: widgetTitle('overview_leaders'), tab: 'overview', fixed: false },
    { id: 'overview_heatmap', title: widgetTitle('overview_heatmap'), tab: 'overview', fixed: false },
    { id: 'overview_quotes', title: widgetTitle('overview_quotes'), tab: 'overview', fixed: false },
    { id: 'overview_news', title: widgetTitle('overview_news'), tab: 'overview', fixed: false },
];

/** The widget library with each title in the language. */
export const widgetLibrary = (locale: Locale): Widget[] => WIDGET_LIBRARY.map((widget) => ({ ...widget, title: widgetTitle(widget.id, locale) }));

// The layout a new user starts with, by level: a Novice starts with fewer Portfolio modules. It is only a starting
// point: any level may show, hide or move any widget, by hand or through the agent.
const NOVICE_HIDDEN = new Set(['sector_allocation', 'investment_rules']);
const STARTING_LAYOUT: Record<Level, string[]> = {
    Novice: WIDGET_LIBRARY.filter((widget) => !NOVICE_HIDDEN.has(widget.id)).map((widget) => widget.id),
    Intermediate: WIDGET_LIBRARY.map((widget) => widget.id),
    Expert: WIDGET_LIBRARY.map((widget) => widget.id),
};

/** The starting layout of a level (a copy). Never a limit: every widget of the library may be added at any level. */
export function defaultLayout(level: Level): string[] {
    return [...(STARTING_LAYOUT[level] ?? STARTING_LAYOUT.Novice)];
}

function layoutProblems(layout: unknown) {
    if (!Array.isArray(layout) || layout.some((id) => typeof id !== 'string')) return [serviceRef('svc.layout.not_a_list', {})];
    const ids = layout as string[];
    const known = new Set(WIDGET_LIBRARY.map((widget) => widget.id));
    const errors = [];
    const unknown = [...new Set(ids.filter((id) => !known.has(id)))];
    if (unknown.length > 0) errors.push(serviceRef('svc.layout.unknown', { ids: unknown }));
    const repeated = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    if (repeated.length > 0) errors.push(serviceRef('svc.layout.repeated', { ids: repeated }));
    const missing = WIDGET_LIBRARY.filter((widget) => widget.fixed && !ids.includes(widget.id));
    if (missing.length > 0) errors.push(serviceRef('svc.layout.fixed', { ids: missing.map((widget) => widget.id) }));
    return errors;
}

/** Problems with a proposed layout, in plain words, in `locale` (default English); an empty list means it can be saved. */
export function validateLayout(layout: unknown, locale: Locale = 'en'): string[] {
    return layoutProblems(layout).map((ref) => renderText(ref, locale));
}

/** The saved layout of the scope's generation (or the level template) and the widget library, its titles in `locale` (default: the request's). */
export async function getLayout(locale?: Locale, scope?: Scope): Promise<{ layout: string[]; library: Widget[]; saved: boolean }> {
    const s = scope ?? await currentScope();
    const library = widgetLibrary(locale ?? await getAppLocale());
    const { layout } = await readState(s);
    if (layout) {
        // A layout saved before a widget left the library keeps its other widgets; the removed id is dropped.
        const known = new Set(WIDGET_LIBRARY.map((widget) => widget.id));
        const ids = [...new Set(layout.widgets.map((widget) => widget.widget).filter((id) => known.has(id)))];
        // Saved before the Overview modules existed: nothing was hidden, so every one of them is still shown
        if (!layout.overview) ids.push(...WIDGET_LIBRARY.filter((widget) => widget.tab === 'overview' && !ids.includes(widget.id)).map((widget) => widget.id));
        return { layout: ids, library, saved: true };
    }
    const profile = await getProfile(s.profileUserId);
    return { layout: defaultLayout(profile?.level ?? 'Novice'), library, saved: false };
}

export async function putLayout(layout: unknown, scope?: Scope): Promise<{ layout: string[] }> {
    const errors = layoutProblems(layout);
    if (errors.length > 0) throw new ServiceError(400, serviceRef('svc.joined', { items: errors }));
    const ids = layout as string[];
    const tabOf = new Map(WIDGET_LIBRARY.map((widget) => [widget.id, widget.tab]));
    const count: Record<string, number> = {};
    await updateState(scope ?? await currentScope(), (state) => {
        state.layout = {
            widgets: ids.map((id) => {
                const tab = tabOf.get(id)!;
                count[tab] = (count[tab] ?? 0) + 1;
                return { slot: `${tab}-${count[tab]}`, widget: id };
            }),
            updatedAt: new Date().toISOString(),
            overview: true,
        };
    });
    return { layout: ids };
}
