import type { MetricResult, Provenance } from "../contracts/index.ts";
import type {
  Dashboard,
  InternationalCategory,
  MetricId,
  MetricRow,
  Observation,
  Snapshot,
} from "../domain.ts";
import {
  calculateMetric,
  compareMetricResults,
  metricRegistry,
  metricResultForFact,
  type DeterministicMetricId,
  provenanceIdFor,
} from "./engine.ts";

type Definition = {
  id: MetricId | DeterministicMetricId;
  label: string;
  inputs: readonly MetricId[];
  unit: string;
  direction: "higher" | "lower";
  page: "overview" | "efficiency";
};

const counts: Definition[] = [
  ["appearances", "Appearances"],
  ["goals", "Goals"],
  ["assists", "Assists"],
  ["club_trophies", "Major club trophies"],
  ["international_trophies", "International trophies"],
  ["awards", "Individual awards"],
].map(([id, label]) => ({
  id: id as MetricId,
  label: label!,
  inputs: [id as MetricId],
  unit: "",
  direction: "higher",
  page: "overview",
}));

export const definitions: Definition[] = [
  ...counts,
  {
    id: "goals_per_game",
    label: "Goals per game",
    inputs: ["goals", "appearances"],
    unit: "per game",
    direction: "higher",
    page: "efficiency",
  },
  {
    id: "non_penalty_goals",
    label: "Non-penalty goals",
    inputs: ["goals", "penalty_goals"],
    unit: "goals",
    direction: "higher",
    page: "efficiency",
  },
  {
    id: "non_penalty_goals_per_game",
    label: "Non-penalty goals per game",
    inputs: ["goals", "penalty_goals", "appearances"],
    unit: "per game",
    direction: "higher",
    page: "efficiency",
  },
  {
    id: "goal_contributions",
    label: "Goal contributions",
    inputs: ["goals", "assists"],
    unit: "contributions",
    direction: "higher",
    page: "efficiency",
  },
  {
    id: "goal_contributions_per_game",
    label: "Goal contributions per game",
    inputs: ["goals", "assists", "appearances"],
    unit: "per game",
    direction: "higher",
    page: "efficiency",
  },
  {
    id: "minutes_per_goal",
    label: "Minutes per goal",
    inputs: ["minutes", "goals"],
    unit: "minutes",
    direction: "lower",
    page: "efficiency",
  },
];

export function formatRatio(n: bigint, d: bigint, precision: number): string {
  if (d === 0n) throw new Error("Cannot format a zero denominator");
  const scale = 10n ** BigInt(precision);
  const value = (n * scale * 2n + d) / (2n * d);
  const text = value.toString().padStart(precision + 1, "0");
  return precision
    ? `${text.slice(0, -precision)}.${text.slice(-precision)}`
    : text;
}

function contextFor(observations: readonly Observation[]): Snapshot {
  const first = observations[0];
  return {
    id: "metric_context",
    label: "Metric calculation",
    freshness: "B0",
    kind: "demo",
    publishedAt: "2000-01-01T00:00:00Z",
    manifest: {
      id: first?.matchSetId ?? "metric_coverage",
      scopeId: first?.scopeId ?? "metric_scope",
      policy: "completed_editions",
      cutoffAt: "2000-01-01T00:00:00Z",
      editions: [],
      exclusions: [],
      validated: true,
    },
    players: [],
    sources: [],
    observations: [...observations],
  };
}

export function calculate(
  id: string,
  observations: Observation[],
  category: InternationalCategory = "overall",
  snapshot = contextFor(observations),
): MetricResult {
  return id in metricRegistry
    ? calculateMetric(
        id as DeterministicMetricId,
        snapshot,
        observations,
        category,
      )
    : metricResultForFact(id as MetricId, snapshot, observations, category);
}

function comparablePopulation(
  definition: Definition,
  leftFacts: readonly Observation[],
  rightFacts: readonly Observation[],
): boolean {
  return definition.inputs.every((inputId) => {
    const left = leftFacts.find((row) => row.metric === inputId);
    const right = rightFacts.find((row) => row.metric === inputId);
    return (
      !!left &&
      !!right &&
      left.scopeId === right.scopeId &&
      left.matchSetId === right.matchSetId &&
      left.definitionVersion === right.definitionVersion
    );
  });
}

