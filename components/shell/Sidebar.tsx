'use client';

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { BookOpen, Code2, Heart, Info, LayoutDashboard, LifeBuoy, Search } from "lucide-react";
import { openSearch } from "@/components/SearchCommand";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { cn } from "@/lib/utils";
import { SIDEBAR_SPONSOR_SLOTS, sidebarSponsors } from "@/lib/sponsors";

type SidebarProps = {
    user: User;
};

const RESOURCES = [
    { href: '/help', label: 'help', icon: LifeBuoy },
    { href: '/api-docs', label: 'apiDocs', icon: Code2 },
    { href: '/about', label: 'about', icon: Info },
    { href: '/terms', label: 'terms', icon: BookOpen },
] as const;

const Sidebar = ({ user }: SidebarProps) => {
    const t = useTranslations('Sidebar');
    const pathname = usePathname();
    const partners = sidebarSponsors();
    const openSlots = SIDEBAR_SPONSOR_SLOTS - partners.length;

    return (
        <aside className="sidebar">
            <Link href="/dashboard" className="px-2 pt-1 pb-2" aria-label={t('homeAria')}>
                <Image src="/assets/images/logo.png" alt="OpenStock" width={150} height={38} priority />
            </Link>

            <button type="button" onClick={openSearch} className="side-cta">
                <Search className="size-4" strokeWidth={2.5} />
                <span className="flex-1 text-start">{t('searchStocks')}</span>
                <kbd className="kbd bg-on-brand/10">⌘K</kbd>
            </button>

            <nav className="flex flex-col gap-0.5">
                <Link href="/dashboard" className={cn('side-item', pathname === '/dashboard' && 'is-active')}>
                    <LayoutDashboard /> {t('overview')}
                </Link>
            </nav>

            <div className="mt-auto flex flex-col gap-0.5">
                {RESOURCES.map(({ href, label, icon: Icon }) => (
                    <Link key={href} href={href} className={cn('side-item h-8', pathname === href && 'is-active')}>
                        <Icon /> {t(`resources.${label}`)}
                    </Link>
                ))}
                <button
                    type="button"
                    onClick={() => window.dispatchEvent(new CustomEvent('open-donate-popup'))}
                    className="side-item h-8 text-start"
                >
                    <Heart /> {t('support')}
                </button>
                <LanguageSwitcher />
            </div>

            <div className="flex flex-col gap-1.5">
                {partners.map((sponsor) => (
                    <a key={sponsor.name} href={sponsor.url} target="_blank" rel="noreferrer" title={sponsor.name} className="flex h-11 items-center gap-2.5 rounded-[11px] px-3 shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:bg-white/5">
                        {sponsor.logo && <img src={sponsor.logo} alt={sponsor.iconOnly ? '' : sponsor.name} className="h-5 w-auto max-w-[120px]" />}
                        {(!sponsor.logo || sponsor.iconOnly) && <span className="truncate text-[13px] font-semibold text-muted-foreground">{sponsor.name}</span>}
                        <span className="kicker ms-auto">{t('sponsor')}</span>
                    </a>
                ))}
                {openSlots > 0 && (
                    <Link href="/sponsor#tiers" className="group flex flex-col gap-0.5 rounded-[11px] px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:bg-white/5">
                        <span className="kicker flex items-center gap-1.5 text-brand-ink">
                            <span className="live-dot" /> {openSlots === SIDEBAR_SPONSOR_SLOTS ? t('sponsorSlotsOpen') : t('sponsorSlotsLeft', { count: openSlots })}
                        </span>
                        <span className="text-[12.5px] text-faint transition-colors group-hover:text-muted-foreground">{t('sponsorPitch')}</span>
                    </Link>
                )}
            </div>

            <div className="flex items-center gap-2.5 border-t border-line pt-3 px-1">
                <span className="grid size-8 flex-none place-items-center rounded-full bg-brand-soft text-[13px] font-bold text-brand-ink">
                    {user.name?.[0]?.toUpperCase() ?? '?'}
                </span>
                <span className="block min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{user.name}</span>
            </div>
        </aside>
    );
};

export default Sidebar;
