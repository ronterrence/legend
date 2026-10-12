import type { ProviderCapabilities } from "./types.ts";

export interface CompetitionQuery {
  sport?: string;
  search?: string;
}

export interface ProviderCompetitionRef {
  externalRef: string;
  name: string;
  sport: string;
  providerData?: unknown;
}

export interface DatasetRequest {
  datasetType: string;
  competitionRef?: string;
  season?: string;
  cursor?: string;
}

export interface ProviderRecordRequest {
  recordType: string;
  externalRef: string;
}

export interface RawProviderRecord {
  providerId: string;
  recordType: string;
  externalRef: string;
  retrievedAt: string;
  payload: unknown;
}

export interface RawProviderDataset {
  providerId: string;
  datasetType: string;
  retrievedAt: string;
  records: RawProviderRecord[];
  nextCursor?: string;
  providerMetadata?: unknown;
}

export interface ProviderAdapter {
  readonly providerId: string;
  getCapabilities(): ProviderCapabilities;
  listCompetitions?(
    request: CompetitionQuery,
  ): Promise<ProviderCompetitionRef[]>;
  fetchDataset?(request: DatasetRequest): Promise<RawProviderDataset>;
  fetchRecord?(request: ProviderRecordRequest): Promise<RawProviderRecord>;
}
