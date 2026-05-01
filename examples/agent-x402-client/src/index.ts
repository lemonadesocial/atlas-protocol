#!/usr/bin/env node
/**
 * CLI entry for the agent-x402-client example.
 *
 * Hits a paid endpoint (default: a local lemonade-backend running
 * /mpp/v1/ping-paid on port 4000), pays the 402 challenge with USDC on Base
 * Sepolia, and prints the eventual 200 body.
 *
 * Reads connection / wallet / safety config from the environment. The example
 * intentionally does NOT default a private key — running it with a wrong cap
 * or wrong allowlist would just lose money.
 */

import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

import { fetchWithPayment, MppPaymentRefusedError } from "@atlasprotocol/mpp/x402";

interface CliConfig {
  url: string;
  privateKey: `0x${string}`;
  allowedReceivers: `0x${string}`[];
  allowedStablecoins: `0x${string}`[];
  maxAmountUsdcMicro: bigint;
  rpcUrl: string | undefined;
}

function buildConfigFromEnv(env: NodeJS.ProcessEnv = process.env): CliConfig {
  const missing: string[] = [];

  const privateKey = env["AGENT_PRIVATE_KEY"];
  if (!privateKey) missing.push("AGENT_PRIVATE_KEY");

  const allowedReceivers = (env["ALLOWED_RECEIVERS"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowedReceivers.length === 0) missing.push("ALLOWED_RECEIVERS");

  const allowedStablecoins = (env["ALLOWED_STABLECOINS"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowedStablecoins.length === 0) missing.push("ALLOWED_STABLECOINS");

  const maxMicroRaw = env["MAX_AMOUNT_USDC_MICRO"];
  if (!maxMicroRaw) missing.push("MAX_AMOUNT_USDC_MICRO");

  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }

  return {
    url: env["TARGET_URL"] ?? "http://localhost:4000/mpp/v1/ping-paid",
    privateKey: privateKey as `0x${string}`,
    allowedReceivers: allowedReceivers as `0x${string}`[],
    allowedStablecoins: allowedStablecoins as `0x${string}`[],
    maxAmountUsdcMicro: BigInt(maxMicroRaw!),
    rpcUrl: env["RPC_URL"],
  };
}

async function main(): Promise<void> {
  const cfg = buildConfigFromEnv();
  const account = privateKeyToAccount(cfg.privateKey);

  console.log(`agent address: ${account.address}`);
  console.log(`target:        ${cfg.url}`);
  console.log(`cap:           ${cfg.maxAmountUsdcMicro.toString()} micro-USDC`);
  console.log(`receivers:     ${cfg.allowedReceivers.join(", ")}`);
  console.log(`stablecoins:   ${cfg.allowedStablecoins.join(", ")}`);

  const opts = {
    account,
    chain: baseSepolia,
    allowedReceivers: cfg.allowedReceivers,
    allowedStablecoins: cfg.allowedStablecoins,
    maxAmountUsdcMicro: cfg.maxAmountUsdcMicro,
    waitForConfirmations: 1,
    onPayment: ({ txHash, amount }: { txHash: `0x${string}`; amount: bigint }) => {
      console.log(`paid ${amount.toString()} micro-USDC, tx=${txHash}`);
    },
    ...(cfg.rpcUrl !== undefined && { rpcUrl: cfg.rpcUrl }),
  };

  try {
    const response = await fetchWithPayment(cfg.url, { method: "GET" }, opts);
    console.log(`status:        ${response.status}`);
    console.log(`body:          ${await response.text()}`);
    if (response.status !== 200) process.exitCode = 1;
  } catch (err) {
    if (err instanceof MppPaymentRefusedError) {
      console.error(`refused 402 challenge: ${err.reason}: ${err.message}`);
      process.exitCode = 2;
      return;
    }
    throw err;
  }
}

void main();
