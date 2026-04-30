import { createPublicClient, http } from "viem";
import { arbitrum, base, optimism, polygon } from "viem/chains";
import type { Chain, PublicClient, Transport } from "viem";

import { resolveLogger, type ServerSdkConfig, type EvmUsdcMethodConfig } from "./config.js";
import type {
  AtlasPaymentMethodType,
  AtlasPaymentProof,
  AtlasPaymentVerifyParams,
  AtlasPaymentVerifyResult,
} from "./types/index.js";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

interface ChainSpec {
  chain: Chain;
  defaultRpcUrl: string;
  usdcAddress: string;
  defaultConfirmations: number;
}

// Tempo (a Stripe L1) is not in viem/chains. Define a minimal spec for it.
const tempoChain = {
  id: 4217,
  name: "Tempo",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.tempo.xyz"] } },
} as const satisfies Chain;

const CHAIN_SPECS: Record<
  Exclude<AtlasPaymentMethodType, "stripe_spt" | "solana_usdc">,
  ChainSpec
> = {
  tempo_usdc: {
    chain: tempoChain,
    defaultRpcUrl: "https://rpc.tempo.xyz",
    usdcAddress: "0x20c000000000000000000000b9537d11c60e8b50",
    defaultConfirmations: 1,
  },
  base_usdc: {
    chain: base,
    defaultRpcUrl: "https://mainnet.base.org",
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    defaultConfirmations: 12,
  },
  arbitrum_usdc: {
    chain: arbitrum,
    defaultRpcUrl: "https://arb1.arbitrum.io/rpc",
    usdcAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    defaultConfirmations: 64,
  },
  polygon_usdc: {
    chain: polygon,
    defaultRpcUrl: "https://polygon-rpc.com",
    usdcAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    defaultConfirmations: 128,
  },
  optimism_usdc: {
    chain: optimism,
    defaultRpcUrl: "https://mainnet.optimism.io",
    usdcAddress: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    defaultConfirmations: 10,
  },
  zksync_usdc: {
    // viem renamed zkSync to zksync at v2. We dynamically create a minimal
    // chain spec to avoid a hard dependency on its exact export name.
    chain: {
      id: 324,
      name: "zkSync",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: ["https://mainnet.era.zksync.io"] } },
    } satisfies Chain,
    defaultRpcUrl: "https://mainnet.era.zksync.io",
    usdcAddress: "0x3355df6D4c9C3035724Fd0e3914dE96A5a83aaf4",
    defaultConfirmations: 1,
  },
};

export const SUPPORTED_PAYMENT_METHODS: readonly AtlasPaymentMethodType[] = [
  "tempo_usdc",
  "base_usdc",
  "arbitrum_usdc",
  "polygon_usdc",
  "optimism_usdc",
  "zksync_usdc",
  "stripe_spt",
];

/**
 * Optional injection point used by tests. Pass a custom viem transport (e.g.
 * a mock transport) and the verifier will use it instead of an HTTP RPC.
 */
export interface VerifyPaymentDeps {
  /** Override the viem PublicClient for an EVM chain. */
  evmClient?: (method: AtlasPaymentMethodType) => PublicClient<Transport, Chain> | undefined;
  /** Override the Stripe verifier (used in tests). */
  verifyStripe?: (intentId: string, expectedAmountUsd: number) => Promise<AtlasPaymentVerifyResult>;
  /**
   * Replay-protection callback. Return `true` if the proof has been seen
   * before. Defaults to returning `false` (no replay protection in-package
   * — consumers wire this to their database).
   */
  isReplay?: (proof: AtlasPaymentProof) => Promise<boolean>;
}

/**
 * Verify an ATLAS payment proof against an expected amount. Multi-chain:
 * EVM USDC chains use viem; Stripe SPT uses an injected verifier (the SDK
 * does not bundle the Stripe SDK to keep the dependency tree minimal).
 *
 * Replay protection is opt-in via `deps.isReplay` — host applications should
 * wire this to their own payment store.
 */
