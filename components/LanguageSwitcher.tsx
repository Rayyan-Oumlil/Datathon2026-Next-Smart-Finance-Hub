'use client';

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Languages, Loader2 } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LOCALES, LOCALE_NAMES, isLocale } from "@/i18n/config";
import { setLocale } from "@/lib/actions/locale.actions";
import { cn } from "@/lib/utils";

// Saves the choice in the locale cookie, then re-renders the page on the server in that language.
function useSwitchLocale() {
    const locale = useLocale();
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const change = (next: string) => {
        if (next === locale || !isLocale(next)) return;
        startTransition(async () => {
            await setLocale(next);
            router.refresh();
        });
    };
    return { locale, pending, change };
}

// Sidebar entry. Language names stay in their own language so anyone can find theirs.
export default function LanguageSwitcher({ className }: { className?: string }) {
    const t = useTranslations('Language');
    const { locale, pending, change } = useSwitchLocale();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger disabled={pending} aria-label={t('switchLabel')} className={cn('side-item h-8 w-full text-start outline-none', className)}>
                {pending ? <Loader2 className="animate-spin" /> : <Languages />}
                <span className="flex-1">{t('label')}</span>
                <span className="text-xs text-faint" lang={locale}>{LOCALE_NAMES[locale]}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-(--radix-dropdown-menu-trigger-width)">
                <DropdownMenuRadioGroup value={locale} onValueChange={change}>
                    {LOCALES.map((code) => (
                        <DropdownMenuRadioItem key={code} value={code} lang={code}>
                            {LOCALE_NAMES[code]}
                        </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

// Two buttons, English | Français, for pages outside the app shell (onboarding). Needs a
// NextIntlClientProvider above it, which the root layout provides.
export function LanguageToggle({ className }: { className?: string }) {
    const t = useTranslations('Language');
    const { locale, pending, change } = useSwitchLocale();

    return (
        <div role="group" aria-label={t('switchLabel')} aria-busy={pending || undefined} className={cn('inline-flex items-center gap-1 text-[12px]', className)}>
            {LOCALES.map((code) => (
                <button
                    key={code}
                    type="button"
                    lang={code}
                    aria-pressed={code === locale}
                    disabled={pending}
                    onClick={() => change(code)}
                    className={cn('rounded-md px-2 py-1 outline-none', code === locale ? 'bg-hover font-semibold text-foreground' : 'text-faint hover:text-foreground')}
                >
                    {LOCALE_NAMES[code]}
                </button>
            ))}
        </div>
    );
}
