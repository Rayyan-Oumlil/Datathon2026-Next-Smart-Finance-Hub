# Portfolio X-ray: design

Status: proposed, 2026-11-15. Branch `feat/portfolio-xray`. Nothing here is built yet.

## 1. Intent

A module on the Portfolio tab that looks inside the simulated portfolio and answers four questions a client actually has:

1. Where is my money concentrated? (by holding, sector, asset class, currency)
2. Where is my *risk* concentrated? (a holding can be 10% of the value and 40% of the risk)
3. How would this exact mix have behaved in past markets? (worst fall, 2022, last 12 months)
4. What would change if I added to, or reduced, a position? (before / after, with the profile conflicts named)

Today no calculator exists for the portfolio as a whole: `portfolio-stats` computes one symbol at a time and says so. The X-ray fills that gap and gives the agent a grounded way to answer "is my portfolio too concentrated?".

Why it matters for the case (official brief, 2026): Data is 20% ("rigour, validation, visualization"); the brief asks teams to test sensitivity to assumptions and scenarios, to stay true to the data, to state limits and to distinguish facts, assumptions and scenarios. The workshop deck ("Understanding the investor") lists six risks (market, credit, liquidity, interest rates and inflation, currency, concentration) and says a return is never just a number: period, source of return and conditions matter. The X-ray is built around that vocabulary.

## 2. Goals, non-goals, anti-goals

