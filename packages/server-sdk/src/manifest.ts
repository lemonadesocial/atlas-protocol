import type { IncomingMessage, ServerResponse } from "node:http";

import { CHAIN_SPECS } from "./chain-specs.js";
import type { ServerSdkConfig } from "./config.js";
import type { AtlasManifest, AtlasSigningKeyJwk } from "./types/index.js";

export interface GenerateManifestOptions {
  /** Optional space scope. When set, search is scoped to `/spaces/{spaceId}/search`. */
  spaceId?: string;
  /** Override capabilities for this server. Defaults to discovery + purchase + holds. */
  capabilities?: Partial<AtlasManifest["capabilities"]>;
  /** Override base URL inferred from config.domain. */
  baseUrl?: string;
}

const DEFAULT_CAPABILITIES: AtlasManifest["capabilities"] = {
  discovery: true,
  purchase: true,
  refund: false,
  holds: true,
  oauth_connect: false,
  webhooks: false,
};

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function inferBaseUrl(domain: string): string {
  const trimmed = trimTrailingSlash(domain);
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

/**
 * Build the canonical `.well-known/atlas.json` manifest object from a
 * ServerSdkConfig. This returns plain JSON-serializable data — wrap it in
 * whatever HTTP response your framework prefers.
 */
export function generateManifest(
  config: ServerSdkConfig,
  options: GenerateManifestOptions = {},
): AtlasManifest {
  const baseUrl = options.baseUrl ?? inferBaseUrl(config.domain);
  const searchEndpoint = options.spaceId
    ? `${baseUrl}/atlas/v1/spaces/${options.spaceId}/search`
    : `${baseUrl}/atlas/v1/search`;

  const paymentMethods = config.paymentMethods.map((method) => method.type);

  return {
    "@context": "https://atlas-protocol.org/v1",
    atlas_version: "1.0",
    platform: {
      name: config.platform.name,
      url: config.platform.url,
      ...(config.platform.logoUrl !== undefined && { logo: config.platform.logoUrl }),
      ...(config.platform.description !== undefined && {
        description: config.platform.description,
      }),
      ...(config.platform.contactEmail !== undefined && {
        contact_email: config.platform.contactEmail,
      }),
    },
    capabilities: { ...DEFAULT_CAPABILITIES, ...options.capabilities },
    endpoints: {
      events: `${baseUrl}/atlas/v1/events`,
      search: searchEndpoint,
      purchase: `${baseUrl}/atlas/v1/events/{event_id}/purchase`,
      receipt_verify: `${baseUrl}/atlas/v1/receipts/{receipt_id}/verify`,
    },
    payment_methods: paymentMethods,
    fee_schedule: {
      protocol_fee_percent: config.feeSchedule.protocolFeePercent,
      platform_fee_percent: config.feeSchedule.platformFeePercent,
      ...(config.feeSchedule.paymentProcessingNote !== undefined && {
        payment_processing_note: config.feeSchedule.paymentProcessingNote,
      }),
    },
    signing_keys: config.signingKeys,
    rate_limits: {
      search_per_minute: config.rateLimits.searchPerMinute,
      purchase_per_minute: config.rateLimits.purchasePerMinute,
    },
  };
}

/**
 * Convenience wrapper: build a manifest scoped to a single space.
 */
export function generateSpaceManifest(
  config: ServerSdkConfig,
  args: { spaceId: string } & Omit<GenerateManifestOptions, "spaceId">,
): AtlasManifest {
  return generateManifest(config, { ...args, spaceId: args.spaceId });
}

/**
 * Spec-aligned manifest shape — matches the example in
 * `01-whitepaper/docs/01-PROTOCOL-SPEC.md` §1.2 and SCHEMAS.md §1.
 *
 * NOTE: `01-PROTOCOL-SPEC.md` and `02-SCHEMAS.md` differ slightly on
 * `capabilities` shape and the precise `endpoints` keys — the schema in
 * SCHEMAS.md is treated as authoritative for nested objects (`endpoints`
 * with `events_url`/`purchase_url`, `settlement.chains`/`token`).
 * `capabilities` is emitted as an array per PROTOCOL-SPEC §1.2.
 */
export interface SpecAlignedAtlasManifest {
  atlas: string;
  name: string;
  url: string;
  logo?: string;
  did?: string;
  capabilities: string[];
  endpoints: {
    events_url: string;
    search_url?: string;
    purchase_url: string;
  };
  settlement: {
    chains: string[];
    token: string;
  };
  fee_model: "inclusive" | "additive";
  signing_keys: AtlasSigningKeyJwk[];
}

export interface GenerateAtlasManifestOpts {
  /** Platform display name. */
  name: string;
  /** Platform homepage URL. */
  url: string;
  /** Optional logo URL (PNG/SVG, ≥128×128). */
  logo?: string;
  /** Optional `did:web:<host>` identifier used for receipt verification. */
  did?: string;
  /** Absolute URL to the event feed endpoint. */
  eventsUrl: string;
  /** Absolute URL to the search endpoint. Optional. */
  searchUrl?: string;
  /**
   * Absolute base URL for the purchase endpoint. The spec uses
   * `{event_id}` templating — pass either the templated form (e.g.
   * `https://x/atlas/v1/events/{event_id}/purchase`) or just the base, in
   * which case the helper appends `/{event_id}/purchase`.
   */
  purchaseUrl: string;
  /**
   * Settlement chains the platform accepts. Strings should follow the
   * `<chain>-usdc` (or `<chain>-usdm`) convention from settlement spec §1.
   * Example: `["base-usdc", "optimism-usdc", "worldchain-usdc"]`.
   */
  supportedChains: string[];
  /** Whether the platform accepts Stripe SPT (fiat) payments. */
  acceptStripe: boolean;
  /** Settlement token symbol. Defaults to "USDC". */
  settlementToken?: string;
  /** Fee model. Defaults to "inclusive". */
  feeModel?: "inclusive" | "additive";
  /** Capability identifiers (per PROTOCOL-SPEC §1.2). */
  capabilities?: string[];
  /** ATLAS protocol version. Defaults to "1.0". */
  schemaVersion?: string;
  /** JWK public keys advertised for receipt signing verification. */
  signingKeys?: AtlasSigningKeyJwk[];
}

/**
 * Convenience helper: produce a spec-aligned `.well-known/atlas.json` from a
 * compact options object instead of a full `ServerSdkConfig`. The richer
 * `generateManifest(config)` is still exported for consumers that want the
 * superset shape (capabilities object, endpoints with receipt_verify, fee
 * schedule, rate limits, payment_methods array).
 *
 * Where `01-PROTOCOL-SPEC.md` and `02-SCHEMAS.md` diverge:
 *   - PROTOCOL-SPEC §1.2 has `events_url` at the top level + `capabilities`
 *     as a string array. SCHEMAS.md §1 nests endpoints inside `endpoints`
 *     and uses different fields.
 *   - This helper follows SCHEMAS.md for the `endpoints` / `settlement`
 *     nested shape (closer to what platforms actually need to advertise),
 *     and uses PROTOCOL-SPEC's array form for `capabilities`. Mismatches
 *     between the two specs are flagged in the PR body.
 */
export function generateAtlasManifest(opts: GenerateAtlasManifestOpts): SpecAlignedAtlasManifest {
  if (opts.supportedChains.length === 0 && !opts.acceptStripe) {
    throw new Error(
      "generateAtlasManifest: must accept at least one rail (supportedChains[] or acceptStripe)",
    );
  }

  const purchaseUrl = opts.purchaseUrl.includes("{event_id}")
    ? opts.purchaseUrl
    : `${trimTrailingSlash(opts.purchaseUrl)}/{event_id}/purchase`;

  const capabilities = opts.capabilities ?? ["listing", "purchase", "settlement"];
  const feeModel = opts.feeModel ?? "inclusive";
  const settlementToken = opts.settlementToken ?? "USDC";

  const manifest: SpecAlignedAtlasManifest = {
    atlas: opts.schemaVersion ?? "1.0",
    name: opts.name,
    url: opts.url,
    capabilities,
    endpoints: {
      events_url: opts.eventsUrl,
      purchase_url: purchaseUrl,
      ...(opts.searchUrl !== undefined && { search_url: opts.searchUrl }),
    },
    settlement: {
      chains: [...opts.supportedChains],
      token: settlementToken,
    },
    fee_model: feeModel,
    signing_keys: opts.signingKeys ?? [],
    ...(opts.logo !== undefined && { logo: opts.logo }),
    ...(opts.did !== undefined && { did: opts.did }),
  };

  // If the platform accepts Stripe alongside on-chain rails, surface that as
  // an extra capability so agents can discover it without parsing the
  // settlement.chains list.
  if (opts.acceptStripe && !manifest.capabilities.includes("stripe_spt")) {
    manifest.capabilities = [...manifest.capabilities, "stripe_spt"];
  }

  return manifest;
}

/**
 * Convenience: list the canonical settlement-chain identifiers (matching
 * SCHEMAS.md `settlement.chains` form) for every non-experimental chain in
 * `CHAIN_SPECS`. Useful when building `generateAtlasManifest` opts.
 */
export function defaultSupportedChainIdentifiers(): string[] {
  const map: Partial<Record<keyof typeof CHAIN_SPECS, string>> = {
    base_usdc: "base-usdc",
    base_sepolia_usdc: "base-sepolia-usdc",
    optimism_usdc: "optimism-usdc",
    arbitrum_usdc: "arbitrum-usdc",
    polygon_usdc: "polygon-usdc",
    zksync_usdc: "zksync-usdc",
    worldchain_usdc: "worldchain-usdc",
    megaeth_usdm: "megaeth-usdm",
    tempo_usdc: "tempo-usdc",
  };
  return (Object.keys(CHAIN_SPECS) as Array<keyof typeof CHAIN_SPECS>)
    .filter((key) => !CHAIN_SPECS[key].experimental)
    .map((key) => map[key])
    .filter((s): s is string => typeof s === "string");
}

/**
 * Build a Node `http`-compatible request handler that serves the
 * `.well-known/atlas.json` manifest. Framework-agnostic: works with raw
 * `http.createServer`, Connect, and any framework that exposes
 * `(req, res)` signatures.
 *
 * Consumers using Koa/Express/Fastify should write a thin adapter rather
 * than coupling this package to their framework of choice.
 */
export function createWellKnownHandler(
  config: ServerSdkConfig,
  options: GenerateManifestOptions = {},
): (req: IncomingMessage, res: ServerResponse) => void {
  const body = JSON.stringify(generateManifest(config, options));

  return (_req, res) => {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.end(body);
  };
}
