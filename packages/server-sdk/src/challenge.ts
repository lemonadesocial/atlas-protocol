import { encode, serialize, type MppEnvelope, type MppPayload } from "@atlasprotocol/mpp";

import { CHAIN_SPECS } from "./chain-specs.js";
import type { AtlasPaymentMethodType } from "./types/index.js";

/**
 * Per-chain x402 entry surfaced inside the challenge payload's
 * `payment_methods` array.
 */
export interface X402PaymentMethodEntry {
  type: Exclude<AtlasPaymentMethodType, "stripe_spt" | "solana_usdc">;
  chain_id: number;
  /** USDC (or chain-native stablecoin) ERC-20 contract address. */
  token: `0x${string}`;
  /** Receiver address — the FeeRouter (or organizer) wallet on this chain. */
  recipient: `0x${string}`;
  /** USDC amount due, as a 6-decimal decimal string (e.g. "12.500000"). */
  amount: string;
  /** Block confirmations the server requires before accepting a transfer. */
  confirmations: number;
  /** Public RPC URL the server will use to validate the transfer. */
  rpc_url: string;
  /** True if this chain spec is unstable / testnet. */
  experimental?: boolean;
}

export interface StripeSptPaymentMethodEntry {
  type: "stripe_spt";
  /** Stripe PaymentIntent client_secret or id the agent uses to confirm. */
  payment_intent_id?: string;
  /** Charge amount as a USD decimal string (e.g. "12.50"). */
  amount: string;
  currency: "usd";
}

export type AtlasPaymentMethodEntry = X402PaymentMethodEntry | StripeSptPaymentMethodEntry;

/**
 * The JSON body returned with a 402 Payment Required response. Mirrors the
 * `AtlasPurchaseChallenge` schema from `01-whitepaper/docs/02-SCHEMAS.md` §4
 * with an explicit `payment_methods` array — agents inspect it to decide
 * which rail to settle on.
 */
export interface AtlasMppChallengePayload {
  /** Stable challenge id used in idempotency keys + replay stores. */
  challenge_id: string;
  event_id: string;
  hold_id: string;
  ticket_type_id?: string;
  quantity?: number;
  /** Total amount due, in USDC micro-units (6 decimals). */
  expected_amount_usdc_micros: string;
  /** ISO-8601 expiry; matches the hold expiry on the server side. */
  expires_at: string;
  /**
   * Per-rail payment methods. Always includes one entry per accepted chain;
   * may include a `stripe_spt` entry if `acceptStripe` was set.
   */
  payment_methods: AtlasPaymentMethodEntry[];
}

export interface GenerateMppChallengeOpts {
  eventId: string;
  holdId: string;
  challengeId?: string;
  ticketTypeId?: string;
  quantity?: number;
  /** Total amount due, in USDC micro-units (6-decimal). */
  amountUsdcMicros: bigint;
  /** Recipient address on EVM rails (FeeRouter or organizer wallet). */
  organizerAddress: `0x${string}`;
  /** Subset of CHAIN_SPECS keys the platform is willing to accept. */
  acceptedChains: ReadonlyArray<keyof typeof CHAIN_SPECS>;
  /** When true, include a `stripe_spt` entry in payment_methods. */
  acceptStripe: boolean;
  /** Optional Stripe PaymentIntent id pre-created server-side. */
  stripePaymentIntentId?: string;
  /** Optional explicit expiry (ISO-8601). Defaults to now + 5 minutes. */
  expiresAt?: string;
  /** Optional realm advertised in the WWW-Authenticate header. */
  realm?: string;
  /**
   * Optional override for per-chain receiver address — falls back to
   * `organizerAddress` when missing. Useful for platforms whose FeeRouter
   * has a different deployment per chain.
   */
  receiversByChain?: Partial<Record<keyof typeof CHAIN_SPECS, `0x${string}`>>;
  /**
   * Override per-chain RPC URL. Falls back to `CHAIN_SPECS[chain].defaultRpcUrl`.
   */
  rpcUrlsByChain?: Partial<Record<keyof typeof CHAIN_SPECS, string>>;
}

export interface GenerateMppChallengeResult {
  /** JSON body to return on the 402 response. */
  payload: AtlasMppChallengePayload;
  /**
   * Single canonical MPP envelope — uses the FIRST accepted chain as its
   * `rail` so a header-only consumer (no JSON body parser) sees a valid
   * single-rail challenge. The full `payment_methods` array is duplicated
   * into `envelope.request.payment_methods` for clients that prefer the
   * envelope path.
   */
  envelope: MppEnvelope;
  /**
   * Value to set on the `WWW-Authenticate` response header. Format:
   * `MPP realm="<realm>", challenge="<base64url-jcs>"`.
   */
  headerValue: string;
}

/**
 * Build the JSON body + MPP envelope + WWW-Authenticate header value for an
 * ATLAS 402 challenge. The platform decides which chains it accepts and
 * whether it accepts Stripe SPT; this helper produces a multi-rail challenge
 * agents can route from.
 */
