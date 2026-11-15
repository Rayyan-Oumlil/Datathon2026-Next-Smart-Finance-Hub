'use client';

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, ChevronsUpDown, Clock, Compass, LayoutDashboard, ScrollText, Search, UserPlus, UserRound, Wallet } from "lucide-react";
import { openSearch } from "@/components/SearchCommand";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PERSONAS, type PersonaName } from "@/lib/personas/presets";
import { cn } from "@/lib/utils";

type SidebarProps = {
    user: User;
    /** The example or demo profile this browser is on, or null for an ordinary visitor. */
    persona?: PersonaName | null;
};

// The profiles the user chip can switch to, in menu order, with the address of each (lib/personas, app/u/[name])
const PROFILES: Array<{ name: PersonaName; href: string }> = [
    { name: 'novice', href: '/u/demo-novice' },
    { name: 'expert', href: '/u/demo-expert' },
    { name: 'amira', href: '/u/amira' },
    { name: 'mateo', href: '/u/mateo' },
    { name: 'robert', href: '/u/robert' },
];

// The three tabs of the dashboard (spec section 10). Portfolio is home.
const NAV = [
    { href: '/portfolio', label: 'portfolio', icon: Wallet },
    { href: '/overview', label: 'overview', icon: LayoutDashboard },
    { href: '/strategy', label: 'strategy', icon: Compass },
    { href: '/time-machine', label: 'timeMachine', icon: Clock },
    { href: '/profile', label: 'profile', icon: UserRound },
] as const;

const Sidebar = ({ user, persona = null }: SidebarProps) => {
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

            <div className="border-t border-line pt-3">
                {/* Switching profile is a full page load (plain links): the address sets the cookie and everything reloads */}
                <DropdownMenu>
                    <DropdownMenuTrigger aria-label={t('profiles.switchLabel', { name: user.name })} className="side-item h-auto w-full gap-2.5 px-1 py-1 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1">
                        <span className="grid size-8 flex-none place-items-center rounded-full bg-brand-soft text-[13px] font-bold text-brand-ink">
                            {user.name?.[0]?.toUpperCase() ?? '?'}
                        </span>
                        <span className="block min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{user.name}</span>
                        <ChevronsUpDown className="size-4 text-faint" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="top" align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-56">
                        {PROFILES.map(({ name, href }) => {
                            const preset = PERSONAS[name];
                            const current = name === persona;
                            return (
                                <DropdownMenuItem key={name} asChild>
                                    <a href={href} aria-current={current ? 'true' : undefined} className="items-start">
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate font-medium text-foreground">{preset.displayName}</span>
                                            <span className="block truncate text-[11.5px] text-faint">
                                                {t('profiles.meta', { level: preset.expectedLevel, risk: preset.expectedRisk })}
                                            </span>
                                        </span>
                                        {current && <Check className="mt-0.5 size-4 text-brand-ink" aria-hidden />}
                                    </a>
                                </DropdownMenuItem>
                            );
                        })}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild>
                            {/* Full page load on purpose (sets the profile cookie), so not next/link */}
                            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                            <a href="/u/new">
                                <UserPlus className="size-4" aria-hidden />
                                <span className="flex-1">{t('profiles.newVisitor')}</span>
                            </a>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </aside>
    );
};

export default Sidebar;
