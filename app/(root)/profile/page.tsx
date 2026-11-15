import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Pencil, RotateCcw } from 'lucide-react';
import Panel from '@/components/Panel';
import History from '@/components/profile/History';
import ProfileModules from '@/components/profile/ProfileModules';
import { ruleBands } from '@/components/profile/rule-bands';
import { describeAnswers } from '@/components/onboarding/labels';
import { getProfile } from '@/lib/services/profile';

export const dynamic = 'force-dynamic';

// A fixed zone so the server and the browser print the same text
const when = (iso: string) => new Date(iso).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto' });

export default async function ProfilePage() {
    const profile = await getProfile();
    if (!profile) redirect('/onboarding');

    return (
        <>
            <header className="page-head">
                <div>
                    <h1 className="page-title">Profile</h1>
                    <p className="page-sub">
                        Your level and risk profile, the answers behind them, and what the app has done with them. Simulation only.
                    </p>
                </div>
            </header>

            <ProfileModules profile={profile} bands={ruleBands()} />

            <Panel
                title="Your answers"
                sub={`Stored as given. Scored by rules ${profile.ruleVersions.level} and ${profile.ruleVersions.risk}. Last saved ${when(profile.updatedAt)} (Toronto time).`}
                action={(
                    <div className="flex flex-wrap justify-end gap-2">
                        <Link href="/onboarding?edit=1" className="btn btn-ghost"><Pencil aria-hidden /> Edit answers</Link>
                        <Link href="/onboarding" className="btn btn-ghost"><RotateCcw aria-hidden /> Start over</Link>
                    </div>
                )}
                bodyClassName="p-4"
            >
                <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                    {describeAnswers(profile.answers).map(({ question, answer }) => (
                        <div key={question} className="min-w-0">
                            <dt className="form-label">{question}</dt>
                            <dd className="mt-0.5 break-words text-[14px] text-foreground">{answer}</dd>
                        </div>
                    ))}
                </dl>
                <p className="mt-4 text-[12.5px] text-faint">
                    Editing re-runs both rules on the server and shows the result before and after. Starting over asks every question again;
                    your current profile stays in place until the new answers are saved.
                </p>
            </Panel>

            <History />
        </>
    );
}
