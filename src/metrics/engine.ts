import type { MetricResult, ExactValue } from "../contracts/index.ts";
import type { MetricId, Observation, Snapshot } from "../domain.ts";
import { validateMetricResult } from "../contracts/index.ts";

type Rational = { n: bigint; d: bigint };
type Values = Partial<Record<MetricId, number>>;
type RegistryEntry = {
  inputs: readonly MetricId[];
  precision: number;
  unit: string;
  direction: "higher" | "lower";
  integer: boolean;
  version: string;
  availabilityClass: "reviewed_coverage_required";
  calculate: (values: Values) => Rational;
};
const idPart = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
export const provenanceIdFor = (row: Observation, sourceId: string) =>
  `prov_${idPart(row.playerId)}_${idPart(row.metric)}_${idPart(row.category ?? "overall")}_${idPart(sourceId)}`;

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a < 0n ? -a : a;
}
function reduce(n: bigint, d: bigint): Rational {
  if (d === 0n) throw new Error("Cannot represent a zero denominator");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const divisor = gcd(n, d) || 1n;
  return { n: n / divisor, d: d / divisor };
}
function decimalRational(value: number): Rational {
  if (!Number.isFinite(value) || value < 0) throw new Error("invalid_input");
  const [base, exponent = "0"] = value.toString().toLowerCase().split("e");
  const parts = base!.split("."),
    shift = Number(exponent) - (parts[1]?.length ?? 0);
  return shift >= 0
    ? reduce(BigInt(parts.join("")) * 10n ** BigInt(shift), 1n)
    : reduce(BigInt(parts.join("")), 10n ** BigInt(-shift));
}
const get = (values: Values, id: MetricId) => {
  const value = values[id];
  if (value === undefined) throw new Error(`missing_input: ${id}`);
  return value;
};

export const metricRegistry = {
  goals_per_game: {
    inputs: ["goals", "appearances"],
    precision: 2,
    unit: "ratio",
    direction: "higher",
    integer: false,
    version: "1.0.0",
    availabilityClass: "reviewed_coverage_required",
    calculate: (v: Values) =>
      reduce(BigInt(get(v, "goals")), BigInt(get(v, "appearances"))),
  },
  non_penalty_goals: {
    inputs: ["goals", "penalty_goals"],
    precision: 0,
    unit: "goals",
    direction: "higher",
    integer: true,
    version: "1.0.0",
    availabilityClass: "reviewed_coverage_required",
    calculate: (v: Values) =>
      reduce(BigInt(get(v, "goals") - get(v, "penalty_goals")), 1n),
  },
  non_penalty_goals_per_game: {
    inputs: ["goals", "penalty_goals", "appearances"],
    precision: 2,
    unit: "ratio",
    direction: "higher",
    integer: false,
    version: "1.0.0",
    availabilityClass: "reviewed_coverage_required",
    calculate: (v: Values) =>
      reduce(
        BigInt(get(v, "goals") - get(v, "penalty_goals")),
        BigInt(get(v, "appearances")),
      ),
  },
  goal_contributions: {
    inputs: ["goals", "assists"],
    precision: 0,
    unit: "contributions",
    direction: "higher",
    integer: true,
    version: "1.0.0",
    availabilityClass: "reviewed_coverage_required",
    calculate: (v: Values) =>
      reduce(BigInt(get(v, "goals")) + BigInt(get(v, "assists")), 1n),
  },
  goal_contributions_per_game: {
    inputs: ["goals", "assists", "appearances"],
    precision: 2,
    unit: "ratio",
    direction: "higher",
    integer: false,
    version: "1.0.0",
    availabilityClass: "reviewed_coverage_required",
    calculate: (v: Values) =>
      reduce(
        BigInt(get(v, "goals")) + BigInt(get(v, "assists")),
        BigInt(get(v, "appearances")),
      ),
  },
  minutes_per_goal: {
    inputs: ["minutes", "goals"],
    precision: 0,
    unit: "minutes_per_goal",
    direction: "lower",
    integer: false,
    version: "1.0.0",
    availabilityClass: "reviewed_coverage_required",
    calculate: (v: Values) => {
      const minutes = decimalRational(get(v, "minutes"));
      return reduce(minutes.n, minutes.d * BigInt(get(v, "goals")));
    },
  },
} satisfies Record<string, RegistryEntry>;

export type DeterministicMetricId = keyof typeof metricRegistry;
function rounded(n: bigint, d: bigint, precision: number): string {
  const scale = 10n ** BigInt(precision),
    value = (n * scale * 2n + d) / (2n * d);
  if (!precision) return value.toString();
  const text = value.toString().padStart(precision + 1, "0");
  return `${text.slice(0, -precision)}.${text.slice(-precision)}`;
}
function exact(value: Rational, integer = false): ExactValue {
  if (integer) return { kind: "integer", value: value.n.toString() };
  return {
    kind: "rational",
    numerator: value.n.toString(),
    denominator: value.d.toString(),
  };
}
function unavailable(
  id: DeterministicMetricId,
  snapshot: Snapshot,
  scopeId: string,
  coverageRef: string,
  provenanceIds: string[],
  reason: string,
  status: MetricResult["status"] = "unavailable",
): MetricResult {
  return {
    metric_id: id,
    definition_version: metricRegistry[id].version,
    status,
    exact_value: null,
    reason,
    snapshot_id: snapshot.id,
    scope_id: scopeId,
    coverage_ref: coverageRef,
    provenance_ids: provenanceIds,
  };
}

