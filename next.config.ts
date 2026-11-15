import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
    devIndicators: false,
    // One self-contained server folder, so the container image carries only what the app needs
    output: 'standalone',
    // Read at runtime by the watchlist pipeline, the stores and the translation loader (i18n/messages.ts);
    // keep them in the standalone trace
    outputFileTracingIncludes: { '/**': ['./rules/**', './data/**', './messages/**'] },
    // Files under public/assets are not fingerprinted: a day of caching, then served while refetched for a week.
    // (/_next/static is fingerprinted and already immutable; the logo route sets its own headers.)
    async headers() {
        return [{
            source: '/assets/:path*',
            headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }],
        }];
    },
    async redirects() {
        return [{ source: '/dashboard', destination: '/overview', permanent: false }];
    },
    turbopack: {
        root: process.cwd(),
    },
    // No remote images: every next/image src is a local file. Allowing a public upload host here (i.ibb.co was)
    // lets anyone feed files to the image optimizer on self-hosted servers.
    eslint: {
        ignoreDuringBuilds: true,
    },
    typescript: {
        ignoreBuildErrors: true,
    }
};

export default withNextIntl(nextConfig);
