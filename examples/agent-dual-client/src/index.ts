#!/usr/bin/env node
/**
 * Reference dual-protocol agent client.
 *
 * Calls the dual-protocol-server's purchase endpoint and pays the 402 over
 * either rail:
 *   - x402 (on-chain USDC) when AGENT_PRIVATE_KEY is set
 *   - stripe-mpp (Stripe SPT) when STRIPE_SECRET_KEY is set
 *   - both: tries x402 first; falls back to stripe-mpp if x402 fails
 *
 * If neither rail is configured, prints a helpful "configure one of …" message
 * with no on-chain side effects.
 */

import {
  fetchWithPayment,
  MppPaymentRefusedError as X402PaymentRefusedError,
} from "@atlasprotocol/mpp/x402";
import {
  fetchWithPaymentSpt,
  MppPaymentRefusedError as SptPaymentRefusedError,
} from "@atlasprotocol/mpp/stripe-mpp";

interface CliConfig {
  url: string;
  body: Record<string, unknown>;
  // x402 (optional)
  privateKey?: `0x${string}`;
  allowedReceivers?: `0x${string}`[];
  allowedStablecoins?: `0x${string}`[];
  maxAmountUsdcMicro?: bigint;
  rpcUrl?: string;
  chainId?: number;
  // stripe-mpp (optional)
  stripeSecretKey?: string;
  paymentMethodId?: string;
  allowedStripeReceivers?: string[];
  maxAmountUsdCents?: number;
}

