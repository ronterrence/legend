import type {
  CompetitionQuery,
  DatasetRequest,
  ProviderAdapter,
  ProviderCompetitionRef,
  ProviderRecordRequest,
  RawProviderDataset,
  RawProviderRecord,
} from "./adapter.ts";
import { capabilitiesFor } from "./registry.ts";
import type { ProviderDefinition } from "./types.ts";

const retrievedAt = "2000-01-01T00:00:00Z";

export class FixtureProviderAdapter implements ProviderAdapter {
  readonly providerId: string;

  constructor(private readonly definition: ProviderDefinition) {
    this.providerId = definition.providerId;
  }

  getCapabilities() {
    return capabilitiesFor(this.definition);
  }

  async listCompetitions(
    _request: CompetitionQuery,
  ): Promise<ProviderCompetitionRef[]> {
    return [
      {
        externalRef: "synthetic_competition",
        name: "Synthetic Competition",
        sport: "football",
        providerData: { fixture: true },
      },
    ];
  }

  async fetchDataset(request: DatasetRequest): Promise<RawProviderDataset> {
    const records = ["synthetic_player_01", "synthetic_player_02"].map(
      (externalRef, index): RawProviderRecord => ({
        providerId: this.providerId,
        recordType: request.datasetType,
        externalRef,
        retrievedAt,
        payload: {
          provider_player_id: externalRef,
          appearances: 10 + index,
          goals: 3 + index,
          synthetic: true,
        },
      }),
    );
    return {
      providerId: this.providerId,
      datasetType: request.datasetType,
      retrievedAt,
      records,
      providerMetadata: {
        competition_ref: request.competitionRef ?? null,
        season: request.season ?? null,
      },
    };
  }

  async fetchRecord(
    request: ProviderRecordRequest,
  ): Promise<RawProviderRecord> {
    return {
      providerId: this.providerId,
      recordType: request.recordType,
      externalRef: request.externalRef,
      retrievedAt,
      payload: { provider_record_id: request.externalRef, synthetic: true },
    };
  }
}
