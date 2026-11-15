import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// Builds the candidate universe: data/canada-tickers.json, data/universe.json and the resolved
// tags in data/esg-demo.json. Names, sectors and list sources only: no prices, no market caps.
//
//   node scripts/build-universe.mjs [--cache <file>]
//
// Inputs kept by hand: data/blue-chip-etfs.json, data/themes.json, the 'rules' of data/esg-demo.json.
// Input built elsewhere: data/us-tickers.json (scripts/build-us-tickers.mjs).
// Network: Wikipedia (2 calls), each fund's issuer page (1 call each), Finnhub profile2 (1 call per
// US ticker, about 10 minutes at the free-tier pace). --cache keeps the Finnhub answers in a file
// outside the repo so a re-run on the same day does not call Finnhub again.

const PER_SECTOR = 12;
const FINNHUB_GAP_MS = 1100;   // free tier: 60 calls a minute
const PAGE_GAP_MS = 3000;      // issuer sites block bursts
const UA = 'universe-builder/1.0 (one request per page)';

const dataUrl = (name) => new URL(`../data/${name}`, import.meta.url);
const readJson = (name) => JSON.parse(readFileSync(dataUrl(name), 'utf8'));
const writeJson = (name, value) => writeFileSync(dataUrl(name), JSON.stringify(value, null, 2) + '\n');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try { process.loadEnvFile(new URL('../.env', import.meta.url)); } catch { /* the key may already be in the environment */ }
const cacheArg = process.argv.indexOf('--cache');
const cachePath = cacheArg > 0 ? process.argv[cacheArg + 1] : null;

// ---------------------------------------------------------------- Canadian stocks (Wikipedia)

const WIKI_PAGE = 'S&P/TSX 60';
const WIKI_URL = 'https://en.wikipedia.org/wiki/S%26P/TSX_60';
const WIKI_API = 'https://en.wikipedia.org/w/api.php';

// HAND MAPPING. The Wikipedia table does not use GICS sector names. This table maps each label to
// the GICS sector name the US list uses, so both markets group under the same headings. It maps
// the label only: a company sits where Wikipedia's label puts it, which is not always where GICS
// itself files it (Wikipedia has Alimentation Couche-Tard under "Consumer Cyclical", for example).
const WIKI_SECTOR_TO_GICS = {
    'Basic Materials': 'Materials',
    'Communication Services': 'Communication Services',
    'Consumer Cyclical': 'Consumer Discretionary',
    'Consumer Staples': 'Consumer Staples',
    'Energy': 'Energy',
    'Financial Services': 'Financials',
    'Healthcare': 'Health Care',
    'Industrials': 'Industrials',
    'Information Technology': 'Information Technology',
    'Real Estate': 'Real Estate',
    'Technology': 'Information Technology',
    'Utilities': 'Utilities',
};

// 'RY' -> 'RY.TO', 'BBD.B' -> 'BBD-B.TO', 'BIP.UN' -> 'BIP-UN.TO'
const appSymbol = (tsxSymbol) => `${tsxSymbol.replace(/\./g, '-')}.TO`;

// '[[Agnico Eagle|Agnico Eagle Mines Limited]]' -> 'Agnico Eagle Mines Limited'
const plainText = (wikitext) => wikitext
    .replace(/<ref[^>]*\/>|<ref[\s\S]*?<\/ref>/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'{2,}/g, '')
    .trim();

async function getJson(url, headers = {}) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
    if (!res.ok) throw new Error(`${url} returned ${res.status}`);
    return res.json();
}

