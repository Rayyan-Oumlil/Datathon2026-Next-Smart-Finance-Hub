import { z } from 'zod';
import { internalTool } from '@/lib/agent/internal';
import { getLayout } from '@/lib/services/layout';

export const POST = internalTool(z.object({}), async () => {
    const { layout, library } = await getLayout();
    return {
        current: layout,
        hidden: library.filter((widget) => !layout.includes(widget.id)).map((widget) => widget.id),
        library,
        note: 'A layout is the ordered list of the widget ids that are shown. A widget left out of the list is hidden; a widget of the library added to the list is shown. Fixed widgets must stay in the list. minLevel is only the level whose starting layout holds the widget; any level may show any widget.',
    };
});
