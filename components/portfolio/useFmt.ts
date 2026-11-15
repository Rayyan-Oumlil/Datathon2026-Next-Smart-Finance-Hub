'use client';

import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { Sourced } from '@/lib/domain/types';
import { cad, errorText, money, share, signed, signedCad, signedPct, sourceLine, units, when } from './logic';

/** The Portfolio tab's formatters bound to the active language, plus its generic error wording. */
export function useFmt() {
    const locale = useLocale();
    const t = useTranslations('Portfolio');
    return useMemo(() => ({
        locale,
        money: (value: number) => money(value, locale),
        signed: (value: number) => signed(value, locale),
        units: (value: number) => units(value, locale),
        cad: (value: number) => cad(value, locale),
        signedCad: (value: number) => signedCad(value, locale),
        share: (value: number) => share(value, locale),
        signedPct: (value: number) => signedPct(value, locale),
        when: (iso: string) => when(iso, locale),
        sourceLine: (sourced: Pick<Sourced<unknown>, 'source' | 'asOf' | 'fetchedAt'>) => sourceLine(sourced, locale, t),
        error: (failure: unknown) => errorText(failure, t),
    }), [locale, t]);
}