async function buildCanada(now) {
    const parseUrl = `${WIKI_API}?action=parse&page=${encodeURIComponent(WIKI_PAGE)}&prop=wikitext%7Crevid&format=json`;
    const parsed = (await getJson(parseUrl)).parse;
    const revisionId = parsed.revid;
    const wikitext = parsed.wikitext['*'];

    const revUrl = `${WIKI_API}?action=query&prop=revisions&revids=${revisionId}&rvprop=ids%7Ctimestamp&format=json`;
    const pages = Object.values((await getJson(revUrl)).query.pages);
    const revisionDate = pages[0]?.revisions?.[0]?.timestamp;
    if (!revisionDate) throw new Error(`No timestamp for Wikipedia revision ${revisionId}`);

    const start = wikitext.indexOf('== Constituents ==');
    if (start < 0) throw new Error('Wikipedia page has no "Constituents" section');
    const section = wikitext.slice(start, wikitext.indexOf('|}', start));
    const asOf = section.match(/\{\{As of\|(\d{4})\|(\d{1,2})\|(\d{1,2})/i);

    const tickers = [];
    for (const line of section.split('\n')) {
        const symbol = line.match(/^\|\s*\{\{TSX link\|([A-Z.]+)\}\}/)?.[1];
        if (!symbol) continue;
        const cells = line.split('||').map((cell) => cell.trim());
        if (cells.length < 3) throw new Error(`Unexpected table row: ${line}`);
        const wikipediaSector = plainText(cells[2]);
        const sector = WIKI_SECTOR_TO_GICS[wikipediaSector];
        if (!sector) throw new Error(`No hand mapping for Wikipedia sector "${wikipediaSector}" (${symbol})`);
        tickers.push({ symbol: appSymbol(symbol), tsxSymbol: symbol, name: plainText(cells[1]), wikipediaSector, sector });
    }
    if (tickers.length < 50 || tickers.length > 70) throw new Error(`Expected about 60 rows, parsed ${tickers.length}`);
    tickers.sort((a, b) => a.symbol.localeCompare(b.symbol));

    const source = {
        name: `Wikipedia, "${WIKI_PAGE}"`,
        url: WIKI_URL,
        permanentUrl: `https://en.wikipedia.org/w/index.php?title=S%26P/TSX_60&oldid=${revisionId}`,
        api: parseUrl,
        revisionId,
        revisionDate,
        tableAsOf: asOf ? `${asOf[1]}-${asOf[2].padStart(2, '0')}-${asOf[3].padStart(2, '0')}` : undefined,
        fetchedAt: now,
        licence: 'CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/). This derived list carries the same licence.',
        attribution: `Wikipedia contributors, "${WIKI_PAGE}", revision ${revisionId}`,
    };
    writeJson('canada-tickers.json', {
        generated: now,
        description: `Companies listed in Wikipedia's S&P/TSX 60 article at revision ${revisionId}. This is the article's table as a volunteer wrote it, not the index provider's constituent list.`,
        note: 'Changed from the source: symbols rewritten to the app form (RY -> RY.TO, CTC.A -> CTC-A.TO, BIP.UN -> BIP-UN.TO) and Wikipedia\'s sector label mapped by hand to a GICS sector name (sectorMapping). No sub-industry: the table has none. Regenerate with scripts/build-universe.mjs.',
        source,
        sectorMapping: { note: 'Hand mapping of Wikipedia\'s sector labels to GICS sector names. It maps the label, not the company.', map: WIKI_SECTOR_TO_GICS },
        tickers,
    });
    return { tickers, source };
}

// ---------------------------------------------------------------- funds (issuer pages)

const decodeHtml = (html) => html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\\u0026|&amp;/g, '&')
    .replace(/&#34;|&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&reg;|&trade;|[®™]/g, ' ')
    .replace(/&nbsp;|\s+/g, ' ');

// One request per fund: the page must answer 200 and name both the ticker and the index we list.
async function checkFunds(etfs) {
    const checks = [];
    for (const etf of etfs) {
        const ticker = etf.symbol.replace(/\.TO$/, '');
        const check = { symbol: etf.symbol, url: etf.issuerUrl, index: etf.index, checkedAt: new Date().toISOString() };
        try {
            const res = await fetch(etf.issuerUrl, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(30000) });
            check.httpStatus = res.status;
            if (res.url !== etf.issuerUrl) check.redirectedTo = res.url;
            const text = res.ok ? decodeHtml(await res.text()).toLowerCase() : '';
            const compact = (value) => value.toLowerCase().replace(/\s+/g, ' ');
            // "S&P 500 ® Index" on the page must still match "S&P 500 Index".
            check.namesIndex = text.replace(/\s+/g, ' ').includes(compact(etf.index));
            check.namesTicker = new RegExp(`\\b${ticker.toLowerCase()}\\b`).test(text);
            check.ok = res.ok && check.namesIndex && check.namesTicker;
        } catch (error) {
            check.error = error.cause?.code || error.name;
            check.ok = false;
        }
        checks.push(check);
        console.log(`fund ${etf.symbol}: ${check.ok ? 'verified' : 'DROPPED'} (status ${check.httpStatus ?? check.error}, index named ${check.namesIndex ?? '-'}, ticker named ${check.namesTicker ?? '-'})`);
        await sleep(PAGE_GAP_MS);
    }
    return checks;
}

// ---------------------------------------------------------------- US stocks (Finnhub rank)

async function fetchProfile(symbol, key) {
    const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}`;
    for (let attempt = 0; attempt < 5; attempt++) {
        // The key travels in a header so it never appears in a URL.
        const res = await fetch(url, { headers: { 'X-Finnhub-Token': key }, signal: AbortSignal.timeout(30000) });
        if (res.status === 429) { await sleep(15000 * (attempt + 1)); continue; }
        if (!res.ok) throw new Error(`Finnhub profile2 ${symbol} returned ${res.status}`);
        const body = await res.json();
        return { marketCap: body.marketCapitalization, currency: body.currency };
    }
    throw new Error(`Finnhub profile2 ${symbol}: still rate-limited after 5 tries`);
}

async function rankUsStocks(usTickers) {
    const today = new Date().toISOString().slice(0, 10);
    let cache = { date: today, profiles: {} };
    if (cachePath && existsSync(cachePath)) {
        const saved = JSON.parse(readFileSync(cachePath, 'utf8'));
        if (saved.date === today) cache = saved;
    }
    const key = process.env.FINNHUB_API_KEY;
    let calls = 0;
    for (const ticker of usTickers) {
        if (cache.profiles[ticker.symbol]) continue;
        if (!key) throw new Error('FINNHUB_API_KEY is not set');
        cache.profiles[ticker.symbol] = { ...(await fetchProfile(ticker.symbol, key)), fetchedAt: new Date().toISOString() };
        calls++;
        if (cachePath && calls % 20 === 0) writeFileSync(cachePath, JSON.stringify(cache));
        if (calls % 50 === 0) console.log(`Finnhub: ${calls} calls`);
        await sleep(FINNHUB_GAP_MS);
    }
    if (cachePath) writeFileSync(cachePath, JSON.stringify(cache));

    // One line per company: Alphabet, Fox and News Corp each list two share classes with the same
    // company market cap, which would take two of a sector's twelve places.
    const classACiks = new Set(usTickers.filter((t) => t.cik && /\(Class A\)/.test(t.name)).map((t) => t.cik));
    const notRanked = [];
    const bySector = new Map();
    for (const ticker of usTickers) {
        const profile = cache.profiles[ticker.symbol];
        let reason;
        if (classACiks.has(ticker.cik) && !/\(Class A\)/.test(ticker.name)) reason = 'second share class of a company already ranked by its Class A line';
        else if (!(profile.marketCap > 0)) reason = 'Finnhub profile2 returned no market cap';
        else if (profile.currency !== 'USD') reason = `Finnhub reports the market cap in ${profile.currency || 'an unnamed currency'}; no exchange rate is applied at build time, so it cannot be ranked against USD figures`;
        if (reason) { notRanked.push({ symbol: ticker.symbol, reason }); continue; }
        if (!bySector.has(ticker.sector)) bySector.set(ticker.sector, []);
        bySector.get(ticker.sector).push({ ticker, marketCap: profile.marketCap });
    }
    const kept = [];
    for (const rows of bySector.values()) {
        rows.sort((a, b) => b.marketCap - a.marketCap || a.ticker.symbol.localeCompare(b.ticker.symbol));
        kept.push(...rows.slice(0, PER_SECTOR).map((row) => row.ticker));
    }
    const times = Object.values(cache.profiles).map((p) => p.fetchedAt).sort();
    return { kept, notRanked, rankDate: today, firstFetch: times[0], lastFetch: times[times.length - 1], asked: usTickers.length };
}

// ---------------------------------------------------------------- assemble

const now = new Date().toISOString();
const usFile = readJson('us-tickers.json');
const etfFile = readJson('blue-chip-etfs.json');
const themeFile = readJson('themes.json');
const esgFile = readJson('esg-demo.json');

const canada = await buildCanada(now);
console.log(`Wikipedia: ${canada.tickers.length} rows at revision ${canada.source.revisionId} (${canada.source.revisionDate})`);
const fundChecks = await checkFunds(etfFile.etfs);
const us = await rankUsStocks(usFile.tickers);

const usSource = (ticker) => (ticker.indexes.includes('SP500')
    ? `datasets/s-and-p-500-companies constituents.csv (ODC-PDDL-1.0; itself taken from Wikipedia "List of S&P 500 companies", CC BY-SA 4.0), via data/us-tickers.json generated ${usFile.generated}`
    : `Wikipedia "List of NASDAQ-100 companies" (CC BY-SA 4.0; ICB industry mapped by hand to a GICS sector, sub-industry is Wikipedia's own label), via data/us-tickers.json generated ${usFile.generated}`)
    + `; kept as one of the ${PER_SECTOR} largest of its sector by Finnhub profile2 market cap on ${us.rankDate}`;

const entries = [
    ...us.kept.map((t) => ({
        symbol: t.symbol, name: t.name, assetClass: 'stock', market: 'US', sector: t.sector, subIndustry: t.subIndustry,
        listSource: usSource(t),
    })),
    ...canada.tickers.map((t) => ({
        symbol: t.symbol, name: t.name, assetClass: 'stock', market: 'Canada', sector: t.sector,
        listSource: `Wikipedia: S&P/TSX 60 article, rev ${canada.source.revisionId}, ${canada.source.revisionDate.slice(0, 10)} (CC BY-SA 4.0); sector "${t.wikipediaSector}" mapped by hand to "${t.sector}"`,
    })),
    ...etfFile.etfs.filter((etf) => fundChecks.find((c) => c.symbol === etf.symbol).ok).map((etf) => ({
        symbol: etf.symbol, name: etf.name, assetClass: 'etf', market: etf.market, blueChipEtf: etf.blueChipEtf,
        etf: { index: etf.index, issuerUrl: etf.issuerUrl },
        listSource: `Hand-kept list data/blue-chip-etfs.json; index as named on the issuer's page (${etf.issuer}), read ${fundChecks.find((c) => c.symbol === etf.symbol).checkedAt.slice(0, 10)}`,
    })),
    ...[['BTC', 'Bitcoin'], ['ETH', 'Ether']].map(([symbol, name]) => ({
        symbol, name, assetClass: 'crypto', market: 'none',
        listSource: 'Hand-set: rules/v1.json filters.asset_class_rules.crypto.assets',
    })),
    { symbol: 'GOLD', name: 'Gold', assetClass: 'gold', market: 'none', listSource: 'Hand-set: rules/v1.json filters.asset_class_rules.gold (reference card)' },
    ...[['CA2Y', '2-year', 'BD.CDN.2YR.DQ.YLD'], ['CA5Y', '5-year', 'BD.CDN.5YR.DQ.YLD'], ['CA10Y', '10-year', 'BD.CDN.10YR.DQ.YLD']].map(([symbol, term, series]) => ({
        symbol, name: `Government of Canada ${term} benchmark bond yield`, assetClass: 'bond_yield', market: 'none',
        listSource: `Hand-set: rules/v1.json filters.asset_class_rules.bond_yields (reference card); Bank of Canada Valet series ${series}`,
    })),
];

const bySymbol = new Map(entries.map((entry) => [entry.symbol, entry]));
if (bySymbol.size !== entries.length) throw new Error('Duplicate symbols in the universe');

// Themes: by sub-industry, then the symbols named one by one. A named symbol that is not in the
// universe stops the build so the hand list gets fixed rather than silently ignored.
for (const entry of entries) entry.themes = [];
const droppedFunds = new Set(fundChecks.filter((c) => !c.ok).map((c) => c.symbol));
for (const theme of themeFile.themes) {
    const subIndustries = new Set(theme.subIndustries.map((s) => s.name));
    for (const entry of entries) if (entry.subIndustry && subIndustries.has(entry.subIndustry)) entry.themes.push(theme.id);
    for (const { symbol } of theme.symbols) {
        if (droppedFunds.has(symbol)) continue;
        const entry = bySymbol.get(symbol);
        if (!entry) throw new Error(`data/themes.json: "${symbol}" (theme ${theme.id}) is not in the universe`);
        if (!entry.themes.includes(theme.id)) entry.themes.push(theme.id);
    }
}

// Mock ESG tag, from the hand-written rules in data/esg-demo.json.
const { controversy, notScreened } = esgFile.rules;
for (const symbol of controversy.symbols) {
    if (!bySymbol.has(symbol)) throw new Error(`data/esg-demo.json: controversy symbol "${symbol}" is not in the universe`);
}
for (const entry of entries) {
    if (controversy.symbols.includes(entry.symbol)) entry.esg = 'controversy';
    else if (notScreened.sectors.includes(entry.sector) || notScreened.subIndustries.includes(entry.subIndustry) || notScreened.assetClasses.includes(entry.assetClass)) entry.esg = 'not screened';
    else entry.esg = esgFile.rules.default;
}

const classOrder = ['stock', 'etf', 'crypto', 'gold', 'bond_yield'];
entries.sort((a, b) => classOrder.indexOf(a.assetClass) - classOrder.indexOf(b.assetClass)
    || a.market.localeCompare(b.market) || (a.sector || '').localeCompare(b.sector || '')
    || (a.assetClass === 'stock' || a.assetClass === 'etf' ? a.symbol.localeCompare(b.symbol) : 0));

// Field order of UniverseEntry, undefined fields left out.
const ordered = entries.map((e) => JSON.parse(JSON.stringify({
    symbol: e.symbol, name: e.name, assetClass: e.assetClass, market: e.market, sector: e.sector, subIndustry: e.subIndustry,
    themes: e.themes, esg: e.esg, blueChipEtf: e.blueChipEtf, etf: e.etf, listSource: e.listSource,
})));

esgFile.tags = Object.fromEntries(ordered.map((e) => [e.symbol, e.esg]).sort(([a], [b]) => a.localeCompare(b)));
writeJson('esg-demo.json', esgFile);

writeJson('universe.json', {
    generated: now,
    description: 'Candidate universe for the demo: which names can be considered at all, before any market data. No prices and no market caps are stored here. Regenerate with scripts/build-universe.mjs.',
    usRank: {
        rankDate: us.rankDate,
        method: `From data/us-tickers.json, the ${PER_SECTOR} largest names of each GICS sector by Finnhub /stock/profile2 marketCapitalization (USD millions). The figures are used once to cut the list and are not stored: market cap is fetched again as a live signal.`,
        profilesFetchedBetween: [us.firstFetch, us.lastFetch],
        tickersAsked: us.asked,
        notRanked: us.notRanked,
    },
    sources: [
        {
            id: 'us-tickers',
            name: 'data/us-tickers.json (S&P 500 and Nasdaq-100 names, GICS sector, sub-industry, SEC CIK)',
            url: 'https://raw.githubusercontent.com/datasets/s-and-p-500-companies/master/data/constituents.csv',
            alsoFrom: ['https://en.wikipedia.org/wiki/List_of_NASDAQ-100_companies', 'https://www.sec.gov/files/company_tickers_exchange.json'],
            date: usFile.generated,
            revision: 'not recorded by scripts/build-us-tickers.mjs: only the build date is known',
            licence: 'S&P 500 file: ODC-PDDL-1.0, taken from Wikipedia "List of S&P 500 companies" (CC BY-SA 4.0). Nasdaq-100 table: Wikipedia, CC BY-SA 4.0. SEC file: public, cite the SEC.',
            usedFor: 'US stocks: symbol, name, sector, sub-industry',
        },
        {
            id: 'finnhub-profile2',
            name: 'Finnhub /stock/profile2',
            url: 'https://finnhub.io/api/v1/stock/profile2',
            date: us.rankDate,
            licence: 'Finnhub free plan: personal use, no redistribution of data or derived results. Only the resulting choice of names is kept here, no Finnhub figure.',
            usedFor: `ranking US stocks by market cap to keep ${PER_SECTOR} per sector`,
        },
        {
            id: 'wikipedia-tsx60',
            name: canada.source.name,
            url: canada.source.permanentUrl,
            revision: canada.source.revisionId,
            date: canada.source.revisionDate,
            licence: canada.source.licence,
            attribution: canada.source.attribution,
            usedFor: `Canadian stocks: companies listed in Wikipedia's S&P/TSX 60 article at revision ${canada.source.revisionId} (see data/canada-tickers.json)`,
        },
        {
            id: 'issuer-pages',
            name: 'Fund issuers\' product pages (data/blue-chip-etfs.json)',
            url: 'data/blue-chip-etfs.json',   // one page per fund: listed there and in fundChecks
            date: now.slice(0, 10),
            licence: 'Each issuer\'s site terms. Only the fund name, the index it names and the page link are kept.',
            usedFor: 'funds: the index each fund tracks',
        },
        {
            id: 'hand-set',
            name: 'Hand-set for the demo: data/themes.json, data/esg-demo.json (mock), crypto, gold and bond-yield rows',
            url: 'rules/v1.json',
            date: now.slice(0, 10),
            licence: 'ours',
            usedFor: 'theme tags, the mock ESG tag, and the non-stock reference rows',
        },
    ],
    fundChecks,
    entries: ordered,
});

const count = (keyOf) => Object.entries(ordered.reduce((acc, e) => ({ ...acc, [keyOf(e)]: (acc[keyOf(e)] || 0) + 1 }), {})).map(([k, n]) => `${k} ${n}`).join(', ');
console.log(`Wrote ${ordered.length} entries. By class: ${count((e) => e.assetClass)}. By market: ${count((e) => e.market)}.`);
console.log(`Not ranked: ${us.notRanked.map((r) => r.symbol).join(', ') || 'none'}. Funds dropped: ${[...droppedFunds].join(', ') || 'none'}.`);
