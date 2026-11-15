import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import LogsView from '@/components/logs/LogsView';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('Logs');
    return { title: t('metaTitle') };
}

// The raw journals of the visitor's own session: the agent action log and the decision log, read in the browser
// from /api/logs. Reached from the agent panel (each reply's timeline, and the link under the input).
export default async function LogsPage({ searchParams }: { searchParams: Promise<{ actionId?: string; tab?: string }> }) {
    const { actionId, tab } = await searchParams;
    const t = await getTranslations('Logs');
    return (
        <>
            <header className="page-head">
                <div>
                    <h1 className="page-title">{t('title')}</h1>
                    <p className="page-sub">{t('subtitle')}</p>
                </div>
            </header>
            <LogsView initialActionId={typeof actionId === 'string' ? actionId.slice(0, 60) : ''} initialTab={tab === 'decisions' ? 'decisions' : 'agent'} />
        </>
    );
}
