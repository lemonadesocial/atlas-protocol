/**
 * Reference dual-protocol-server: a minimal Hono service exposing the four
 * ATLAS endpoints from an in-memory event store. Demonstrates how an event
 * platform can install @atlasprotocol/server-sdk + @atlasprotocol/mpp +
 * stripe + viem and accept x402 (multi-L2 USDC) AND Stripe SPT payments
 * out of the box.
 *
 * Endpoints:
 *   GET  /.well-known/atlas.json
 *   GET  /atlas/v1/search?q=&city=&date_from=&date_to=
 *   GET  /atlas/v1/events/:id
 *   POST /atlas/v1/events/:id/purchase
 *
 * The platform IS the source of truth for its own events — there is no
 * registry server in this phase. Aggregators (multi-platform search) are an
 * optional convenience layer anyone can build later.
 */

import { serve } from "@hono/node-server";
import { decode, deserialize, type MppPayload } from "@atlasprotocol/mpp";
import {
  InMemoryIdempotencyStore,
  InMemoryRateLimiter,
  RewardKind,
  buildMintTicketTx,
  buildRecordRewardTx,
  createRateLimitMiddleware,
  defaultSupportedChainIdentifiers,
  generateAtlasManifest,
  generateMppChallenge,
  generateReceipt,
  parseRewardRecordedEvent,
  parseTicketMintedEvent,
  verifyPayment,
  verifyStripePayment,
  withIdempotency,
  type AtlasPaymentMethodType,
} from "@atlasprotocol/server-sdk";
import { keccak256, toHex } from "viem";
import { Hono, type Context } from "hono";

import {
  DEMO_EVENTS,
  findEvent,
  findTicketType,
  getHold,
  lookupOrCreateHold,
  markSettled,
  type DemoEvent,
  type DemoHold,
} from "./data.js";

const PORT = Number(process.env["PORT"] ?? 4001);
const PLATFORM_NAME = process.env["PLATFORM_NAME"] ?? "ATLAS Demo Platform";
const PLATFORM_URL = process.env["PLATFORM_URL"] ?? `http://localhost:${PORT}`;
const PLATFORM_DID = process.env["PLATFORM_DID"]; // optional did:web identifier
const ORGANIZER_ADDRESS =
  (process.env["ORGANIZER_ADDRESS"] as `0x${string}` | undefined) ??
  "0x000000000000000000000000000000000000dEaD";
const STRIPE_SECRET_KEY = process.env["STRIPE_SECRET_KEY"]; // required to enable the Stripe rail
// `ACCEPT_STRIPE` is opt-in and only takes effect when STRIPE_SECRET_KEY is also set.
// We don't claim the stripe_spt capability if we can't actually verify it.
const ACCEPT_STRIPE =
  (process.env["ACCEPT_STRIPE"] ?? "true").toLowerCase() === "true" && Boolean(STRIPE_SECRET_KEY);
const ACCEPTED_CHAINS_ENV = process.env["ACCEPTED_CHAINS"]; // comma-separated CHAIN_SPECS keys
type AcceptedChain = Exclude<AtlasPaymentMethodType, "stripe_spt" | "solana_usdc">;
const ACCEPTED_CHAINS: AcceptedChain[] = ACCEPTED_CHAINS_ENV
  ? (ACCEPTED_CHAINS_ENV.split(",")
      .map((s) => s.trim())
      .filter(Boolean) as AcceptedChain[])
  : ["base_usdc", "optimism_usdc", "arbitrum_usdc"];

