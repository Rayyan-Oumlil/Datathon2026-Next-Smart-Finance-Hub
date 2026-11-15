import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import HtmlLang from "@/components/HtmlLang";
import AppShell from "@/components/shell/AppShell";
import { searchStocks } from "@/lib/actions/finnhub.actions";
import { displayUser } from "@/lib/demo-user";
import { personaOfSession } from "@/lib/personas";
import { warmModelPortfolios } from "@/lib/services/model-portfolio";
import { getProfile } from "@/lib/services/profile";
import { getSession } from "@/lib/session";

// Every page under the shell reads the visitor's profile and live data: render per request, never at build time.
export const dynamic = 'force-dynamic';

const Layout = async ({ children }: { children: React.ReactNode }) => {
    // The replay snapshot and the suggested portfolios' figures load in the background on the first page of the process
    warmModelPortfolios();

    // The profile check and the shell's own data are read together; none of them depends on another
    const [profile, initialStocks, locale, session] = await Promise.all([
        getProfile(),
        searchStocks(),
        getLocale(),
        getSession(),
    ]);
    // The app needs a level and a risk profile before it can show anything
    if (!profile) redirect('/onboarding');

    return (
        <NextIntlClientProvider>
            <HtmlLang locale={locale} />
            <AppShell user={displayUser(session.sessionId)} persona={personaOfSession(session.sessionId)} initialStocks={initialStocks}>
                {children}
            </AppShell>
        </NextIntlClientProvider>
    )
}
export default Layout
