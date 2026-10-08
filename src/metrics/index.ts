import type { MetricResult, Provenance } from "../contracts/index.ts";
import type {
  Dashboard,
  InternationalCategory,
  MetricId,
  MetricRow,
  MetricValue,
  Observation,
  Snapshot,
} from "../domain.ts";
import {
  calculateMetric,
  metricRegistry,
  type DeterministicMetricId,
  provenanceIdFor,
} from "./engine.ts";

type Definition = {
  id: string;
  label: string;
  inputs: MetricId[];
  formula: string;
  unit: string;
  precision: number;
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
  formula: "Verified count within declared coverage",
  unit: "",
  precision: 0,
  direction: "higher",
  page: "overview",
}));

export const definitions: Definition[] = [
  ...counts,
  {
    id: "goals_per_game",
    label: "Goals per game",
    inputs: ["goals", "appearances"],
    formula: "Goals ÷ appearances",
    unit: "per game",
    precision: 2,
    direction: "higher",
    page: "efficiency",
  },
  {
    id: "non_penalty_goals",
    label: "Non-penalty goals",
    inputs: ["goals", "penalty_goals"],
    formula: "Goals − penalty goals",
    unit: "goals",
    precision: 0,
    direction: "higher",
    page: "efficiency",
  },
  {
    id: "non_penalty_goals_per_game",
    label: "Non-penalty goals per game",
    inputs: ["goals", "penalty_goals", "appearances"],
    formula: "(Goals − penalty goals) ÷ appearances",
    unit: "per game",
    precision: 2,
    direction: "higher",
    page: "efficiency",
  },
  {
    id: "goal_contributions",
    label: "Goal contributions",
    inputs: ["goals", "assists"],
    formula: "Goals + assists",
    unit: "contributions",
    precision: 0,
    direction: "higher",
    page: "efficiency",
  },
  {
    id: "goal_contributions_per_game",
    label: "Goal contributions per game",
    inputs: ["goals", "assists", "appearances"],
    formula: "(Goals + assists) ÷ appearances",
    unit: "per game",
    precision: 2,
    direction: "higher",
    page: "efficiency",
  },
  {
    id: "minutes_per_goal",
    label: "Minutes per goal",
    inputs: ["minutes", "goals"],
    formula: "Minutes played ÷ goals",
    unit: "minutes",
    precision: 0,
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

function projectResult(
  result: MetricResult,
  observations: readonly Observation[],
): MetricValue {
  let value: MetricValue["value"] = null;
  if (result.exact_value?.kind === "integer")
    value = { numerator: result.exact_value.value, denominator: "1" };
  else if (result.exact_value?.kind === "rational")
    value = {
      numerator: result.exact_value.numerator,
      denominator: result.exact_value.denominator,
    };
  else if (result.exact_value?.kind === "decimal")
    value = {
      numerator: result.exact_value.value.replace(".", ""),
      denominator: `1${"0".repeat(result.exact_value.value.split(".")[1]?.length ?? 0)}`,
    };
  return {
    value,
    display: result.display_value ?? "N/A",
    status:
      result.status === "disputed" || result.status === "provisional"
        ? "unavailable"
        : result.status,
    reason: result.reason ?? null,
    sourceIds: [
      ...new Set(observations.flatMap((row) => row.sourceIds)),
    ].sort(),
    result,
  };
}

function directFact(
  id: string,
  observations: readonly Observation[],
  category: InternationalCategory,
): MetricValue {
  const row = observations.find(
    (item) => item.metric === id && (item.category ?? "overall") === category,
  );
  const sourceIds = [...new Set(row?.sourceIds ?? [])].sort();
  if (
    !row ||
    row.value === null ||
    row.coverage !== "complete" ||
    row.review !== "accepted"
  ) {
    return {
      value: null,
      display: "N/A",
      status: "unavailable",
      reason: !row ? "missing_input" : "unavailable_input",
      sourceIds,
    };
  }
  if (row.value < 0 || !Number.isFinite(row.value))
    throw new Error("invalid_input");
  const n = BigInt(row.value);
  return {
    value: { numerator: n.toString(), denominator: "1" },
    display: n.toString(),
    status: "available",
    reason: null,
    sourceIds,
  };
}

export function calculate(
  id: string,
  observations: Observation[],
  category: InternationalCategory = "overall",
  snapshot = contextFor(observations),
): MetricValue {
  if (id in metricRegistry) {
    const relevant = observations.filter(
      (row) => (row.category ?? "overall") === category,
    );
    return projectResult(
      calculateMetric(
        id as DeterministicMetricId,
        snapshot,
        observations,
        category,
      ),
      relevant,
    );
  }
  return directFact(id, observations, category);
}

function comparison(
  left: MetricValue,
  right: MetricValue,
  direction: "higher" | "lower",
): { leader: MetricRow["leader"]; comparison: string } {
  if (!left.value || !right.value)
    return { leader: null, comparison: "Not comparable" };
  const diff =
    BigInt(left.value.numerator) * BigInt(right.value.denominator) -
    BigInt(right.value.numerator) * BigInt(left.value.denominator);
  const comparison =
    diff === 0n
      ? "Exact tie"
      : left.display === right.display
        ? "Equal at displayed precision"
        : "Comparable within coverage";
  const leader =
    diff !== 0n && left.display !== right.display
      ? diff > 0n === (direction === "higher")
        ? "left"
        : "right"
      : null;
  return { leader, comparison };
}

function rowFor(
  definition: Definition,
  players: Snapshot["players"],
  snapshot: Snapshot,
  category: InternationalCategory = "overall",
): MetricRow {
  const values = players.map((player) =>
    calculate(
      definition.id,
      snapshot.observations.filter((row) => row.playerId === player.id),
      category,
      snapshot,
    ),
  );
  const leftFacts = snapshot.observations.filter(
    (row) =>
      row.playerId === players[0]!.id &&
      (row.category ?? "overall") === category,
  );
  const rightFacts = snapshot.observations.filter(
    (row) =>
      row.playerId === players[1]!.id &&
      (row.category ?? "overall") === category,
  );
  const inputIds =
    metricRegistry[definition.id as DeterministicMetricId]?.inputs ??
    definition.inputs;
  const compatiblePopulation = inputIds.every((inputId) => {
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
  const result = compatiblePopulation
    ? comparison(values[0]!, values[1]!, definition.direction)
    : { leader: null, comparison: "Not comparable" };
  return {
    id:
      category === "overall"
        ? definition.id
        : `international_${category}_${definition.id}`,
    label: definition.label,
    formula: definition.formula,
    unit: definition.unit,
    direction: definition.direction,
    left: values[0]!,
    right: values[1]!,
    ...result,
  };
}

export function assemble(
  snapshot: Snapshot,
  id: string,
  createdAt = new Date().toISOString(),
): Dashboard {
  const internationalGroups: {
    id: InternationalCategory;
    label: string;
    description: string;
  }[] = [
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
      description: "European Championship and Copa América finals",
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
  ];
  const derived = definitions.filter(
    (definition) => definition.id in metricRegistry,
  );
  const metricResults = snapshot.players.flatMap((player) =>
    derived.map((definition) =>
      calculateMetric(
        definition.id as DeterministicMetricId,
        snapshot,
        snapshot.observations.filter((row) => row.playerId === player.id),
      ),
    ),
  );
  for (const player of snapshot.players)
    for (const category of internationalGroups
      .map((group) => group.id)
      .filter((id) => id !== "overall")) {
      metricResults.push(
        calculateMetric(
          "goals_per_game",
          snapshot,
          snapshot.observations.filter((row) => row.playerId === player.id),
          category,
        ),
      );
    }
  const sourcesById = new Map(
    snapshot.sources.map((source) => [source.id, source]),
  );
  const provenanceById = new Map<string, Provenance>();
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
  const pages: Dashboard["pages"] = {
    overview: definitions
      .filter((definition) => definition.page === "overview")
      .map((definition) => rowFor(definition, snapshot.players, snapshot)),
    efficiency: definitions
      .filter((definition) => definition.page === "efficiency")
      .map((definition) => rowFor(definition, snapshot.players, snapshot)),
    international: internationalGroups.map((group) => ({
      ...group,
      rows: ["appearances", "goals", "goals_per_game"].map((id) =>
        rowFor(
          definitions.find((definition) => definition.id === id)!,
          snapshot.players,
          snapshot,
          group.id,
        ),
      ),
    })),
  };
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
