# Data sources

What each source is used for, the exact endpoints called, whether a key is needed, what its terms allow, and how its values are labelled in the app. The code is in `lib/sources/`.

Endpoints were called from this machine on 2026-11-14 (evening, markets closed). Terms are quoted from the providers' pages as read on that date; the URL follows each quote. Where a page could not be read, that is said.

**The honest position:** this is a non-commercial datathon demo running in simulation. Three of the sources below (Finnhub free, TMX Money, Yahoo) only allow personal or non-commercial use, or forbid automated access. A real product would license a market-data vendor and TMX. No value is invented to cover a gap: what a provider does not give is listed as missing.

## How every value is stored and shown

Each value is a `Sourced` record (`lib/domain/types.ts`):

| Field | Meaning |
|---|---|
| `value`, `unit`, `currency` | the number or label, as the provider gave it or as we derived it |
| `source` | the label shown in the UI (see each section) |
| `endpoint` | the URL or query called. Never contains a key: the Finnhub key travels in a request header |
| `fetchedAt` | when we fetched it. A cached or stale value keeps the time of its real fetch |
| `asOf` | the provider's own date or time, when it gives one |
| `note` | what the field is, the formula for derived values, the conversion rate used, or that the provider failed at the last refresh |

Caching (`lib/sources/cache.ts`): quotes for 60 seconds; profiles, metrics, daily closes, yields, the exchange rate and news counts for 24 hours. In memory and on disk under `DATA_CACHE_DIR` or `.data/cache`. If a provider fails at refresh and an older value exists, the older value is returned with its original `fetchedAt` and a note saying so.

The daily snapshot (`lib/sources/daily-signals.ts`) is one file per Toronto day, `.data/cache/signals/YYYY-MM-DD.json`. If today's file does not exist, the newest earlier file is served and flagged stale.

## Finnhub

- **Used for:** US stocks and ETFs: last price and % change today, industry label, market cap, P/E, revenue growth, beta, 10-day average volume, number of headlines over 7 days.
- **Key:** yes, free key (`FINNHUB_API_KEY`), sent in the `X-Finnhub-Token` header.
- **Endpoints** (base `https://finnhub.io/api/v1`):
  - `/quote?symbol=AAPL`: `c` (last price), `dp` (% change), `t` (time of the last trade, used as `asOf`)
  - `/stock/profile2?symbol=AAPL`: `finnhubIndustry`, `marketCapitalization` (millions of the profile `currency`), `exchange`, `currency`
  - `/stock/metric?symbol=AAPL&metric=all`: `peTTM`, `revenueGrowthTTMYoy` (%), `beta`, `10DayAverageTradingVolume` (millions of shares)
  - `/company-news?symbol=AAPL&from=YYYY-MM-DD&to=YYYY-MM-DD`: headlines counted over the last 7 days
