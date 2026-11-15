'use client';

import { useLayoutEffect } from 'react';

// The root layout renders <html lang> from the request's locale. This keeps it right after a client
// navigation or a language switch, where React does not always re-apply attributes on <html>.
export default function HtmlLang({ locale }: { locale: string }) {
    useLayoutEffect(() => {
        document.documentElement.lang = locale;
    }, [locale]);
    return null;
}
