import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowRight, ChevronDown, History, ListChecks, ScrollText, ShieldCheck, UserRound } from 'lucide-react';
import { LanguageToggle } from '@/components/LanguageSwitcher';
import AuroraBackdrop from '@/components/motion/AuroraBackdrop';
import CountUp from '@/components/motion/CountUp';
import MotionStage from '@/components/motion/MotionStage';
import SmoothScroll from '@/components/motion/SmoothScroll';
import SpotlightCard from '@/components/motion/SpotlightCard';
import SplitHeading from '@/components/motion/SplitHeading';
import { getUniverse } from '@/lib/universe';
import ReplayIllustration from './ReplayIllustration';

const FEATURES = [
    { id: 'profile', icon: UserRound },
    { id: 'strategy', icon: ListChecks },
    { id: 'timeMachine', icon: History },
    { id: 'agent', icon: ScrollText },
] as const;
const FLOW = ['profile', 'portfolio', 'strategy', 'replay'] as const;

// The words after the first comma carry the brand gradient ("..., sans argent réel.")
function accentAfterComma(text: string): number[] {
    const words = text.split(/\s+/).filter(Boolean);
    const at = words.findIndex((w) => w.endsWith(','));
    return at < 0 ? [] : words.map((_, i) => i).filter((i) => i > at);
}

/** The first page a new visitor sees: what the product is, its four tools, and the way in (onboarding). */
export default async function Landing() {
    const t = await getTranslations('Landing');
    const universeCount = getUniverse().length;
    const title = t('hero.title');

    return (
        <div className="landing">
            <SmoothScroll />
            <MotionStage>
                <header className="landing-nav">
                    <Link href="/welcome" aria-label={t('nav.home')} className="text-[17px] font-bold tracking-[-0.03em] text-foreground sm:text-[19px]">
                        <span className="max-[380px]:hidden">Next </span>Smart <span className="text-brand-ink">Finance Hub</span>
                    </Link>
                    <div className="flex items-center gap-2">
                        <LanguageToggle />
                        <span className="pill is-brand max-sm:hidden"><ShieldCheck aria-hidden /> {t('nav.simulationOnly')}</span>
                    </div>
                </header>

                <section className="landing-hero">
                    <AuroraBackdrop />
                    <div className="landing-hero-copy">
                        <p data-hero className="pill is-brand w-fit">{t('hero.kicker')}</p>
                        <SplitHeading text={title} accentWords={accentAfterComma(title)} className="landing-title" />
                        <p data-hero className="landing-lead">{t('hero.lead')}</p>
                        <div data-hero className="flex flex-wrap items-center gap-3">
                            <Link href="/onboarding" className="btn btn-primary landing-cta">
                                {t('hero.cta')} <ArrowRight aria-hidden />
                            </Link>
                            <a href="#features" className="btn btn-ghost landing-cta">
                                {t('hero.secondary')} <ChevronDown aria-hidden />
                            </a>
                        </div>
                        <p data-hero className="text-[12.5px] text-faint">{t('hero.note')}</p>
                    </div>
                    <div data-hero className="landing-hero-visual">
                        <ReplayIllustration title={t('visual.title')} withLabel={t('visual.with')} withoutLabel={t('visual.without')} note={t('visual.note')} />
                    </div>
                </section>

                <section aria-label={t('stats.label')} className="landing-section">
                    <dl className="landing-stats">
                        <div data-reveal className="landing-stat">
                            <dt className="order-2">{t('stats.universe')}</dt>
                            <dd className="landing-stat-value"><CountUp value={universeCount} /></dd>
                        </div>
                        <div data-reveal className="landing-stat">
                            <dt className="order-2">{t('stats.steps')}</dt>
                            <dd className="landing-stat-value"><CountUp value={FLOW.length} duration={0.8} /></dd>
                        </div>
                        <div data-reveal className="landing-stat">
                            <dt className="order-2">{t('stats.preview')}</dt>
                            <dd className="landing-stat-value"><CountUp value={100} format="percent" /></dd>
                        </div>
                    </dl>
                </section>

                <section id="features" aria-labelledby="features-title" className="landing-section scroll-mt-6">
                    <div data-reveal className="landing-section-head">
                        <p className="kicker">{t('features.kicker')}</p>
                        <h2 id="features-title" className="landing-h2">{t('features.title')}</h2>
                    </div>
                    <ul className="landing-features">
                        {FEATURES.map(({ id, icon: Icon }) => (
                            <li key={id} data-reveal className="flex">
                                <SpotlightCard className="landing-feature">
                                    <span className="landing-feature-icon"><Icon aria-hidden /></span>
                                    <h3 className="text-[17px] font-bold tracking-[-0.02em] text-foreground">{t(`features.${id}.title`)}</h3>
                                    <p className="flex-1 text-[13.5px] leading-relaxed text-muted-foreground">{t(`features.${id}.body`)}</p>
                                    <span className="pill h-auto min-h-[22px] w-fit py-0.5 leading-tight">{t(`features.${id}.tag`)}</span>
                                </SpotlightCard>
                            </li>
                        ))}
                    </ul>
                </section>

                <section aria-labelledby="flow-title" className="landing-section">
                    <div data-reveal className="landing-section-head">
                        <p className="kicker">{t('flow.kicker')}</p>
                        <h2 id="flow-title" className="landing-h2">{t('flow.title')}</h2>
                    </div>
                    <ol className="landing-flow">
                        {FLOW.map((id, i) => (
                            <li key={id} data-reveal className="landing-flow-step">
                                <span className="landing-flow-num num" aria-hidden>{i + 1}</span>
                                <div className="min-w-0">
                                    <h3 className="text-[15px] font-bold text-foreground">{t(`flow.${id}.title`)}</h3>
                                    <p className="text-[13px] text-muted-foreground">{t(`flow.${id}.body`)}</p>
                                </div>
                            </li>
                        ))}
                    </ol>
                </section>

                <section aria-labelledby="cta-title" className="landing-section">
                    <div data-reveal className="landing-final">
                        <div>
                            <h2 id="cta-title" className="landing-h2 text-on-brand">{t('cta.title')}</h2>
                            <p className="mt-1 text-[14px] text-on-brand/85">{t('cta.body')}</p>
                        </div>
                        <Link href="/onboarding" className="btn landing-cta landing-final-btn">
                            {t('cta.button')} <ArrowRight aria-hidden />
                        </Link>
                    </div>
                </section>

                <footer className="landing-footer">
                    <p>{t('disclaimer')}</p>
                </footer>
            </MotionStage>
        </div>
    );
}
