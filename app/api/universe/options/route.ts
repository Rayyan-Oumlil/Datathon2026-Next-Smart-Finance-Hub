import { respond } from '@/lib/services/http';
import { listNiches, listSectors, listThemes } from '@/lib/universe';

// The choices onboarding offers: sectors and niches of the candidate list, and the themes (ESG is the demo tag).
export const GET = () => respond(async () => {
    const niches: Record<string, string[]> = {};
    for (const { sector, niche } of listNiches()) (niches[sector] ??= []).push(niche);
    return {
        sectors: listSectors().map(({ sector, count }) => ({ name: sector, count })),
        niches,
        themes: [...listThemes().map(({ theme }) => theme), 'ESG'],
    };
});
