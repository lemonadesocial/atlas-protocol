/**
 * @atlasprotocol/mpp/x402 — agent-side helper for HTTP 402 payment challenges.
 *
 * Counterpart to the server-side verifier pattern shown at
 * `lemonade-backend/src/app/services/atlas/mpp.ts`: the server issues a 402 with
 * an MPP envelope as the challenge body; this helper transparently pays the
 * challenge on-chain and retries the request with an
 * `Authorization: MPP <credential>` header.
 *
 * The helper is intentionally narrow:
 *   - one rail family (USDC ERC-20 on EVM chains, default Base Sepolia)
 *   - one retry — if the server returns 402 a second time, that response is
 *     surfaced verbatim (the helper does not loop)
 *   - no replay store, no JWS challenge signing
 *
 * Replay/JWS handling is Session 3+ work (see PR body for "Out of scope").
 */

import {
  decode,
  deserialize,
  encode,
  serialize,
  type MppEnvelope,
  type MppPayload,
} from "../index.js";

/**
 * ERC-20 `transfer(address,uint256)` ABI fragment — the only call we need to
 * settle a USDC challenge.
 */
const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/**
 * Minimal subset of viem types we depend on. Declared structurally so callers
 * can pass `viem.PrivateKeyAccount`, `viem.LocalAccount`, or any account-like
 * object that exposes `address` and an EIP-1193 `signTransaction` flow via the
 * walletClient. We avoid a hard `import type ... from "viem"` so this file
 * still compiles for consumers who never load the x402 subpath.
 */
export interface ViemAccountLike {
  address: `0x${string}`;
  type?: string;
}

export interface ViemChainLike {
  id: number;
  name: string;
  rpcUrls: { default: { http: readonly string[] } };
}

/**
 * Strategy for sending the on-chain payment. Defaults to a viem-backed
 * `walletClient.writeContract` against `chain` + `rpcUrl`. Tests inject a stub
 * to avoid pulling viem or hitting a live RPC.
 */
export type PaymentStrategy = (input: {
  account: ViemAccountLike;
  chain: ViemChainLike;
  rpcUrl: string | undefined;
  token: `0x${string}`;
  receiver: `0x${string}`;
  amountUsdcMicro: bigint;
  waitForConfirmations: number;
}) => Promise<`0x${string}`>;

/**
 * Options for `fetchWithPayment`.
 *
 * Safety-critical fields (`allowedReceivers`, `allowedStablecoins`,
 * `maxAmountUsdcMicro`) are required — without them the helper would be a
 * wallet-drain footgun.
 */
export interface FetchWithPaymentOptions {
  /** Wallet account that will sign the USDC transfer. */
  account: ViemAccountLike;
  /** Chain to settle on. Must match the rail in the challenge envelope. */
  chain: ViemChainLike;
  /** Optional RPC override; falls back to `chain.rpcUrls.default.http[0]`. */
  rpcUrl?: string;
  /** Receiver addresses the helper is willing to pay. Lower-cased compare. */
  allowedReceivers: readonly `0x${string}`[];
  /** USDC contract addresses the helper is willing to settle in. Lower-cased compare. */
  allowedStablecoins: readonly `0x${string}`[];
  /** Per-request hard cap, in 6-decimal USDC micro-units. */
  maxAmountUsdcMicro: bigint;
  /** Block confirmations to wait for after sending. Default 1. */
  waitForConfirmations?: number;
  /** Notification hook for instrumented agents (logging, metrics). */
  onPayment?: (info: { txHash: `0x${string}`; amount: bigint; receiver: `0x${string}` }) => void;
  /**
   * Override for the on-chain payment step. Tests inject a stub; production
   * callers omit this and pick up the default viem-backed strategy.
   */
  paymentStrategy?: PaymentStrategy;
}

/**
 * Reason a 402 was refused without paying. Surfaced as an instance member so
 * callers can branch on `err instanceof MppPaymentRefusedError` and inspect
 * `err.reason` without parsing the message.
 */
export type MppPaymentRefusedReason =
  | "challenge-missing"
  | "challenge-malformed"
  | "receiver-not-allowed"
  | "stablecoin-not-allowed"
  | "amount-exceeds-cap"
  | "amount-malformed";

/**
 * Thrown when a 402 challenge fails the safety checks in `FetchWithPaymentOptions`.
 * Distinguishable from on-chain / network errors so callers can decide whether
 * to alert ("the server asked us to pay an unknown party") vs retry ("RPC was
 * flaky").
 */
export class MppPaymentRefusedError extends Error {
  public readonly reason: MppPaymentRefusedReason;
  public readonly challenge: MppPayload | undefined;

