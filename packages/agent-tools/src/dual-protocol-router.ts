/**
 * Dual-protocol routing for ATLAS 402 challenges.
 *
 * The platform's purchase endpoint can return one of two 402 shapes:
 *
 *   1. **MPP envelope** — produced by `generateMppChallenge` from
 *      `@atlasprotocol/server-sdk`. The body carries `{ challenge: <wire>, ... }`
 *      or the response sets `WWW-Authenticate: MPP …`. Inside the envelope's
 *      `metadata.payment_methods` is a JSON-encoded array describing each
 *      available rail (per-chain x402 entries plus an optional `stripe_spt`
 *      entry).
 *
 *   2. **Legacy `atlas:challenge`** — the older 402 shape that goes through
 *      the backend's `/atlas/v1/holds/:id/checkout` redirect flow. Out of
 *      scope here; the caller falls back to that path.
 *
 * This module decodes the MPP envelope, picks a rail, and dynamically imports
 * the corresponding client subpath (`@atlasprotocol/mpp/x402` or
 * `@atlasprotocol/mpp/stripe-mpp`). Consumers that don't accept fiat or don't
 * accept on-chain payments only pay for the subpath they actually use.
 */

import type { AtlasMppRoutingConfig, PreferredRail, ViemAccount, ViemChainLike } from "./config.js";

/** A single payment method entry from `metadata.payment_methods`. */
export interface MppPaymentMethodOffer {
  type: string;
  amount?: string;
  currency?: string;
  recipient?: string;
  chain_id?: number;
  token?: string;
  rpc_url?: string;
  confirmations?: number;
  payment_intent_id?: string;
  experimental?: boolean;
}

export interface DecodedMppChallenge {
  /** Re-serialized envelope body (the `challenge` field clients need). */
  envelopeWire: string;
  /** Decoded `payment_methods` array from envelope metadata. */
  offers: MppPaymentMethodOffer[];
}

/**
 * Outcome of a routing decision. Consumers branch on `kind`:
 *
 *   - `paid` — a payment ran end-to-end. `response` holds whatever the retry produced.
 *   - `unrouted` — the helper could not pick a rail (no compatible client opts,
 *     no rails advertised, or `preferredRail = "raw"`). Caller should hand the
 *     decoded challenge back to the agent for manual handling.
 */
export type DualProtocolRoutingResult =
  | { kind: "paid"; rail: "x402" | "stripe-mpp"; response: Response }
  | { kind: "unrouted"; reason: UnroutedReason; challenge: DecodedMppChallenge };

export type UnroutedReason =
  | "no-mpp-envelope"
  | "no-rails-offered"
  | "no-x402-method"
  | "no-stripe-method"
  | "no-client-opts"
  | "preferred-rail-missing-opts";

/**
 * Try to settle a 402 by routing through the right `@atlasprotocol/mpp/*`
 * client. Returns `{ kind: "unrouted" }` (without throwing) for cases the
 * caller should handle — e.g. "preferred rail not configured", "neither rail
 * advertised". Real errors from the underlying clients (RPC failure, getSpt
 * rejection) propagate as exceptions.
 */
