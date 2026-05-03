# Multi-chain deployment — ATLAS Protocol contracts

> **FeeRouter v2 (May 2026).** FeeRouter has moved to a v2 ABI: `settle()` now accepts a
> `FeeSplit[]` array of stacked platform fees (cap 20% of gross), a new `reverseSettle()`
> function plus `REFUND_ROLE` enable per-payment refunds, and the default protocol fee was
> lowered from 2% to 0.5% (50 bps). The v2 contract enforces a 70% organizer-share floor as
> defense-in-depth. ATLAS is pre-production and FeeRouter has not yet been deployed on any
> chain — see [`deployments.json`](../deployments.json), where every proxy slot is `null` —
> so the ABI break is non-breaking on-chain. Operators integrating now should target v2.

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

The **implementation** contract address is deterministic across chains by construction — the salt is the same and the bytecode is the same, so the CREATE2 derivation produces the same address everywhere it deploys. The **proxy** address is per-chain by design: UUPS proxies embed chain-specific `(admin, upgrader, pauser, treasury, stablecoin)` values in their `initData`, so the proxy creation digest differs even when the salt is identical. Pinning the same multisig addresses on every chain AND bridging the deployer to the same nonce can yield matching proxy addresses, but that is an operational choice — not a protocol guarantee. See the §"CREATE2 caveat" further down for the formal derivation, and treat per-chain proxy addresses as the default expectation.

Compute the expected addresses before deployment with `forge script script/Deploy.s.sol --rpc-url <rpc>` — both are logged before broadcast. The canonical registry of deployed proxy addresses is [`deployments.json`](../deployments.json) at the repo root; SDK consumers read it via `getFeeRouterAddress(chainSlug)` and `getFeeRouterImplementation()` from `@atlasprotocol/server-sdk`.

### AtlasTicket

AtlasTicket follows the same CREATE2 pattern with its own version-aware salt:
`keccak256("atlas-protocol/AtlasTicket v0.1.0")`. Same Nick's factory, same `ERC1967Proxy`
runtime — so the **implementation** bytecode hash is identical across chains and the impl
CREATE2 address is deterministic everywhere.

Per-chain **proxies** still differ because `initialize()` embeds chain-specific role
recipients and the (name, symbol) pair. **Crucially, AtlasTicket does NOT take a stablecoin
parameter** — the contract is pure NFT issuance, with no on-chain payment leg. That makes
proxy-address parity easier than FeeRouter's: pin the same `(admin, minter, pauser, upgrader)`
multisigs and the same `(name, symbol)` literal across chains and the proxy address matches
without needing to bridge deployer nonces.

Compute the expected addresses with `forge script script/DeployAtlasTicket.s.sol --rpc-url <rpc>`
— both impl and proxy are logged before broadcast. SDK consumers read deployed addresses via
`getAtlasTicketAddress(chainSlug)` and `getAtlasTicketImplementation()` from
`@atlasprotocol/server-sdk`.

#### v2 — burn flow + custodial pattern

`AtlasTicket` v2 introduces:

- **`BURNER_ROLE`** — granted post-deploy to the ATLAS-managed settlement service that drives
  `FeeRouter.reverseSettle()` refunds. The deploy script does NOT pre-grant this role; the
  admin runs `grantRole(BURNER_ROLE, settlementService)` once the operator has identified the
  burner wallet for that chain.
- **`burn(tokenId, paymentId)`** — retires a ticket as part of a refund. Pause-gated.
- **Custodial-wallet pattern** — `mint()` now accepts an `emailHash` (`bytes32`) argument.
  Email-only buyers are minted to an ATLAS-managed custodial holder address with a
  `keccak256(lowercase email)` hash recorded on-chain via `emailHashOf(tokenId)`. The buyer
  later receives the ticket via standard ERC-721 transfer once they connect a wallet — no
  special claim function is required. Wallet-first buyers pass `bytes32(0)` for `emailHash`.

ATLAS contracts are pre-production; no proxies are deployed yet, so the v2 ABI change is
non-breaking on-chain. SDK consumers updating to the v2 helpers gain `buildBurnTicketTx`,
`parseTicketBurnedEvent`, and the new `emailHash` parameter on `buildMintTicketTx`.

### RewardLedger

RewardLedger follows the same CREATE2 pattern with its own version-aware salt:
`keccak256("atlas-protocol/RewardLedger v0.1.0")`. Same Nick's factory, same `ERC1967Proxy`
runtime — so the **implementation** bytecode hash is identical across chains and the impl
CREATE2 address is deterministic everywhere.

Per-chain **proxies** differ for the same reason FeeRouter's do: `initialize()` embeds the
chain-specific `(admin, recorder, pauser, upgrader, stablecoin)` tuple, and payouts settle in
the chain's stablecoin. Pinning the same multisig addresses on every chain AND bridging the
deployer to the same nonce can yield matching proxy addresses, but that is an operational
choice — not a protocol guarantee.

Compute the expected addresses with `forge script script/DeployRewardLedger.s.sol --rpc-url <rpc>`
— both impl and proxy are logged before broadcast. SDK consumers read deployed addresses via
`getRewardLedgerAddress(chainSlug)` and `getRewardLedgerImplementation()` from
`@atlasprotocol/server-sdk`.

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
