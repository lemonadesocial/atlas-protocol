/**
 * Configuration types for the ATLAS agent-tools package.
 *
 * The package never reads `process.env` itself — callers pass an explicit
 * {@link AtlasToolsConfig} object. This keeps the package portable across
 * runtimes (Node, Deno, browser/edge) and easy to test.
 */

/**
 * Minimal logger interface accepted by the package.
 *
 * Compatible with the public API of pino, bunyan, winston, and console — pass
 * any object that exposes the four methods below. Defaults to a no-op logger
 * when omitted.
 */
export interface Logger {
  debug(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
}

/** No-op logger used when no logger is supplied. */
export const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/**
 * Runtime configuration for the ATLAS agent-tools package.
 */
export interface AtlasToolsConfig {
  /** Base URL of an ATLAS Registry (federated event search). */
  registryUrl: string;
  /** Base URL of the ATLAS Backend (purchases, holds, receipts). */
  backendUrl: string;
  /** Stable identifier for this agent (sent as `Atlas-Agent-Id`). */
  agentId: string;
  /**
   * Optional pre-shared API key. If present, sent as a Bearer token on all
   * outbound requests. End-user auth (e.g. session tokens) is passed via
   * per-tool `authHeader` arguments instead.
   */
  apiKey?: string;
  /** Optional logger. Defaults to a no-op. */
  logger?: Logger;
  /** Override the ATLAS API version header. Defaults to `"1.0"`. */
  apiVersion?: string;
}

/**
 * Minimal viem account / chain shapes used by the x402 client. Declared
 * structurally so this package compiles without viem installed — agents that
 * only accept fiat never load it.
 */
export interface ViemAccount {
  address: `0x${string}`;
  type?: string;
}

export interface ViemChainLike {
  id: number;
  name: string;
  rpcUrls: { default: { http: readonly string[] } };
}

/** Selects which payment rail the dual-protocol router prefers. */
export type PreferredRail = "x402" | "stripe-mpp" | "auto" | "raw";

/**
 * Notification hook fired after either rail completes a settlement. Useful
 * for instrumented agents (logging, metrics) and for surfacing transaction
 * details back to the user.
 */
export type AtlasPaymentNotification =
  | { rail: "x402"; txHash: `0x${string}`; amount: bigint; receiver: `0x${string}` }
  | { rail: "stripe-mpp"; paymentIntentId: string; amountCents: number; receiver: string };

/**
 * Routing config consumed by the dual-protocol `atlas_purchase` tool.
 * Composed into {@link AtlasMcpToolsConfig} so callers configure routing
 * once at registration time.
 *
 * Safety fields (`allowedReceivers`, `maxAmountUsdCents`, plus
 * `allowedStablecoins` / `maxAmountUsdcMicro` for the x402 path) are
 * required — without them the tool would settle any 402 it received.
 */
export interface AtlasMppRoutingConfig {
  /** Which rail to use. Defaults to `"auto"` if omitted. */
  preferredRail?: PreferredRail;

  // x402 (on-chain USDC) options ---------------------------------------------

  /** Wallet account that signs USDC transfers. Required for the x402 rail. */
  viemAccount?: ViemAccount;
  /** Chain to settle on. Must match a rail in the challenge. */
  chain?: ViemChainLike;
  /** Optional RPC override. Falls back to `chain.rpcUrls.default.http[0]`. */
  rpcUrl?: string;
  /** Block confirmations to wait for. Default 1. */
  waitForConfirmations?: number;
  /** USDC contract addresses the tool is willing to settle in. Required for x402. */
  allowedStablecoins?: readonly `0x${string}`[];
  /** Per-request hard cap, in 6-decimal USDC micro-units. Required for x402 if `maxAmountUsdCents` is unset. */
  maxAmountUsdcMicro?: bigint;

  // stripe-mpp (Stripe SPT) options ------------------------------------------

  /**
   * Caller-supplied Stripe SPT callback. Returns the Stripe
   * `payment_intent_id` once the user has authorized + the charge has
   * settled. Required for the stripe-mpp rail.
   */
  getSpt?: (challenge: {
    amount: number;
    currency: "usd";
    challenge_id: string;
    realm: string;
    receiver?: string;
  }) => Promise<string>;

  // Common safety opts -------------------------------------------------------

  /**
   * Receiver allowlist. For x402: EVM addresses. For stripe-mpp: Stripe
   * account ids / merchant identifiers. Always required.
   */
  allowedReceivers: readonly string[];
  /**
   * Per-request hard cap in USD cents. Always required (covers both rails).
   * `maxAmountUsdcMicro` defaults to this × 10_000 if not separately set.
   */
  maxAmountUsdCents: number;
  /** Notification hook fired after either rail completes a settlement. */
  onPayment?: (info: AtlasPaymentNotification) => void;
}

/**
 * Full MCP-tool config: base `AtlasToolsConfig` plus optional dual-protocol
 * routing. Pass to `registerAtlasMcpTools` to enable in-tool 402 settlement.
 * If `routing` is omitted the `atlas_purchase` tool falls back to its legacy
 * `/atlas/v1/holds/:id/checkout` redirect path.
 */
export interface AtlasMcpToolsConfig extends AtlasToolsConfig {
  routing?: AtlasMppRoutingConfig;
}

/** Resolves a config to its concrete defaults. */
export function resolveConfig(config: AtlasToolsConfig): Required<
  Pick<AtlasToolsConfig, "registryUrl" | "backendUrl" | "agentId" | "apiVersion">
> & {
  logger: Logger;
  apiKey: string | undefined;
} {
  return {
    registryUrl: config.registryUrl,
    backendUrl: config.backendUrl,
    agentId: config.agentId,
    apiVersion: config.apiVersion ?? "1.0",
    logger: config.logger ?? noopLogger,
    apiKey: config.apiKey,
  };
}
