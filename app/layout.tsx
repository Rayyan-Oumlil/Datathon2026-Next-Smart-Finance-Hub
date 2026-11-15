import type { Metadata } from "next";
import { Plus_Jakarta_Sans, IBM_Plex_Mono, IBM_Plex_Sans_Arabic } from "next/font/google";
import {Toaster} from "@/components/ui/sonner";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
});

// The Latin display face has no Arabic glyphs. Only Arabic pages use this one (see globals.css),
// so it isn't preloaded on the rest.
const arabic = IBM_Plex_Sans_Arabic({
  variable: "--font-arabic",
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  preload: false,
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "AlphaForge — simulated investing with a traceable AI agent",
  description: "A profile-aware stock quotes demo. Every number shows its source and time. Simulation only: no real trades, no investment advice. Built on OpenStock (AGPL-3.0).",
};

export default function RootLayout({
                                       children,
                                   }: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body
                className={`${jakarta.variable} ${arabic.variable} ${plexMono.variable} font-sans antialiased`}
            >
                {children}
                <Toaster/>
            </body>
        </html>
    );
}