export async function verifyPayment(
  config: Pick<ServerSdkConfig, "paymentMethods" | "logger">,
  proof: AtlasPaymentProof,
  params: AtlasPaymentVerifyParams,
  deps: VerifyPaymentDeps = {},
): Promise<AtlasPaymentVerifyResult> {
  const log = resolveLogger(config);

  try {
    if (deps.isReplay) {
      const replay = await deps.isReplay(proof);
      if (replay) {
        return { valid: false, error: "Payment proof already used (replay rejected)" };
      }
    }

    const method = config.paymentMethods.find((m) => m.type === proof.type);

    switch (proof.type) {
      case "stripe_spt": {
        if (!proof.payment_intent_id) {
          return { valid: false, error: "Missing payment_intent_id" };
        }
        if (!deps.verifyStripe) {
          return {
            valid: false,
            error:
              "Stripe SPT verification not configured. Pass deps.verifyStripe to verifyPayment().",
          };
        }

        return deps.verifyStripe(proof.payment_intent_id, params.expected_amount_usd);
      }

      case "tempo_usdc":
      case "base_usdc":
      case "arbitrum_usdc":
      case "polygon_usdc":
      case "optimism_usdc":
      case "zksync_usdc": {
        if (!proof.transaction_hash) {
          return { valid: false, error: "Missing transaction_hash" };
        }

        const evmConfig =
          method?.type !== "stripe_spt" ? (method as EvmUsdcMethodConfig | undefined) : undefined;
        const recipient = evmConfig?.receiverAddress ?? params.recipient_address;
        if (!recipient) {
          return {
            valid: false,
            error: `No recipient address configured for ${proof.type}`,
          };
        }

        const spec = CHAIN_SPECS[proof.type];
        const client =
          deps.evmClient?.(proof.type) ??
          (createPublicClient({
            chain: spec.chain,
            transport: http(evmConfig?.rpcUrl ?? spec.defaultRpcUrl),
          }) as PublicClient<Transport, Chain>);

        return verifyEvmUsdcTransfer(client, {
          txHash: proof.transaction_hash,
          expectedRecipient: recipient,
          expectedAmountUsd: params.expected_amount_usd,
          usdcContract: evmConfig?.usdcContractAddress ?? spec.usdcAddress,
          requiredConfirmations: evmConfig?.requiredConfirmations ?? spec.defaultConfirmations,
        });
      }

      case "solana_usdc": {
        return {
          valid: false,
          error: "Solana payment verification is not bundled in this package",
        };
      }

      default: {
        return { valid: false, error: `Unsupported payment type: ${String(proof.type)}` };
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Payment verification failed";
    log.error("atlas payment verification failed", { err, proof });

    return { valid: false, error: message };
  }
}

interface EvmTransferArgs {
  txHash: string;
  expectedRecipient: string;
  expectedAmountUsd: number;
  usdcContract: string;
  requiredConfirmations: number;
}

async function verifyEvmUsdcTransfer(
  client: PublicClient<Transport, Chain>,
  args: EvmTransferArgs,
): Promise<AtlasPaymentVerifyResult> {
  const receipt = await client.getTransactionReceipt({
    hash: args.txHash as `0x${string}`,
  });
  if (!receipt) return { valid: false, error: "Transaction not found on-chain" };
  if (receipt.status !== "success") {
    return { valid: false, error: "Transaction reverted on-chain" };
  }

  const currentBlock = await client.getBlockNumber();
  const confirmations = Number(currentBlock - receipt.blockNumber);
  if (confirmations < args.requiredConfirmations) {
    return {
      valid: false,
      error: `Insufficient confirmations: ${confirmations}/${args.requiredConfirmations}`,
    };
  }

  const transferLogs = receipt.logs.filter(
    (log) =>
      log.address.toLowerCase() === args.usdcContract.toLowerCase() &&
      log.topics[0] === TRANSFER_TOPIC,
  );
  if (transferLogs.length === 0) {
    return { valid: false, error: "No USDC Transfer event found in transaction" };
  }

  const recipientLower = args.expectedRecipient.toLowerCase();
  const expectedMicroUnits = BigInt(Math.round(args.expectedAmountUsd * 1_000_000));

  for (const log of transferLogs) {
    const topic2 = log.topics[2];
    if (topic2 === undefined) continue;
    const to = "0x" + topic2.slice(26).toLowerCase();
    if (to !== recipientLower) continue;

    const transferredAmount = BigInt(log.data);
    const diff =
      transferredAmount > expectedMicroUnits
        ? transferredAmount - expectedMicroUnits
        : expectedMicroUnits - transferredAmount;
    // 0.1% proportional tolerance, with a 1000-microunit floor.
    const tolerance = (expectedMicroUnits * 10n) / 10000n;
    const minTolerance = 1000n;
    const allowed = tolerance > minTolerance ? tolerance : minTolerance;
    if (diff <= allowed) {
      return {
        valid: true,
        verified_amount_usd: Number(transferredAmount) / 1_000_000,
      };
    }
  }

  return {
    valid: false,
    error: "No matching USDC transfer to expected recipient with expected amount",
  };
}
