import { z } from 'zod';
import { LOCALES } from '@/i18n/config';
import { loadMessages } from '@/i18n/messages';
import { internalTool } from '@/lib/agent/internal';
import { getLayout, widgetLibrary } from '@/lib/services/layout';

// locale: the agent's reply language, so the widget titles reach the model as the Portfolio tab shows them
export const POST = internalTool(z.object({ locale: z.enum(LOCALES).optional() }), async ({ locale }, _actionId, scope) => {
    const { layout, library } = await getLayout('en', scope);
    const messages = locale && locale !== 'en' ? ((await loadMessages(locale).catch(() => ({}))) as { Portfolio?: { modules?: Record<string, string> } }) : {};
    const titles = messages.Portfolio?.modules ?? {};
    // Overview panel titles are not in the Portfolio messages: the library's own title in the language
    const own = new Map(widgetLibrary(locale ?? 'en').map((widget) => [widget.id, widget.title]));
    return {
        current: layout,
        hidden: library.filter((widget) => !layout.includes(widget.id)).map((widget) => widget.id),
        library: library.map((widget) => ({ ...widget, title: titles[widget.id] ?? own.get(widget.id) ?? widget.title })),
        note: 'A layout is the ordered list of the widget ids that are shown. A widget left out of the list is hidden; a widget of the library added to the list is shown. Fixed widgets must stay in the list. Every widget is available at every level. Each widget has a tab: portfolio widgets are drawn in the list order; overview widgets (ids starting with overview_) are panels of the Overview page, shown when they are in the list and hidden when left out (their order on the page is fixed). To hide a panel, send the current list without its id and with every other id unchanged; to bring it back, add its id again.',
    };
});