// ---------------------------------------------------------------------------
// Optional integration env vars — when set, the example wires up on-chain
// mint + reward calls and IPFS pinning. When unset, the example STILL runs:
// it logs a clear warning and skips the corresponding step. This keeps the
// example runnable locally without on-chain credentials or a pinning
// service account.
// ---------------------------------------------------------------------------
const ATLAS_TICKET_ADDRESS = process.env["ATLAS_TICKET_ADDRESS"] as `0x${string}` | undefined;
const REWARD_LEDGER_ADDRESS = process.env["REWARD_LEDGER_ADDRESS"] as `0x${string}` | undefined;
const WALLET_PRIVATE_KEY = process.env["WALLET_PRIVATE_KEY"] as `0x${string}` | undefined;
const RPC_URL = process.env["RPC_URL"];
const SETTLEMENT_CHAIN_NAME = process.env["SETTLEMENT_CHAIN_NAME"] ?? "base";
const PINATA_JWT = process.env["PINATA_JWT"];
const WEB3_STORAGE_TOKEN = process.env["WEB3_STORAGE_TOKEN"];
const WEB3_STORAGE_SPACE_DID = process.env["WEB3_STORAGE_SPACE_DID"];
const PROTOCOL_FEE_BPS = 200n; // 2% — split between the protocol fee and the organizer reward.

interface StripeLikeForVerifier {
  paymentIntents: {
    retrieve(id: string): Promise<{ id: string; status: string; currency: string; amount: number }>;
  };
}

let stripeClient: StripeLikeForVerifier | null = null;
async function getStripeClient(): Promise<StripeLikeForVerifier | null> {
  if (!ACCEPT_STRIPE) return null;
  if (stripeClient) return stripeClient;
  if (!STRIPE_SECRET_KEY) {
    console.warn("ACCEPT_STRIPE=true but STRIPE_SECRET_KEY is not set — Stripe rail disabled.");
    return null;
  }
  const StripeModule = await import("stripe");
  const Stripe = (
    StripeModule as unknown as { default: new (key: string) => StripeLikeForVerifier }
  ).default;
  stripeClient = new Stripe(STRIPE_SECRET_KEY);
  return stripeClient;
}

// ---------------------------------------------------------------------------
// Lazy on-chain signer — only initialized if WALLET_PRIVATE_KEY + RPC_URL
// are both set. The wallet broadcasts mint + recordReward txs after a
// successful verify. Returns null if not configured.
// ---------------------------------------------------------------------------
interface SimpleWalletClient {
  sendTransaction(tx: {
    to: `0x${string}`;
    data: `0x${string}`;
    value: bigint;
  }): Promise<`0x${string}`>;
  waitForReceipt(hash: `0x${string}`): Promise<{
    logs: Array<{ topics: readonly `0x${string}`[]; data: `0x${string}` }>;
  }>;
}

