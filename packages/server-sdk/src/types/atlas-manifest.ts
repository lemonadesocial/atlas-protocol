export interface AtlasManifestPlatform {
  name: string;
  url: string;
  logo?: string;
  description?: string;
  contact_email?: string;
}

export interface AtlasManifestCapabilities {
  discovery: boolean;
  purchase: boolean;
  refund: boolean;
  holds: boolean;
  oauth_connect: boolean;
  webhooks: boolean;
}

export interface AtlasManifestEndpoints {
  events: string;
  search: string;
  purchase: string;
  receipt_verify: string;
}

export interface AtlasManifestFeeSchedule {
  protocol_fee_percent: number;
  platform_fee_percent: number;
  payment_processing_note?: string;
}

export interface AtlasManifestRateLimits {
  search_per_minute: number;
  purchase_per_minute: number;
}

export interface AtlasSigningKeyJwk {
  kid: string;
  kty: string;
  crv?: string;
  x?: string;
  y?: string;
  alg: string;
  use: string;
}

export interface AtlasManifest {
  '@context': string;
  atlas_version: string;
  platform: AtlasManifestPlatform;
  capabilities: AtlasManifestCapabilities;
  endpoints: AtlasManifestEndpoints;
  payment_methods: string[];
  fee_schedule: AtlasManifestFeeSchedule;
  signing_keys: AtlasSigningKeyJwk[];
  rate_limits: AtlasManifestRateLimits;
}
