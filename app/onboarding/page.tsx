import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import OnboardingFlow, { type UniverseOptions } from '@/components/onboarding/OnboardingFlow';
import { LanguageToggle } from '@/components/LanguageSwitcher';
import { ruleBands } from '@/components/profile/rule-bands';
import { getProfile } from '@/lib/services/profile';
import { listNiches, listSectors, listThemes } from '@/lib/universe';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('Onboarding');
    return { title: t('title') };
}

// The same choices GET /api/universe/options serves, read directly since this page renders on the server
function universeOptions(): UniverseOptions {
    const niches: Record<string, string[]> = {};
    for (const { sector, niche } of listNiches()) (niches[sector] ??= []).push(niche);
    return {
        sectors: listSectors().map(({ sector, count }) => ({ name: sector, count })),
        niches,
        themes: [...listThemes().map(({ theme }) => theme), 'ESG'],
    };
}

// Outside the app shell. "?edit=1" re-opens the stored answers; anything else starts from a blank set.
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
    const { edit } = await searchParams;
    const profile = edit === '1' ? await getProfile() : null;
    const t = await getTranslations('Onboarding');

    return (
        <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-page px-3 py-6 sm:px-6">
            <div className="flex w-full max-w-[600px] items-baseline justify-between gap-3 px-1">
                <span className="text-[19px] font-bold tracking-[-0.03em] text-foreground">Next Smart Finance Hub</span>
                <div className="flex items-center gap-2">
                    <LanguageToggle />
                    <span className="pill">{t('simulationOnly')}</span>
                </div>
            </div>
            <div className="hatch w-full max-w-[600px]">
                <div className="card">
                    <OnboardingFlow options={universeOptions()} bands={ruleBands()} initial={profile?.answers} />
                </div>
            </div>
            <p className="max-w-[600px] px-1 text-center text-[12px] text-faint">
                {t('disclaimer')}
            </p>
        </main>
    );
}
