import Ajv from "ajv";
import addFormats from "ajv-formats";
import { createHash } from "node:crypto";
import playerSchema from "../../schemas/player.schema.json";
import sourceRecordSchema from "../../schemas/source-record.schema.json";
import provenanceSchema from "../../schemas/provenance.schema.json";
import snapshotSchema from "../../schemas/snapshot.schema.json";
import metricSchema from "../../schemas/metric.schema.json";

export interface PlayerAlias {
  provider: string;
  external_id: string;
  name: string;
}

export interface CanonicalPlayer {
  player_id: string;
  display_name: string;
  sport: "football";
  country: string;
  active?: boolean;
  birth_date?: string;
  aliases?: PlayerAlias[];
}

export type SourceType =
  | "official"
  | "enterprise_provider"
  | "midmarket_provider"
  | "historical_archive"
  | "secondary";

export interface SourceRecord {
  source_record_id: string;
  provider: string;
  source_type: SourceType;
  url: string;
  retrieved_at: string;
  document_hash: string;
  attribution: string;
  external_ref: string;
  license_class?: string;
  notes?: string;
}

export type ReviewStatus = "pending" | "accepted" | "rejected";

export interface Provenance {
  provenance_id: string;
  source_record_id: string;
  retrieved_at: string;
  review_status: ReviewStatus;
  review_reason: string;
}

export type SnapshotType = "FINAL" | "CURRENT" | "LIVE";

export interface CoveredMatch {
  match_id: string;
  finished_at: string;
}

export interface CoveredEdition {
  edition_id: string;
  competition_id: string;
  competition_name: string;
  season: string;
  status: "completed" | "in_progress";
  start_at: string;
  end_at: string;
  match_set_hash: string;
  covered_matches: CoveredMatch[];
}

export interface SnapshotCoverage {
  manifest_id: string;
  editions: CoveredEdition[];
  exclusions: string[];
}

export interface CanonicalSnapshot {
  snapshot_id: string;
  snapshot_type: SnapshotType;
  season: string;
  published_at: string;
  immutable: true;
  sporting_cutoff_at: string;
  coverage: SnapshotCoverage;
  supersedes?: string | null;
  metric_definition_version?: string;
  source_set_version?: string;
}

export type MetricStatus =
  "available" | "unavailable" | "undefined" | "disputed" | "provisional";

export type ExactValue =
  | { kind: "integer"; value: string }
  | { kind: "decimal"; value: string }
  | { kind: "rational"; numerator: string; denominator: string };