export function generateMppChallenge(opts: GenerateMppChallengeOpts): GenerateMppChallengeResult {
  if (opts.acceptedChains.length === 0 && !opts.acceptStripe) {
    throw new Error(
      "generateMppChallenge: at least one accepted rail required (acceptedChains[] or acceptStripe)",
    );
  }
  if (opts.amountUsdcMicros <= 0n) {
    throw new Error("generateMppChallenge: amountUsdcMicros must be > 0");
  }

  const challengeId = opts.challengeId ?? `ch_${opts.holdId}`;
  const expiresAt = opts.expiresAt ?? new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const realm = opts.realm ?? "atlas";

  const amountDecimal = formatUsdcMicroAsDecimal(opts.amountUsdcMicros);

  const x402Entries: X402PaymentMethodEntry[] = opts.acceptedChains.map((chainKey) => {
    const spec = CHAIN_SPECS[chainKey];
    const recipient = opts.receiversByChain?.[chainKey] ?? opts.organizerAddress;
    const rpcUrl = opts.rpcUrlsByChain?.[chainKey] ?? spec.defaultRpcUrl;
    return {
      type: chainKey,
      chain_id: spec.chain.id,
      token: spec.usdcAddress as `0x${string}`,
      recipient,
      amount: amountDecimal,
      confirmations: spec.defaultConfirmations,
      rpc_url: rpcUrl,
      ...(spec.experimental === true && { experimental: true }),
    };
  });

  const stripeEntry: StripeSptPaymentMethodEntry | undefined = opts.acceptStripe
    ? {
        type: "stripe_spt",
        currency: "usd",
        amount: formatUsdMicroAsTwoDecimal(opts.amountUsdcMicros),
        ...(opts.stripePaymentIntentId !== undefined && {
          payment_intent_id: opts.stripePaymentIntentId,
        }),
      }
    : undefined;

  const payment_methods: AtlasPaymentMethodEntry[] = stripeEntry
    ? [...x402Entries, stripeEntry]
    : [...x402Entries];

  const payload: AtlasMppChallengePayload = {
    challenge_id: challengeId,
    event_id: opts.eventId,
    hold_id: opts.holdId,
    expected_amount_usdc_micros: opts.amountUsdcMicros.toString(),
    expires_at: expiresAt,
    payment_methods,
    ...(opts.ticketTypeId !== undefined && { ticket_type_id: opts.ticketTypeId }),
    ...(opts.quantity !== undefined && { quantity: opts.quantity }),
  };

  const primary = pickPrimaryRail(x402Entries, stripeEntry);
  const mppPayload: MppPayload = {
    rail: primary.rail,
    realm,
    paymentId: challengeId,
    intent: "charge",
    amount: primary.amount,
    currency: primary.currency,
    recipient: primary.recipient,
    organizer: opts.organizerAddress,
    expires: expiresAt,
    description: `ATLAS purchase ${opts.eventId} hold=${opts.holdId}`,
    metadata: {
      event_id: opts.eventId,
      hold_id: opts.holdId,
      challenge_id: challengeId,
      // payment_methods is JSON-encoded so it survives the
      // `metadata: Record<string, string>` shape of the MPP envelope.
      payment_methods: JSON.stringify(payment_methods),
    },
  };

  const envelope = encode(mppPayload);
  const headerValue = `MPP realm="${realm}", challenge="${serialize(envelope)}"`;

  return { payload, envelope, headerValue };
}

interface PrimaryRail {
  rail: string;
  amount: string;
  currency: string;
  recipient: string;
}

function pickPrimaryRail(
  x402Entries: X402PaymentMethodEntry[],
  stripeEntry: StripeSptPaymentMethodEntry | undefined,
): PrimaryRail {
  const first = x402Entries[0];
  if (first) {
    return {
      rail: x402RailName(first.type),
      amount: first.amount,
      currency: first.token,
      recipient: first.recipient,
    };
  }
  if (stripeEntry) {
    return {
      rail: "stripe-spt",
      amount: stripeEntry.amount,
      currency: "usd",
      // Stripe SPT does not have an on-chain recipient. Use a sentinel that
      // makes the challenge syntactically valid; the agent will see
      // `stripe_spt` in payment_methods and ignore this field.
      recipient: "stripe:platform",
    };
  }
  // Unreachable per the guard at the top of generateMppChallenge.
  throw new Error("generateMppChallenge: no rails to encode");
}

/**
 * Map an internal `<chain>_<token>` payment method type to the canonical
 * MPP rail name (e.g. `base_usdc` -> `usdc-base`). Mirrors the convention in
 * `lemonade-backend/src/app/services/atlas/mpp.ts`.
 */
function x402RailName(type: X402PaymentMethodEntry["type"]): string {
  switch (type) {
    case "base_usdc":
      return "usdc-base";
    case "base_sepolia_usdc":
      return "usdc-base-sepolia";
    case "optimism_usdc":
      return "usdc-optimism";
    case "arbitrum_usdc":
      return "usdc-arbitrum";
    case "polygon_usdc":
      return "usdc-polygon";
    case "zksync_usdc":
      return "usdc-zksync";
    case "worldchain_usdc":
      return "usdc-worldchain";
    case "megaeth_usdm":
      return "usdm-megaeth";
    case "tempo_usdc":
      return "usdc-tempo";
  }
}

/**
 * Format a USDC micro-units bigint as a 6-decimal string. "1234567" -> "1.234567".
 */
function formatUsdcMicroAsDecimal(micros: bigint): string {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const whole = abs / 1_000_000n;
  const fraction = abs % 1_000_000n;
  const fractionStr = fraction.toString().padStart(6, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${fractionStr}`;
}

/**
 * Format a USD micros bigint as a 2-decimal string for Stripe display.
 * Banker-friendly rounding to the nearest cent.
 */
function formatUsdMicroAsTwoDecimal(micros: bigint): string {
  // Round to nearest cent (10_000 micros).
  const cents = (micros + 5_000n) / 10_000n;
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / 100n;
  const fraction = abs % 100n;
  return `${negative ? "-" : ""}${whole.toString()}.${fraction.toString().padStart(2, "0")}`;
}