export function calculateMetric(
  id: DeterministicMetricId,
  snapshot: Snapshot,
  observations: readonly Observation[],
  category?: Observation["category"],
): MetricResult {
  const definition = metricRegistry[id];
  const rows = observations.filter(
    (row) => (row.category ?? "overall") === (category ?? "overall"),
  );
  const inputs = definition.inputs.map((metric) =>
    rows.find((row) => row.metric === metric),
  );
  const provenanceIds = [
    ...new Set(
      inputs.flatMap(
        (row) =>
          row?.sourceIds.map((sourceId) => provenanceIdFor(row, sourceId)) ??
          [],
      ),
    ),
  ].sort();
  const present = inputs.filter((row): row is Observation => row !== undefined);
  const scopeIds = new Set(present.map((row) => row.scopeId));
  const matchSets = new Set(present.map((row) => row.matchSetId));
  const definitions = new Set(present.map((row) => row.definitionVersion));
  if (scopeIds.size > 1)
    return unavailable(
      id,
      snapshot,
      snapshot.manifest.scopeId,
      snapshot.manifest.id,
      provenanceIds,
      "incompatible_scope",
    );
  if (matchSets.size > 1)
    return unavailable(
      id,
      snapshot,
      snapshot.manifest.scopeId,
      snapshot.manifest.id,
      provenanceIds,
      "incompatible_coverage",
    );
  if (definitions.size > 1)
    return unavailable(
      id,
      snapshot,
      snapshot.manifest.scopeId,
      snapshot.manifest.id,
      provenanceIds,
      "incompatible_definition",
    );
  const scopeId = present[0]?.scopeId ?? snapshot.manifest.scopeId;
  const base = (
    reason: string,
    status: MetricResult["status"] = "unavailable",
  ) =>
    unavailable(
      id,
      snapshot,
      scopeId,
      snapshot.manifest.id,
      provenanceIds,
      reason,
      status,
    );
  for (const row of present) {
    if (row.value === null) continue;
    if (row.value < 0 || !Number.isFinite(row.value))
      throw new Error("invalid_input");
    if (row.metric !== "minutes" && !Number.isSafeInteger(row.value))
      throw new Error("invalid_input");
  }
  const facts = inputs as Observation[];
  const allNumericInputsPresent = inputs.every(
    (row) => row !== undefined && row.value !== null,
  );
  if (allNumericInputsPresent && id.startsWith("non_penalty")) {
    const goals = facts.find((row) => row.metric === "goals")!.value!;
    const penalties = facts.find(
      (row) => row.metric === "penalty_goals",
    )!.value!;
    if (penalties > goals)
      throw new Error("invalid_input: penalty_goals_exceed_goals");
  }
  if (present.some((row) => row.review === "rejected"))
    return base("disputed_input", "disputed");
  if (present.some((row) => row.review === "pending"))
    return base("provisional_input", "provisional");
  if (inputs.some((row) => row === undefined)) return base("missing_input");
  if (facts.some((row) => row.value === null || row.coverage !== "complete"))
    return base("unavailable_input");
  const value = (metric: MetricId) =>
    facts.find((row) => row.metric === metric)!.value!;
  const goals = value("goals");
  const penalties = id.startsWith("non_penalty") ? value("penalty_goals") : 0;
  if (penalties > goals)
    throw new Error("invalid_input: penalty_goals_exceed_goals");
  if (
    (id.endsWith("per_game") && value("appearances") === 0) ||
    (id === "minutes_per_goal" && goals === 0)
  ) {
    return base("undefined_zero_denominator", "undefined");
  }
  const values: Values = Object.fromEntries(
    facts.map((row) => [row.metric, row.value!]),
  ) as Values;
  const result = definition.calculate(values);
  if (provenanceIds.length === 0) return base("unavailable_input");
  const resultValue: MetricResult = {
    metric_id: id,
    definition_version: definition.version,
    status: "available",
    exact_value: exact(result, definition.integer),
    display_value: rounded(result.n, result.d, definition.precision),
    snapshot_id: snapshot.id,
    scope_id: scopeId,
    coverage_ref: snapshot.manifest.id,
    provenance_ids: provenanceIds,
  };
  validateMetricResult(resultValue);
  return resultValue;
}

export function compareMetricResults(
  left: MetricResult,
  right: MetricResult,
): -1 | 0 | 1 | null {
  if (
    left.status !== "available" ||
    right.status !== "available" ||
    left.scope_id !== right.scope_id ||
    left.coverage_ref !== right.coverage_ref
  )
    return null;
  const rational = (value: ExactValue): Rational =>
    value.kind === "integer"
      ? { n: BigInt(value.value), d: 1n }
      : value.kind === "rational"
        ? { n: BigInt(value.numerator), d: BigInt(value.denominator) }
        : decimalRational(Number(value.value));
  const a = rational(left.exact_value!),
    b = rational(right.exact_value!);
  const delta = a.n * b.d - b.n * a.d;
  return delta < 0n ? -1 : delta > 0n ? 1 : 0;
}
