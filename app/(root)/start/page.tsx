import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import StartView from '@/components/start/StartView';
import type { Locale } from '@/i18n/config';
import { getModelPortfolios } from '@/lib/services/model-portfolio';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('Start');
    return { title: t('metaTitle') };
}

// Step 2 of the flow (docs/v2-plan.md): the suggested portfolios for the visitor's risk profile, read from the
// versioned table in rules/v1.json (never from a model), each line with its reasons. Choosing one places it in the
// simulated portfolio through the normal trade path, then the visitor moves on to the strategy.
export default async function StartPage() {
    const locale = (await getLocale()) as Locale;
    const data = await getModelPortfolios(locale);
    return <StartView data={data} />;
}
