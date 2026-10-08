import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import playerSchema from "../schemas/player.schema.json";
import sourceRecordSchema from "../schemas/source-record.schema.json";
import provenanceSchema from "../schemas/provenance.schema.json";
import snapshotSchema from "../schemas/snapshot.schema.json";
import metricSchema from "../schemas/metric.schema.json";
import {
  validateMetricResult,
  hashCoveredMatches,
  validatePlayer,
  validateProvenance,
  validateSnapshot,
  validateSourceRecord,
  type CanonicalPlayer,
  type CanonicalSnapshot,
  type CoveredMatch,
  type MetricResult,
  type Provenance,
  type SourceRecord,
} from "../src/contracts/index.ts";

const schemas = {
  player: playerSchema,
  "source-record": sourceRecordSchema,
  provenance: provenanceSchema,
  snapshot: snapshotSchema,
  metric: metricSchema,
};
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validators = Object.fromEntries(
  Object.entries(schemas).map(([name, schema]) => [name, ajv.compile(schema)]),
);

function fixture(group: "valid" | "invalid", name: string): unknown {
  return JSON.parse(
    readFileSync(join(process.cwd(), "tests", "fixtures", group, name), "utf8"),
  ) as unknown;
}

test("canonical contracts retain JSON Schema Draft 07 and reject unknown properties", () => {
  for (const [name, schema] of Object.entries(schemas)) {
    assert.equal(
      schema.$schema,
      "http://json-schema.org/draft-07/schema#",
      `${name} schema draft`,
    );
  }
  assert.equal(validators.player!(fixture("valid", "player.json")), true);
  assert.equal(
    validators["source-record"]!(fixture("valid", "source-record.json")),
    true,
  );
  assert.equal(
    validators.provenance!(fixture("valid", "provenance.json")),
    true,
  );
  assert.equal(
    validators.snapshot!(fixture("valid", "snapshot-final.json")),
    true,
  );
  assert.equal(
    validators.snapshot!(fixture("valid", "snapshot-current.json")),
    true,
  );
  assert.equal(
    validators.metric!(fixture("valid", "metric-available.json")),
    true,
  );
  assert.equal(
    validators.metric!(fixture("valid", "metric-unavailable.json")),
    true,
  );
  assert.equal(
    validators.metric!(fixture("valid", "metric-undefined.json")),
    true,
  );
  assert.equal(validators.metric!(fixture("valid", "metric-zero.json")), true);
  assert.equal(
    validators.player!(fixture("invalid", "player-unexpected-field.json")),
    false,
  );
});

test("invalid fixtures fail their contract schemas", () => {
  const cases: [keyof typeof schemas, string][] = [
    ["player", "player-missing-id.json"],
    ["snapshot", "snapshot-mutable.json"],
    ["metric", "metric-available-null.json"],
    ["metric", "metric-missing-snapshot.json"],
    ["metric", "metric-confidence-field-rejected.json"],
    ["metric", "metric-unknown-status.json"],
    ["player", "player-unexpected-field.json"],
    ["source-record", "source-malformed-timestamp.json"],
    ["source-record", "source-missing-evidence-metadata.json"],
    ["provenance", "provenance-confidence-grade.json"],
  ];
  for (const [contract, file] of cases) {
    assert.equal(validators[contract]!(fixture("invalid", file)), false, file);
  }
});

