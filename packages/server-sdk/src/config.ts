import type { AtlasPaymentMethodType, AtlasSigningKeyJwk } from "./types/index.js";

/**
 * Pluggable logger interface. Defaults to a no-op so consumers may run the
 * SDK silently. Pass a pino/winston/console adapter to integrate with the
 * host application's logging.
 */
export interface Logger {
  debug(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
}

export const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * Per-payment-method configuration. The SDK uses these values to verify
 * on-chain transfers against the expected receiver / contract address.
 *
 * For EVM USDC chains, supply { type, receiverAddress, rpcUrl?, chainId? }.
 * For Stripe SPT, supply { type: 'stripe_spt', stripeSecretKey }.
 */
export type PaymentMethodConfig = EvmUsdcMethodConfig | StripeSptMethodConfig;

export interface EvmUsdcMethodConfig {
  type: Exclude<AtlasPaymentMethodType, "stripe_spt" | "solana_usdc">;
  /** Receiver address that USDC must be transferred to. */
  receiverAddress: string;
  /** Optional override for the chain RPC URL. */
  rpcUrl?: string;
  /** Optional override for the USDC contract address. */
  usdcContractAddress?: string;
  /** Confirmations required before the SDK accepts a transfer. */
  requiredConfirmations?: number;
}

export interface StripeSptMethodConfig {
  type: "stripe_spt";
  /** Stripe secret key used to retrieve PaymentIntents. */
  stripeSecretKey: string;
  /** Optional Stripe API version override. */
  apiVersion?: string;
}

export interface PlatformInfo {
  name: string;
  url: string;
  logoUrl?: string;
  description?: string;
  contactEmail?: string;
}

export interface FeeSchedule {
  protocolFeePercent: number;
  platformFeePercent: number;
  paymentProcessingNote?: string;
}

export interface RateLimits {
  searchPerMinute: number;
  purchasePerMinute: number;
}

export interface ServerSdkConfig {
  /** Branding shown in the manifest. */
  platform: PlatformInfo;
  /** ATLAS API base URL (e.g. `https://atlas.lemonade.social`). */
  domain: string;
  /** Fee schedule advertised in the manifest. */
  feeSchedule: FeeSchedule;
  /** Configured payment methods. Drives manifest + payment verification. */
  paymentMethods: PaymentMethodConfig[];
  /** Public signing keys (JWK) advertised in the manifest. */
  signingKeys: AtlasSigningKeyJwk[];
  /** Rate-limit hints advertised in the manifest. */
  rateLimits: RateLimits;
  /** Optional logger. Defaults to a no-op logger if omitted. */
  logger?: Logger;
}

export function resolveLogger(config: Pick<ServerSdkConfig, "logger">): Logger {
  return config.logger ?? noopLogger;
}
