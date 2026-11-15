'use client';

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { MARKETS, MARKET_COOKIE, type MarketId } from "@/lib/markets";
import { cn } from "@/lib/utils";

// Market chips for the dashboard. The choice is remembered in a cookie so the server renders it next time.
// A chip is a filter on the same page: it never scrolls (scroll={false}), and the panels of the market on screen stay
// until the new ones are ready.
export default function MarketSwitcher({ active, openIds }: { active: MarketId; openIds: MarketId[] }) {
    const t = useTranslations('MarketSwitcher');
    const tm = useTranslations('Markets');
    // The chip just pressed is marked at once, before the server has answered; it holds until the market on screen changes
    const [pressed, setPressed] = useState<{ id: MarketId; from: MarketId } | null>(null);
    const pending = pressed && pressed.from === active && pressed.id !== active ? pressed.id : null;
    const remember = (id: MarketId, event: React.MouseEvent) => {
        document.cookie = `${MARKET_COOKIE}=${id}; path=/; max-age=31536000; samesite=lax`;
        // A click that opens another tab or window changes nothing here
        if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) setPressed({ id, from: active });
    };

    return (
        <nav aria-label={t('label')} aria-busy={pending !== null} className="flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
            {MARKETS.map((m) => {
                const selected = m.id === (pending ?? active);
                const open = openIds.includes(m.id);
                return (
                    <Link
                        key={m.id}
                        href={`/overview?market=${m.id}`}
                        scroll={false}
                        onClick={(event) => remember(m.id, event)}
                        aria-current={selected ? 'page' : undefined}
                        className={cn(
                            'flex h-9 flex-none items-center gap-2 rounded-full px-3.5 text-[13.5px] font-semibold transition-[background-color,color,box-shadow] duration-150',
                            selected
                                ? 'bg-brand-soft text-brand-ink shadow-[inset_0_0_0_1px_oklch(0.8_0.13_176/0.45)]'
                                : 'text-muted-foreground shadow-[inset_0_0_0_1px_var(--line)] hover:bg-hover hover:text-foreground',
                        )}
                    >
                        <span className={cn('size-1.5 rounded-full', open ? 'bg-up' : 'bg-line-strong')} title={open ? t('openNow') : t('closedNow')} />
                        {tm(`names.${m.id}`)}
                    </Link>
                );
            })}
        </nav>
    );
}