test("TypeScript contract models accept schema-shaped values", () => {
  const player: CanonicalPlayer = {
    player_id: "example_player",
    display_name: "Example Player",
    sport: "football",
    country: "Exampleland",
    active: true,
  };
  const sourceRecord: SourceRecord = {
    source_record_id: "src_example_001",
    provider: "Example Registry",
    source_type: "secondary",
    external_ref: "example-record-123",
    url: "https://example.org/record/123",
    retrieved_at: "2026-09-12T12:00:00Z",
    document_hash:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    attribution: "Synthetic contract test source",
  };
  const provenance: Provenance = {
    provenance_id: "prov_test_001",
    source_record_id: "src_example_001",
    retrieved_at: "2026-09-12T12:00:00Z",
    review_status: "accepted",
    review_reason: "Synthetic contract test fixture",
  };
  const coveredMatches: CoveredMatch[] = [
    { match_id: "match_001", finished_at: "2026-06-01T12:00:00Z" },
  ];
  const snapshot: CanonicalSnapshot = {
    snapshot_id: "2025_26_FINAL_V1",
    snapshot_type: "FINAL",
    season: "2025/26",
    published_at: "2026-07-01T00:00:00Z",
    immutable: true,
    sporting_cutoff_at: "2026-07-01T00:00:00Z",
    coverage: {
      manifest_id: "COVERAGE_2025_26_V1",
      editions: [
        {
          edition_id: "example_league_2025_26",
          competition_id: "example_league",
          competition_name: "Example League",
          season: "2025/26",
          status: "completed",
          start_at: "2025-08-01T00:00:00Z",
          end_at: "2026-06-30T23:59:59Z",
          match_set_hash: hashCoveredMatches(coveredMatches),
          covered_matches: coveredMatches,
        },
      ],
      exclusions: [],
    },
  };
  const metric: MetricResult = {
    metric_id: "test_ratio",
    definition_version: "1.0.0",
    status: "available",
    exact_value: { kind: "rational", numerator: "73", denominator: "100" },
    display_value: "0.73",
    snapshot_id: "2025_26_FINAL_V1",
    scope_id: "test_scope",
    coverage_ref: "COVERAGE_2025_26_V1",
    provenance_ids: ["prov_test_001"],
  };
  validatePlayer(player);
  validateMetricResult(metric, { publishable: true, snapshot });
  validateSourceRecord(sourceRecord);
  validateProvenance(provenance, [sourceRecord]);
  validateSnapshot(snapshot);
  assert.throws(
    () =>
      validateSnapshot({
        ...snapshot,
        sporting_cutoff_at: "2026-07-02T00:00:00Z",
      }),
    /publication/,
  );
  assert.throws(
    () =>
      validateMetricResult(metric, {
        snapshot: { ...snapshot, snapshot_id: "OTHER" },
      }),
    /snapshot reference/,
  );
});

test("snapshot coverage identifies included editions and verifies the covered match population", () => {
  const snapshot = fixture("valid", "snapshot-final.json") as CanonicalSnapshot;
  assert.doesNotThrow(() => validateSnapshot(snapshot));
  assert.equal(snapshot.coverage.editions[0]?.covered_matches.length, 1);
  const changed = structuredClone(snapshot);
  changed.coverage.editions[0]!.covered_matches[0]!.match_id =
    "different_match";
  assert.throws(() => validateSnapshot(changed), /hash mismatch/);
});

test("semantic invariants distinguish missing, undefined, zero, and reject duplicate aliases", () => {
  assert.throws(
    () => validatePlayer(fixture("invalid", "player-duplicate-alias.json")),
    /repeat/,
  );
  const unavailable = fixture(
    "valid",
    "metric-unavailable.json",
  ) as MetricResult;
  const undefinedMetric = fixture(
    "valid",
    "metric-undefined.json",
  ) as MetricResult;
  const zero = fixture("valid", "metric-zero.json") as MetricResult;
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.exact_value, null);
  assert.equal(undefinedMetric.status, "undefined");
  assert.equal(undefinedMetric.exact_value, null);
  assert.deepEqual(zero.exact_value, { kind: "integer", value: "0" });
  assert.doesNotThrow(() => validateMetricResult(unavailable));
  assert.doesNotThrow(() => validateMetricResult(undefinedMetric));
  assert.doesNotThrow(() => validateMetricResult(zero));
  assert.throws(
    () => validateMetricResult(unavailable, { publishable: true }),
    /provenance/,
  );
  assert.throws(
    () => validateSnapshot(fixture("invalid", "snapshot-b0-after-cutoff.json")),
    /cutoff/,
  );
});

test("provenance source references are checked when source records are supplied", () => {
  const provenance = fixture("valid", "provenance.json");
  assert.throws(
    () => validateProvenance(provenance, []),
    /Unknown source record/,
  );
});
