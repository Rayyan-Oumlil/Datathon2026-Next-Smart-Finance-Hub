import type { NextRequest } from 'next/server';
import { requestLocale, respond } from '@/lib/services/http';
import { renderText, serviceRef } from '@/lib/services/text';
import { listNiches, listSectors, listThemes } from '@/lib/universe';

// The choices onboarding offers: sectors and niches of the candidate list, and the themes (ESG is the demo tag).
// Names are the stable identifiers the profile stores; `label` / `themeLabels` give each in the request's language.
// Niches (GICS sub-industries) are the source's own English labels.
export const GET = (req: NextRequest) => respond(async () => {
    const locale = await requestLocale(req);
    const niches: Record<string, string[]> = {};
    for (const { sector, niche } of listNiches()) (niches[sector] ??= []).push(niche);
    const themes = [...listThemes().map(({ theme }) => theme), 'ESG'];
    return {
        sectors: listSectors().map(({ sector, count }) => ({ name: sector, count, label: renderText(serviceRef('svc.sector', { sector }), locale) })),
        niches,
        themes,
        themeLabels: Object.fromEntries(themes.map((theme) => [theme, renderText(serviceRef('svc.theme', { theme }), locale)])),
    };
}, req);