function comparison(
  left: MetricResult,
  right: MetricResult,
  direction: "higher" | "lower",
  compatible: boolean,
): Pick<MetricRow, "leader" | "comparison"> {
  if (!compatible) return { leader: null, comparison: "Not comparable" };
  const result = compareMetricResults(left, right);
  if (result === null) return { leader: null, comparison: "Not comparable" };
  if (result === 0) return { leader: null, comparison: "Exact tie" };
  if (left.display_value === right.display_value)
    return { leader: null, comparison: "Equal at displayed precision" };
  const leftLeads = result > 0 === (direction === "higher");
  return {
    leader: leftLeads ? "left" : "right",
    comparison: "Comparable within coverage",
  };
}

function rowFor(
  definition: Definition,
  players: Snapshot["players"],
  snapshot: Snapshot,
  category: InternationalCategory = "overall",
): MetricRow {
  const facts = players.map((player) =>
    snapshot.observations.filter(
      (row) =>
        row.playerId === player.id && (row.category ?? "overall") === category,
    ),
  );
  const values = facts.map((playerFacts) =>
    calculate(definition.id, playerFacts, category, snapshot),
  );
  return {
    id:
      category === "overall"
        ? definition.id
        : `international_${category}_${definition.id}`,
    label: definition.label,
    unit: definition.unit,
    direction: definition.direction,
    left: values[0]!,
    right: values[1]!,
    ...comparison(
      values[0]!,
      values[1]!,
      definition.direction,
      comparablePopulation(definition, facts[0]!, facts[1]!),
    ),
  };
}

const internationalGroups = [
  {
    id: "overall",
    label: "Overall",
    description: "All covered senior international matches",
  },
  {
    id: "friendly",
    label: "Friendlies",
    description: "Recognized senior international friendlies",
  },
  {
    id: "world_cup",
    label: "World Cup",
    description: "World Cup finals matches",
  },
  {
    id: "continental",
    label: "Continental championship",
    description: "European Championship and Copa AmÃ©rica finals",
  },
  {
    id: "qualifier",
    label: "Qualifiers",
    description: "World Cup and continental qualifiers",
  },
  {
    id: "other",
    label: "Other",
    description: "Other covered senior international competitions",
  },
] as const;

export function assemble(
  snapshot: Snapshot,
  id: string,
  createdAt = new Date().toISOString(),
): Dashboard {
  const pages: Dashboard["pages"] = {
    overview: definitions
      .filter((definition) => definition.page === "overview")
      .map((definition) => rowFor(definition, snapshot.players, snapshot)),
    efficiency: definitions
      .filter((definition) => definition.page === "efficiency")
      .map((definition) => rowFor(definition, snapshot.players, snapshot)),
    international: internationalGroups.map((group) => ({
      ...group,
      rows: ["appearances", "goals", "goals_per_game"].map((metricId) =>
        rowFor(
          definitions.find((definition) => definition.id === metricId)!,
          snapshot.players,
          snapshot,
          group.id,
        ),
      ),
    })),
  };
  const provenanceById = new Map<string, Provenance>();
  const sourcesById = new Map(
    snapshot.sources.map((source) => [source.id, source]),
  );
  for (const row of snapshot.observations)
    for (const sourceId of row.sourceIds) {
      const source = sourcesById.get(sourceId);
      if (!source) continue;
      const record: Provenance = {
        provenance_id: provenanceIdFor(row, sourceId),
        source_record_id: sourceId,
        retrieved_at: source.retrievedAt,
        review_status: row.review,
        review_reason: row.reviewReason,
      };
      provenanceById.set(record.provenance_id, record);
    }
  const rows = [
    ...pages.overview,
    ...pages.efficiency,
    ...pages.international.flatMap((group) => group.rows),
  ];
  const metricResults = rows.flatMap((row) => [row.left, row.right]);
  return {
    id,
    createdAt,
    snapshotId: snapshot.id,
    label: snapshot.label,
    freshness: snapshot.freshness,
    kind: snapshot.kind,
    scopeId: snapshot.manifest.scopeId,
    cutoffAt: snapshot.manifest.cutoffAt,
    coverage: snapshot.manifest,
    definitionVersion: "v1",
    rendererVersion: "v1",
    players: snapshot.players,
    sources: snapshot.sources,
    provenance: [...provenanceById.values()].sort((a, b) =>
      a.provenance_id.localeCompare(b.provenance_id),
    ),
    metricResults,
    pages,
    narrative:
      "A comparison is only as complete as its evidence. Explore the definitions and coverage behind every number.",
  };
}
