import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import StrategyBuilder from '@/components/strategy/StrategyBuilder';

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('Strategy');
    return { title: t('metaTitle') };
}

// The manual strategy builder. Strategies, the portfolio and every check are read from the app's own API in the browser.
export default function StrategyPage() {
    return (
        <Suspense>
            <StrategyBuilder />
        </Suspense>
    );
}
