# Specification — profile-aware stock quotes app with a traceable AI agent

Written from the two boards in this folder and the build brief, on 2026-11-14.

- **T** = `Tech-stack-documentation.png` (newer; wins on any conflict)
- **F** = `OpenStock-flow.png` (design board; older)
- **B** = the build brief

Every threshold, weight and point value lives in [`rules/v1.json`](../rules/v1.json). This file describes behaviour; it does not repeat the numbers except where needed to read a rule.

How the boards were read: each board was cut into overlapping tiles at 2× zoom, transcribed by one reader and re-read by a second reader who looked only for wrong numbers, symbols and missing rows. The second reader found no wrong value. Section 12 of T (rule values) was read a third time by hand.

---

## 1. Purpose and limits

A datathon demo about AI for investment decisions, judged by a bank and AWS. The thing being graded is that every number and every suggestion can be traced to its source and defended.

- The app runs entirely in simulation. No real trades. No investment advice.
- The portfolio and every trade are labelled "simulated".
- One demo user with a fixed id. No sign-in.
- When the spec is silent, choose the option that keeps results reproducible and explainable, and report the choice.

## 2. Where the sources disagree, and what applies

| Topic | Design board (F) | Tech board (T) | Brief (B) | Applies |
|---|---|---|---|---|
| Database | — | DynamoDB | DynamoDB | DynamoDB |
| Volatility window | 30 days | 1 year, annualized | — | 1 year |
| Score factors | fit, momentum, news, fundamentals, risk fit | profile fit, risk fit, fundamentals, diversification | momentum and news not scored | T |
| Starter dataset | "use starter dataset" | "not used" in section 11, but still named in the Analytics tool row | not used | not used |
| Sign-in | "auth was removed" | one demo user | removed | removed |
| Models | "Claude, Llama, etc." | Claude (orchestrator) + Nova (subagents) | — | **Owner, Nov 14:** Claude Sonnet 5.5 (orchestrator) + Claude Haiku 5.5 (subagents) |
| Agent runtime | — | Bedrock AgentCore: runtime, memory, gateway, observability (status: Planned) | Python service in `/agent`, over HTTP, on ECS Fargate | **Owner, Nov 14:** AgentCore Runtime. The same code runs locally as a plain HTTP service |
| Analytics tool | — | AgentCore Code Interpreter (Planned) | not mentioned | not built: fixed calculators in our code are easier to audit than model-written code |
| Glossary source | "a vetted glossary only" | Bedrock Knowledge Base (Planned) | not mentioned | **Owner, Nov 14:** Bedrock Knowledge Base |
| Knowledge test (question 5) | in the flow | in the Level rule, 2 points | — | **Owner, Nov 14:** removed |
| Audit trail, step 9 | Agent action log | Agent action log + AgentCore observability | action log + CloudTrail + model invocation logging | **B** |
| Never-words scope | "in a reason" | "in a reason" | reasons **and** agent replies | B (stricter) |

The brief says CloudTrail was added to the tech board. The PNG in this folder does not show it (it was exported before that change), so the audit trail in section 9 below follows the brief.

## 3. Starting point and what is removed

Fork of OpenStock: Next.js 15, React 19, TypeScript, Tailwind, shadcn/ui, Vitest. Licence AGPL-3.0: the licence and the credit to the original authors stay, and a modified or deployed version must publish its source under the same licence.

- **Reuse:** Finnhub and Yahoo data code, `/api/quotes`, TradingView widgets, the stock page, search.
- **Remove**, with dependencies and env vars: better-auth and the middleware check, Inngest jobs, Nodemailer, Kit, `lib/ai-provider.ts`, MongoDB/Mongoose.

## 4. Architecture

```
User (browser)
  └─ Web app (Next.js)            Onboarding · Dashboard (Portfolio / Overview / Profile) · Agent panel
       └─ Server layer            Server actions · /api/quotes · Watchlist pipeline (filters + score v1)
            │                     · Rules engine (demo, simulated trades)
            ├─ Agent service      Python, Strands Agents SDK, orchestrator + subagents,
            │                     on Bedrock AgentCore Runtime (plain HTTP on :8080 locally)
            ├─ External           Finnhub · Yahoo chart · Bank of Canada Valet · MetalCharts · Binance
            │                     · Amazon Bedrock (models, Guardrails, Knowledge Base) · TradingView · Adanos
            └─ DynamoDB           profile_config · decision_log · agent_action_log
```

