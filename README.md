# Legend — Comparison Studio

A local football comparison studio with two dashboard modules, exact calculations, immutable snapshots, source inspection, saved comparisons and portrait PNG exports.

## Run on Windows

Requires Node 24.13 or later. From this directory:

```powershell
npm.cmd install
npx.cmd playwright install chromium
npm.cmd run dev
```

Open **http://127.0.0.1:4317**. `npm.cmd` avoids PowerShell's npm.ps1 execution-policy issue. Stop with Ctrl+C. For built assets run `npm.cmd run build`, then `npm.cmd start`. No API key is needed for the studio or exports.

The studio includes a clearly labeled synthetic demo snapshot and a verified international-only snapshot, `B0_INTL_2025_V1`, through 14 November 2025. The verified snapshot covers appearances and goals from the preserved RSSSF records; assists, minutes, trophies and awards remain unavailable. No current-season or live data is implied.

## Use the studio

Select two players and a snapshot; choose Career Overview, Goal Efficiency, or International Performance; build to save a comparison. The international page groups the preserved records into Overall, Friendlies, World Cup, Continental championship, Qualifiers, and Other. Click a metric for its formula, exact value and sources. Open Sources & coverage for scope and exclusions. Export PNG creates a 1080 × 1920 image plus a JSON metadata download. My comparisons reopens pinned results. No viewing/export action calls a data provider.

## Source workflows

`npm.cmd run collect:rsssf` downloads only the two allowlisted international-record pages into runtime/sources and writes runtime/reports/rsssf-*.json. The parser validates contiguous appearances and cumulative goals. Reports are candidates, not published benchmarks. The current inspected pages do not establish complete 2025/26 coverage, and Messi's table contains cumulative-total inconsistencies requiring review.

For a previously downloaded page:

```powershell
npm.cmd run inspect:rsssf -- path/to/source.html https://www.rsssf.org/miscellaneous/cronaldo-intlg.html
```

After the allowlisted reports have been reviewed, generate the international-only B0 candidate:

```powershell
npm.cmd run prepare:b0
npm.cmd run import -- runtime/bundles/b0-international.json
```

This candidate publishes only international appearances and goals. Assists, minutes, penalty goals, trophies and awards remain unavailable. The bundle records the Messi cap-110 cumulative-field correction explicitly; it does not alter any per-match goal value. Review `runtime/bundles/b0-international.json` before importing it.

Transfermarkt is an additional verification source. No automated Transfermarkt collector or unofficial API is assumed. Review the access/reuse conditions and scope (including reserve-team competitions) before importing observations.

### Publish reviewed data

Create a JSON bundle with `snapshot` matching schemas/snapshot.schema.json, optional `alias`, and `evidence`: an array of `{ "path": "relative/source-file", "hash": "sha256" }`. Paths are relative to the bundle. Include all source documents and match-set evidence in this array.

Every observation needs accepted review, a reason, source IDs, definition version and declared match-set scope. Missing metrics use null and unknown/partial coverage. Conflicts must be reconciled before import; duplicate player/metric observations are rejected.

Verified coverage editions must supply startAt, endAt and matchSetHash. The preserved match-set document is a JSON array of `{ "id": "unique-match-id", "finishedAt": "ISO UTC timestamp" }`. Every match must fall within the edition bounds; the edition must end before the exclusive cutoff. B0 editions must be completed. The reviewer remains responsible for verifying completeness, player participation and scope against original evidence.

```powershell
npm.cmd run import -- path/to/bundle.json
```

Identical reimports are idempotent. Changed content requires a new snapshot ID. Old comparisons and exports remain pinned. Start the server again or reload the studio to see newly imported snapshots.

## API-Football pilot

1. Copy .env.example to .env and set API_FOOTBALL_KEY locally. Never put it in browser code or version control.
2. Copy fixtures/cr7-vs-messi/provider.example.json to runtime/provider.json. Replace the zero placeholders with reviewed provider player IDs, competition IDs and current season years. This pilot selects one competition per player, not complete career coverage.
3. Open Provider connections and refresh, or run `npm.cmd run provider`.

The adapter verifies the selected current season and player-stat coverage, then checks access by requesting the player data. It caches reference data for seven days and player data for twelve hours. Pages/retries count toward a persistent 80-attempt UTC daily budget under the provider's advertised 100/day allowance. Account season restrictions still apply. Import reports need review and canonical publication; a successful download is not a published B1 snapshot.

The running server checks for scheduled refresh every twelve hours. Manual refresh uses the same cache and budget. Network/transient failures allow at most two retries. Authentication, entitlement and quota errors stop the operation. Last valid snapshots remain available. B2/B3 and billing are not implemented.

## Validation

```powershell
npm.cmd run check
npm.cmd run test:e2e
```

Checks include exact ratios, missing inputs, schema/provenance, immutable snapshots, alias pinning, source parser failures and provider quota handling. Browser tests cover create/inspect/save, both PNG exports, footer containment, mobile overflow and cross-origin write rejection. Screenshots are written under runtime.

## Storage and backup

All user state is in runtime/ unless LEGEND_DATA_DIR is configured. It contains legend.sqlite, hash-addressed sources, review reports and exports. Stop the server before copying the complete directory for backup; restore it together to retain provenance and export history. Keep the directory private. The app is loopback-only and has no multi-user authentication.

See ARCHITECTURE.md, docs/data/source-policy.md and docs/architecture/snapshots.md for the operating contracts.
