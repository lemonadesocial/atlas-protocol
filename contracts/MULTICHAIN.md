# Multi-chain deployment — ATLAS Protocol contracts

## Architectural stance: chain-neutral within EVM, separate ports for non-EVM

ATLAS contracts are EVM-portable. Any EVM chain that supports an ERC-20 stablecoin can host FeeRouter. Any EVM chain can host AtlasTicket. The protocol does **not** prescribe which chains operators use — the contracts are generic, the choice is operational.

Solana is the only non-EVM chain we plan to support. It requires a separate Anchor program (different language, different VM, separate audit). Solana support ships as a separate package post-seed; it is not part of Stages 1-3.

Other non-EVM chains (Sui, Aptos, Move-based VMs) are out of scope until proven operator demand exists.

## Three independent concerns

ATLAS contracts and supporting infrastructure can deploy across different chains for different concerns:

| Concern              | Capability requirement                                              | Operator chooses based on                                                  |
|----------------------|---------------------------------------------------------------------|---------------------------------------------------------------------------|
| Payment settlement   | EVM chain with an ERC-20 stablecoin                                 | Stablecoin liquidity, gas cost, finality, regulatory profile, ecosystem fit |
| NFT ticket issuance  | EVM chain                                                           | Mint cost per ticket, throughput, user reach                              |
| Registry pointer     | IPFS + ENS, or contract storage on any chain                        | Decentralization profile, lookup latency                                  |

These three concerns are independent decisions. An operator may collapse all three onto a single chain (one-chain UX, simpler ops), or split them across chains optimized per concern. The protocol supports both patterns equally.

## CREATE2 deterministic addresses

FeeRouter deploys via Nick's deterministic factory (`0x4e59b44847b379578588920cA78FbF26c0B4956C`, available at the same address on every major EVM chain) with a version-aware salt: `keccak256("atlas-protocol/FeeRouter v0.1.0")`.

Result: the proxy contract has the **same address on every EVM chain**. Integrators store one address in their config, regardless of which chain they're settling on. Compute the expected address before deployment with `forge script script/Deploy.s.sol --rpc-url <rpc>` — it's logged before broadcast.

## Stablecoin-agnostic by design

FeeRouter's `initialize()` accepts an ERC-20 token address — it is not hardcoded to USDC or any specific stablecoin. Each chain's deployment passes the appropriate stablecoin for that chain's operator.

Illustrative examples (not exhaustive — operators choose):

- USDC on most major EVM chains
- USDm on MegaETH (native fast/cheap settlement)
- cUSD / cEUR / cREAL on Celo (regional stablecoins)
- USDP, USDT, FRAX, or any other ERC-20 stablecoin
- Tempo USDC (Stripe-Tempo native L2)

The contract doesn't care. Operators pick the stablecoin that fits their use case.

> **Verify before deploying.** ERC-20 contract addresses change occasionally (chain redeploys, native USDC migrations, etc.). Always verify against canonical sources (e.g., Circle's official USDC address page, the chain's official docs) before passing an address to `STABLECOIN` env var.

## Per-chain runbooks

Authoritative per-chain deploy instructions live in [`deploy/`](./deploy/):

| Chain | Status | Runbook |
|-------|--------|---------|
| Base mainnet | Production | [`deploy/base.md`](./deploy/base.md) |
| Optimism | Production | [`deploy/optimism.md`](./deploy/optimism.md) |
| Arbitrum One | Production | [`deploy/arbitrum.md`](./deploy/arbitrum.md) |
| World Chain | Production | [`deploy/worldchain.md`](./deploy/worldchain.md) |
| MegaETH | Experimental (USDM, no canonical Circle USDC yet) | [`deploy/megaeth.md`](./deploy/megaeth.md) |
| Tempo | Placeholder (pending public mainnet) | [`deploy/tempo.md`](./deploy/tempo.md) |

Each runbook documents the canonical stablecoin contract for that chain, the required env vars, the `forge script` invocation, the post-deploy verification command, and the CREATE2 address derivation. USDC contract addresses are verified against [Circle's official "USDC contract addresses" page](https://developers.circle.com/stablecoins/usdc-contract-addresses).

> **CREATE2 caveat.** The proxy address is **NOT** byte-identical across chains by default — `initData` embeds chain-specific `(admin, upgrader, pauser, treasury, stablecoin)` values, and `impl` is created with plain `CREATE` (so its address depends on the deployer's nonce on that chain). To get a matching address everywhere, pin the same multisig addresses on every chain AND bridge the deployer to the same nonce; otherwise treat the proxy as per-chain output and record it in the runbook's "Deployed addresses" section. See [`deploy/README.md`](./deploy/README.md) §"CREATE2 address derivation" for the full formula.

## Per-chain expansion checklist (EVM)

When adding a new EVM chain N to the protocol:

1. **Deploy FeeRouter** via Foundry script — follow the runbook for chain N in [`deploy/<chain>.md`](./deploy/), or copy [`deploy/base.md`](./deploy/base.md) as a template if no runbook exists yet.

2. **Audit addendum.** Trail of Bits or OpenZeppelin: a small redeploy verification (~$10-30K), not a full re-audit. Skip if chain has identical EVM semantics to a previously-audited deployment AND nothing in the contract changed.

3. **Update server-sdk config.** Add chain N to `@atlasprotocol/server-sdk` payment-verify supported chains:
   ```
   { chain: "<name>", chainId: <number>, stablecoin: "0x...", feeRouter: "0x..." }
   ```

4. **Update atlas-registry.** Start indexing events that settle on chain N. Connector framework is already chain-agnostic.

5. **Update MPP rails enum.** Add `usdc-<chain>` (or `usdm-<chain>`, `cusd-<chain>`, etc.) to `@atlasprotocol/mpp`.

6. **Update lemonade-backend operator config.** Chain RPC + payment-account config.

7. **Update `.well-known/atlas.json`.** `payment_methods` array gets the new rail entry.

Realistic timeline per EVM chain: 2-3 engineering days + audit addendum cycle. Most work is operational (RPC providers, monitoring, treasury setup), not contract code.

## Solana support — separate ports

Solana is non-EVM. FeeRouter.sol does not deploy there. Path:

- Build an Anchor program implementing equivalent semantics to FeeRouter (settle, fee distribution, admin role, pausability).
- Build an Anchor program implementing equivalent semantics to AtlasTicket (Metaplex-compatible NFT, mint with claim, batch issuance).
- Ship as separate packages: `@atlasprotocol/solana-feerouter` and `@atlasprotocol/solana-ticket`.
- Update MPP rails to include `usdc-solana` (or whichever Solana stablecoins the operator supports).
- Separate audits — Anchor programs use different security tooling and idioms than Solidity.

Realistic timing: post-seed work. The EVM portfolio (any chain operators want) is sufficient for Stages 1-3.

## Cross-chain coordination — Stage 4 only

Hyperlane / CCIP / LayerZero cross-chain messaging becomes relevant when:

- Aggregating fees across chains for unified treasury management
- Unified governance — a single DAO controlling fee schedules across all chains
- Cross-chain reputation — agent reputation that follows them across chains

None of these are needed for Stages 1-3. Avoid adding them until proven necessary — bridge complexity is the wrong cost to pay for problems we don't yet have. Stage 1-3 architecture relies on signed claims for cross-chain coordination (see Stage 3 spec for AtlasTicket).
