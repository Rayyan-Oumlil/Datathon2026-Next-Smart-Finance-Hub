# Documentation

Start with the [project README](../README.md) ([en français](../README.fr.md)). This folder contains the reference documents and the working notes.

## Reference

| Document | What it covers |
|---|---|
| [spec.md](spec.md) | The full specification: what the app does, the rules, the decisions and the open points. Written from the two boards in [boards/](boards/) and the build brief. |
| [agent-api.md](agent-api.md) | The contract between the web app and the agent service: requests, internal tool routes, previews, undo, logs and environment variables. |
| [data-sources.md](data-sources.md) | Every data source, its endpoint, its terms of use and its limits. |
| [../agent/README.md](../agent/README.md) | The agent service: orchestrator, subagents, checks, prompts and glossary. |
| [../rules/v1.json](../rules/v1.json) | Every threshold, weight and formula the app applies. |

## Design notes

| Document | What it covers |
|---|---|
| [superpowers/specs/2026-11-15-portfolio-xray-design.md](superpowers/specs/2026-11-15-portfolio-xray-design.md) | Method and design of the portfolio X-ray. |
| [superpowers/specs/2026-11-15-agent-streaming-design.md](superpowers/specs/2026-11-15-agent-streaming-design.md) | How the agent's stages are streamed live. |

## Working notes (kept for the record)

These files were written during the hackathon to drive the work. Code comments and `rules/v1.json` point to them, so they stay where they are.

| Document | What it is |
|---|---|
| [v2-brief.md](v2-brief.md) | The build brief for the second version (in French). |
| [v2-plan.md](v2-plan.md) | The decisions agreed on top of the brief, on 2026-11-15. |

## Images

[boards/](boards/) holds the two specification boards. [images/](images/) holds the pictures used in the README.
