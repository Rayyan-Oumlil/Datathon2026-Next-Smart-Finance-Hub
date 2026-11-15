import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import HtmlLang from "@/components/HtmlLang";
import AppShell from "@/components/shell/AppShell";
import { searchStocks } from "@/lib/actions/finnhub.actions";
import { DEMO_USER } from "@/lib/demo-user";

const Layout = async ({ children }: { children: React.ReactNode }) => {
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
