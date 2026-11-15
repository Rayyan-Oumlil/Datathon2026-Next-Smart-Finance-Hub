import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
    devIndicators: false,
    // One self-contained server folder, so the container image carries only what the app needs
    output: 'standalone',
    // Read at runtime by the watchlist pipeline and the stores; keep them in the standalone trace
    outputFileTracingIncludes: { '/**': ['./rules/**', './data/**'] },
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
