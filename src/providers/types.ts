import type { SourceType } from "../contracts/index.ts";

export type ProviderClass =
  | "official"
  | "historical_archive"
  | "structured_api"
  | "midmarket_provider"
  | "enterprise_provider"
  | "live_event_provider"
  | "secondary_reference";

export type AccessClass =
  "free" | "freemium" | "paid" | "enterprise" | "internal";
export type FreshnessClass = "B0" | "B1" | "B2" | "B3";
export type DataEra =
  | "archival"
  | "structured_record"
  | "early_digital"
  | "event_data"
  | "advanced_analytics"
  | "tracking_ai";
export type MetricFamily =
  | "identity"
  | "fixtures"
  | "results"
  | "lineups"
  | "appearances"
  | "minutes"
  | "goals"
  | "penalties"
  | "assists"
  | "cards"
  | "trophies"
  | "awards"
  | "shots"
  | "passing"
  | "defending"
  | "possession"
  | "xg"
  | "xa"
  | "event_coordinates"
  | "tracking"
  | "live_events";
export type ProductId = "legend" | "legend_pro" | "legend_live";
export type ProviderReviewState =
  "unreviewed" | "reviewed" | "verified" | "contested";

export interface CompetitionCoverageDescriptor {
  competitionRef: string;
  fromSeason?: string;
  toSeason?: string;
  coverageLevel: "basic" | "standard" | "event" | "tracking" | "live";
  metricFamilies?: MetricFamily[];
  completeness: "unknown" | "partial" | "complete";
  knownGaps?: string[];
}

export interface HistoricalCoverageDescriptor {
  earliestSeason?: string;
  latestSeason?: string;
  earliestDate?: string;
  latestDate?: string;
  continuity: "unknown" | "partial" | "continuous";
  metricDepth?: MetricFamily[];
  archiveCompleteness: "unknown" | "partial" | "reviewed_complete";
  notes?: string;
}

export interface ProviderAccessDescriptor {
  methods: (
    | "public_web"
    | "manual_download"
    | "api"
    | "bulk_export"
    | "webhook"
    | "stream"
  )[];
  authType: "none" | "api_key" | "oauth" | "basic" | "contract_custom";
  trialAvailable?: boolean;
  contractRequired?: boolean;
}

export interface ProviderLicenseDescriptor {
  licenseType:
    "public" | "open" | "commercial" | "enterprise" | "internal" | "unknown";
  redistributionAllowed?: boolean;
  derivativeUseAllowed?: boolean;
  displayAttributionRequired?: boolean;
  cachingAllowed?: boolean;
  storageAllowed?: boolean;
  termsUrl?: string;
  notes?: string;
}

export interface ProviderAttributionDescriptor {
  required: boolean;
  displayText?: string;
  logoRequired?: boolean;
  sourceLinkRequired?: boolean;
}

export interface ProviderOperationalDescriptor {
  rateLimitModel?: string;
  maxRequestsPerMinute?: number;
  maxRequestsPerDay?: number;
  supportsBulkExport?: boolean;
  supportsWebhooks?: boolean;
  supportsStreaming?: boolean;
  expectedLatencyClass?: "archive" | "batch" | "current" | "near_live" | "live";
}

export interface ProviderCostDescriptor {
  costClass: "free" | "low" | "medium" | "high" | "enterprise" | "unknown";
  pricingModel?:
    | "subscription"
    | "per_request"
    | "per_competition"
    | "per_feed"
    | "custom"
    | "unknown";
  notes?: string;
}

export interface ProviderDefinition {
  providerId: string;
  displayName: string;
  providerClass: ProviderClass;
  sourceType: SourceType;
  accessClass: AccessClass;
  homepage?: string;
  freshnessClasses: FreshnessClass[];
  dataEras: DataEra[];
  supportedSports: string[];
  supportedMetricFamilies: MetricFamily[];
  competitionCoverage: CompetitionCoverageDescriptor[];
  historicalCoverage?: HistoricalCoverageDescriptor;
  access: ProviderAccessDescriptor;
  licensing: ProviderLicenseDescriptor;
  attribution: ProviderAttributionDescriptor;
  operational?: ProviderOperationalDescriptor;
  cost: ProviderCostDescriptor;
  reviewState: ProviderReviewState;
  productCompatibility: Record<ProductId, boolean>;
  priority?: number;
  enabled: boolean;
}

export interface ProviderCapabilities {
  providerId: string;
  freshnessClasses: FreshnessClass[];
  supportedSports: string[];
  supportedMetricFamilies: MetricFamily[];
  competitionRefs: string[];
}

export interface ProviderQuery {
  metricFamily?: MetricFamily;
  freshness?: FreshnessClass;
  competitionRef?: string;
  sport?: string;
  product?: ProductId;
  includeDisabled?: boolean;
}
