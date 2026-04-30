import type { ServerSdkConfig } from "@atlasprotocol/server-sdk";

/**
 * Build the ServerSdkConfig used by `generateManifest`. Defaults are
 * illustrative — production deployments should override every value via env.
 */
export function getAtlasConfig(): ServerSdkConfig {
  const domain = process.env.ATLAS_DOMAIN ?? "localhost:3000";
  const platformName = process.env.ATLAS_PLATFORM_NAME ?? "ATLAS Organizer Example";
  const platformUrl = process.env.ATLAS_PLATFORM_URL ?? "http://localhost:3000";
  const protocolFeePercent = numberFromEnv(process.env.ATLAS_PROTOCOL_FEE_PCT, 2);
  const platformFeePercent = numberFromEnv(process.env.ATLAS_PLATFORM_FEE_PCT, 3);

  return {
    platform: {
      name: platformName,
      url: platformUrl,
      description: "Reference Next.js operator app demonstrating the ATLAS Protocol manifest.",
      contactEmail: "operator@example.com",
    },
    domain,
    feeSchedule: {
      protocolFeePercent,
      platformFeePercent,
      paymentProcessingNote: "Production operators should document processing fees here.",
    },
    // Replace with real configured methods (evm_usdc_*, stripe_spt, ...) before going live.
    paymentMethods: [],
    // Replace with the platform's public signing keys (JWK) before going live.
    signingKeys: [],
    rateLimits: {
      searchPerMinute: 60,
      purchasePerMinute: 30,
    },
  };
}

function numberFromEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);

  return Number.isFinite(parsed) ? parsed : fallback;
}
