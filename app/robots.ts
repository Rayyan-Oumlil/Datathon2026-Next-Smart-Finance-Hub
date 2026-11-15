import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/seo/site';

// Cached a day instead of rendered per hit. Regenerated at runtime, so a Docker build without
// APP_URL picks up the real origin within a day.
export const revalidate = 86400;

export default function robots(): MetadataRoute.Robots {
    const origin = siteUrl();
    return {
        rules: {
            userAgent: '*',
            allow: ['/', '/s', '/s/', '/compare', '/compare/'],
            disallow: [
                '/api/',
                '/dashboard',
                '/stocks',
                '/stocks/',
            ],
        },
        sitemap: `${origin}/sitemap.xml`,
        host: origin,
    };
}
