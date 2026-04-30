import type { IncomingMessage, ServerResponse } from 'node:http';

import type { ServerSdkConfig } from './config.js';
import type { AtlasManifest } from './types/index.js';

export interface GenerateManifestOptions {
  /** Optional space scope. When set, search is scoped to `/spaces/{spaceId}/search`. */
  spaceId?: string;
  /** Override capabilities for this server. Defaults to discovery + purchase + holds. */
  capabilities?: Partial<AtlasManifest['capabilities']>;
  /** Override base URL inferred from config.domain. */
  baseUrl?: string;
}

const DEFAULT_CAPABILITIES: AtlasManifest['capabilities'] = {
  discovery: true,
  purchase: true,
  refund: false,
  holds: true,
  oauth_connect: false,
  webhooks: false,
};

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function inferBaseUrl(domain: string): string {
  const trimmed = trimTrailingSlash(domain);
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
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
    '@context': 'https://atlas-protocol.org/v1',
    atlas_version: '1.0',
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
  args: { spaceId: string } & Omit<GenerateManifestOptions, 'spaceId'>,
): AtlasManifest {
  return generateManifest(config, { ...args, spaceId: args.spaceId });
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
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.end(body);
  };
}
