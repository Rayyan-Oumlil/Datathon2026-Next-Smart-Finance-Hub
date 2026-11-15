import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requestLocale, respond } from '@/lib/services/http';
import { getLayout, putLayout } from '@/lib/services/layout';

export const dynamic = 'force-dynamic';

// Widget titles follow the request's language.
export const GET = (req: NextRequest) => respond(async () => {
    const { layout, library } = await getLayout(await requestLocale(req));
    return { layout, library: library.map(({ id, title, tab, fixed }) => ({ id, title, tab, fixed })) };
}, req);

export const PUT = (req: NextRequest) => respond(async () => {
    const { layout } = z.object({ layout: z.array(z.string().max(40)).max(40) }).parse(await req.json());
    return putLayout(layout);
}, req);
