# Legend architecture

One TypeScript application, one local Node process, SQLite and preserved source documents. The HTTP server binds to 127.0.0.1 and validates Host and write-request Origin. Vite supplies development assets; the built bundle is served by the same server in production mode. Node 24.13's experimental SQLite API is isolated in src/storage.

Dependency flow: ingestion → normalization/review → validation → storage → metric engine → validated dashboard JSON → rendering. React never computes sports metrics. Source-specific imports cannot overwrite published snapshots. SQLite user_version=1 establishes the initial schema; subsequent releases must supply forward migrations.

Snapshots, manifests and saved dashboard payloads are immutable. Aliases resolve once. Exports are stored by comparison ID and page, with JSON metadata. Changing source data does not regenerate old exports. Retain renderer-version compatibility before changing templates in a future release.

Source adapters have separate responsibilities: RSSSF parses supported international-cap tables into candidate match records with cumulative-total checks; Transfermarkt uses canonical reviewed imports until access is established; API-Football preserves paginated responses and requires review before B1 publication. No LLM or live-feed dependency exists.

API: GET /api/players, /api/snapshots, /api/comparisons, /api/comparisons/:id, /api/provider. POST /api/comparisons accepts exactly one snapshotId/snapshotAlias and optional two playerIds. POST /api/comparisons/:id/export accepts page=overview|efficiency and returns PNG/metadata download paths. POST /api/provider/refresh creates a review report. Errors are JSON with an error field. Write calls require same-origin JSON.

Observability: source review reports, API request ledger, last provider import/error and quota status. No secrets are logged. B0 reads/exports operate offline. B1 is optional and does not merge season statistics into career totals.