function buildConfigFromEnv(env: NodeJS.ProcessEnv = process.env): CliConfig {
  const url =
    env["TARGET_URL"] ?? "http://localhost:4001/atlas/v1/events/evt_jazz_brooklyn_001/purchase";

  const ticketTypeId = env["TICKET_TYPE_ID"] ?? "tt_ga_001";
  const quantity = Number(env["QUANTITY"] ?? "1");
  const body: Record<string, unknown> = { ticket_type_id: ticketTypeId, quantity };

  const cfg: CliConfig = { url, body };

  if (env["AGENT_PRIVATE_KEY"]) {
    cfg.privateKey = env["AGENT_PRIVATE_KEY"] as `0x${string}`;
    cfg.allowedReceivers = (env["ALLOWED_RECEIVERS"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean) as `0x${string}`[];
    cfg.allowedStablecoins = (env["ALLOWED_STABLECOINS"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean) as `0x${string}`[];
    cfg.maxAmountUsdcMicro = BigInt(env["MAX_AMOUNT_USDC_MICRO"] ?? "100000000");
    if (env["RPC_URL"]) cfg.rpcUrl = env["RPC_URL"];
    if (env["CHAIN_ID"]) cfg.chainId = Number(env["CHAIN_ID"]);
  }

  if (env["STRIPE_SECRET_KEY"]) {
    cfg.stripeSecretKey = env["STRIPE_SECRET_KEY"];
    cfg.paymentMethodId = env["STRIPE_PAYMENT_METHOD_ID"] ?? "pm_card_visa";
    cfg.allowedStripeReceivers = (env["ALLOWED_STRIPE_RECEIVERS"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    cfg.maxAmountUsdCents = Number(env["MAX_AMOUNT_USD_CENTS"] ?? "10000");
  }

  return cfg;
}

async function tryX402(cfg: CliConfig): Promise<Response> {
  if (
    !cfg.privateKey ||
    !cfg.allowedReceivers ||
    !cfg.allowedStablecoins ||
    cfg.maxAmountUsdcMicro === undefined
  ) {
    throw new Error("x402 path not configured");
  }
  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(cfg.privateKey);

  // Pick a chain spec. Caller can override via CHAIN_ID; otherwise default to
  // Base Sepolia (the chain the agent-x402-client example uses too).
  const { baseSepolia, base, optimism, arbitrum } = await import("viem/chains");
  const chainById: Record<
    number,
    { id: number; name: string; rpcUrls: { default: { http: readonly string[] } } }
  > = {
    8453: base,
    84532: baseSepolia,
    10: optimism,
    42161: arbitrum,
  };
  const chain = cfg.chainId ? chainById[cfg.chainId] : baseSepolia;
  if (!chain) throw new Error(`Unsupported CHAIN_ID=${cfg.chainId}`);

  console.log(`[x402] agent: ${account.address}, chain: ${chain.name} (${chain.id})`);

  return await fetchWithPayment(
    cfg.url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": cryptoUUID() },
      body: JSON.stringify(cfg.body),
    },
    {
      account,
      chain,
      allowedReceivers: cfg.allowedReceivers,
      allowedStablecoins: cfg.allowedStablecoins,
      maxAmountUsdcMicro: cfg.maxAmountUsdcMicro,
      waitForConfirmations: 1,
      ...(cfg.rpcUrl !== undefined && { rpcUrl: cfg.rpcUrl }),
      onPayment: ({ txHash, amount }) =>
        console.log(`[x402] paid ${amount} micro-USDC, tx=${txHash}`),
    },
  );
}

async function tryStripeMpp(cfg: CliConfig): Promise<Response> {
  if (!cfg.stripeSecretKey || !cfg.allowedStripeReceivers || cfg.maxAmountUsdCents === undefined) {
    throw new Error("stripe-mpp path not configured");
  }
  const StripeModule = await import("stripe");
  type StripeCtor = new (key: string) => {
    paymentIntents: {
      create(args: {
        amount: number;
        currency: string;
        confirm: boolean;
        payment_method?: string;
        metadata: Record<string, string>;
      }): Promise<{ id: string; status: string }>;
    };
  };
  const Stripe = (StripeModule as unknown as { default: StripeCtor }).default;
  const stripe = new Stripe(cfg.stripeSecretKey);

  console.log(
    `[stripe-mpp] using payment_method=${cfg.paymentMethodId}, max=${cfg.maxAmountUsdCents}¢`,
  );

  return await fetchWithPaymentSpt(
    cfg.url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": cryptoUUID() },
      body: JSON.stringify(cfg.body),
    },
    {
      maxAmountUsdCents: cfg.maxAmountUsdCents,
      allowedReceivers: cfg.allowedStripeReceivers,
      getSpt: async ({ amount, currency, challenge_id }) => {
        const intent = await stripe.paymentIntents.create({
          amount,
          currency,
          confirm: true,
          ...(cfg.paymentMethodId && { payment_method: cfg.paymentMethodId }),
          metadata: { atlas_challenge: challenge_id },
        });
        if (intent.status !== "succeeded") {
          throw new Error(`Stripe intent did not succeed: ${intent.status}`);
        }
        return intent.id;
      },
      onPayment: ({ paymentIntentId, amountCents }) =>
        console.log(`[stripe-mpp] paid ${amountCents}¢, intent=${paymentIntentId}`),
    },
  );
}

async function main(): Promise<void> {
  const cfg = buildConfigFromEnv();

  console.log(`target: ${cfg.url}`);
  console.log(`body:   ${JSON.stringify(cfg.body)}`);

  const haveX402 = Boolean(cfg.privateKey);
  const haveStripe = Boolean(cfg.stripeSecretKey);

  if (!haveX402 && !haveStripe) {
    console.error(
      "configure one of: AGENT_PRIVATE_KEY (+ ALLOWED_RECEIVERS, ALLOWED_STABLECOINS, MAX_AMOUNT_USDC_MICRO) for x402, or STRIPE_SECRET_KEY (+ ALLOWED_STRIPE_RECEIVERS, MAX_AMOUNT_USD_CENTS) for stripe-mpp.",
    );
    process.exitCode = 2;
    return;
  }

  // Prefer x402 if configured; fall back to stripe-mpp.
  if (haveX402) {
    try {
      const response = await tryX402(cfg);
      console.log(`x402 status: ${response.status}`);
      console.log(`body:        ${await response.text()}`);
      if (response.status === 200) return;
      if (!haveStripe) {
        process.exitCode = response.status === 200 ? 0 : 1;
        return;
      }
      console.log("x402 did not return 200; trying stripe-mpp …");
    } catch (err) {
      if (err instanceof X402PaymentRefusedError) {
        console.warn(`x402 refused: ${err.reason}: ${err.message}`);
        if (!haveStripe) {
          process.exitCode = 2;
          return;
        }
        console.log("falling back to stripe-mpp …");
      } else {
        throw err;
      }
    }
  }

  if (haveStripe) {
    try {
      const response = await tryStripeMpp(cfg);
      console.log(`stripe-mpp status: ${response.status}`);
      console.log(`body:              ${await response.text()}`);
      if (response.status !== 200) process.exitCode = 1;
    } catch (err) {
      if (err instanceof SptPaymentRefusedError) {
        console.error(`stripe-mpp refused: ${err.reason}: ${err.message}`);
        process.exitCode = 2;
        return;
      }
      throw err;
    }
  }
}

function cryptoUUID(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

void main();
