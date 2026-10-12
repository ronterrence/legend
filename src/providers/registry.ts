import Ajv from "ajv";
import addFormats from "ajv-formats";
import providerDefinitionSchema from "../../schemas/provider-definition.schema.json";
import type { ProviderAdapter } from "./adapter.ts";
import type {
  MetricFamily,
  ProviderCapabilities,
  ProviderDefinition,
  ProviderQuery,
} from "./types.ts";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const schemaValidator = ajv.compile<ProviderDefinition>(
  providerDefinitionSchema,
);

export function validateProviderDefinition(
  value: unknown,
): asserts value is ProviderDefinition {
  if (!schemaValidator(value)) {
    const details = schemaValidator.errors
      ?.map(
        (error) =>
          `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
      )
      .join("; ");
    throw new Error(
      `Provider definition validation failed${details ? `: ${details}` : ""}`,
    );
  }
  const definition = value;
  const competitionRefs = definition.competitionCoverage.map(
    (item) => item.competitionRef,
  );
  if (new Set(competitionRefs).size !== competitionRefs.length)
    throw new Error(`Duplicate competition coverage: ${definition.providerId}`);
  for (const coverage of definition.competitionCoverage) {
    if (
      coverage.fromSeason &&
      coverage.toSeason &&
      coverage.fromSeason > coverage.toSeason
    )
      throw new Error(
        `Invalid competition season range: ${coverage.competitionRef}`,
      );
    if (
      coverage.metricFamilies?.some(
        (family) => !definition.supportedMetricFamilies.includes(family),
      )
    )
      throw new Error(
        `Competition capability exceeds provider capability: ${coverage.competitionRef}`,
      );
  }
  if (
    definition.historicalCoverage?.metricDepth?.some(
      (family) => !definition.supportedMetricFamilies.includes(family),
    )
  )
    throw new Error(
      `Historical capability exceeds provider capability: ${definition.providerId}`,
    );
  if (
    definition.historicalCoverage?.earliestDate &&
    definition.historicalCoverage.latestDate &&
    definition.historicalCoverage.earliestDate >
      definition.historicalCoverage.latestDate
  )
    throw new Error(`Invalid historical date range: ${definition.providerId}`);
}

export function capabilitiesFor(
  definition: ProviderDefinition,
): ProviderCapabilities {
  return {
    providerId: definition.providerId,
    freshnessClasses: [...definition.freshnessClasses],
    supportedSports: [...definition.supportedSports],
    supportedMetricFamilies: [...definition.supportedMetricFamilies],
    competitionRefs: definition.competitionCoverage.map(
      (coverage) => coverage.competitionRef,
    ),
  };
}

export function supports(
  definition: ProviderDefinition,
  metricFamily: MetricFamily,
): boolean {
  return definition.supportedMetricFamilies.includes(metricFamily);
}

export function validateAdapterContract(
  adapter: ProviderAdapter,
  definition: ProviderDefinition,
): void {
  if (adapter.providerId !== definition.providerId)
    throw new Error("Adapter provider ID does not match registry definition");
  const expected = capabilitiesFor(definition);
  const actual = adapter.getCapabilities();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(
      `Adapter capabilities do not match registry definition: ${definition.providerId}`,
    );
}

export class ProviderRegistry {
  readonly #definitions: Map<string, ProviderDefinition>;

  constructor(definitions: readonly ProviderDefinition[]) {
    this.#definitions = new Map();
    for (const input of definitions) {
      validateProviderDefinition(input);
      if (this.#definitions.has(input.providerId))
        throw new Error(`Duplicate provider ID: ${input.providerId}`);
      this.#definitions.set(input.providerId, structuredClone(input));
    }
  }

  get(providerId: string): ProviderDefinition {
    const definition = this.#definitions.get(providerId);
    if (!definition) throw new Error(`Unknown provider: ${providerId}`);
    return structuredClone(definition);
  }

  list(includeDisabled = false): ProviderDefinition[] {
    return [...this.#definitions.values()]
      .filter((definition) => includeDisabled || definition.enabled)
      .sort(
        (left, right) =>
          (right.priority ?? 0) - (left.priority ?? 0) ||
          left.providerId.localeCompare(right.providerId),
      )
      .map((definition) => structuredClone(definition));
  }

  findProviders(query: ProviderQuery = {}): ProviderDefinition[] {
    return this.list(query.includeDisabled).filter((definition) => {
      if (query.metricFamily && !supports(definition, query.metricFamily))
        return false;
      if (
        query.freshness &&
        !definition.freshnessClasses.includes(query.freshness)
      )
        return false;
      if (query.sport && !definition.supportedSports.includes(query.sport))
        return false;
      if (query.product && !definition.productCompatibility[query.product])
        return false;
      if (query.competitionRef) {
        const coverage = definition.competitionCoverage.find(
          (item) => item.competitionRef === query.competitionRef,
        );
        if (!coverage) return false;
        if (
          query.metricFamily &&
          coverage.metricFamilies &&
          !coverage.metricFamilies.includes(query.metricFamily)
        )
          return false;
      }
      return true;
    });
  }
}