  constructor(
    reason: MppPaymentRefusedReason,
    message: string,
    challenge: MppPayload | undefined = undefined,
  ) {
    super(message);
    this.name = "MppPaymentRefusedError";
    this.reason = reason;
    this.challenge = challenge;
  }
}

/**
 * Drop-in `fetch` that handles a single 402 → pay → retry round.
 *
 * Behavior:
 *   1. Issue `fetch(url, init)`.
 *   2. If the response is not 402, return it unchanged.
 *   3. If it is 402:
 *      a. Parse the challenge body. We accept either
 *         `{ challenge: <wire>, ... }` JSON or a `WWW-Authenticate: MPP
 *         realm="...", challenge="<wire>"` header — matches the server reference
 *         in `lemonade-backend/src/app/controllers/mpp/ping-paid.ts`.
 *      b. Validate the decoded challenge against the safety opts. Throw
 *         `MppPaymentRefusedError` on any mismatch.
 *      c. Submit the USDC `transfer` via `paymentStrategy` (default viem) and
 *         wait for `waitForConfirmations` confirmations.
 *      d. Build a credential envelope echoing the challenge fields, with
 *         `tx_hash` written into `payload.metadata` (the form the server
 *         verifier accepts — see `mpp.ts:readTxHash`).
 *      e. Retry with `Authorization: MPP <credential-wire>`. Return whatever
 *         that produces, even if it is another 402.
 */
export async function fetchWithPayment(
  url: string | URL,
  init: RequestInit | undefined,
  opts: FetchWithPaymentOptions,
): Promise<Response> {
  const response = await fetch(url, init);

  if (response.status !== 402) {
    return response;
  }

  // Response bodies may only be read once — pass a clone to the parser so the
  // original is still available if the helper bails out.
  const challengeWire = await extractChallengeWire(response.clone());
  if (!challengeWire) {
    throw new MppPaymentRefusedError(
      "challenge-missing",
      "402 response did not carry an MPP challenge (no `challenge` body field, no WWW-Authenticate: MPP header)",
    );
  }

  let envelope: MppEnvelope;
  let payload: MppPayload;
  try {
    envelope = deserialize(challengeWire);
    payload = decode(envelope);
  } catch (err) {
    throw new MppPaymentRefusedError(
      "challenge-malformed",
      `failed to decode MPP challenge: ${errMsg(err)}`,
    );
  }

  const receiver = assertAllowedReceiver(payload, opts);
  const token = assertAllowedToken(payload, opts);
  const amountMicro = assertAmountWithinCap(payload, opts);

  const paymentStrategy = opts.paymentStrategy ?? defaultViemPaymentStrategy;
  const rpcUrl = opts.rpcUrl ?? opts.chain.rpcUrls.default.http[0];

  const txHash = await paymentStrategy({
    account: opts.account,
    chain: opts.chain,
    rpcUrl,
    token,
    receiver,
    amountUsdcMicro: amountMicro,
    waitForConfirmations: opts.waitForConfirmations ?? 1,
  });

  opts.onPayment?.({ txHash, amount: amountMicro, receiver });

  const credential = buildCredentialFromChallenge(payload, envelope, txHash);
  const credentialWire = serialize(credential);

  const retryHeaders = new Headers(init?.headers);
  retryHeaders.set("Authorization", `MPP ${credentialWire}`);

  return await fetch(url, { ...init, headers: retryHeaders });
}

// --- internal helpers -----------------------------------------------------

/**
 * Try the JSON body first (`{ challenge: <wire> }`), fall back to the
 * `WWW-Authenticate: MPP realm="...", challenge="<wire>"` header. Servers in
 * the MPP / x402 ecosystem set both — we accept either.
 */
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
    // fall through to WWW-Authenticate
  }

  const wwwAuth = response.headers.get("www-authenticate");
  if (!wwwAuth) return null;

  const match = /(?:^|[\s,])(?:MPP|Bearer)\s.*?challenge="([^"]+)"/i.exec(wwwAuth);
  return match?.[1] ?? null;
}

function assertAllowedReceiver(payload: MppPayload, opts: FetchWithPaymentOptions): `0x${string}` {
  if (!payload.recipient) {
    throw new MppPaymentRefusedError("receiver-not-allowed", "challenge has no recipient", payload);
  }
  const receiver = payload.recipient.toLowerCase();
  const allowed = opts.allowedReceivers.some((r) => r.toLowerCase() === receiver);
  if (!allowed) {
    throw new MppPaymentRefusedError(
      "receiver-not-allowed",
      `challenge recipient ${payload.recipient} is not in allowedReceivers`,
      payload,
    );
  }
  return payload.recipient as `0x${string}`;
}

