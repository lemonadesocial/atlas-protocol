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
  createRateLimitMiddleware,
  defaultSupportedChainIdentifiers,
  generateAtlasManifest,
  generateMppChallenge,
  verifyPayment,
  verifyStripePayment,
  withIdempotency,
  type AtlasPaymentMethodType,
} from "@atlasprotocol/server-sdk";
import { Hono, type Context } from "hono";

import {
  DEMO_EVENTS,
  findEvent,
  findTicketType,
  getHold,
  lookupOrCreateHold,
  markSettled,
  type DemoEvent,
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

process.on("SIGINT", () => {
  console.log("shutting down");
  server.close();
  process.exit(0);
});