- API keys stay server-side. Rate limiting and caching sit in the server layer.
- TradingView and Adanos are display-only embeds. Neither feeds a filter, a score or the agent's context.
- Hosting: the web app on Docker → ECR → ECS Fargate + load balancer; the agent service on AgentCore Runtime. Everything runs locally first, with DynamoDB Local in docker-compose. If AgentCore deployment is blocked, the same agent container runs on Fargate and only the invoke call changes.
- AgentCore pieces used: Runtime and Observability. Memory only if multi-turn chat is in the demo. Gateway and Code Interpreter are not used.
- Bedrock region: `us-east-1`. The board says Montréal, but the workshop account denies Bedrock there (see question 8).

## 5. Data sources

Every external value is stored with its source and fetch time.

| Source | Endpoint / fields | Used for | Accuracy check | Limits and terms |
|---|---|---|---|---|
| Finnhub | `/quote`: price, % change | live prices, market movers, portfolio value | timestamp shown; stale after 60 s is flagged | free-tier rate limit → cache, show delay |
| Finnhub | `/stock/metric`: beta, market cap, P/E, volume | cap and liquidity filters, fundamentals score, volatility cross-check | provider values, timestamped | coverage varies by ticker |
| Finnhub | `/stock/profile2`: sector, exchange | sector tags, sector fit, sector allocation, market filter | provider's own classification | not GICS → label "Finnhub industry" |
| Finnhub | `/company-news`: headlines, dates | news on the card, earnings calendar | count over the last 7 days | news text is untrusted input to the AI |
| Yahoo | chart: daily closes, last 12 months | 1-year volatility, non-US quotes | at least 20 days of data | unofficial endpoint → document its terms |
| Bank of Canada | Valet API: bond yields | bonds on the watchlist and Overview | official source, dated | gives yields, not bond prices |
| MetalCharts | gold price API | gold on the watchlist and Overview | provider value, timestamped | check free-tier limits and terms |
| Binance | public market-data API: BTC, ETH | crypto, High risk only | provider value, timestamped | confirm access from Canada; document terms |
| TradingView | embedded widgets | charts on stock pages | rendered by the provider | display only; document widget terms |
| Adanos | sentiment | shown on Overview | method not disclosed | display only; never in a decision |
| Amazon Bedrock | models, Guardrails | agent replies; rephrasing fact sentences; glossary answers | Guardrails grounding check; text itself not verified | may only cite logged data or a document |
| ESG tag (mock) | set by hand per asset, in the app | ESG filter and the tag on cards | not real data | labelled "demo data" wherever shown |
| Our data | profile config, simulated holdings | filters, fit score, reason sentences | answers stored verbatim | — |

T still lists "news-flow score" as a use of `/company-news`. That is a leftover: section 12 removes news from the score.

Each provider's real endpoints, fields and terms are checked against its documentation before coding, and recorded in `docs/data-sources.md`. If one is unreachable, needs a paid plan, or forbids our use, work stops and the problem is reported; no data is faked.

### 5.1 What each source allows — tested and read on 2026-11-14

The table above is the board's. This section is what live calls and the providers' own terms pages showed. Every endpoint was called from this machine and re-tested by a second checker.

**Clearly licensed for reuse**

| Source | Gives | Terms |
|---|---|---|
| Bank of Canada Valet (no key) | Government of Canada benchmark yields (2, 3, 5, 7, 10 year, long), T-bill yields, policy rate, CORRA, daily FX, CPI | "freely use, copy, distribute and transmit", with attribution and a note if changed; no Bank logo |
| Statistics Canada web data service (no key) | CPI, GDP, unemployment | Statistics Canada Open Licence, with a source notice |
| SEC EDGAR (no key) | US company list and SIC industry code | public, cite the SEC, at most 10 requests a second |
| Wikipedia lists of S&P 500 and S&P/TSX constituents | ticker, company, sector | CC BY-SA 4.0: attribution, and our derived list carries the same licence |

**Works, but the terms are personal or non-commercial use**

