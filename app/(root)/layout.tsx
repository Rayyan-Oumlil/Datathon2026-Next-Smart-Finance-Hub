import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import HtmlLang from "@/components/HtmlLang";
import AppShell from "@/components/shell/AppShell";
import { searchStocks } from "@/lib/actions/finnhub.actions";
import { DEMO_USER } from "@/lib/demo-user";
import { getProfile } from "@/lib/services/profile";

// Every page under the shell reads the demo user's profile and live data: render per request, never at build time.
export const dynamic = 'force-dynamic';

const Layout = async ({ children }: { children: React.ReactNode }) => {
    // The app needs a level and a risk profile before it can show anything
    if (!(await getProfile())) redirect('/onboarding');

    const [initialStocks, locale] = await Promise.all([
        searchStocks(),
        getLocale(),
    ]);

    return (
        <NextIntlClientProvider>
            <HtmlLang locale={locale} />
            <AppShell user={DEMO_USER} initialStocks={initialStocks}>
                {children}
            </AppShell>
        </NextIntlClientProvider>
    )
}
export default Layout