function assertAllowedToken(payload: MppPayload, opts: FetchWithPaymentOptions): `0x${string}` {
  const token = payload.currency.toLowerCase();
  const allowed = opts.allowedStablecoins.some((t) => t.toLowerCase() === token);
  if (!allowed) {
    throw new MppPaymentRefusedError(
      "stablecoin-not-allowed",
      `challenge currency ${payload.currency} is not in allowedStablecoins`,
      payload,
    );
  }
  return payload.currency as `0x${string}`;
}

function assertAmountWithinCap(payload: MppPayload, opts: FetchWithPaymentOptions): bigint {
  let micro: bigint;
  try {
    micro = parseDecimalUsdcAsMicro(payload.amount);
  } catch (err) {
    throw new MppPaymentRefusedError(
      "amount-malformed",
      `challenge amount "${payload.amount}" is not a USDC decimal: ${errMsg(err)}`,
      payload,
    );
  }
  if (micro > opts.maxAmountUsdcMicro) {
    throw new MppPaymentRefusedError(
      "amount-exceeds-cap",
      `challenge amount ${payload.amount} (${micro.toString()} micro) exceeds maxAmountUsdcMicro=${opts.maxAmountUsdcMicro.toString()}`,
      payload,
    );
  }
  return micro;
}

/**
 * USDC has 6-decimal units. The mpp envelope carries `amount` as a decimal
 * string in `currency` units (e.g. "0.001000" for 1000 micro-USDC). Mirror
 * the shape used by the server's `formatUsdcMicroAsDecimal` so a credential
 * we mint matches the server's expected amount string byte-for-byte.
 */
function parseDecimalUsdcAsMicro(decimal: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(decimal)) {
    throw new Error(`expected decimal with <=6 fractional digits, got "${decimal}"`);
  }
  const [whole, fraction = ""] = decimal.split(".");
  const fractionPadded = fraction.padEnd(6, "0");
  return BigInt(whole ?? "0") * 1_000_000n + BigInt(fractionPadded);
}

/**
 * Build the credential envelope from the challenge envelope. We re-encode
 * (rather than mutating in place) so the credential goes through the same
 * canonicalization the server runs on its end. Echoes every challenge field
 * verbatim and adds `tx_hash` to `metadata` — matches the form pulled out of
 * the credential by the server's `readTxHash` (see lemonade-backend mpp.ts).
 */
function buildCredentialFromChallenge(
  challenge: MppPayload,
  challengeEnvelope: MppEnvelope,
  txHash: `0x${string}`,
): MppEnvelope {
  const metadata: Record<string, string> = {
    ...(challenge.metadata ?? {}),
    tx_hash: txHash,
  };

  const credentialPayload: MppPayload = {
    ...challenge,
    metadata,
  };

  const encoded = encode(credentialPayload);
  // The challenge envelope may have an `opaque` map the server uses to
  // correlate the credential — pass it back unmodified per spec.
  if (challengeEnvelope.opaque !== undefined) {
    encoded.opaque = { ...challengeEnvelope.opaque };
  }
  return encoded;
}

/**
 * Default viem-backed payment strategy. Loaded lazily so the import only fires
 * when an x402 caller actually pays — the main `@atlasprotocol/mpp` export
 * stays viem-free.
 *
 * Skipped under tests, which inject `opts.paymentStrategy`. The hand-off here
 * is one `writeContract` + `waitForTransactionReceipt`; everything else (gas
 * estimation, nonce handling) defers to viem's defaults.
 */
const defaultViemPaymentStrategy: PaymentStrategy = async (input) => {
  type ViemModule = {
    createWalletClient: (cfg: unknown) => {
      writeContract: (cfg: unknown) => Promise<`0x${string}`>;
    };
    createPublicClient: (cfg: unknown) => {
      waitForTransactionReceipt: (cfg: unknown) => Promise<{ status: "success" | "reverted" }>;
    };
    http: (rpc?: string) => unknown;
  };

  let viem: ViemModule;
  try {
    viem = (await import("viem")) as unknown as ViemModule;
  } catch (err) {
    throw new Error(
      `@atlasprotocol/mpp/x402: viem peer dependency is required for the default payment strategy — install \`viem\` or pass opts.paymentStrategy. (import error: ${errMsg(err)})`,
    );
  }

  const transport = viem.http(input.rpcUrl);
  const walletClient = viem.createWalletClient({
    account: input.account,
    chain: input.chain,
    transport,
  });
  const publicClient = viem.createPublicClient({
    chain: input.chain,
    transport,
  });

  const txHash = await walletClient.writeContract({
    address: input.token,
    abi: ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args: [input.receiver, input.amountUsdcMicro],
    account: input.account,
    chain: input.chain,
  });

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: input.waitForConfirmations,
  });
  if (receipt.status !== "success") {
    throw new Error(`USDC transfer reverted (tx ${txHash})`);
  }

  return txHash;
};

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
