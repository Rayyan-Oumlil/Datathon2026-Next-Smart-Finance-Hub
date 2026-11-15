import { z } from 'zod';
import { LOCALES } from '@/i18n/config';
import { loadMessages } from '@/i18n/messages';
import { internalTool } from '@/lib/agent/internal';
import { getLayout } from '@/lib/services/layout';

// locale: the agent's reply language, so the widget titles reach the model as the Portfolio tab shows them
export const POST = internalTool(z.object({ locale: z.enum(LOCALES).optional() }), async ({ locale }) => {
    const { layout, library } = await getLayout();
    const messages = locale && locale !== 'en' ? ((await loadMessages(locale).catch(() => ({}))) as { Portfolio?: { modules?: Record<string, string> } }) : {};
    const titles = messages.Portfolio?.modules ?? {};
    return {
        current: layout,
        hidden: library.filter((widget) => !layout.includes(widget.id)).map((widget) => widget.id),
        library: library.map((widget) => ({ ...widget, title: titles[widget.id] ?? widget.title })),
        note: 'A layout is the ordered list of the widget ids that are shown. A widget left out of the list is hidden; a widget of the library added to the list is shown. Fixed widgets must stay in the list. minLevel is only the level whose starting layout holds the widget; any level may show any widget.',
    };
});
