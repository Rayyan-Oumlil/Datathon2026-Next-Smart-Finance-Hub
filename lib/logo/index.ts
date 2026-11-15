// One entry point for the logo route: which image URL belongs to a symbol, and its bytes, cached.
// Source: the `logo` field of Finnhub /stock/profile2 (read through finnhub.profile(), cached 24 h).

import * as finnhub from '@/lib/sources/finnhub';
import { HttpError } from '@/lib/sources/http';
import { getEntry } from '@/lib/universe';
import { fetchLogoImage, LogoRefused } from './fetch-image';
import { isFresh, readLogoEntry, writeLogoEntry, type LogoEntry } from './store';
import { CLASSES_WITHOUT_REMOTE_LOGO } from './symbol';

export { normalizeLogoSymbol } from './symbol';
export type { LogoEntry, LogoHit, LogoMiss } from './store';

const FINNHUB_LOGO_BASE = 'https://static2.finnhub.io/file/publicdatany/finnhubimage/stock_logo/';
const sameTicker = (a: string, b: string) => a.toUpperCase().replace(/-/g, '.') === b.toUpperCase().replace(/-/g, '.');

// First meaningful word of a company name: 'Shopify Inc.' -> 'shopify', 'The Toronto-Dominion Bank' -> 'toronto'
const LEGAL_WORDS = new Set(['the', 'inc', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited', 'plc', 'group', 'holdings']);
const firstWord = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').find((w) => w && !LEGAL_WORDS.has(w)) ?? '';
const sameCompany = (a?: string, b?: string) => !!a && !!b && firstWord(a) !== '' && firstWord(a) === firstWord(b);

class NoLogo extends Error {
    constructor(message: string, public transient = false) {
        super(message);
    }
}

/** The image URL Finnhub gives for this symbol. Throws NoLogo when there is none. */
async function logoUrlFor(symbol: string): Promise<string> {
    const entry = getEntry(symbol);
    if (entry && CLASSES_WITHOUT_REMOTE_LOGO.has(entry.assetClass)) throw new NoLogo(`${entry.assetClass} has a drawn mark`);
    // Finnhub's free key answers /stock/profile2 with {} for a fund (tested with SPY): no call is spent on it
    if (entry?.assetClass === 'etf') throw new NoLogo('Finnhub has no fund profile on the free key');

    // Toronto listings: the free key refuses .TO symbols, so the base ticker is asked. An interlisted name answers
    // with its Toronto profile ('RY' returns 'RY.TO') or its US listing ('SHOP' returns Shopify on NASDAQ, kept
    // because the names match). A base ticker that is another company ('T' is AT&T, not TELUS) is not used.
    const isToronto = symbol.endsWith('.TO');
    const asked = isToronto ? symbol.slice(0, -3).replace(/-/g, '.') : symbol;

    let profile: finnhub.FinnhubProfile;
    try {
        profile = await finnhub.profile(asked);
    } catch (e) {
        const definitive = (e instanceof HttpError && (e.status === 403 || e.status === 404)) || (e instanceof Error && /has no profile/.test(e.message));
        throw new NoLogo(e instanceof Error ? e.message : String(e), !definitive);
    }
    const ticker = profile.ticker ?? '';
    if (isToronto && !sameTicker(ticker, symbol) && !sameCompany(profile.name, entry?.name)) {
        throw new NoLogo(`${asked} answers as ${ticker || 'nothing'} (${profile.name ?? 'no name'}), not ${symbol}`);
    }

    // A profile cached before the logo field was read has no `logo` key: Finnhub names its files by its own ticker
    const url = 'logo' in profile ? profile.logo : ticker ? `${FINNHUB_LOGO_BASE}${encodeURIComponent(ticker)}.png` : '';
    if (!url) throw new NoLogo('Finnhub profile has no logo');
    return url;
}

async function load(symbol: string): Promise<LogoEntry> {
    const storedAt = new Date().toISOString();
    try {
        const url = await logoUrlFor(symbol);
        const image = await fetchLogoImage(url);
        return { kind: 'hit', symbol, contentType: image.contentType, bytes: image.bytes, storedAt, sourceUrl: image.url };
    } catch (e) {
        const transient = e instanceof NoLogo ? e.transient : e instanceof LogoRefused ? !e.definitive : true;
        return { kind: 'miss', symbol, storedAt, transient, reason: e instanceof Error ? e.message : String(e) };
    }
}

const inFlight = new Map<string, Promise<LogoEntry>>();

/** The cached entry when it is still fresh, without any network call; null when a fetch would be needed. */
export async function cachedLogo(symbol: string): Promise<LogoEntry | null> {
    const entry = await readLogoEntry(symbol);
    return entry && isFresh(entry) ? entry : null;
}

/**
 * The logo for an upper-cased symbol (see normalizeLogoSymbol). Fresh cache first; otherwise one fetch per symbol
 * at a time. If the refresh of an expired image fails, the old image is kept rather than lost.
 */
export async function getLogo(symbol: string): Promise<LogoEntry> {
    const held = await readLogoEntry(symbol);
    if (held && isFresh(held)) return held;

    let pending = inFlight.get(symbol);
    if (!pending) {
        pending = (async () => {
            const fresh = await load(symbol);
            if (fresh.kind === 'miss' && fresh.transient && held?.kind === 'hit') return held;
            await writeLogoEntry(fresh);
            return fresh;
        })().finally(() => inFlight.delete(symbol));
        inFlight.set(symbol, pending);
    }
    return pending;
}
