import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  optimism,
  optimismSepolia,
  polygon,
  polygonAmoy,
  worldchainSepolia,
  zkSyncSepoliaTestnet,
} from "viem/chains";
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

// MegaETH mainnet is not yet in viem/chains — define a minimal spec.
const megaethChain = {
  id: 4326,
  name: "MegaETH",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://mainnet.megaeth.com/rpc"] } },
} as const satisfies Chain;

// MegaETH testnet — chain id 6342 per the project's docs and chainlist.
// Circle has not published a canonical USDC for MegaETH testnet at time of
// writing; flagged experimental and using a placeholder.
const megaethTestnetChain = {
  id: 6342,
  name: "MegaETH Testnet",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://carrot.megaeth.com/rpc"] } },
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

// Tempo testnet — chain id, RPC, and stablecoin all pending Stripe-Tempo
// public access. Full placeholder, kept experimental.
const tempoTestnetChain = {
  id: 4218,
  name: "Tempo Testnet",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.tempo.xyz"] } },
} as const satisfies Chain;

/**
 * Canonical chain specs, keyed by `AtlasPaymentMethodType`. Sources:
 *
 *   - Mainnets (Base, Optimism, Arbitrum, Polygon, zkSync Era, World Chain)
 *     and verified testnets (Base Sepolia, Optimism Sepolia, Arbitrum
 *     Sepolia, Polygon Amoy) — Circle's official "USDC on test networks" /
 *     "USDC contract addresses" pages
 *     (https://developers.circle.com/stablecoins/docs/usdc-on-test-networks
 *     and https://developers.circle.com/stablecoins/usdc-contract-addresses,
 *     accessed 2026-05-02).
 *   - MegaETH mainnet — chain id 4326 from chainlist.org/chain/4326.
 *     Stablecoin field uses USDM (the chain-native stablecoin) per MegaETH's
 *     `llms-full.txt` token list; Circle does not publish a canonical USDC
 *     for MegaETH.
 *   - MegaETH testnet (chain id 6342), zkSync Sepolia (chain id 300), World
 *     Chain Sepolia (chain id 4801) — Circle has NOT published a canonical
 *     USDC for these networks at time of writing. Each spec ships with a
 *     zero-address placeholder and `experimental: true`; consumers must
 *     opt in explicitly and supply a real USDC address out-of-band until
 *     Circle publishes one.
 *   - Tempo mainnet + testnet — placeholders pending Stripe-Tempo public
 *     release.
 *
 * `defaultConfirmations` is set to 1 on every testnet to keep soak feedback
 * fast; mainnet values follow the chain's nominal finality model.
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
  optimism_sepolia_usdc: {
    chain: optimismSepolia,
    defaultRpcUrl: "https://sepolia.optimism.io",
    usdcAddress: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
    defaultConfirmations: 1,
    notes: "Native Circle USDC on OP Sepolia testnet (chain id 11155420).",
  },
  arbitrum_usdc: {
    chain: arbitrum,
    defaultRpcUrl: "https://arb1.arbitrum.io/rpc",
    usdcAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    defaultConfirmations: 64,
    notes: "Native Circle USDC on Arbitrum One (chain id 42161).",
  },
  arbitrum_sepolia_usdc: {
    chain: arbitrumSepolia,
    defaultRpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    usdcAddress: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    defaultConfirmations: 1,
    notes: "Native Circle USDC on Arbitrum Sepolia testnet (chain id 421614).",
  },
  polygon_usdc: {
    chain: polygon,
    defaultRpcUrl: "https://polygon-rpc.com",
    usdcAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    defaultConfirmations: 128,
    notes: "Native Circle USDC on Polygon PoS (chain id 137).",
  },
  polygon_amoy_usdc: {
    chain: polygonAmoy,
    defaultRpcUrl: "https://rpc-amoy.polygon.technology",
    usdcAddress: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
    defaultConfirmations: 1,
    notes: "Native Circle USDC on Polygon Amoy testnet (chain id 80002).",
  },
  zksync_usdc: {
    chain: zksyncChain,
    defaultRpcUrl: "https://mainnet.era.zksync.io",
    usdcAddress: "0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4",
    defaultConfirmations: 1,
    notes: "Native Circle USDC on zkSync Era (chain id 324).",
  },
  zksync_sepolia_usdc: {
    chain: zkSyncSepoliaTestnet,
    defaultRpcUrl: "https://sepolia.era.zksync.dev",
    // Circle has NOT published a canonical USDC on zkSync Sepolia at time
    // of writing. Zero address is intentional — do not use in production.
    usdcAddress: "0x0000000000000000000000000000000000000000",
    defaultConfirmations: 1,
    experimental: true,
    notes:
      "zkSync Sepolia testnet (chain id 300). Circle has not published a canonical USDC for zkSync Sepolia at time of writing; usdcAddress is a placeholder. Consumers must supply a verified address out-of-band until Circle publishes one.",
  },
  worldchain_usdc: {
    chain: worldchainChain,
    defaultRpcUrl: "https://worldchain-mainnet.g.alchemy.com/public",
    usdcAddress: "0x79A02482A880bCe3F13E09da970dC34dB4cD24D1",
    defaultConfirmations: 1,
    notes: "Native Circle USDC on World Chain (chain id 480).",
  },
  worldchain_sepolia_usdc: {
    chain: worldchainSepolia,
    defaultRpcUrl: "https://worldchain-sepolia.g.alchemy.com/public",
    // Circle has NOT published a canonical USDC on World Chain Sepolia at
    // time of writing. Placeholder zero address — do not use in production.
    usdcAddress: "0x0000000000000000000000000000000000000000",
    defaultConfirmations: 1,
    experimental: true,
    notes:
      "World Chain Sepolia testnet (chain id 4801). Circle has not published a canonical USDC for World Chain Sepolia at time of writing; usdcAddress is a placeholder.",
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
  megaeth_testnet_usdc: {
    chain: megaethTestnetChain,
    defaultRpcUrl: "https://carrot.megaeth.com/rpc",
    // No canonical Circle USDC nor a published native stablecoin for
    // MegaETH testnet. Zero address placeholder — opt-in only.
    usdcAddress: "0x0000000000000000000000000000000000000000",
    defaultConfirmations: 1,
    experimental: true,
    notes:
      "MegaETH testnet (chain id 6342). No canonical Circle USDC published; usdcAddress is a placeholder. Use only with an explicitly-supplied stablecoin address.",
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
  tempo_testnet_usdc: {
    chain: tempoTestnetChain,
    defaultRpcUrl: "https://rpc.testnet.tempo.xyz",
    // Tempo testnet is not publicly accessible yet. RPC URL and USDC
    // address are TODO-pending-access placeholders.
    usdcAddress: "0x0000000000000000000000000000000000000000",
    defaultConfirmations: 1,
    experimental: true,
    notes:
      "Tempo testnet — TODO-pending-access. RPC URL and USDC address are placeholders until Stripe-Tempo publishes testnet access. Do not use in production.",
  },
};

/**
 * Every payment method the SDK can issue challenges for or verify. Includes
 * Stripe SPT (off-chain) plus every `*_usdc` / `*_usdm` chain in CHAIN_SPECS.
 */
export const SUPPORTED_PAYMENT_METHODS: readonly AtlasPaymentMethodType[] = [
  "tempo_usdc",
  "tempo_testnet_usdc",
  "base_usdc",
  "base_sepolia_usdc",
  "arbitrum_usdc",
  "arbitrum_sepolia_usdc",
  "polygon_usdc",
  "polygon_amoy_usdc",
  "optimism_usdc",
  "optimism_sepolia_usdc",
  "zksync_usdc",
  "zksync_sepolia_usdc",
  "worldchain_usdc",
  "worldchain_sepolia_usdc",
  "megaeth_usdm",
  "megaeth_testnet_usdc",
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
