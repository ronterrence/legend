import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateMetric,
  compareMetricResults,
  metricRegistry,
  provenanceIdFor,
  type DeterministicMetricId,
} from "../src/metrics/engine.ts";
import { demoSnapshot } from "../src/ingestion/demo.ts";
import { hash } from "../src/storage/index.ts";
import { demoEvidence } from "../src/ingestion/demo.ts";
import { assemble } from "../src/metrics/index.ts";
import { validateMetricResult } from "../src/contracts/index.ts";
import { validateDashboard } from "../src/validation/index.ts";
import type { Observation } from "../src/domain.ts";

const snapshot = () => demoSnapshot(hash(demoEvidence));
const playerFacts = (id = "cristiano_ronaldo") => {
  const data = snapshot();
  return {
    data,
    facts: data.observations.filter((row) => row.playerId === id),
  };
};
const calculate = (
  metric: DeterministicMetricId,
  facts: Observation[],
  data = snapshot(),
) => calculateMetric(metric, data, facts);

test("six registered metrics calculate exact values with display rounding", () => {
  const { data, facts } = playerFacts();
  const cases: [DeterministicMetricId, string, string][] = [
    ["goals_per_game", "3/4", "0.75"],
    ["non_penalty_goals", "75", "75"],
    ["non_penalty_goals_per_game", "5/8", "0.63"],
    ["goal_contributions", "114", "114"],
    ["goal_contributions_per_game", "19/20", "0.95"],
    ["minutes_per_goal", "110/1", "110"],
  ];
  assert.equal(Object.keys(metricRegistry).length, 6);
  for (const [metric, exactPrefix, display] of cases) {
    const result = calculateMetric(metric, data, facts);
    assert.equal(result.status, "available", metric);
    assert.ok(result.exact_value);
    const exact =
      result.exact_value.kind === "integer"
        ? result.exact_value.value
        : result.exact_value.kind === "rational"
          ? `${result.exact_value.numerator}/${result.exact_value.denominator}`
          : result.exact_value.value;
    assert.equal(exact, exactPrefix, metric);
    assert.equal(result.display_value, display, metric);
    assert.equal(result.snapshot_id, data.id);
    assert.equal(result.coverage_ref, data.manifest.id);
    assert.deepEqual(
      result.provenance_ids,
      facts
        .filter((row) =>
          (metricRegistry[metric].inputs as readonly string[]).includes(
            row.metric,
          ),
        )
        .map((row) => provenanceIdFor(row, "demo_fixture"))
        .sort(),
    );
    assert.doesNotThrow(() => validateMetricResult(result));
  }
});

test("missing and incomplete operands are unavailable rather than zero", () => {
  const { data, facts } = playerFacts();
  const missing = facts.filter((row) => row.metric !== "assists");
  assert.equal(
    calculate("goal_contributions", missing, data).reason,
    "missing_input",
  );
  const incomplete = facts.map((row) =>
    row.metric === "assists" ? { ...row, coverage: "partial" as const } : row,
  );
  assert.equal(
    calculate("goal_contributions", incomplete, data).status,
    "unavailable",
  );
  assert.equal(
    calculate("goal_contributions", incomplete, data).exact_value,
    null,
  );
});

test("zero denominators remain undefined and exact zero remains available", () => {
  const { data, facts } = playerFacts();
  const noAppearances = facts.map((row) =>
    row.metric === "appearances" ? { ...row, value: 0 } : row,
  );
  assert.equal(
    calculate("goals_per_game", noAppearances, data).reason,
    "undefined_zero_denominator",
  );
  const noGoals = facts.map((row) =>
    row.metric === "goals" || row.metric === "penalty_goals"
      ? { ...row, value: 0 }
      : row,
  );
  const zeroGoals = calculate("non_penalty_goals", noGoals, data);
  assert.equal(zeroGoals.status, "available");
  assert.deepEqual(zeroGoals.exact_value, { kind: "integer", value: "0" });
  assert.equal(
    calculate("minutes_per_goal", noGoals, data).status,
    "undefined",
  );
});

