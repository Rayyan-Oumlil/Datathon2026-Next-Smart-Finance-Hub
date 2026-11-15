import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Pencil, RotateCcw } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Panel from '@/components/Panel';
import History from '@/components/profile/History';
import ProfileModules from '@/components/profile/ProfileModules';
import { ruleBands } from '@/components/profile/rule-bands';
import { describeAnswers } from '@/components/onboarding/labels';
import { formatDateTime } from '@/i18n/format';
import { getAppLocale } from '@/i18n/locale';
import { getProfile } from '@/lib/services/profile';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
    const profile = await getProfile();
    if (!profile) redirect('/onboarding');
    const t = await getTranslations('Profile');
    const to = await getTranslations('Onboarding');
    const locale = await getAppLocale();

    return (
        <>
            <header className="page-head">
                <div>
                    <h1 className="page-title">{t('title')}</h1>
                    <p className="page-sub">
                        {t('subtitle')}
                    </p>
                </div>
            </header>

            <ProfileModules profile={profile} bands={ruleBands()} />

            <Panel
                title={t('answers.title')}
                sub={t('answers.subtitle', { levelRule: profile.ruleVersions.level, riskRule: profile.ruleVersions.risk, when: formatDateTime(profile.updatedAt, locale) })}
                action={(
                    <div className="flex flex-wrap justify-end gap-2">
                        <Link href="/onboarding?edit=1" className="btn btn-ghost"><Pencil aria-hidden /> {t('answers.edit')}</Link>
                        <Link href="/onboarding" className="btn btn-ghost"><RotateCcw aria-hidden /> {t('answers.startOver')}</Link>
                    </div>
                )}
                bodyClassName="p-4"
            >
                <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                    {describeAnswers(profile.answers, to, locale).map(({ question, answer }) => (
                        <div key={question} className="min-w-0">
                            <dt className="form-label">{question}</dt>
                            <dd className="mt-0.5 break-words text-[14px] text-foreground">{answer}</dd>
                        </div>
                    ))}
                </dl>
                <p className="mt-4 text-[12.5px] text-faint">
                    {t('answers.note')}
                </p>
            </Panel>

            <History />
        </>
    );
}
