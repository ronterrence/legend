# AGENTS.md

## Project
The Legend Dashboard is a versioned sports-data comparison platform.

## Product tiers
- LEGEND = completed-season N-1 data only.
- LEGEND PRO = current-season validated snapshots.
- LEGEND LIVE = real-time provider/event feed.

## Core rules
1. Never use an LLM-generated number as factual sports data.
2. No source -> no statistic.
3. All derived metrics must be deterministic.
4. Every published metric must have provenance.
5. Never treat unavailable historical data as zero.
6. Preserve snapshot reproducibility.
7. Free-tier requests must never trigger a paid live API.
8. Rendering consumes structured JSON; business logic must not live in templates.

## Before changing data logic
Read:
- docs/data/source-policy.md
- docs/product/metric-definitions.md
- docs/architecture/snapshots.md

## Validation
Run:
- unit tests
- schema validation
- metric consistency checks

## Git
Keep changes focused and explain any schema or metric-definition change.