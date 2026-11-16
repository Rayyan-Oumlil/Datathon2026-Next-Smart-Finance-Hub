import type { Metadata } from "next";
import { Plus_Jakarta_Sans, IBM_Plex_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import {Toaster} from "@/components/ui/sonner";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Metadata');
  return { title: t('title'), description: t('description') };
}

// Every page reads the locale (cookie, then Accept-Language), so <html lang> is right on the first paint.
// The provider here also covers the pages outside the app shell, such as onboarding.
export default async function RootLayout({
                                       children,
                                   }: Readonly<{
    children: React.ReactNode;
}>) {
    const locale = await getLocale();
    return (
        <html lang={locale} suppressHydrationWarning>
            <body
                className={`${jakarta.variable} ${plexMono.variable} font-sans antialiased`}
            >
                <NextIntlClientProvider>
                    {children}
                    <Toaster position="top-center"/>
                </NextIntlClientProvider>
            </body>
        </html>
    );
}
