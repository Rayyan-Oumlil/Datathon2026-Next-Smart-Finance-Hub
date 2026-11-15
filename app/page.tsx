import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import Landing from '@/components/landing/Landing';
import { getProfile } from '@/lib/services/profile';

// Reads the visitor's session on every request
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('Landing');
    return { title: t('meta.title'), description: t('meta.description') };
}

// A visitor who already has a profile goes straight to the portfolio; a first-time visitor sees the landing page.
// The landing page itself stays reachable at /welcome.
export default async function Home() {
    const profile = await getProfile().catch(() => null);
    if (profile) redirect('/portfolio');
    return <Landing />;
}