| Source | Gives | Terms and limits |
|---|---|---|
| Finnhub free key | US quote, sector, market cap, P/E, growth, beta, volume, news. Refuses `.TO` quotes, TSX symbol list, ETF profile, index constituents, candles. Interlisted Canadian names answer by their US ticker (`RY` returns Royal Bank, in CAD). | "strictly for personal use"; no sharing of "data or derived results" without written approval. 60 calls a minute. Sector is Finnhub's own classification, not GICS. |
| TMX Money (tmx.com's own site data, no key) | Canadian quote, sector, market cap, P/E, beta, one year of daily closes. No sector for ETFs. | Undocumented; site terms allow viewing "for your non-commercial or personal use only". Delayed 15 minutes or more; the response does not say so, the app must. |
| TSX "Listed Companies" Excel (official, monthly) | every TSX issuer with sector, sub-sector, month-end market cap, and all ETFs with fund family | "Do not copy, distribute, sell or modify this document without TSX Inc.'s prior written consent." The site's robots file disallows fetching it by program: a one-time manual download only. |
| Kraken public API (no key) | BTC and ETH in CAD, daily history | Works; terms restrict data extraction and third-party apps without consent. |
| Binance public API (no key) | BTC, ETH in USDT | Answered from this machine. Use from Canada under its terms is not confirmed. |

**Not dependable**

| Source | Problem |
|---|---|
| Yahoo chart | Its terms forbid automated access "without our express, prior permission". Answered some calls and returned "too many requests" on others from the same machine within the hour. |
| iShares and SPDR holdings files | Have a sector column, but terms forbid redistribution; BlackRock blocked this machine after a burst of requests. |
| Alpha Vantage free key | 25 requests a day; personal, non-commercial licence. |
| gold-api.com | Keyless and allows commercial use, but names neither its operator nor its sources. |

**No free official source exists for TSX quotes or daily price history.** That is the one gap no licensed source fills.

**Proposed design** (awaiting the owner's choice, see section 16):

- Universe: a candidate file in the repo, built once from the Wikipedia lists (licensed), with the revision id and date stored per row. About 200 US and 60 Canadian names.
- US numbers: Finnhub, labelled "Finnhub" with fetch time. Sector shown as "Finnhub industry".
- Canadian numbers: Finnhub by US ticker for the interlisted large caps where it answers; TMX Money for the rest and for Canadian ETFs, labelled "TMX Money, delayed 15 min or more".
- One-year volatility: from daily closes fetched once a day and cached, so the demo never waits on a provider. TMX Money for Canadian names; for US names a source is still needed, since Finnhub refuses candles (Yahoo cached ahead of time, labelled unofficial, is the only free option found).
- Bonds, FX, policy rate, CPI: Bank of Canada. Market caps in CAD are converted with its FXUSDCAD rate before the cap filter.
- Crypto: Kraken in CAD. Gold: left open; no source found that is both free and names its origin.
- Every value is stored as value, unit, currency, source, endpoint (without the key), fetch time and the provider's own as-of time.
- `docs/data-sources.md` states each source's terms as above, including the personal-use ones. The honest position for the jury: this is a non-commercial demo; a real product would license TMX and a market-data vendor.

## 6. Data model

| Store | Fields | Written by | Read by | Rule |
|---|---|---|---|---|
| `profile_config` (DynamoDB) | level, risk, every answer verbatim, markets, sectors, niches, themes, brands, avoid list, échéance, goal, agent style, rule versions | Onboarding; Profile tab; Profile subagent after confirm | watchlist pipeline, context builder, level template | editable; an edit re-runs the Level and Risk rules |
| `decision_log` (DynamoDB) | signal snapshot (value + source + timestamp), filter results, factor scores, rule versions, reason sentence, user action; simulated trades and why | watchlist pipeline, rules engine | "Why?" panel, Profile → History, audit | append-only; no update or delete path exists |
| `agent_action_log` (DynamoDB) | request id, prompt, data used, stated reason, before / after, result, timestamp, model + prompt version, every hand-off | Action log writer (plain code, not the model) | undo, audit | append-only; no update or delete path exists |
| Saved layout | widget positions | edit mode; Layout subagent after confirm | dashboard | kept in the app, no table |
| Investment rules | rule definition, status (active / paused) | Rules subagent; rules module | rules engine | kept in the app, no table |
| Simulated portfolio | starting cash, positions, simulated fills | rules engine | Portfolio tab, Portfolio subagent | always labelled simulated |

Changing a weight, filter or prompt bumps its version, so older decisions stay explainable.

## 7. Onboarding → investor profile

Every user ends with a level **and** a risk profile.

| # | Question | Options | Asked to | Feeds |
|---|---|---|---|---|
| 1 | Goal: what brings you here? | learn · track · find ideas | everyone | context |
| 2 | Placed a trade yourself? | yes · no | everyone | splits the path; Level rule |
| 3 | Experience: how long have you traded? | < 1 yr · 1–5 yrs · 5+ yrs | traded: yes | Level rule |
| 4 | Tools you use | limit / stop orders, options, margin, shorting | traded: yes | Level rule |
| 6 | Investing goal | income · growth · trading | everyone | Risk rule |
| 7 | Échéance: when do you want to see profit progress? | weeks · months · 1 yr · 5+ yrs | everyone | Risk rule |
| 8 | If it dropped 20%, you'd… | sell · wait · buy more | everyone | Risk rule |
| 9 | Self-rated risk | low · medium · high | everyone | Risk rule |
| 10 | Markets | US · Canada · global | everyone | universe; market filter |
| 11 | Sectors you like | tech · health · energy · finance · consumer… | everyone | universe; sector fit |
| 12 | Drill-down, per picked sector | niches (Tech → chips, cloud, software) | everyone | universe; fit score |
| 13 | Themes | AI · clean energy · dividends · ESG | everyone | universe; fit score |
| 14 | Brands you know | companies you use or admire | everyone | seed tickers |
| 15 | Avoid list | sectors or companies to exclude | everyone | hard filter |
| 16 | Agent style | teach me · suggest · just the data | everyone | prompt tone |

The numbers are the board's; 5, 3a and 4a are gone. The owner removed the knowledge test (5). Questions 3a and 4a carried no points and fed nothing, so they are dropped too (proposed; say if you want them back).

Flow: 1 → 2. "yes" → 3 → 4. "no" → straight on. Then 6 → 7 → 8 → 9, then 10 → … → 16 → result screen → save → open that level's dashboard. That is 13 screens for someone who has traded and 11 for someone who has not.

**How it should feel** (owner: "a classic smart onboarding that is user friendly"):

- One question per screen, answered by tapping a chip; no typing except brands and the avoid list, which use the existing ticker search.
- A progress bar with three named parts: About you · Your comfort with risk · What interests you.
- Back on every screen. Interests questions (11–15) can be skipped; skipping means "no preference".
- Question 12 only shows niches for the sectors picked in 11.
- A result screen before saving: "Your level: X. Your risk profile: Y.", the answers that led there in plain words, and an edit link. If the self-rating differs from the computed risk, both are shown.
- Nothing is scored in the browser: answers go to the server, which runs the versioned rules and logs inputs and versions.

**Level rule v1.** Not traded → Novice. Traded → points for experience and tools (5 at most), summed into three bands. The bands were redrawn for 5 points instead of the board's 7 (proposed; see `rules/v1.json`). The user can change the level on the Profile tab.

**Risk rule v1.** Questions 6–9 score 0–2 each and sum into three bands. Answering "sell" to the drop question can never give High. If the self-rating differs from the result, show both.

**Save.** Level, risk, every answer verbatim, and the rule versions. Inputs and version are logged.

**Split of effects.** Level changes the UI. Risk changes the watchlist only.

## 8. Smart watchlist

The main focus of the Overview tab. The whole pipeline is deterministic code: no model call anywhere in filtering, scoring or selection. Same inputs → same output, covered by tests.

| Stage | Rule | Data used | Logged |
|---|---|---|---|
| 1 Signal snapshot | collect every input once, each value with its source and timestamp | Finnhub, Yahoo closes, profile config, simulated holdings | the whole snapshot |
| A Universe | seed tickers from brands (q14) + companies in the chosen sectors, niches and themes, in the markets picked; plus bond yields, gold, BTC and ETH | profile config; Finnhub profile; Bank of Canada, MetalCharts, Binance | candidate list |
| B Filters v1 (pass / fail) | dropped if: on the avoid list · 1-year volatility above the risk band's cap · market cap below the band's floor · traded value under the daily minimum · Novice: ETFs and large caps only · ESG theme picked: mock tag must be "screened" · crypto: High risk only | profile; Finnhub metrics; 1-year volatility; ESG mock tag | each result + rule version |
| C Score v1 (0–100 per factor) | fixed weights, all slow-moving: profile fit · risk fit · fundamentals · diversification. No momentum, no news flow | derived signals | each factor score + version |
| D Selection | top N by weighted score (N by level) · at most 2 per sector and 1 crypto · seed tickers kept if they pass · recomputed once a day · a newcomer must beat a listed stock by the margin · ties → lower volatility first (F) | scores | ranked list |
| Reason text | filled from the allowed fact templates; the AI may only rephrase, never judge or pick | template fields, each with a source | sentence + sources |
| E Representation | same ranking for everyone, density by level | level from profile config | what was shown |
| User action | add · dismiss · pin | — | action + timestamp |

**Derived signals** (computed by us, formula versioned, recomputed once a day):

- Volatility: standard deviation of daily returns over 1 year, annualized; beta as a cross-check
- Profile fit: sector, niche, theme and brand match
- Risk fit: how close volatility sits to the band
- Fundamentals: P/E vs sector, growth
- Diversification: adds a sector or class not yet held
- News: shown on the card, never scored

**Score formulas.** The board gives each factor in words only. The 0–100 formulas in `rules/v1.json` (`score.factor_formulas`) are proposed first values. Fundamentals uses Finnhub `peTTM` and `revenueGrowthTTMYoy`; both fields were confirmed present on the key.

**Asset classes in the filters** (proposed, from the owner's direction that market cap matters and novices get blue-chip ETFs):

- Stocks go through every filter. A Novice only sees stocks of US$10B or more, whatever their risk band.
- ETFs skip the market-cap floor (a fund has assets, not a company market cap) but must pass volatility and liquidity. Novice and Low-risk users only get blue-chip ETFs: a short hand-kept list of broad-index funds, each with the issuer's page as its source.
- Crypto (BTC, ETH): High risk only, never for a Novice, one slot at most, must pass the volatility cap.
- Gold and bond yields: shown as reference cards beside the ranked list, not ranked, because a yield is not a price and neither has fundamentals.

**Representation by level** (search bar on top, then cards):

- Novice — up to 5 picks. Facts and links only: name, type or sector, % move today, one fact sentence. No scores, no opinions.
- Intermediate — up to 10 picks. Rank, score, top 2 drivers, 1-month sparkline.
- Expert — up to 20 picks. Every factor, raw values (P/E against sector, volatility, beta), source and fetch time, rule versions; sortable by any factor.
- All levels — tapping a card opens "Why?": the score, its sources and the timestamp.

The wireframe cards on F show "momentum" and "news" as drivers and factors. Those are illustrations from before the factors changed; cards show the four current factors.

**Reason sentences.** Only the five allowed templates, each filled from data we hold and logged with its source. If none applies, the card shows facts only (sector, % move). The never-words never appear in a reason or an agent reply.

**Never:** Adanos sentiment in any stage · the AI choosing or re-ranking · a pick without sources and a timestamp.

## 9. Agent

### One request, nine steps

| Step | What happens | Control |
|---|---|---|
| 1 Chat input | user types or taps a quick action | logged |
| 2 Context builder | gathers only data we hold: profile, layout, watchlist, holdings, quotes, the conversation so far | nothing from outside enters the prompt; Adanos never enters |
| 3 Prompt templates | stored locally and versioned; tone set by level + agent style | prompt version logged |
| 4 Orchestrator | Strands agent (Python) on AgentCore Runtime, Claude Sonnet 5.5; picks subagent(s) (Claude Haiku 5.5), sends a task + context slice, merges results and sources | no data tools of its own; subagents never talk to each other or to the user |
| 5 Guardrail check | Bedrock Guardrails: forbidden topics (advice), never-list words, personal-data masking, grounding check; plus our own check that wording fits the level | fails twice → safe refusal |
| 6 Action router | whitelist: reply with cited data · look up a quote or company · move / swap a widget · create / pause a simulated rule · explain a watchlist pick | nothing outside the whitelist runs |
| 7 Preview + confirm | before / after shown; user confirms or cancels | plain replies skip this step |
| 8 Apply | to the layout, the rules engine or server actions | never trades for real |
| 9 Result + undo | shown in the panel; undo restores "before" | every step written to the agent action log |

### Subagents

Each gets only its own tools and a slice of context.

| Subagent | Does | Data / tools | Limit |
|---|---|---|---|
| Market data | quotes, company profile, movers, earnings, bond yields, gold, crypto | Finnhub, Yahoo, Bank of Canada, MetalCharts, Binance | read-only |
| Watchlist explainer | explains why a stock is listed | signal snapshot + decision log | cannot change the ranking |
| Portfolio | holdings, performance, sector split; return, drawdown, correlation on request | simulated portfolio; fixed calculators | read-only |
| Rules | turns plain words into a structured rule, validates it, sends it to preview | rules engine (simulated) | applies only after confirm |
| Layout | maps "show me less" to widget swaps; outputs a layout diff | widget library, saved layout | applies only after confirm |
| Profile | proposes edits to level, risk, sectors; re-runs the Level and Risk rules | profile config | applies only after confirm |
| Glossary | explains terms such as ETF or P/E | Bedrock Knowledge Base holding the vetted glossary (markdown files kept in the repo) | answers only from the documents, cited with the document's location |
| Action log writer | records every hand-off and result | agent action log | not AI: plain code |

Code computes and the model explains: each tool is one of our fixed calculators.

### Profile-conflict check

When a user asks about, or simulates buying, an asset that fails their profile's filters: do not hide it silently and do not simply agree. Name the conflict with the actual values (for example the asset's volatility against the user's cap), then let them proceed in simulation. Log it. T lists this as "planned, not yet designed in detail"; the behaviour here is from the brief.

### Audit trail

One `action_id` is created per agent request. Every model call made for that request is recorded in three places, joined by the AWS request id that Bedrock returns with each response.

| Layer | Holds | State on the workshop account |
|---|---|---|
| 1. `agent_action_log` (DynamoDB) | our record of each step: `action_id`, AWS request id, model id, prompt version, data used, stated reason, before / after, result, token counts, timestamp, and a SHA-256 hash of the prompt and of the reply. Written by plain code. | to build |
| 2. AWS CloudTrail | who called which model, when, from where; the request id; token counts; the region that served the call. No prompt or reply text. | already recording model calls, no setup |
| 3. Bedrock model invocation logging | the full prompt and reply text, token counts, caller identity, request id, and our `action_id` passed as request metadata | off; to switch on (S3 or CloudWatch Logs) |

**Checked on 2026-11-15 UTC.** Three test calls (Haiku 5.5 and Sonnet 5.5) were made from the CLI and their request ids captured. About six minutes later all three were found in CloudTrail event history by request id, each with the caller's role, the model id, input and output token counts, and the serving region.

What needs a trail of our own:

- Knowledge Base retrievals, Guardrail evaluations and AgentCore Runtime invocations are CloudTrail "data events". They are not recorded by default and never appear in event history. A trail with selectors for `AWS::Bedrock::KnowledgeBase`, `AWS::Bedrock::Guardrail` and `AWS::BedrockAgentCore::Runtime` records them. The account's two existing trails belong to the workshop and are left alone.
- A trail also gives log file integrity validation (hourly signed digest files), which is the tamper-evidence claim. It must run for at least an hour before the demo to have a digest to show.

Limits to state plainly:

- A call takes about five minutes to appear in CloudTrail. The demo shows an earlier call.
- CloudTrail does not contain or sign the prompt text. Content integrity rests on the invocation log plus the hashes in our own log.
- Streaming calls produce two CloudTrail events (the call, then a completion event). Count calls by the first kind only.
- Use the `us.` model profiles. A test call on a `global.` profile was served from `ap-northeast-1`.
- Still to test in step 7: capturing the request id and sending `action_id` as request metadata through the Strands SDK when streaming. If the SDK does not expose them, a boto3 event hook does.

## 10. Dashboard

| Tab | Module | Shows | Source | Note |
|---|---|---|---|---|
| Portfolio (home) | Total value | simulated balance + today's gain / loss | simulated portfolio + quotes | fixed widget |
| Portfolio | Performance chart | 1D · 1W · 1M · 1Y · All | portfolio history | compares with the starting amount |
| Portfolio | Holdings | each position, value, return + sector tag | portfolio; Finnhub profile | |
| Portfolio | Sector allocation | % of the portfolio by sector | holdings + sector tags | |
| Portfolio | Investment rules | add / pause rules, see simulated trades | rules engine | |
| Portfolio | Price alerts | notify on a price or % move | rules engine | low priority |
| Overview | Smart watchlist | ranked cards with reasons, ESG tag (mock) and "Why?" | watchlist pipeline | main focus |
| Overview | Quote lookup | search any ticker | Finnhub / Yahoo | |
| Overview | Market movers | top gainers, losers, most active | Finnhub quotes | whole market; low priority |
| Overview | Indices & sentiment | indices; Adanos sentiment shown | Adanos | display only |
| Overview | Charts | TradingView chart per stock | TradingView | |
| Overview | Earnings calendar | upcoming dates for holdings + watchlist | Finnhub | low priority |
| Profile | Level | Novice / Intermediate / Expert, editable | profile config | changes the UI |
| Profile | Risk | Low / Medium / High, editable | profile config | changes the watchlist only |
| Profile | History | past picks and why | decision log | |

UI by level: Novice — plain words, fewer numbers · Intermediate — charts + key ratios · Expert — dense data, indicators. Visual style: red and white.

## 11. Rules engine (demo) and simulated portfolio

- Rules are created by talking to the agent or from the Investment rules module.
- The Rules subagent turns the words into a structured rule and validates it; the user confirms it in a preview.
- The engine watches live quotes and simulates a fill at the last price.
- Every simulated trade and its reason go to the decision log.
- No broker, no real trades. Rules live in the app.
- The portfolio starts with the fixed cash amount in CAD. Positions come from a simulated buy on a card or from a rule.

## 12. Widget editing (last, only if time remains)

Each user starts from their level template. The dashboard has fixed widgets (such as total value) and swappable slots. Layout changes come from edit mode (pencil: drag, swap, add, remove) or from the agent, both drawing on a library of pre-made widgets. Agent changes show before / after, need a confirm, are logged and can be undone. The layout is saved and reloads on the next visit.

## 13. Business rules

| Decision | Why | Enforced by |
|---|---|---|
| Every pick traces to timestamped source values and versioned rules | any result can be replayed and defended | signal snapshot, decision log |
| Filters and score are deterministic | same input → same output | watchlist pipeline v1, tests |
| The AI explains; it never picks, ranks or judges | model output cannot be verified | fact templates, guardrail check |
| No recommendation wording anywhere | the app is not investment advice | never-list, guardrail check |
| Adanos sentiment is display only | the provider's method is not disclosed | not wired into any stage |
| Same ranking for every level; only density changes | keeps the ranking defensible | representation stage |
| Level changes the UI; risk changes the watchlist only | a split users can understand | level templates; filters |
| The agent runs only whitelisted actions, with confirm and undo | the user stays in control | action router, preview step |
| Agent log is append-only and written by plain code | the model cannot rewrite its own trace | action log writer |
| Portfolio and trades are simulated | demo scope; no broker | rules engine, labels in the UI |
| Changing a weight, filter or prompt bumps its version | old decisions stay explainable | versioned config |
| The watchlist ranking is slow-moving | the list must not reshuffle on daily noise or read as predicting returns | 1-year windows, daily recompute, newcomer margin |

## 14. Known open points from the boards

From T section 11 "Still open" and F "What's still missing". None is a blocker for step 2.

- Rule values are untested first values.
- No "limits line" (period, freshness, what is not considered) on results yet.
- Agent: fallbacks when a subagent or API fails, prompt injection (news and company text are untrusted), cost and latency budget, evals, merge rule when subagents disagree, permission matrix per subagent.
- Privacy and consent (Law 25, PIPEDA), French UI, disclaimers.
- Finnhub free-tier caching; stale-data flags everywhere a value is shown.
- AGPL-3.0 duties; Yahoo and TradingView terms to document.
- Real ESG data (the tag is a mock).
- **The team AWS account is deleted on Nov 16.** Anything that matters must live in the repo.

F also holds a case review against the datathon brief (criteria weights, the Amira / Mateo / Robert persona tests, "add first" and "cut or shrink" lists). T already absorbed most of it: crypto, bonds and gold added, ESG mock tag, momentum removed, conflict check in. Not absorbed, and not in the brief either: one-click persona presets, a sensitivity view, and analysis over an explicit multi-year period.

## 15. Decisions from the owner's review (2026-11-14)

1. **AgentCore:** use it. Runtime and Observability; see section 4.
2. **Glossary:** Bedrock Knowledge Base.
3. **Knowledge test:** removed. Onboarding redesigned as a short one-question-per-screen flow; level bands redrawn (section 7).
4. **Score formulas:** left to Claude. Proposed formulas are in `rules/v1.json`.
5. **Échéance mapping:** confirmed (weeks and months 0, 1 yr 1, 5+ yrs 2).
6. **Asset classes:** market cap matters; blue-chip ETFs for novices; the rest left to Claude (section 8).
7. **Universe:** see section 5.1; one choice still open.
8. **Models and region:** Claude Sonnet 5.5 and Claude Haiku 5.5, in `us-east-1` (the workshop account denies Bedrock in Montréal). CloudTrail on the model calls: confirmed feasible and already tested (section 9).

Nothing on either board was unreadable at 2× zoom. One note is uncertain: free text on F in the widgets frame reads "Style BNCD ROUGE BLANC" (last letter could be D or O). T confirms "red and white".

## 16. What changed during the build (2026-11-14 and 15)

Where this section and an earlier one disagree, this section describes what was built.

- **Onboarding length.** 15 questions for someone who has traded and 13 for someone who has not (one fewer when the picked sectors have no niches), not 13 and 11.
- **Result screen.** The profile is computed and saved by the server, then the result screen shows it with an edit link. Nothing is scored in the browser.
- **Glossary.** Creating a Bedrock Knowledge Base is denied on the workshop account. The Glossary subagent reads the vetted files in `agent/glossary/` and quotes and cites them; setting `KNOWLEDGE_BASE_ID` switches to a Knowledge Base.
- **Guardrail.** The Bedrock Guardrail blocks the forbidden words and replies that are not grounded in the data supplied. Its "investment advice" topic and its relevance check only detect and log: set to block, they refused correct factual replies. Judgement and prediction wording is blocked by a second word list in our own code.
- **Agent whitelist.** Two more actions exist, both only after the user confirms a preview: simulate a trade, and change the profile.
- **Profile-conflict check.** Built: the conflict is named with its actual values, the user may still proceed in simulation, and both are logged. The orchestrator's conflict tool returns the conflicts only, not the asset's data.
- **Blue-chip ETFs** are always candidates in the markets picked, and at most one fund per tracked index is listed.
- **Diversification factor.** A new sector scores highest (see `rules/v1.json`, score version `score-v1.1`).
- **ESG** is a filter only: it adds no candidate and no fit points.
- **Stock page.** The technical-analysis widget was removed; the Adanos sentiment card takes its place, labelled display only.
- **Not built:** price alerts, the earnings calendar, layout editing on the Overview tab, drag-and-drop widget editing, AgentCore Memory, Gateway and Code Interpreter.
- **Gold** has no value: the only free source found refused the calls. The card says "not available".
- **State kept in the container** (layout, rules, pins, the watchlist's listed-since dates) is lost on restart; see the README.
- **Deployment.** Web app on ECS Fargate behind a load balancer; agent service on AgentCore Runtime; region `us-east-1`. Audit trail verified on the live system: one reply traced by request id from `agent_action_log` to CloudTrail to the Bedrock invocation log, with identical token counts.

## 17. Still open


1. **Data-source terms** (section 5.1): which of the personal-use sources to accept for the demo, and whether to write to Finnhub for permission.
2. **GDELT DOC 2.0:** named by the owner without a purpose. If it is for news headlines it sits beside Finnhub news on the cards; its tone scores are sentiment and would be display-only.
3. **Questions 3a and 4a:** dropped as they fed nothing. Confirm.