Goals
- Every number is computed by deterministic code, with its period, method and sources (the app's "code computes, the model explains" rule).
- Facts, assumptions and scenarios are labelled as such, in the UI and in the data.
- Profile-aware: the level sets the density of the view; the risk band and the user's own answer to the "20% drop" question appear next to the numbers.
- English and French, including every explanation.
- Usable by the agent (read-only tool), with the existing number-grounding and wording checks applying unchanged.
- Clean: one calm module, few colours, no chart library, no decorative effects.

Non-goals
- No new AWS service, no new database table, no new Bedrock model.
- No trade execution from the X-ray (it stays read-only; the existing trade dialog and agent flow remain the only way to change the portfolio).
- No ESG, news, sentiment or fundamentals inside the X-ray.
- No look-through into ETF holdings (no free licensed source; stated as a limit).

Anti-goals (a failure even if it technically works)
- Anything that reads as a forecast or as advice. The words in `rules/v1.json` `reasons.never_words` (EN and FR) never appear; the messages test enforces it.
- A backtest that looks like performance. Past-window results are labelled "scenario", with the assumption stated beside them.
- A number with no source, period or method.
- Silent gaps. Missing data is shown as missing; coverage is stated.

## 3. What was verified before designing (2026-11-15)

| Question | Finding |
|---|---|
| How much history can we get? | Not 1 year: the limit is a parameter we set. TMX Money `getTimeSeriesData` returned 1,256 daily rows from 2021-11-12 to 2026-11-13 for RY, XIU, AAPL:US and SPY:US, and 2,510 rows (10 years) for SHOP. Yahoo `range=5y` answered 200. Kraken returns 721 daily candles (about 2 years) for BTC in CAD. |
| Can returns be in CAD? | Yes. Bank of Canada Valet `FXUSDCAD?start_date=2021-11-12` returned 1,246 daily observations, official and keyless, the same source the app already uses for the latest rate. |
| Do we need the organizers' starter dataset? | No, and it is not used. Nothing from `Context/` enters the repo. |
| Standard risk decomposition | Percent contribution of asset i to portfolio risk = w_i (Σw)_i / (wᵀΣw); contributions sum to 100% (Euler decomposition). Sources: Zivot, Risk Budgeting slides, faculty.washington.edu/ezivot/econ424/riskbudgetingslides.pdf; Palomar, Portfolio Optimization, ch. 11.3 (bookdown.org/palomar/portfoliooptimizationbook/11.3-risk-contributions.html). |
| What a reference X-ray shows | Morningstar's Portfolio X-Ray: asset allocation, sector concentration, overlap. Ours adds risk concentration and window sensitivity, and omits look-through (needs fund holdings data). |
| Regulatory framing of hypothetical performance | CSA Staff Notice 31-325 (2011, updated 2018): hypothetical or back-tested data must be disclosed as such, with how it was calculated and its assumptions. The X-ray's labels and limits line follow that. |

## 4. Services and data: what we use, and why nothing new

| Piece | Role in the X-ray | New? |
|---|---|---|
| Next.js app on ECS Fargate (existing) | Runs the calculators and the API; no extra compute | no |
| TMX Money, Yahoo chart (fallback), Kraken | Daily closes: now requested for up to 5 years for the X-ray only (the 1-year path used by the watchlist filter is unchanged) | additive functions |
| Bank of Canada Valet | USD/CAD daily history so a US holding's return is what a Canadian investor would have seen | additive function |
| Existing 24 h source cache | Each long series fetched once a day per symbol | no |
| Bedrock, Strands, AgentCore (existing) | The `portfolio` subagent gets one more read-only tool and explains the result in plain words; Guardrails and the number-grounding check apply as they do to every reply | tool only |
| `agent_action_log`, CloudTrail, invocation log (existing) | Every agent use of the X-ray is traced like any other tool call | no |
| DynamoDB | Not written to. The X-ray is a pure read of the trade log replay plus market data | no |

The deck's rule is "don't multiply services to impress". We add none, and say why in the technical document.

Data terms are unchanged: TMX, Yahoo and Kraken are personal / non-commercial use sources already documented in `docs/data-sources.md`; the long-history calls are added there.

## 5. Method

All formulas are fixed, versioned (`xray-v1`) and written into the result's `method` text.

**Series.** For each held symbol, daily closes (up to 5 years; crypto about 2). A USD close is multiplied by that day's Bank of Canada USD/CAD rate (last published rate on or before the day, since the Bank publishes none on holidays). Crypto from Kraken is already in CAD. Dividends are not included (price return); this is stated.

**Calendar.** The common calendar is the days on which every stock and ETF held has a close. A day one market was closed is left out, so the next return spans the gap for all holdings alike. Crypto uses its close on that date, or the previous one. This replaces ad-hoc forward-filling.

**Weights.** w_i = current value in CAD / total value including cash. Cash has weight, zero return and zero risk.

**Constant-weights replay (SCENARIO).** The daily return of the portfolio is Σ w_i r_i with today's weights applied to every past day. This is the standard basis for risk decomposition and keeps every statistic additive. It is not what the portfolio actually earned: the app only holds the trades since the simulation started. Always labelled.

**Windows (sensitivity).** Three, computed together so the user can switch instantly: *up to 5 years* (the full history available), *3 years*, *1 year*. A window needs at least 60 daily returns for the covered holdings; otherwise it returns `null` with the reason, never a guess. A holding with no data in a window (BTC in 2022) is left out of that window; the result states the **coverage** (share of portfolio value included) and names what was left out. Weights are renormalised over the covered part.

**Statistics (per window)**
- Annualised volatility = sample stdev of daily returns × √252 (same convention as `rules/v1.json` `filters.volatility`).
- Maximum drawdown = lowest value of (curve / running peak − 1), with peak date, trough date, and whether it recovered.
- Worst day; worst 20-trading-day span.
- Risk contribution of each holding = w_i (Σw)_i / (wᵀΣw) from the sample covariance of daily returns; sums to 100%.
- Diversification ratio = Σ w_i σ_i / σ_p (1.0 means no diversification benefit).
- Pairwise correlations; the three highest pairs are shown.
- Curve indexed to 100, thinned to at most 150 points for the chart.

**Facts about the present** (not window-dependent): shares by holding, top holding, top three, effective number of holdings = 1 / Σ ŵ² over the invested part, shares by sector / asset class / currency, USD share.

**Profile band.** Portfolio volatility is compared with the volatility limit of the user's risk band (`filters.volatility.cap_by_risk`), the same limit the watchlist applies to single assets. Labelled as an assumption: it is the app's own band, not a regulatory threshold.

**Your answer.** When the worst fall is 20% or more, the user's own answer to the "20% drop" question is shown beside it, as a fact, with no comment.

**What-if.** `change = { symbol, amountCad, direction: add | reduce }`. The same engine runs on hypothetical holdings: an addition spends cash (refused if cash is short, like a trade), a reduction cannot exceed the position. The result holds `before`, `after` and the differences, plus, for an addition, the profile conflicts the watchlist filters would name (the existing `checkProfileConflict`, with actual values). Nothing is logged as a trade and nothing is written.

**Risk coverage chips** (the deck's six risks): *measured here*: market, concentration, currency. *Not measured here*: credit, liquidity, interest-rate sensitivity. Honest, visible.

## 6. UI

One `Panel` in the Portfolio layout, between sector allocation and investment rules. It reuses the app's tokens (`kicker`, `num`, `pill`, `card`, `hatch`, `bg-brand`, `text-up/down`) and hand-drawn SVG like `PerformanceChart`: no chart library.

```
┌ Portfolio X-ray                         [simulated]          ┐
│ How the holdings are spread and how this mix would have moved │
│                                                               │
│ Period  ( Since Nov 2021 )  ( 2022 )  ( Last 12 months )      │
│ Measured here: Market · Concentration · Currency              │
│ Not measured: Credit · Liquidity · Interest rates             │
│ ─────────────────────────────────────────────────────────── │
│  Largest holding   Effective holdings   Volatility   Worst fall│
│  NVDA  38%         3.1 of 5             31%  ▮───┃──  −38%     │
│  fact              fact                 your band 35%  scenario│
│ ─────────────────────────────────────────────────────────── │
│ Where the value sits  vs  where the risk sits                 │
│  NVDA  ████████ 38%      ███████████████ 61%                  │
│  RY.TO ██████   27%      ████ 12%                             │
│ ─────────────────────────────────────────────────────────── │
│ How this mix moved (scenario)   ~~~~~~╲__╱~~~  shaded worst fall│
│ You said: "reduce my position" after a 20% drop. Worst fall −38%│
│ ─────────────────────────────────────────────────────────── │
│ Moves together · NVDA & AAPL 0.81 · …   Diversification ratio 1.2│
│ Exposure · Sector · Asset class · Currency                    │
│ ─────────────────────────────────────────────────────────── │
│ ▸ Test a change   [symbol] [amount CAD] (Add)(Reduce)  [Run]  │
│    before → after for each tile, conflicts named, "scenario"  │
│ ─────────────────────────────────────────────────────────── │
│ Limits: period dates, price changes only, today's proportions,│
│ returns in CAD, not a forecast. Sources: …  (Expert: formulas)│
└───────────────────────────────────────────────────────────────┘
```

Density by level (same numbers, different amount shown): *Novice* three tiles in plain words, the value-vs-risk pairs for the top three only, one sentence per section, no correlations, no formulas. *Intermediate* the layout above. *Expert* adds worst day, worst 20 days, diversification ratio, raw values, per-holding volatility, the method text and every source line.

Labels: small chips "Fact" (today's weights), "Scenario" (replay statistics), "Assumption" (band limit). The limits line is always visible, never behind a click.

States: empty portfolio (explains what appears once a position exists, no error), loading skeleton, partial coverage note, per-window "not enough history" note, unpriced positions listed, error with retry.

Accessibility: window switch is a radiogroup; bars carry text values (never colour alone); chart has a text summary; focus rings from the existing tokens.

## 7. Agent integration

- New read-only tool `get_portfolio_xray(change?)` in `agent/app/web_tools.py` calling `/api/internal/tools/portfolio-xray`; added to the `portfolio` subagent only; prompt `portfolio.md` updated to report windows, coverage and method exactly as returned.
- No new whitelisted action: a reply with cited data is already allowed. A what-if question returns a preview-style result but never proposes a trade.
- The orchestrator still holds no data tools. The existing guardrail, never-word lists, number-grounding check and French checks apply to the explanation unchanged.

## 8. Files

New
- `lib/xray/` — `types.ts`, `align.ts`, `stats.ts`, `windows.ts` (pure, no I/O)
- `lib/services/portfolio-xray.ts` — loads holdings and series, runs the engine, what-if
- `app/api/portfolio/xray/route.ts`, `app/api/portfolio/xray/what-if/route.ts`
- `app/api/internal/tools/portfolio-xray/route.ts`
- `components/portfolio/xray/` — `Xray.tsx`, `Tiles.tsx`, `ValueVsRisk.tsx`, `MoveChart.tsx`, `Pairs.tsx`, `Exposure.tsx`, `WhatIf.tsx`, `Limits.tsx`, `logic.ts`
- `messages/en/Xray.json`, `messages/fr/Xray.json`
- tests under `__tests__/xray/`, `__tests__/services/`, `agent/tests/`

Edited (small, additive)
- `lib/sources/tmx.ts`, `yahoo.ts`, `boc.ts` (long-history functions), `lib/services/quotes.ts`
- `lib/services/layout.ts`, `lib/services/text.ts` (widget title, `svc.xray.*` messages), `components/portfolio/logic.ts`, `PortfolioBoard.tsx` (one registration line)
- `messages/*/Portfolio.json` (module title), `__tests__/services/layout.test.ts`
- `agent/app/web_tools.py`, `subagents.py`, `prompts/portfolio.md`
- `docs/agent-api.md`, `docs/data-sources.md`, `docs/spec.md` (section 16), `README.md`

## 9. Test plan (written first)

- **Statistics, by hand.** Two assets with chosen returns: ρ = 0 and equal volatility gives equal risk contributions; ρ = 1 gives contributions equal to weights and diversification ratio 1; a constant series has zero volatility; a known path gives the exact drawdown, peak and trough; contributions always sum to 1; shares always sum to 1.
- **Alignment.** Common calendar, holiday gaps, FX as-of on a day with no rate, crypto date matching, minimum-returns guard, coverage and renormalisation when a holding lacks a window.
- **Windows.** Calendar-2022 slicing, last-12-months slicing, `null` with a reason when history is short.
- **Service.** Stubbed closes: empty portfolio, cash only, unpriced position excluded and listed, what-if add and reduce, cash-short and position-short refusals, zero-size change equals `before`, conflicts named with values.
- **Routes.** Validation, error shape and language, internal token.
- **Messages.** The existing parity, translation and never-word tests cover the new namespace.
- **UI logic.** Pure helpers (band status, bar widths, labels, level density) unit tested; visual check in a browser at 3 widths and both languages.
- **Agent.** Tool posts to its endpoint with the right body; subagent wiring test.
- **Independent check for the technical document.** Recompute volatility, drawdown and risk contributions from the same stored closes with an independent implementation (pandas) and report the differences.
- Gates before the PR: `tsc --noEmit`, full `vitest`, agent `pytest`, `next build`, code review and security review passes.

## 10. Risks

| Risk | Mitigation |
|---|---|
| TMX is undocumented and may rate-limit | 24 h cache; one call per symbol per day; clear "history not available" state |
| Longer payloads slow the first load | Fetch in parallel, cache, loading skeleton; the module loads after the rest of the tab |
| Replay misread as performance | Scenario label, limits line, no "return" headline, wording tests |
| Merge conflicts with Simon's pushes and the voice PR | New files first; one-line registrations; rebase before opening the PR |
| Constant weights hide rebalancing and survivorship | Stated as an assumption; the universe is today's list |
| French quality | Written with the English, checked by the messages test, reviewed once before the PR |

## 11. Out of scope for this PR (separate work)

Persona preset buttons with seeded portfolios (demo convenience, unrelated code); ETF look-through; liquidity and rate-sensitivity measures; exporting the X-ray.

## 12. Build order

1. Long-history sources and BoC FX history, with tests.
2. `lib/xray` engine, tests first.
3. Service, routes, text catalog, tests.
4. Messages, UI, layout registration, visual check.
5. Agent tool, prompt, tests.
6. Docs; full gates; review passes; PR.
