'use client';

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Clock, Compass, LayoutDashboard, ScrollText, Search, UserRound, Wallet } from "lucide-react";
import { openSearch } from "@/components/SearchCommand";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { cn } from "@/lib/utils";

type SidebarProps = {
    user: User;
};

// The three tabs of the dashboard (spec section 10). Portfolio is home.
const NAV = [
    { href: '/portfolio', label: 'portfolio', icon: Wallet },
    { href: '/overview', label: 'overview', icon: LayoutDashboard },
    { href: '/strategy', label: 'strategy', icon: Compass },
    { href: '/time-machine', label: 'timeMachine', icon: Clock },
    { href: '/profile', label: 'profile', icon: UserRound },
] as const;

const Sidebar = ({ user }: SidebarProps) => {
    const t = useTranslations('Sidebar');
    const ts = useTranslations('Shell');
    const pathname = usePathname();

    return (
        <aside className="sidebar">
            <Link href="/portfolio" className="px-2 pt-1 pb-2 text-[19px] font-bold tracking-[-0.03em] text-foreground" aria-label={ts('logoLabel')}>
                Smart <span className="text-brand-ink">Finance Hub</span>
            </Link>

            <button type="button" onClick={openSearch} className="side-cta">
                <Search className="size-4" strokeWidth={2.5} />
                <span className="flex-1 text-start">{t('searchStocks')}</span>
                <kbd className="kbd bg-on-brand/10">⌘K</kbd>
            </button>

            <nav className="flex flex-col gap-0.5">
                {NAV.map(({ href, label, icon: Icon }) => (
                    <Link key={href} href={href} className={cn('side-item h-auto min-h-9 py-1.5 leading-tight', pathname === href && 'is-active')}>
                        <Icon /> <span className="min-w-0">{ts(`nav.${label}`)}</span>
                    </Link>
                ))}
            </nav>

            <div className="mt-auto flex flex-col gap-2">
                <Link href="/logs" className={cn('side-item', pathname === '/logs' && 'is-active')}>
                    <ScrollText /> {ts('nav.logs')}
                </Link>
                <p className="rounded-[11px] px-3 py-2.5 text-[12px] leading-snug text-faint shadow-[inset_0_0_0_1px_var(--line)]">
                    {ts('disclaimer')}
                </p>
                <LanguageSwitcher />
                <p className="px-2.5 text-[11.5px] text-faint">
                    {ts.rich('credit', {
                        link: (chunks) => <a href="https://github.com/Open-Dev-Society/OpenStock" target="_blank" rel="noreferrer" className="underline">{chunks}</a>,
                    })}
                </p>
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
