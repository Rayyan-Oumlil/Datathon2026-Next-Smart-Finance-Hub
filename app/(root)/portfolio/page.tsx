import type { Metadata } from 'next';
import PortfolioBoard from '@/components/portfolio/PortfolioBoard';

export const metadata: Metadata = { title: 'Portfolio (simulated)' };

// The home tab. Everything on it is read from the app's own API in the browser, so prices are never baked into the page.
export default function PortfolioPage() {
    return <PortfolioBoard />;
}
