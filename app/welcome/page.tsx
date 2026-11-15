import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Landing from '@/components/landing/Landing';

// The landing page for anyone, with or without a profile ("/" sends a visitor with a profile to the portfolio)
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('Landing');
    return { title: t('meta.title'), description: t('meta.description') };
}

export default function WelcomePage() {
    return <Landing />;
}
