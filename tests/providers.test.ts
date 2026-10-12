import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import providerDefinitionSchema from "../schemas/provider-definition.schema.json";
import {
  FixtureProviderAdapter,
  ProviderRegistry,
  providerDefinitions,
  providerRegistry,
  supports,
  validateAdapterContract,
  validateProviderDefinition,
} from "../src/providers/index.ts";

const fixtureDefinition = providerDefinitions.find(
  (definition) => definition.providerId === "fixture_provider",
)!;

test("provider definitions use Draft 07 validation and reject invalid classes and IDs", () => {
  assert.equal(
    providerDefinitionSchema.$schema,
    "http://json-schema.org/draft-07/schema#",
  );
  for (const definition of providerDefinitions)
    assert.doesNotThrow(() => validateProviderDefinition(definition));
  assert.throws(
    () =>
      validateProviderDefinition({
        ...fixtureDefinition,
        providerClass: "guess",
      }),
    /providerClass/,
  );
  assert.throws(
    () =>
      validateProviderDefinition({
        ...fixtureDefinition,
        freshnessClasses: ["B9"],
      }),
    /freshnessClasses/,
  );
  const { providerId: _providerId, ...missingId } = fixtureDefinition;
  assert.throws(() => validateProviderDefinition(missingId), /providerId/);
  assert.throws(
    () => new ProviderRegistry([fixtureDefinition, fixtureDefinition]),
    /Duplicate provider ID/,
  );
});

test("capability queries filter metrics, freshness, competition, products, and disabled providers", () => {
  const goals = providerRegistry.findProviders({
    metricFamily: "goals",
    freshness: "B0",
  });
  assert.ok(
    goals.some((provider) => provider.providerId === "fixture_provider"),
  );
  assert.equal(
    providerRegistry.findProviders({ metricFamily: "xg" }).length,
    0,
  );
  assert.equal(providerRegistry.findProviders({ freshness: "B3" }).length, 0);
  assert.deepEqual(
    providerRegistry
      .findProviders({
        metricFamily: "goals",
        competitionRef: "synthetic_competition",
      })
      .map((provider) => provider.providerId),
    ["fixture_provider"],
  );
  assert.equal(
    providerRegistry
      .list()
      .some((provider) => provider.providerId === "transfermarkt"),
    false,
  );
  assert.equal(
    providerRegistry
      .list(true)
      .some((provider) => provider.providerId === "transfermarkt"),
    true,
  );
  assert.equal(
    providerRegistry.findProviders({ product: "legend_live" }).length,
    0,
  );
  assert.equal(supports(fixtureDefinition, "goals"), true);
  assert.equal(supports(fixtureDefinition, "xg"), false);
});

test("licensing and attribution metadata preserve unknown and required states", () => {
  const rsssf = providerRegistry.get("rsssf");
  assert.equal(rsssf.licensing.licenseType, "unknown");
  assert.equal(rsssf.attribution.required, true);
  assert.match(rsssf.attribution.displayText!, /RSSSF/);
  assert.throws(
    () =>
      validateProviderDefinition({
        ...fixtureDefinition,
        attribution: { required: true },
      }),
    /displayText/,
  );
});

test("fixture adapter is deterministic, offline, and returns raw provider-domain data", async () => {
  const adapter = new FixtureProviderAdapter(fixtureDefinition);
  validateAdapterContract(adapter, fixtureDefinition);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Network access is forbidden in fixture adapter tests");
  };
  try {
    const first = await adapter.fetchDataset!({
      datasetType: "player_totals",
      competitionRef: "synthetic_competition",
      season: "synthetic_v1",
    });
    const second = await adapter.fetchDataset!({
      datasetType: "player_totals",
      competitionRef: "synthetic_competition",
      season: "synthetic_v1",
    });
    assert.deepEqual(first, second);
    assert.equal(first.providerId, "fixture_provider");
    assert.equal(
      first.records.every((record) => record.providerId === adapter.providerId),
      true,
    );
    const serialized = JSON.stringify(first);
    assert.equal(serialized.includes("exact_value"), false);
    assert.equal(serialized.includes("snapshot_id"), false);
    assert.equal(serialized.includes("provenance_ids"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : /\.(ts|tsx)$/.test(name)
        ? [path]
        : [];
  });
}

test("metric engine and Studio remain independent from provider adapters", () => {
  for (const area of ["metrics", "studio"])
    for (const path of sourceFiles(join(process.cwd(), "src", area))) {
      const source = readFileSync(path, "utf8");
      assert.equal(/from\s+["'][^"']*providers\//.test(source), false, path);
    }
  const adapterSource = readFileSync(
    join(process.cwd(), "src", "providers", "adapter.ts"),
    "utf8",
  );
  assert.equal(adapterSource.includes("MetricResult"), false);
});
