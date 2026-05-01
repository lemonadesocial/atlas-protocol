import { createPublicClient, http } from "viem";
import type { Chain, PublicClient, Transport } from "viem";

import { CHAIN_SPECS, ERC20_TRANSFER_TOPIC, SUPPORTED_PAYMENT_METHODS } from "./chain-specs.js";
import { resolveLogger, type ServerSdkConfig } from "./config.js";
import { verifyStripePayment, type StripeLike } from "./stripe-verifier.js";
import type {
  AtlasPaymentMethodType,
  AtlasPaymentProof,
  AtlasPaymentVerifyParams,
  AtlasPaymentVerifyResult,
} from "./types/index.js";

export { SUPPORTED_PAYMENT_METHODS };

/**
 * Optional injection point used by tests. Pass a custom viem transport (e.g.
 * a mock transport) and the verifier will use it instead of an HTTP RPC.
 */
export interface VerifyPaymentDeps {
  /** Override the viem PublicClient for an EVM chain. */
  evmClient?: (method: AtlasPaymentMethodType) => PublicClient<Transport, Chain> | undefined;
  /**
   * Stripe SDK instance for native SPT verification. The verifier calls
   * `stripe.paymentIntents.retrieve(...)` and inspects status/currency/amount.
   * Take precedence over `verifyStripe` (callback) when both are supplied.
   */
  stripe?: StripeLike;
  /**
   * Legacy callback-style Stripe verifier. Kept for backward compatibility
   * with consumers built against the v0.1.x deps-injected pattern. New
   * consumers should pass `deps.stripe` to use the bundled verifier.
   */
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
 * EVM USDC chains use viem; Stripe SPT uses either the bundled native
 * verifier (`deps.stripe`) or a callback (`deps.verifyStripe`).
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

        if (deps.stripe) {
          const expectedMicros = BigInt(Math.round(params.expected_amount_usd * 1_000_000));
          return verifyStripePayment(deps.stripe, proof.payment_intent_id, expectedMicros);
        }

        if (deps.verifyStripe) {
          return deps.verifyStripe(proof.payment_intent_id, params.expected_amount_usd);
        }

        return {
          valid: false,
          error:
            "Stripe SPT verification not configured. Pass deps.stripe (preferred) or deps.verifyStripe to verifyPayment().",
        };
      }

      case "tempo_usdc":
      case "base_usdc":
      case "base_sepolia_usdc":
      case "arbitrum_usdc":
      case "polygon_usdc":
      case "optimism_usdc":
      case "zksync_usdc":
      case "worldchain_usdc":
      case "megaeth_usdm": {
        if (!proof.transaction_hash) {
          return { valid: false, error: "Missing transaction_hash" };
        }

        const evmConfig = method?.type !== "stripe_spt" ? method : undefined;
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
          createPublicClient({
            chain: spec.chain,
            transport: http(evmConfig?.rpcUrl ?? spec.defaultRpcUrl),
          });

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
      log.topics[0] === ERC20_TRANSFER_TOPIC,
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
