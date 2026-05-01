import { arbitrum, base, baseSepolia, optimism, polygon } from "viem/chains";
import type { Chain } from "viem";

import type { AtlasPaymentMethodType } from "./types/index.js";

/**
 * `keccak256("Transfer(address,address,uint256)")` — log topic[0] for every
 * ERC-20 Transfer event. Same on every EVM chain.
 */
export const ERC20_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/**
 * Per-chain settlement parameters. The same record is consumed by both
 * `verifyPayment` (server-side log walking) and `generateMppChallenge`
 * (server-side challenge issuance).
 */
export interface ChainSpec {
  /** Viem-compatible chain object. Used by createPublicClient. */
  chain: Chain;
  /** Public RPC URL, used as fallback if the consumer does not supply one. */
  defaultRpcUrl: string;
  /** Canonical USDC (or chain-native stablecoin) ERC-20 address. */
  usdcAddress: string;
  /** Confirmations the verifier waits for before accepting a transfer. */
  defaultConfirmations: number;
  /**
   * `true` if the chain spec is a placeholder pending verification (mainnet
   * not yet stable, or stablecoin contract not yet published by Circle). Such
   * chains MUST NOT appear in `acceptedChains` defaults — consumers must
   * opt in explicitly. Documented per chain below.
   */
  experimental?: boolean;
  /** Free-form note shown next to the spec when documenting it. */
  notes?: string;
}

// MegaETH is not yet in viem/chains — define a minimal spec.
const megaethChain = {
  id: 4326,
  name: "MegaETH",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://mainnet.megaeth.com/rpc"] } },
} as const satisfies Chain;

// World Chain (chain id 480) is not in older viem releases — define
// structurally to avoid pinning to a specific viem version.
const worldchainChain = {
  id: 480,
  name: "World Chain",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://worldchain-mainnet.g.alchemy.com/public"] } },
} as const satisfies Chain;

const zksyncChain = {
  id: 324,
  name: "zkSync",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://mainnet.era.zksync.io"] } },
} as const satisfies Chain;

// Tempo (Stripe's L1) is not in viem/chains. The contract addresses below
// are placeholders pending Tempo's public mainnet release; flagged
// `experimental: true` to keep them out of default acceptedChains.
const tempoChain = {
  id: 4217,
  name: "Tempo",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.tempo.xyz"] } },
} as const satisfies Chain;

/**
 * Canonical chain specs, keyed by `AtlasPaymentMethodType`. Sources:
 *
 *   - Base mainnet, Base Sepolia, Optimism, Arbitrum, Polygon, zkSync Era,
 *     World Chain — Circle's official "USDC contract addresses" page
 *     (https://developers.circle.com/stablecoins/usdc-contract-addresses,
 *     accessed 2026-05-01).
 *   - MegaETH — chain id 4326 from chainlist.org/chain/4326. Stablecoin field
 *     uses USDM (the chain-native stablecoin) per MegaETH's `llms-full.txt`
 *     token list; Circle does not yet publish a canonical USDC for MegaETH.
 *   - Tempo — placeholder pending public mainnet release.
 */
export const CHAIN_SPECS: Record<
  Exclude<AtlasPaymentMethodType, "stripe_spt" | "solana_usdc">,
  ChainSpec
> = {
  base_usdc: {
    chain: base,
    defaultRpcUrl: "https://mainnet.base.org",
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    defaultConfirmations: 12,
    notes: "Native Circle USDC on Base mainnet (chain id 8453).",
  },
  base_sepolia_usdc: {
    chain: baseSepolia,
    defaultRpcUrl: "https://sepolia.base.org",
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    defaultConfirmations: 1,
    notes: "Native Circle USDC on Base Sepolia testnet (chain id 84532).",
  },
  optimism_usdc: {
    chain: optimism,
    defaultRpcUrl: "https://mainnet.optimism.io",
    usdcAddress: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    defaultConfirmations: 10,
    notes: "Native Circle USDC on OP Mainnet (chain id 10).",
  },
  arbitrum_usdc: {
    chain: arbitrum,
    defaultRpcUrl: "https://arb1.arbitrum.io/rpc",
    usdcAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    defaultConfirmations: 64,
    notes: "Native Circle USDC on Arbitrum One (chain id 42161).",
  },
  polygon_usdc: {
    chain: polygon,
    defaultRpcUrl: "https://polygon-rpc.com",
    usdcAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    defaultConfirmations: 128,
    notes: "Native Circle USDC on Polygon PoS (chain id 137).",
  },
  zksync_usdc: {
    chain: zksyncChain,
    defaultRpcUrl: "https://mainnet.era.zksync.io",
    usdcAddress: "0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4",
    defaultConfirmations: 1,
    notes: "Native Circle USDC on zkSync Era (chain id 324).",
  },
  worldchain_usdc: {
    chain: worldchainChain,
    defaultRpcUrl: "https://worldchain-mainnet.g.alchemy.com/public",
    usdcAddress: "0x79A02482A880bCe3F13E09da970dC34dB4cD24D1",
    defaultConfirmations: 1,
    notes: "Native Circle USDC on World Chain (chain id 480).",
  },
  megaeth_usdm: {
    chain: megaethChain,
    defaultRpcUrl: "https://mainnet.megaeth.com/rpc",
    // USDM is MegaETH's chain-native stablecoin per the project's token
    // list (https://docs.megaeth.com/llms-full.txt). Circle does not yet
    // publish a native USDC for MegaETH — flagging experimental until that
    // changes.
    usdcAddress: "0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7",
    defaultConfirmations: 1,
    experimental: true,
    notes:
      "MegaETH mainnet (chain id 4326). Stablecoin is USDM (chain-native), not Circle USDC. Treat as experimental until Circle publishes a canonical USDC for MegaETH.",
  },
  tempo_usdc: {
    chain: tempoChain,
    defaultRpcUrl: "https://rpc.tempo.xyz",
    // TODO(tempo): replace with the canonical USDC contract once Stripe-Tempo
    // publishes it. The address below is a placeholder kept for backward
    // compatibility with the pre-multi-L2 SDK; do not rely on it in
    // production.
    usdcAddress: "0x20c000000000000000000000b9537d11c60e8b50",
    defaultConfirmations: 1,
    experimental: true,
    notes:
      "Tempo (Stripe's L1) — chain id 4217 is provisional. RPC + USDC fields are placeholders pending public mainnet release; do not use in production.",
  },
};

/**
 * Every payment method the SDK can issue challenges for or verify. Includes
 * Stripe SPT (off-chain) plus every `*_usdc` / `*_usdm` chain in CHAIN_SPECS.
 */
export const SUPPORTED_PAYMENT_METHODS: readonly AtlasPaymentMethodType[] = [
  "tempo_usdc",
  "base_usdc",
  "base_sepolia_usdc",
  "arbitrum_usdc",
  "polygon_usdc",
  "optimism_usdc",
  "zksync_usdc",
  "worldchain_usdc",
  "megaeth_usdm",
  "stripe_spt",
];

/**
 * Default acceptedChains — the subset of CHAIN_SPECS keys that are NOT
 * `experimental: true`. Suitable for consumers who want "everything stable"
 * without manually enumerating chains.
 */
export const DEFAULT_ACCEPTED_CHAINS: ReadonlyArray<keyof typeof CHAIN_SPECS> = (
  Object.keys(CHAIN_SPECS) as Array<keyof typeof CHAIN_SPECS>
).filter((key) => !CHAIN_SPECS[key].experimental);