let walletClient: SimpleWalletClient | null = null;
let walletInitFailed = false;
async function getWalletClient(): Promise<SimpleWalletClient | null> {
  if (walletInitFailed) return null;
  if (walletClient) return walletClient;
  if (!WALLET_PRIVATE_KEY || !RPC_URL) {
    return null;
  }
  try {
    const viem = await import("viem");
    const accounts = await import("viem/accounts");
    const account = accounts.privateKeyToAccount(WALLET_PRIVATE_KEY);
    // Using a generic chain stub — the example does not pin a viem/chains
    // import because the operator may target any chain. The transport's
    // RPC URL is what actually picks the chain.
    const transport = viem.http(RPC_URL);
    const publicClient = viem.createPublicClient({ transport });
    const chainId = await publicClient.getChainId();
    const chain = {
      id: chainId,
      name: SETTLEMENT_CHAIN_NAME,
      nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [RPC_URL] } },
    };
    const wc = viem.createWalletClient({ account, chain, transport });
    walletClient = {
      async sendTransaction(tx) {
        return wc.sendTransaction({ to: tx.to, data: tx.data, value: tx.value });
      },
      async waitForReceipt(hash) {
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        return { logs: receipt.logs };
      },
    };
    return walletClient;
  } catch (err) {
    console.warn("Failed to initialize wallet client — on-chain mint/reward disabled:", err);
    walletInitFailed = true;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Lazy pinner — Pinata first, then Web3.Storage, otherwise null. Logged on
// startup to make the chosen path obvious to operators.
// ---------------------------------------------------------------------------
interface SimplePinner {
  pinJson(
    obj: unknown,
    opts?: { name?: string; metadata?: Record<string, string> },
  ): Promise<{ cid: string; size: number }>;
  pinBytes(
    content: Uint8Array,
    opts?: { name?: string; metadata?: Record<string, string> },
  ): Promise<{ cid: string; size: number }>;
  unpin(cid: string): Promise<void>;
  isPinned(cid: string): Promise<boolean>;
}

let pinnerInstance: SimplePinner | null = null;
let pinnerInitFailed = false;
async function getPinner(): Promise<SimplePinner | null> {
  if (pinnerInitFailed) return null;
  if (pinnerInstance) return pinnerInstance;
  if (!PINATA_JWT && !(WEB3_STORAGE_TOKEN && WEB3_STORAGE_SPACE_DID)) {
    return null;
  }
  try {
    const ipfs = await import("@atlasprotocol/ipfs");
    if (PINATA_JWT) {
      pinnerInstance = new ipfs.PinataPinner({ jwt: PINATA_JWT });
    } else if (WEB3_STORAGE_TOKEN && WEB3_STORAGE_SPACE_DID) {
      pinnerInstance = new ipfs.Web3StoragePinner({
        apiToken: WEB3_STORAGE_TOKEN,
        spaceDID: WEB3_STORAGE_SPACE_DID,
      });
    }
    return pinnerInstance;
  } catch (err) {
    console.warn("Failed to initialize pinner — receipt pinning disabled:", err);
    pinnerInitFailed = true;
    return null;
  }
}

const app = new Hono();

// ---------------------------------------------------------------------------
// Adoption polish: idempotency + rate limiting on the purchase endpoint.
// ---------------------------------------------------------------------------
//
// The token bucket caps each agent at 60 requests with a steady refill of 1/s
// (matching the manifest's advertised `purchase_per_minute: 60`). Identifier
// resolution defaults to MPP credential `payer_id` -> recipient -> client IP.
const purchaseRateLimiter = new InMemoryRateLimiter({
  capacity: 60,
  refillRatePerSecond: 1,
});
const purchaseRateLimit = createRateLimitMiddleware({ limiter: purchaseRateLimiter });

// 24h TTL matches the protocol's idempotency window (01-PROTOCOL-SPEC.md §3.6).
const purchaseIdempotency = new InMemoryIdempotencyStore();
const PURCHASE_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

// ---------------------------------------------------------------------------
// 1. /.well-known/atlas.json
// ---------------------------------------------------------------------------
app.get("/.well-known/atlas.json", (c) => {
  const manifest = generateAtlasManifest({
    name: PLATFORM_NAME,
    url: PLATFORM_URL,
    ...(PLATFORM_DID !== undefined && { did: PLATFORM_DID }),
    eventsUrl: `${PLATFORM_URL}/atlas/v1/events`,
    searchUrl: `${PLATFORM_URL}/atlas/v1/search`,
    purchaseUrl: `${PLATFORM_URL}/atlas/v1/events`,
    supportedChains: defaultSupportedChainIdentifiers(),
    acceptStripe: ACCEPT_STRIPE,
  });
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Cache-Control", "public, max-age=3600");
  return c.json(manifest);
});

// ---------------------------------------------------------------------------
// 2. GET /atlas/v1/search
// ---------------------------------------------------------------------------
app.get("/atlas/v1/search", (c) => {
  const url = new URL(c.req.url);
  const q = url.searchParams.get("q")?.toLowerCase() ?? null;
  const city = url.searchParams.get("city")?.toLowerCase() ?? null;
  const dateFrom = url.searchParams.get("date_from");
  const dateTo = url.searchParams.get("date_to");

  const matches = DEMO_EVENTS.filter((event) => {
    if (city && event.city.toLowerCase() !== city) return false;
    if (dateFrom && event.start < dateFrom) return false;
    if (dateTo && event.start > dateTo) return false;
    if (q) {
      const haystack = [event.title, event.description, ...event.categories]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  return c.json({
    atlas_version: "1.0",
    total: matches.length,
    page: 1,
    per_page: matches.length,
    results: matches.map((e) => toAtlasEvent(e)),
  });
});

// ---------------------------------------------------------------------------
// 3. GET /atlas/v1/events/:id
// ---------------------------------------------------------------------------
app.get("/atlas/v1/events/:id", (c) => {
  const id = c.req.param("id");
  const event = findEvent(id);
  if (!event) return c.json({ error: "event_not_found", message: `Unknown event ${id}` }, 404);
  return c.json(toAtlasEvent(event));
});

// ---------------------------------------------------------------------------
// 4. POST /atlas/v1/events/:id/purchase
// ---------------------------------------------------------------------------
//
// Rate limit and idempotency wrap this endpoint. Order: rate-limit middleware
// runs before the handler so abusive callers are rejected without ever
// reserving a hold. Inside the handler, `withIdempotency` caches the final
// response payload by `Idempotency-Key` (or a deterministic fallback derived
// from event + ticket + payer) so a retried request returns the same bytes.
app.post("/atlas/v1/events/:id/purchase", purchaseRateLimit, async (c) => {
  const id = c.req.param("id");
  const event = findEvent(id);
  if (!event) return c.json({ error: "event_not_found" }, 404);

  const body: unknown = await c.req.json().catch(() => ({}));
  const bodyObj = (typeof body === "object" && body !== null ? body : {}) as Record<
    string,
    unknown
  >;
  const ticketTypeId =
    typeof bodyObj["ticket_type_id"] === "string" ? bodyObj["ticket_type_id"] : undefined;
  const quantity = typeof bodyObj["quantity"] === "number" ? bodyObj["quantity"] : 1;
  if (!ticketTypeId)
    return c.json({ error: "invalid_request", details: { ticket_type_id: "required" } }, 422);
  const ticket = findTicketType(event, ticketTypeId);
  if (!ticket) return c.json({ error: "ticket_type_not_found" }, 404);
  if (ticket.available < quantity)
    return c.json({ error: "sold_out", available: ticket.available }, 409);

  const idempotencyKey = c.req.header("Idempotency-Key");
  const amountUsdMicros = ticket.priceUsdMicros * BigInt(quantity);

  // Resolve the idempotency cache key: prefer the agent-supplied header, fall
  // back to a deterministic fingerprint of the request shape so naive retries
  // still hit the cache.
  const auth = c.req.header("Authorization");
  const payerHint = auth?.startsWith("MPP ") ? auth.slice(4, 32) : "anon";
  const idempotencyCacheKey = `purchase:${event.id}:${ticket.id}:${quantity}:${
    idempotencyKey ?? payerHint
  }`;

  const snapshot = await withIdempotency<ResponseSnapshot>(
    purchaseIdempotency,
    idempotencyCacheKey,
    PURCHASE_IDEMPOTENCY_TTL_SECONDS,
    async () => {
      const response = await handlePurchase(c, {
        event,
        ticket,
        quantity,
        amountUsdMicros,
        idempotencyKey,
      });
      return snapshotResponse(response);
    },
  );
  return rebuildResponse(snapshot);
});

interface PurchaseHandlerInput {
  event: DemoEvent;
  ticket: DemoEvent["ticketTypes"][number];
  quantity: number;
  amountUsdMicros: bigint;
  idempotencyKey?: string | undefined;
}

interface ResponseSnapshot {
  status: number;
  headers: [string, string][];
  body: string;
}

async function snapshotResponse(response: Response): Promise<ResponseSnapshot> {
  const body = await response.text();
  const headers: [string, string][] = [];
  response.headers.forEach((value, key) => headers.push([key, value]));
  return { status: response.status, headers, body };
}

function rebuildResponse(snapshot: ResponseSnapshot): Response {
  return new Response(snapshot.body, {
    status: snapshot.status,
    headers: snapshot.headers,
  });
}

async function handlePurchase(c: Context, input: PurchaseHandlerInput): Promise<Response> {
  const { event, ticket, quantity, amountUsdMicros, idempotencyKey } = input;
  const hold = lookupOrCreateHold({
    eventId: event.id,
    ticketTypeId: ticket.id,
    quantity,
    amountUsdMicros,
    ...(idempotencyKey !== undefined && { idempotencyKey }),
  });

  // ---------------------------------------------------------------------
  // Step A — buyer presents a credential? Verify it and confirm purchase.
  // ---------------------------------------------------------------------
  const auth = c.req.header("Authorization");
  if (auth?.startsWith("MPP ")) {
    const credentialWire = auth.slice("MPP ".length);
    let payload: MppPayload;
    try {
      payload = decode(deserialize(credentialWire));
    } catch (err) {
      return c.json({ error: "credential_invalid", message: errMsg(err) }, 422);
    }

    if (payload.paymentId !== hold.challengeId) {
      return c.json(
        { error: "credential_mismatch", message: "credential paymentId does not match this hold" },
        422,
      );
    }

    const offerType = inferProofType(payload.rail);
    if (offerType === null) {
      return c.json({ error: "rail_unsupported", rail: payload.rail }, 422);
    }

    if (offerType === "stripe_spt") {
      const piId = payload.metadata?.["payment_intent_id"];
      if (typeof piId !== "string") {
        return c.json({ error: "missing_payment_intent_id" }, 422);
      }
      const stripe = await getStripeClient();
      if (!stripe) return c.json({ error: "stripe_not_configured" }, 503);
      const verification = await verifyStripePayment(stripe, piId, hold.amountUsdMicros);
      if (!verification.valid) {
        return c.json({ error: "credential_rejected", reason: verification.error }, 402);
      }
      markSettled(hold.holdId, "stripe-mpp", { paymentIntentId: piId });
    } else if (offerType === "solana_usdc") {
      return c.json({ error: "rail_unsupported", rail: payload.rail }, 422);
    } else {
      const txHash = payload.metadata?.["tx_hash"];
      if (typeof txHash !== "string") {
        return c.json({ error: "missing_tx_hash" }, 422);
      }
      const verification = await verifyPayment(
        { paymentMethods: [{ type: offerType, receiverAddress: ORGANIZER_ADDRESS }] },
        { type: offerType, transaction_hash: txHash },
        {
          challenge_id: hold.challengeId,
          expected_amount_usd: Number(hold.amountUsdMicros) / 1_000_000,
          recipient_address: ORGANIZER_ADDRESS,
        },
      );
      if (!verification.valid) {
        return c.json({ error: "credential_rejected", reason: verification.error }, 402);
      }
      markSettled(hold.holdId, "x402", { txHash });
    }

    const settled = getHold(hold.holdId);

    // -----------------------------------------------------------------
    // After verification: mint AtlasTicket NFT, record organizer reward,
    // and pin the W3C VC receipt. Each step is env-gated and degrades
    // gracefully when credentials are missing.
    // -----------------------------------------------------------------
    const paymentId = paymentIdFromChallenge(hold.challengeId);
    const attendee = inferAttendee(payload, settled);
    const integration = await runPostSettlementIntegrations({
      paymentId,
      eventId: event.id,
      attendee,
      hold,
      offerType,
      txHash: settled?.settledTxHash,
      paymentIntentId: settled?.settledPaymentIntentId,
    });

    return c.json({
      "atlas:status": "confirmed",
      "atlas:holdId": hold.holdId,
      "atlas:settlement": {
        rail: settled?.settledRail,
        tx_hash: settled?.settledTxHash,
        payment_intent_id: settled?.settledPaymentIntentId,
        settled_at: settled?.settledAt,
        amount_usd_micros: hold.amountUsdMicros.toString(),
      },
      "atlas:ticket": integration.ticket,
      "atlas:reward": integration.reward,
      "atlas:receipt": integration.receipt,
      "atlas:cid": integration.cid,
    });
  }

  // ---------------------------------------------------------------------
  // Step B — no credential yet. Issue a 402 with the MPP challenge.
  // ---------------------------------------------------------------------
  const stripeAvailable = ACCEPT_STRIPE && Boolean(STRIPE_SECRET_KEY);
  const challenge = generateMppChallenge({
    eventId: event.id,
    holdId: hold.holdId,
    challengeId: hold.challengeId,
    ticketTypeId: ticket.id,
    quantity,
    amountUsdcMicros: hold.amountUsdMicros,
    organizerAddress: ORGANIZER_ADDRESS,
    acceptedChains: ACCEPTED_CHAINS,
    acceptStripe: stripeAvailable,
    expiresAt: hold.expiresAt,
    realm: new URL(PLATFORM_URL).host,
  });

  c.header("WWW-Authenticate", challenge.headerValue);
  c.header("Content-Type", "application/json");
  c.status(402);
  return c.body(
    JSON.stringify({
      challenge: serializeFromHeader(challenge.headerValue),
      ...challenge.payload,
    }),
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function toAtlasEvent(event: DemoEvent) {
  return {
    "@context": ["https://schema.org", "https://atlas.events/v1"],
    "@type": "Event",
    "atlas:id": event.id,
    name: event.title,
    startDate: event.start,
    endDate: event.end,
    location: { "@type": "Place", address: event.location },
    description: event.description,
    "atlas:availability": event.ticketTypes.some((t) => t.available > 0) ? "available" : "sold_out",
    "atlas:ticketTypes": event.ticketTypes.map((t) => ({
      ticket_type_id: t.id,
      name: t.title,
      description: t.description,
      price: { amount: (Number(t.priceUsdMicros) / 1_000_000).toFixed(2), currency: "USD" },
      availability: {
        status: t.available > 0 ? "available" : "sold_out",
        remaining: t.available,
        max_per_order: 4,
      },
    })),
    "atlas:settlement": { chains: defaultSupportedChainIdentifiers(), token: "USDC" },
    "atlas:organizer_id": event.organizer_id,
    "atlas:categories": event.categories,
  };
}

function inferProofType(rail: string): AtlasPaymentMethodType | null {
  switch (rail) {
    case "stripe-spt":
      return "stripe_spt";
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
    default:
      return null;
  }
}

/** Pull the base64url challenge wire out of the WWW-Authenticate header value. */
function serializeFromHeader(header: string): string {
  const match = /challenge="([^"]+)"/.exec(header);
  return match?.[1] ?? "";
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Post-settlement integration: mint AtlasTicket NFT, record organizer
// reward, generate + pin the W3C VC receipt. Each step is env-gated and
// logs a warning when its credentials are missing rather than failing.
// ---------------------------------------------------------------------------

interface PostSettlementInputs {
  paymentId: `0x${string}`;
  eventId: string;
  attendee: `0x${string}`;
  hold: DemoHold;
  offerType: AtlasPaymentMethodType;
  txHash: string | undefined;
  paymentIntentId: string | undefined;
}

interface PostSettlementOutput {
  ticket: { tokenId?: string; txHash?: string; skipped?: string } | null;
  reward: { amount?: string; recipient?: string; txHash?: string; skipped?: string } | null;
  receipt: unknown;
  cid: string | null;
}

async function runPostSettlementIntegrations(
  input: PostSettlementInputs,
): Promise<PostSettlementOutput> {
  const ticket = await tryMintTicket(input);
  const reward = await tryRecordReward(input);
  const { receipt, cid } = await tryGenerateReceipt(input);
  return { ticket, reward, receipt, cid };
}

async function tryMintTicket(input: PostSettlementInputs): Promise<PostSettlementOutput["ticket"]> {
  if (!ATLAS_TICKET_ADDRESS) {
    return {
      skipped:
        "ATLAS_TICKET_ADDRESS env var not set — set it to the AtlasTicket proxy on your settlement chain.",
    };
  }
  const wallet = await getWalletClient();
  if (!wallet) {
    return {
      skipped:
        "WALLET_PRIVATE_KEY + RPC_URL env vars not set — cannot broadcast mint. Set both to enable.",
    };
  }
  try {
    const tx = buildMintTicketTx({
      contract: ATLAS_TICKET_ADDRESS,
      to: input.attendee,
      eventId: BigInt(stableHashToBigInt(input.eventId)),
      paymentId: input.paymentId,
      tokenURI: `ipfs://placeholder/${input.eventId}`,
    });
    const hash = await wallet.sendTransaction(tx);
    const receipt = await wallet.waitForReceipt(hash);
    let tokenId: string | undefined;
    for (const log of receipt.logs) {
      const decoded = parseTicketMintedEvent(log);
      if (decoded) {
        tokenId = decoded.tokenId.toString();
        break;
      }
    }
    return tokenId !== undefined ? { tokenId, txHash: hash } : { txHash: hash };
  } catch (err) {
    console.warn("mint ticket failed:", err);
    return { skipped: `mint failed: ${errMsg(err)}` };
  }
}

async function tryRecordReward(
  input: PostSettlementInputs,
): Promise<PostSettlementOutput["reward"]> {
  if (!REWARD_LEDGER_ADDRESS) {
    return {
      skipped:
        "REWARD_LEDGER_ADDRESS env var not set — set it to the RewardLedger proxy on your settlement chain.",
    };
  }
  const wallet = await getWalletClient();
  if (!wallet) {
    return {
      skipped: "WALLET_PRIVATE_KEY + RPC_URL not set — cannot broadcast recordReward.",
    };
  }
  // 2% organizer reward — matches the protocol's default organizer share.
  // Production deployments would derive this from the protocol fee policy.
  const rewardAmount = (input.hold.amountUsdMicros * PROTOCOL_FEE_BPS) / 10_000n;
  try {
    const tx = buildRecordRewardTx({
      contract: REWARD_LEDGER_ADDRESS,
      recipient: ORGANIZER_ADDRESS,
      kind: RewardKind.Organizer,
      amount: rewardAmount,
      paymentId: input.paymentId,
    });
    const hash = await wallet.sendTransaction(tx);
    const receipt = await wallet.waitForReceipt(hash);
    for (const log of receipt.logs) {
      const decoded = parseRewardRecordedEvent(log);
      if (decoded) {
        return {
          amount: decoded.amount.toString(),
          recipient: decoded.recipient,
          txHash: hash,
        };
      }
    }
    return { amount: rewardAmount.toString(), recipient: ORGANIZER_ADDRESS, txHash: hash };
  } catch (err) {
    console.warn("recordReward failed:", err);
    return { skipped: `recordReward failed: ${errMsg(err)}` };
  }
}

async function tryGenerateReceipt(
  input: PostSettlementInputs,
): Promise<{ receipt: unknown; cid: string | null }> {
  const pinner = await getPinner();
  if (!pinner) {
    console.warn(
      "Receipt pinning disabled — set PINATA_JWT or (WEB3_STORAGE_TOKEN + WEB3_STORAGE_SPACE_DID) to enable.",
    );
  }
  const isStripe = input.offerType === "stripe_spt";
  try {
    const result = await generateReceipt(
      isStripe
        ? {
            holdId: input.hold.holdId,
            eventId: input.eventId,
            attendee: input.attendee,
            organizerAddress: PLATFORM_DID ?? ORGANIZER_ADDRESS,
            paymentMethod: "stripe_spt",
            paymentIntentId: input.paymentIntentId ?? "pi_unknown",
            amount: (Number(input.hold.amountUsdMicros) / 1_000_000).toFixed(2),
            currency: "USD",
            ...(pinner ? { pinner } : {}),
          }
        : {
            holdId: input.hold.holdId,
            eventId: input.eventId,
            attendee: input.attendee,
            organizerAddress: PLATFORM_DID ?? ORGANIZER_ADDRESS,
            paymentMethod: "x402",
            txHash: input.txHash ?? "0x",
            settlementChain: SETTLEMENT_CHAIN_NAME,
            amount: (Number(input.hold.amountUsdMicros) / 1_000_000).toFixed(6),
            currency: "USDC",
            ...(pinner ? { pinner } : {}),
          },
    );
    return { receipt: result.receipt, cid: result.cid ?? null };
  } catch (err) {
    console.warn("generateReceipt failed:", err);
    return { receipt: null, cid: null };
  }
}

/** Stable-ish bigint from an event id string — keeps the demo deterministic. */
function stableHashToBigInt(s: string): string {
  let h = 0n;
  for (const ch of s) {
    h = (h * 131n + BigInt(ch.charCodeAt(0))) % 2n ** 64n;
  }
  return h.toString();
}

/** Derive a 32-byte paymentId deterministically from the challenge id. */
function paymentIdFromChallenge(challengeId: string): `0x${string}` {
  return keccak256(toHex(challengeId));
}

/**
 * Best-effort attendee resolution. Real implementations should pull this
 * from the agent's authenticated identity. The demo falls back to the
 * MPP envelope's organizer field, which is at least a real address.
 */
function inferAttendee(payload: MppPayload, _settled: DemoHold | undefined): `0x${string}` {
  const fromMeta = payload.metadata?.["attendee"];
  if (typeof fromMeta === "string" && /^0x[a-fA-F0-9]{40}$/.test(fromMeta)) {
    return fromMeta as `0x${string}`;
  }
  if (payload.organizer && /^0x[a-fA-F0-9]{40}$/.test(payload.organizer)) {
    return payload.organizer as `0x${string}`;
  }
  return ORGANIZER_ADDRESS;
}

const server = serve({ fetch: app.fetch, port: PORT });
console.log(`atlas dual-protocol-server listening on http://localhost:${PORT}`);
console.log(`  manifest:  http://localhost:${PORT}/.well-known/atlas.json`);
console.log(`  search:    http://localhost:${PORT}/atlas/v1/search?city=Brooklyn`);
console.log(`  event:     http://localhost:${PORT}/atlas/v1/events/${DEMO_EVENTS[0]!.id}`);
console.log(
  `  purchase:  POST http://localhost:${PORT}/atlas/v1/events/${DEMO_EVENTS[0]!.id}/purchase`,
);
console.log(`  accepted chains: ${ACCEPTED_CHAINS.join(", ")}`);
console.log(`  accept Stripe: ${ACCEPT_STRIPE ? "yes" : "no"}`);
console.log(
  `  mint AtlasTicket: ${ATLAS_TICKET_ADDRESS && WALLET_PRIVATE_KEY && RPC_URL ? "yes" : "no (set ATLAS_TICKET_ADDRESS + WALLET_PRIVATE_KEY + RPC_URL)"}`,
);
console.log(
  `  record reward:    ${REWARD_LEDGER_ADDRESS && WALLET_PRIVATE_KEY && RPC_URL ? "yes" : "no (set REWARD_LEDGER_ADDRESS + WALLET_PRIVATE_KEY + RPC_URL)"}`,
);
console.log(
  `  pin receipt:      ${PINATA_JWT ? "yes (Pinata)" : WEB3_STORAGE_TOKEN && WEB3_STORAGE_SPACE_DID ? "yes (Web3.Storage)" : "no (set PINATA_JWT or WEB3_STORAGE_TOKEN + WEB3_STORAGE_SPACE_DID)"}`,
);

process.on("SIGINT", () => {
  console.log("shutting down");
  server.close();
  process.exit(0);
});
