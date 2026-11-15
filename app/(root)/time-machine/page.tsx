import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import TimeMachine from '@/components/replay/TimeMachine';

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('Replay');
    return { title: t('page.metaTitle') };
}

const one = (value: string | string[] | undefined) => (typeof value === 'string' && value.length <= 60 ? value : undefined);

// « Machine à remonter le temps »: ?strategy=<id> preselects one of the visitor's strategies, ?replay=<id> opens a
// replay run earlier (a sensitivity variant or a compared scenario), ?mode=compare opens the comparison. Everything else is read from the app's own API in the browser.
export default async function TimeMachinePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const params = await searchParams;
    return <TimeMachine initialStrategyId={one(params.strategy)} replayId={one(params.replay)} initialMode={one(params.mode) === 'compare' ? 'compare' : undefined} />;
}