export async function routeDualProtocol402(
  url: string | URL,
  initBeforeRetry: RequestInit | undefined,
  response402: Response,
  opts: AtlasMppRoutingConfig,
): Promise<DualProtocolRoutingResult> {
  const challenge = await decodeMppChallengeFromResponse(response402);
  if (!challenge) {
    return {
      kind: "unrouted",
      reason: "no-mpp-envelope",
      challenge: { envelopeWire: "", offers: [] },
    };
  }

  if (challenge.offers.length === 0) {
    return { kind: "unrouted", reason: "no-rails-offered", challenge };
  }

  const preferred: PreferredRail = opts.preferredRail ?? "auto";

  const stripeOffer = challenge.offers.find((o) => o.type === "stripe_spt");
  const x402Offers = challenge.offers.filter(
    (o) => o.type !== "stripe_spt" && o.type !== "solana_usdc",
  );

  const canX402 =
    x402Offers.length > 0 && opts.viemAccount !== undefined && opts.chain !== undefined;
  const canStripe = stripeOffer !== undefined && opts.getSpt !== undefined;

  if (preferred === "raw") {
    return { kind: "unrouted", reason: "no-client-opts", challenge };
  }

  if (preferred === "x402") {
    if (!canX402) {
      return { kind: "unrouted", reason: "preferred-rail-missing-opts", challenge };
    }
    return runX402(url, initBeforeRetry, opts, x402Offers, challenge);
  }

  if (preferred === "stripe-mpp") {
    if (!canStripe) {
      return { kind: "unrouted", reason: "preferred-rail-missing-opts", challenge };
    }
    return runStripeMpp(url, initBeforeRetry, opts, challenge);
  }

  // auto: prefer x402 if usable, else stripe-mpp, else give up.
  if (canX402) return runX402(url, initBeforeRetry, opts, x402Offers, challenge);
  if (canStripe) return runStripeMpp(url, initBeforeRetry, opts, challenge);
  return { kind: "unrouted", reason: "no-client-opts", challenge };
}

/**
 * Decode an MPP envelope from a 402 response. Returns `null` if the response
 * doesn't carry an envelope (e.g. legacy `atlas:challenge` shape).
 */
async function decodeMppChallengeFromResponse(
  response: Response,
): Promise<DecodedMppChallenge | null> {
  const wire = await extractChallengeWire(response.clone());
  if (!wire) return null;

  // Lazy-load the wire-format helpers — this module never blocks the agent
  // surface from running purchase tools that don't speak MPP.
  const mpp = await import("@atlasprotocol/mpp");
  let envelope;
  let payload;
  try {
    envelope = mpp.deserialize(wire);
    payload = mpp.decode(envelope);
  } catch {
    return null;
  }

  const raw = payload.metadata?.["payment_methods"];
  if (typeof raw !== "string") {
    // Single-rail challenges may not pack a payment_methods array. Treat the
    // primary rail as a one-element offer set.
    return {
      envelopeWire: wire,
      offers: [
        {
          type: railToMethodType(payload.rail),
          amount: payload.amount,
          currency: payload.currency,
          ...(payload.recipient !== undefined && { recipient: payload.recipient }),
        },
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const offers: MppPaymentMethodOffer[] = parsed
    .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
    .map((e) => normalizeOffer(e));

  return { envelopeWire: wire, offers };
}

function normalizeOffer(e: Record<string, unknown>): MppPaymentMethodOffer {
  const offer: MppPaymentMethodOffer = { type: typeof e["type"] === "string" ? e["type"] : "" };
  if (typeof e["amount"] === "string") offer.amount = e["amount"];
  if (typeof e["currency"] === "string") offer.currency = e["currency"];
  if (typeof e["recipient"] === "string") offer.recipient = e["recipient"];
  if (typeof e["chain_id"] === "number") offer.chain_id = e["chain_id"];
  if (typeof e["token"] === "string") offer.token = e["token"];
  if (typeof e["rpc_url"] === "string") offer.rpc_url = e["rpc_url"];
  if (typeof e["confirmations"] === "number") offer.confirmations = e["confirmations"];
  if (typeof e["payment_intent_id"] === "string") offer.payment_intent_id = e["payment_intent_id"];
  if (e["experimental"] === true) offer.experimental = true;
  return offer;
}

async function extractChallengeWire(response: Response): Promise<string | null> {
  try {
    const ct = response.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const body = (await response.json()) as { challenge?: unknown };
      if (typeof body.challenge === "string" && body.challenge.length > 0) {
        return body.challenge;
      }
    }
  } catch {
    // fall through
  }
  const wwwAuth = response.headers.get("www-authenticate");
  if (!wwwAuth) return null;
  const match = /(?:^|[\s,])(?:MPP|Bearer)\s.*?challenge="([^"]+)"/i.exec(wwwAuth);
  return match?.[1] ?? null;
}

