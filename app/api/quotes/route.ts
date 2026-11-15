import { NextRequest, NextResponse } from "next/server";
import { DEMO_USER } from "@/lib/demo-user";
import { getLiveQuotes } from "@/lib/actions/finnhub.actions";
import { isRateLimited } from "@/lib/rate-limit";

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
    if (await isRateLimited(`quotes:user:${DEMO_USER.id}`, 300, 60, symbols.length)) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    return NextResponse.json(await getLiveQuotes(symbols), {
        headers: { "Cache-Control": "private, max-age=5" },
    });
}