- **What it refuses on the free key (tested):** `.TO` quotes (HTTP 403, "You don't have access to this resource."), candles, ETF profile, index constituents. Interlisted Canadian names answer `profile2` by their US ticker (`RY` returns `RY.TO`, in CAD).
- **Limits:** "60 API calls/minute" (https://finnhub.io/pricing). "If your limit is exceeded, you will receive a response with status code 429. On top of all plan's limit, there is a 30 API calls/ second limit." (https://finnhub.io/docs/api/rate-limit). Our calls run one at a time, spaced a little over one second apart, and a 429 is retried once after the wait the provider asks for.
- **Terms** (https://finnhub.io/terms-of-service): "All plan listed on Finnhub website is strictly for personal use unless explicitly stated otherwise"; users "agree to not redistribute or share access to data or derived results"; "All data must be deleted should your subscription to that data ends."
  - Plainly: the free plan is for personal use only. Showing Finnhub numbers, or scores derived from them, to other people is not covered without Finnhub's written approval. No attribution clause exists.
- **Labels in the UI:** source "Finnhub" with the fetch time. Sector is shown as "Finnhub industry" because it is Finnhub's own classification, not GICS. The news count is shown on the card and never scored; news text is untrusted input.
- **Known gaps:** `/stock/profile2` answers `{}` for a fund (tested with SPY), so it is not called for ETFs. The `/quote` answer names no currency (the free key only prices US listings, so USD is recorded). The news endpoint appears to cap its answer (248 rows for AAPL over 7 days), so a very large count may be understated.

## TMX Money

- **Used for:** Canadian stocks and ETFs: price, % change, market cap, P/E, beta, 10-day average volume, sector, and about one year of daily closes (for the 1-year volatility and the 1-month sparkline). Also used as the fallback for US daily closes when Yahoo refuses (symbol form `AAPL:US`).
- **Key:** none. Undocumented: it is the data behind money.tmx.com.
- **Endpoint:** `POST https://app-money.tmx.com/graphql` with a browser User-Agent.
  - `getQuoteBySymbol(symbol: "RY", locale: "en")`: `price`, `percentChange`, `MarketCap` (in the listing currency, not millions), `peRatio`, `beta`, `averageVolume10D` (shares), `sector`, `issueType` (`CS` share, `ET` fund), `currency`
  - `getTimeSeriesData(symbol: "RY", freq: "day", start: "YYYY-MM-DD")`: `dateTime`, `close`; 251 rows for one year, newest first
  - `getCompanyPriceHistory` is not used: it is capped at 25 rows.
  - App symbols map as `RY.TO` -> `RY`, `BIP-UN.TO` -> `BIP.UN`.
- **Terms** (https://www.tmx.com/en/terms-of-use): TMX grants "a limited non-exclusive, non-transferable license to view and print the material on the Websites for your non-commercial or personal use only"; no republishing "without TMX's prior written permission"; "Market information is generally delayed 15 minutes or more."
  - Plainly: this is personal, non-commercial viewing of TMX's own site data through an interface TMX does not document or offer. It is not a licensed feed.
- **Labels in the UI:** source "TMX Money (delayed 15 min or more)". The response itself has no delay field and no timestamp on the quote, so the label carries the delay and `asOf` is empty for quotes. Sector is shown as "TMX Money sector" (its own classification, not GICS).
- **Known gaps:** no sector for ETFs (empty string, treated as absent). No revenue growth and no news: both are listed as missing for Canadian stocks. The P/E and market cap TMX reports for a fund are not used.

## Yahoo chart

- **Used for:** daily closes over one year for US stocks and ETFs (1-year volatility, sparkline), and gold (below). It can also quote symbols Finnhub cannot price.
- **Key:** none. Unofficial: there is no public Yahoo Finance API.
- **Endpoint:** `GET https://query1.finance.yahoo.com/v8/finance/chart/{SYMBOL}?range=1y&interval=1d` (and `range=5d` for a quote), with a browser User-Agent. Fields: `timestamp[]`, `indicators.quote[0].close[]`, `meta.currency`, `meta.regularMarketTime`, `meta.gmtoffset`.
- **Terms** (https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html): you may not "access or collect data… using any automated means, including but not limited to robots, spiders, scrapers, data mining tools… without our express, prior permission"; nor use data "to create any database, archive, mobile application, data feed, widget or any other aggregated data source"; no reuse "for any commercial purpose".
  - Plainly: automated use is forbidden without Yahoo's permission, which we do not have. If asked "is this source licensed?", the answer is no.
- **Reliability:** it rate-limits by address. On 2026-11-14 it answered HTTP 429 "Too Many Requests" to every call from this machine, for AAPL and for GC=F, during development and during the live check. The code asks once a day per symbol at most, stops asking after three refusals in a row within one collection, and falls back to TMX Money for US closes.
- **Labels in the UI:** source "Yahoo chart (unofficial)".

## Gold (Yahoo, COMEX futures)

- **Used for:** the gold reference card: price, % change, 1-year volatility, sparkline.
- **Endpoint:** the Yahoo chart endpoint above with symbol `GC=F` (front COMEX gold futures contract), in USD per troy ounce.
- **Terms and reliability:** the same as Yahoo chart. No free source was found that is both licensed and names its origin: gold-api.com is keyless and says "Commercial use of the API is always permitted" (https://gold-api.com/terms) but names neither its operator nor its sources; MetalCharts (named on the board) needs an account and allows "200 requests" a month on its free plan (https://metalcharts.org/api-pricing).
- **Labels in the UI:** source "Yahoo chart (unofficial), COMEX gold futures". It is a futures price, not spot.
- **State on 2026-11-14:** Yahoo refused every call, so gold came back with price, % change, volatility and closes all missing. Nothing is shown in their place.

## Bank of Canada Valet

- **Used for:** Government of Canada benchmark bond yields (reference cards), the USD/CAD rate used to convert Canadian market caps and traded values to USD before the cap and liquidity filters, and the policy rate.
- **Key:** none. Official.
- **Endpoints** (base `https://www.bankofcanada.ca/valet/observations`), each `/{series}/json?recent=5`, keeping the most recent observation of each series with its date:
  - `BD.CDN.2YR.DQ.YLD`, `BD.CDN.5YR.DQ.YLD`, `BD.CDN.10YR.DQ.YLD`, `BD.CDN.LONG.DQ.YLD`: benchmark bond yields, in percent
  - `FXUSDCAD`: Canadian dollars per US dollar, daily average
  - `V39079`: target for the overnight rate, in percent
- **Terms** (https://www.bankofcanada.ca/terms/, linked in every response): "Unless otherwise stated the copyright and any other rights in the contents of the material available through this website... are owned by the Bank of Canada." Users agree not to "Circumvent such limit or limits imposed by the Bank with respect to the number or frequency of requests made to a Bank Site, including the retrieval of financial data and information using Bank of Canada services (e.g., the Bank of Canada Valet API)." The specification (section 5.1) records the reuse clause as "freely use, copy, distribute and transmit", with attribution, a note if the content is changed, and no Bank logo.
- **Labels in the UI:** source "Bank of Canada" with the observation date. A yield is shown as a yield in percent, never as a price. Converted amounts say "converted from CAD at {rate} CAD per USD (Bank of Canada FXUSDCAD, {date})".

## Kraken

- **Used for:** BTC and ETH in CAD: last trade, % change, one year of daily closes. Crypto is offered to High-risk profiles only.
- **Key:** none ("Market data — Public endpoints — no API key needed", Kraken API documentation).
- **Endpoints** (base `https://api.kraken.com/0/public`):
  - `/Ticker?pair=XBTCAD` and `/Ticker?pair=ETHCAD`: `c[0]` (last trade), `o` (today's opening price, 00:00 UTC)
  - `/OHLC?pair=XBTCAD&interval=1440`: daily bars, 720 at most; `last` is the time of the last finished bar, and the bar still in progress is left out
- **Terms** (https://www.kraken.com/en-ca/legal/global-terms): forbids to "distribute or otherwise commercially exploit or make available to any third party Our Content". Whether that covers public API market data is unclear; no market-data licence or attribution clause was found.
- **Labels in the UI:** source "Kraken". The % change is computed by us from Kraken's last and open, and its note says "change since today's opening price (00:00 UTC)". The ticker carries no timestamp, so `asOf` is empty for quotes.

## Derived values

Computed by our code from the values above; source label "derived", with the inputs and formula in the note.

| Value | Formula | Inputs |
|---|---|---|
| 1-year volatility | sample standard deviation of daily simple returns x sqrt(252); absent with fewer than 20 daily returns (`rules/v1.json`, `filters.volatility`) | daily closes from Yahoo chart, TMX Money or Kraken; the note names which, with the first and last date and the number of returns |
| Market cap in USD | provider value; CAD amounts divided by FXUSDCAD | Finnhub `marketCapitalization` x 1,000,000, or TMX `MarketCap`; Bank of Canada rate |
| Average traded value per day, USD | 10-day average volume x last price; CAD amounts divided by FXUSDCAD | Finnhub or TMX volume and price; Bank of Canada rate |
| 1-month closes | the daily closes of the last calendar month | same as volatility |

The same sqrt(252) is applied to crypto, as the rule says, although crypto trades every day of the year.

## What is missing, by design

| Candidate | Not available | Why |
|---|---|---|
| Canadian stocks | revenue growth, news count | TMX Money does not give them; Finnhub refuses `.TO` |
| ETFs | market cap, P/E, revenue growth, sector | a fund has assets, not a company market cap or earnings |
| Crypto, gold | fundamentals, traded value | not applicable to the filters that apply to them |
| Gold | everything, whenever Yahoo refuses | no second source |
| US stocks | 1-year volatility, when both Yahoo and TMX Money refuse | Finnhub refuses candles on the free key |