/**
 * Map a primary-rail string (`usdc-base`, `stripe-spt`, …) back to a payment
 * method type identifier. Used when the envelope's `metadata.payment_methods`
 * is missing — every challenge always has at least the single primary rail.
 */
function railToMethodType(rail: string): string {
  switch (rail) {
    case "usdc-base":
      return "base_usdc";
    case "usdc-base-sepolia":
      return "base_sepolia_usdc";
    case "usdc-optimism":
      return "optimism_usdc";
    case "usdc-arbitrum":
      return "arbitrum_usdc";
    case "usdc-polygon":
      return "polygon_usdc";
    case "usdc-zksync":
      return "zksync_usdc";
    case "usdc-worldchain":
      return "worldchain_usdc";
    case "usdm-megaeth":
      return "megaeth_usdm";
    case "usdc-tempo":
      return "tempo_usdc";
    case "stripe-spt":
      return "stripe_spt";
    default:
      return rail;
  }
}

async function runX402(
  url: string | URL,
  init: RequestInit | undefined,
  opts: AtlasMppRoutingConfig,
  offers: MppPaymentMethodOffer[],
  challenge: DecodedMppChallenge,
): Promise<DualProtocolRoutingResult> {
  if (offers.length === 0) {
    return { kind: "unrouted", reason: "no-x402-method", challenge };
  }
  if (opts.viemAccount === undefined || opts.chain === undefined) {
    return { kind: "unrouted", reason: "preferred-rail-missing-opts", challenge };
  }

  // The mpp/x402 helper itself does the safety checks (allowedReceivers,
  // allowedStablecoins, maxAmountUsdcMicro). We forward what the caller
  // configured; if they pinned a chain that isn't offered, x402 will throw
  // `stablecoin-not-allowed` or `receiver-not-allowed`.
  const x402 = await import("@atlasprotocol/mpp/x402");

  const response = await x402.fetchWithPayment(url, init, {
    account: opts.viemAccount,
    chain: opts.chain,
    allowedReceivers: opts.allowedReceivers as readonly `0x${string}`[],
    allowedStablecoins: opts.allowedStablecoins ?? [],
    maxAmountUsdcMicro: opts.maxAmountUsdcMicro ?? BigInt(opts.maxAmountUsdCents) * 10_000n,
    ...(opts.waitForConfirmations !== undefined && {
      waitForConfirmations: opts.waitForConfirmations,
    }),
    ...(opts.rpcUrl !== undefined && { rpcUrl: opts.rpcUrl }),
    ...(opts.onPayment !== undefined && {
      onPayment: (info: { txHash: `0x${string}`; amount: bigint; receiver: `0x${string}` }) =>
        opts.onPayment?.({
          rail: "x402",
          txHash: info.txHash,
          amount: info.amount,
          receiver: info.receiver,
        }),
    }),
  });

  return { kind: "paid", rail: "x402", response };
}

async function runStripeMpp(
  url: string | URL,
  init: RequestInit | undefined,
  opts: AtlasMppRoutingConfig,
  challenge: DecodedMppChallenge,
): Promise<DualProtocolRoutingResult> {
  if (opts.getSpt === undefined) {
    return { kind: "unrouted", reason: "preferred-rail-missing-opts", challenge };
  }

  const stripeMpp = await import("@atlasprotocol/mpp/stripe-mpp");

  const response = await stripeMpp.fetchWithPaymentSpt(url, init, {
    getSpt: opts.getSpt,
    maxAmountUsdCents: opts.maxAmountUsdCents,
    allowedReceivers: opts.allowedReceivers,
    ...(opts.onPayment !== undefined && {
      onPayment: (info: { paymentIntentId: string; amountCents: number; receiver: string }) =>
        opts.onPayment?.({
          rail: "stripe-mpp",
          paymentIntentId: info.paymentIntentId,
          amountCents: info.amountCents,
          receiver: info.receiver,
        }),
    }),
  });

  return { kind: "paid", rail: "stripe-mpp", response };
}

export type { ViemAccount, ViemChainLike, PreferredRail };
