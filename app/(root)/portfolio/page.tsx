import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import PortfolioBoard from '@/components/portfolio/PortfolioBoard';

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('Portfolio');
    return { title: t('metaTitle') };
}

// The home tab. Everything on it is read from the app's own API in the browser, so prices are never baked into the page.
export default function PortfolioPage() {
    return <PortfolioBoard />;
}