export interface MetricResult {
  metric_id: string;
  definition_version: string;
  status: MetricStatus;
  exact_value: ExactValue | null;
  display_value?: string;
  reason?: string;
  snapshot_id: string;
  scope_id: string;
  coverage_ref: string;
  provenance_ids: string[];
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const validators = {
  player: ajv.compile<CanonicalPlayer>(playerSchema),
  sourceRecord: ajv.compile<SourceRecord>(sourceRecordSchema),
  provenance: ajv.compile<Provenance>(provenanceSchema),
  snapshot: ajv.compile<CanonicalSnapshot>(snapshotSchema),
  metric: ajv.compile<MetricResult>(metricSchema),
};

function assertValid<T>(
  valid: (value: unknown) => value is T,
  value: unknown,
  label: string,
): asserts value is T {
  if (!valid(value)) {
    const details = (
      valid as typeof valid & {
        errors?: { instancePath: string; message?: string }[];
      }
    ).errors
      ?.map(
        (error) =>
          `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
      )
      .join("; ");
    throw new Error(
      `${label} validation failed${details ? `: ${details}` : ""}`,
    );
  }
}

export function validatePlayer(
  value: unknown,
): asserts value is CanonicalPlayer {
  assertValid(validators.player, value, "Player");
  const seen = new Set<string>();
  for (const alias of value.aliases ?? []) {
    const key = `${alias.provider}\u0000${alias.external_id}`;
    if (seen.has(key))
      throw new Error(
        "Player aliases must not repeat a provider and external ID",
      );
    seen.add(key);
  }
}

export function validateSourceRecord(
  value: unknown,
): asserts value is SourceRecord {
  assertValid(validators.sourceRecord, value, "Source record");
}

export function validateProvenance(
  value: unknown,
  sourceRecords?: readonly SourceRecord[],
): asserts value is Provenance {
  assertValid(validators.provenance, value, "Provenance");
  if (
    sourceRecords &&
    !sourceRecords.some(
      (record) => record.source_record_id === value.source_record_id,
    )
  ) {
    throw new Error(`Unknown source record: ${value.source_record_id}`);
  }
}

export function validateSnapshot(
  value: unknown,
): asserts value is CanonicalSnapshot {
  assertValid(validators.snapshot, value, "Snapshot");
  const snapshot = value;
  const cutoff = Date.parse(snapshot.sporting_cutoff_at);
  if (cutoff > Date.parse(snapshot.published_at)) {
    throw new Error("Sporting cutoff must not follow snapshot publication");
  }
  const editionIds = new Set<string>();
  for (const edition of snapshot.coverage.editions) {
    if (editionIds.has(edition.edition_id)) {
      throw new Error(`Duplicate coverage edition: ${edition.edition_id}`);
    }
    editionIds.add(edition.edition_id);
    if (Date.parse(edition.start_at) > Date.parse(edition.end_at)) {
      throw new Error(`Invalid edition date bounds: ${edition.edition_id}`);
    }
    if (snapshot.snapshot_type === "FINAL") {
      if (edition.status !== "completed") {
        throw new Error(
          "FINAL snapshots require completed competition editions",
        );
      }
      if (Date.parse(edition.end_at) >= cutoff) {
        throw new Error(
          "FINAL editions must end before the exclusive sporting cutoff",
        );
      }
    }
    const matchIds = new Set<string>();
    for (const match of edition.covered_matches) {
      if (matchIds.has(match.match_id)) {
        throw new Error(`Duplicate covered match: ${match.match_id}`);
      }
      matchIds.add(match.match_id);
      const finishedAt = Date.parse(match.finished_at);
      if (
        finishedAt < Date.parse(edition.start_at) ||
        finishedAt > Date.parse(edition.end_at)
      ) {
        throw new Error(
          `Covered match outside edition bounds: ${match.match_id}`,
        );
      }
      if (finishedAt >= cutoff) {
        throw new Error(
          `Covered match is at or after the exclusive sporting cutoff: ${match.match_id}`,
        );
      }
    }
    const actualHash = hashCoveredMatches(edition.covered_matches);
    if (actualHash !== edition.match_set_hash) {
      throw new Error(`Covered match set hash mismatch: ${edition.edition_id}`);
    }
  }
}

export function hashCoveredMatches(matches: readonly CoveredMatch[]): string {
  const ordered = [...matches].sort((left, right) =>
    left.match_id < right.match_id
      ? -1
      : left.match_id > right.match_id
        ? 1
        : 0,
  );
  const canonical = JSON.stringify(
    ordered.map(({ match_id, finished_at }) => ({ match_id, finished_at })),
  );
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function validateMetricResult(
  value: unknown,
  options: { publishable?: boolean; snapshot?: CanonicalSnapshot } = {},
): asserts value is MetricResult {
  assertValid(validators.metric, value, "Metric result");
  if (options.publishable && value.provenance_ids.length === 0) {
    throw new Error(
      "Publishable metric results require at least one provenance ID",
    );
  }
  if (options.snapshot) {
    if (value.snapshot_id !== options.snapshot.snapshot_id) {
      throw new Error("Metric snapshot reference does not match its snapshot");
    }
    if (value.coverage_ref !== options.snapshot.coverage.manifest_id) {
      throw new Error("Metric coverage reference does not match its snapshot");
    }
  }
}