test("invalid totals, negative inputs, and incompatible scope or coverage are rejected", () => {
  const { data, facts } = playerFacts();
  const tooManyPenalties = facts.map((row) =>
    row.metric === "penalty_goals" ? { ...row, value: 91 } : row,
  );
  assert.throws(
    () => calculate("non_penalty_goals", tooManyPenalties, data),
    /penalty_goals_exceed_goals/,
  );
  const negativeMinutes = facts.map((row) =>
    row.metric === "minutes" ? { ...row, value: -1 } : row,
  );
  assert.throws(
    () => calculate("minutes_per_goal", negativeMinutes, data),
    /invalid_input/,
  );
  const incompatibleScope = facts.map((row) =>
    row.metric === "appearances" ? { ...row, scopeId: "club_only_v1" } : row,
  );
  assert.equal(
    calculate("goals_per_game", incompatibleScope, data).reason,
    "incompatible_scope",
  );
  const incompatibleCoverage = facts.map((row) =>
    row.metric === "appearances"
      ? { ...row, matchSetId: "other_matches" }
      : row,
  );
  assert.equal(
    calculate("goals_per_game", incompatibleCoverage, data).reason,
    "incompatible_coverage",
  );
});

test("assist definition incompatibility blocks contributions; evidence lineage propagates", () => {
  const { data, facts } = playerFacts();
  const incompatibleAssists = facts.map((row) =>
    row.metric === "assists" ? { ...row, definitionVersion: "v2" } : row,
  ) as Observation[];
  assert.equal(
    calculate("goal_contributions", incompatibleAssists, data).reason,
    "incompatible_definition",
  );
  const pendingAssists = facts.map((row) =>
    row.metric === "assists" ? { ...row, review: "pending" as const } : row,
  );
  assert.equal(
    calculate("goal_contributions", pendingAssists, data).status,
    "provisional",
  );
  const rejected = facts.map((row) =>
    row.metric === "assists" ? { ...row, review: "rejected" as const } : row,
  );
  assert.equal(
    calculate("goal_contributions", rejected, data).status,
    "disputed",
  );
  const bothSources = facts.map((row) =>
    row.metric === "assists"
      ? { ...row, sourceIds: ["demo_fixture", "second_source"] }
      : row,
  );
  assert.deepEqual(
    calculate("goal_contributions", bothSources, data).provenance_ids,
    ["demo_fixture", "second_source"]
      .map((sourceId) =>
        provenanceIdFor(
          bothSources.find((row) => row.metric === "assists")!,
          sourceId,
        ),
      )
      .concat(
        provenanceIdFor(
          facts.find((row) => row.metric === "goals")!,
          "demo_fixture",
        ),
      )
      .sort(),
  );
});

test("calculation is deterministic and exact comparisons ignore display rounding", () => {
  const { data, facts } = playerFacts();
  const first = calculate("goals_per_game", facts, data);
  const second = calculate("goals_per_game", facts, data);
  assert.deepEqual(first, second);
  const equalRounded = {
    ...first,
    exact_value: {
      kind: "rational" as const,
      numerator: "751",
      denominator: "1000",
    },
    display_value: "0.75",
  };
  assert.equal(compareMetricResults(first, equalRounded), -1);
});

test("comparison assembly exposes canonical results and resolvable provenance", () => {
  const data = snapshot();
  const dashboard = assemble(data, "comparison_test", "2026-10-09T00:00:00Z");
  assert.doesNotThrow(() => validateDashboard(dashboard));
  const provenanceIds = new Set(
    dashboard.provenance.map((record) => record.provenance_id),
  );
  assert.equal(dashboard.pages.efficiency.length, 6);
  assert.ok(dashboard.metricResults.length >= data.players.length * 6);
  for (const result of dashboard.metricResults) {
    assert.equal(result.snapshot_id, data.id);
    assert.equal(result.coverage_ref, data.manifest.id);
    for (const provenanceId of result.provenance_ids)
      assert.ok(provenanceIds.has(provenanceId));
    assert.doesNotThrow(() => validateMetricResult(result));
  }
});

test("comparison rows do not rank different covered match populations", () => {
  const data = snapshot();
  for (const row of data.observations.filter(
    (row) => row.playerId === "lionel_messi",
  )) {
    row.matchSetId = "different_covered_population";
  }
  const dashboard = assemble(data, "coverage_mismatch", "2026-10-09T00:00:00Z");
  assert.equal(dashboard.pages.efficiency[0]?.comparison, "Not comparable");
  assert.equal(dashboard.pages.efficiency[0]?.leader, null);
});
