import { NextRequest, NextResponse } from "next/server";
import { getLiveQuotes } from "@/lib/actions/finnhub.actions";
import { clientIp, isRateLimited } from "@/lib/rate-limit";
import { requestLocale } from "@/lib/services/http";
import { renderText, serviceRef } from "@/lib/services/text";
import { getSession } from "@/lib/session";

const MAX_SYMBOLS = 25;
const SYMBOL_PATTERN = /^[A-Z0-9.:\-]{1,20}$/;

// Polled by on-screen prices. Capped, so polling cannot burn the Finnhub quota.
export async function GET(req: NextRequest) {
    const symbols = [...new Set(
        (req.nextUrl.searchParams.get("symbols") ?? "")
            .split(",")
            .map((s) => s.trim().toUpperCase())
            .filter((s) => SYMBOL_PATTERN.test(s)),
    )].slice(0, MAX_SYMBOLS);

    // Counted per symbol: unseen tickers each cost a Finnhub call. A 25-symbol watchlist polled every 15 s uses
    // about 100 a minute; the cap stops a runaway page from draining the key.
    // Per session, and per address since a new session is one cookie away
    const { sessionId } = await getSession(req);
    if (await isRateLimited(`quotes:session:${sessionId}`, 300, 60, symbols.length)
        || await isRateLimited(`quotes:ip:${clientIp(req)}`, 900, 60, symbols.length)) {
        return NextResponse.json({ error: renderText(serviceRef("svc.http.too_many", {}), await requestLocale(req)) }, { status: 429 });
    }

    return NextResponse.json(await getLiveQuotes(symbols), {
        headers: { "Cache-Control": "private, max-age=5" },
    });
}
