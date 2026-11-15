# V2 plan — decisions agreed on 2026-11-15

The brief is `docs/v2-brief.md` (final version). This file records the choices made on top of it. Context: a hackathon demo that will be recorded; the live site goes down the next day. Make it work for the demo; tests are kept light.

## The flow that matters most

1. **Onboarding** gives the persona (level and risk, computed by `rules/v1.json`).
2. **Suggested portfolios**: a few portfolio options built for that persona from a versioned rules table (not by the model), labelled as a teaching example.
3. **Strategy**: a strategy is a named set of one or more rules. It is built with the agent panel (the agent proposes rule cards, the user confirms) or by hand with the same rule cards.
4. **Backtest**: the chosen portfolio is replayed on the frozen snapshot, without and with the strategy, side by side.

## Decisions

| Topic | Decision |
|---|---|
| Replay data | yfinance snapshot built on this machine by `scripts/build_replay_dataset.py`; committed to the repo under `data/replay/<id>/`; S3 is described as the target only |
| Failed or doubtful symbols | excluded, with the reason in the manifest and on screen; never patched |
| Symbol mapping | one committed mapping file: BTC→BTC-USD, ETH→ETH-USD, gold→GLD; bond yields are reference values and are not replayed; QQQ, ESGV, GLD, XBB.TO, ZST.TO, AGG, TLT added to the universe as tradable ETFs |
| Organisers' CSV files | not used by the app and not in the repo |
| X-ray vs time machine | one sentence on both pages: the X-ray applies today's weights to past price changes without dividends; the time machine follows a strategy through time with dividends reinvested; the two figures are not comparable |
| Fractional shares | allowed in the replay, as in the live simulation |
| Rule priority | drawdown guard, then weight cap, then rebalancing, then periodic purchase; 5 trading days before the same rule fires again; minimum order 25 CAD; all in `rules/v1.json` |
| 60/40 benchmark | XIU.TO 60 / XBB.TO 40, rebalanced quarterly |
| Server-side rule evaluation | not built (no EventBridge, no Lambda) |
| Profiles | no visible profile switcher. Hidden addresses select the user: `/u/new` starts a new user (onboarding), `/u/amira`, `/u/mateo`, `/u/robert` open the stored example profiles |
| Sources on screen | cited once per view with asterisk markers and one legend; built once, applied as each screen is touched |
| Drag and drop | react-grid-layout |
| Logos | internal route with an allow-list, monogram fallback |
| Language | French by default, switch visible |
| Voice and streaming | kept as they are |
| Imports by vision | not built |
| Models for subagents | Sonnet for mechanical work, Opus for implementation and review, Fable for the replay engine |

## Order of work

1. Users by hidden address and example profiles; snapshot and data provider; replay engine with the shared rules evaluator and the new rule types; rename and French default.
2. The flow screens: suggested portfolios, strategy builder (agent and manual), time machine page; agent tools `rule_propose` and `run_replay`.
3. Readable agent timeline kept in the reply; agent-proposed modules; cleaner watchlist; portfolio summary fixes; grid layout.
4. Not built unless time remains: imports, guided animations, visual polish.
