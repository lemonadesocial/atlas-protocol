/**
 * MCP resource registrar for ATLAS Protocol.
 *
 * Exposes static resources (e.g. fee structure) and optionally per-user
 * resources via caller-supplied loaders. Verification status is handled via a
 * pluggable loader because the upstream verification provider is
 * implementation-specific (Lemonade, Civic, Sumsub, etc.).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { AtlasToolsConfig } from "../config.js";
import { resolveConfig } from "../config.js";

/** Pricing payload returned for the `atlas://pricing` resource. */
export interface AtlasPricingPayload {
  protocol_fee_percent: number;
  payment_processing: Record<string, { percent: number; fixed_cents: number }>;
  refund_policy: {
    full_refund_window_hours: number;
    partial_refund_after: boolean;
  };
  currency_support: string[];
  free_events: { protocol_fee: boolean; processing_fee: boolean };
}

/** Verification status payload for the `atlas://verification` resource. */
export interface AtlasVerificationStatus {
  is_verified: boolean;
  level: string;
  submitted_at?: string;
  reviewed_at?: string;
}

/** Options for {@link registerAtlasMcpResources}. */
export interface RegisterAtlasMcpResourcesOptions {
  /** Connection / identity config. */
  config: AtlasToolsConfig;
  /**
   * Override the default pricing payload. The default is a sensible placeholder
   * that callers SHOULD replace with their network's actual fee schedule.
   */
  pricing?: AtlasPricingPayload;
  /**
   * Loads the user's identity verification status. Receives the raw
   * Authorization header from the MCP request. Omit to disable the
   * `atlas://verification` resource.
   */
  loadVerificationStatus?: (authorization: string) => Promise<AtlasVerificationStatus>;
}

const DEFAULT_PRICING: AtlasPricingPayload = {
  protocol_fee_percent: 2.5,
  payment_processing: {
    stripe: { percent: 2.9, fixed_cents: 30 },
    crypto: { percent: 1.0, fixed_cents: 0 },
  },
  refund_policy: {
    full_refund_window_hours: 24,
    partial_refund_after: false,
  },
  currency_support: ["USD", "EUR", "GBP"],
  free_events: {
    protocol_fee: false,
    processing_fee: false,
  },
};

/** Register ATLAS MCP resources on the supplied {@link McpServer}. */
export function registerAtlasMcpResources(
  server: McpServer,
  options: RegisterAtlasMcpResourcesOptions,
): void {
  const resolved = resolveConfig(options.config);
  const logger = resolved.logger;
  const pricing = options.pricing ?? DEFAULT_PRICING;

  server.registerResource(
    "atlas-pricing",
    "atlas://pricing",
    {
      description: "Atlas Protocol fee structure and pricing information",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "atlas://pricing",
          mimeType: "application/json",
          text: JSON.stringify(pricing),
        },
      ],
    }),
  );

  if (options.loadVerificationStatus) {
    const loader = options.loadVerificationStatus;
    server.registerResource(
      "atlas-verification",
      "atlas://verification",
      {
        description: "Your current identity verification status for Atlas Protocol transactions",
        mimeType: "application/json",
      },
      async (_uri, extra) => {
        const rawAuth = (extra as { requestInfo?: { headers?: Record<string, unknown> } })
          ?.requestInfo?.headers?.["authorization"];
        const authorization = typeof rawAuth === "string" ? rawAuth : undefined;
        if (!authorization) {
          throw new Error("Authentication required to check verification status");
        }

        try {
          const data = await loader(authorization);
          return {
            contents: [
              {
                uri: "atlas://verification",
                mimeType: "application/json",
                text: JSON.stringify(data),
              },
            ],
          };
        } catch (error) {
          logger.warn("Failed to fetch verification status", {
            error: (error as Error).message,
          });
          return {
            contents: [
              {
                uri: "atlas://verification",
                mimeType: "application/json",
                text: JSON.stringify({
                  is_verified: false,
                  level: "unknown",
                  error: "Unable to fetch verification status",
                }),
              },
            ],
          };
        }
      },
    );
  }

  logger.debug("Atlas MCP resources registered");
}
