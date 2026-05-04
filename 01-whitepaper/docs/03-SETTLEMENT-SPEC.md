# 03: Settlement Architecture Specification

**ATLAS Protocol | Version 0.1 | April 2026**

---

## 1. Design Principle

ATLAS deploys identical Solidity contracts to every supported EVM chain. The contract source, constructor parameters (other than the per-chain stablecoin token address), and compiler version are the same across all deployments. An organizer selects a settlement chain when creating an event. That choice is stored in the listing's `atlas:settlement.chains` array. Agents read the chain from the listing and route payment to the correct FeeRouter deployment.

No chain-specific logic exists in the contracts. The same bytecode runs on Base, Optimism, Arbitrum, Polygon, Ethereum L1, World Chain, MegaETH, and Tempo. If a new chain launches with EVM compatibility and a USDC- or USDM-class stablecoin, ATLAS can deploy to it without modifying the protocol.

Three deployment axes are independent and MUST NOT be conflated:

- **Settlement chain** — the chain the buyer sends stablecoin to and FeeRouter executes on. Per-event, organizer-selected.
- **NFT chain** — the chain AtlasTicket ERC-721 tokens are minted on. May differ from the settlement chain for cost or composability reasons.
- **Reward chain** — the canonical chain for RewardLedger accruals. **Base + USDC** is the canonical reward chain in v1; multi-chain reward accrual lands in Phase 7+ (see [10-PROGRESSIVE-DECENTRALIZATION](./10-PROGRESSIVE-DECENTRALIZATION.md)).

A purchase can therefore settle on Optimism (USDC), mint a ticket on Base (cheaper NFT chain), and accrue rewards on Base — three distinct on-chain interactions per sale.

```bash
# Organizer creates an event and selects Base for settlement
lemonade event create \
  --space bjc_abc123 \
  --title "Jazz Night at Nublu" \
  --date 2026-05-10T21:00:00Z \
  --location "Nublu, 151 Avenue C, NYC" \
  --chain base \
  --format json
```

The `--chain` flag writes `"atlas:settlement.chains": ["base"]` into the listing metadata. Agents parse this field before initiating payment.

---

## 2. Supported Chains

| Chain | Type | Tx Fee | Block Time | USDC Source | Identity | Status |
|-------|------|--------|------------|-------------|----------|--------|
| Base | OP Stack L2 | ~$0.01 | ~2 sec | Native Circle | None | Production |
| Optimism | OP Stack L2 | ~$0.01 | ~2 sec | Native Circle | None | Production |
| Arbitrum | Nitro L2 | ~$0.01 | ~0.25 sec | Native Circle | None | Production |
| Polygon | PoS sidechain | ~$0.001 | ~2 sec | Native Circle | None | Production |
| zkSync Era | ZK rollup | ~$0.01 | ~1 sec | Native Circle | None | Production |
| World Chain | OP Stack L2 | ~$0.01-0.03 (free World ID) | ~2 sec | Canonical bridge | World ID | Production |
| MegaETH | EVM L2 (real-time) | <$0.01 | ~10 ms | Bridge (FastBridge), USDM | None | Experimental |
| Tempo | Stripe-Tempo native L2 | TBD | TBD | Native (Stripe) | None | Experimental — pending public mainnet |
| Ethereum L1 | Mainnet | $2-50 | ~12 sec | Native Circle | None | Production |

Base is the default recommendation for most organizers: low fees, 2-second finality, native USDC, and broad wallet support. Ethereum L1 is available for high-value settlements where mainnet security justifies the gas cost. World Chain is optimal when Sybil resistance matters (verified humans receive gas subsidies and boosted reward rates). Tempo and MegaETH are flagged experimental in the SDK's `CHAIN_SPECS` (`experimental: true`) and MUST be opted into explicitly — they are not in the SDK's default accepted-chains list.

Each chain also has a corresponding testnet entry in the SDK (`base_sepolia_usdc`, `optimism_sepolia_usdc`, `arbitrum_sepolia_usdc`, `polygon_amoy_usdc`, `zksync_sepolia_usdc`, `worldchain_sepolia_usdc`, `megaeth_testnet_usdc`, `tempo_testnet_usdc`). Testnets whose canonical USDC contract has not yet been published by Circle ship with a placeholder zero address and `experimental: true`. Verified addresses live in [`packages/server-sdk/src/chain-specs.ts`](../../packages/server-sdk/src/chain-specs.ts); deployed FeeRouter proxies live in [`deployments.json`](../../deployments.json) at the repo root and are read by the SDK helpers `getFeeRouterAddress(chainSlug)` / `listDeployedChains()`.

### 2.1 Per-Chain Stablecoin Parameters

The settlement contract's constructor accepts the chain's canonical stablecoin token address. ATLAS is stablecoin-agnostic at initialization: any ERC-20 stablecoin with `decimals = 6` (USDC convention) MAY be used. Per-chain defaults:

| Chain | Stablecoin | Token Symbol | Notes |
|-------|------------|--------------|-------|
| Base | USDC | `USDC` | Native Circle deployment |
| Optimism | USDC | `USDC` | Native Circle deployment |
| Arbitrum | USDC | `USDC` | Native Circle deployment |
| Polygon | USDC | `USDC` | Native Circle deployment |
| Ethereum L1 | USDC | `USDC` | Native Circle deployment |
| World Chain | USDC | `USDC` | Canonical bridge from L1 |
| MegaETH | USDM | `USDM` | M^0-issued, settles in <10 ms |
| Tempo | USDC (Tempo-native) | `USDC` | Stripe-Tempo native issuance |

Organizers selecting MegaETH receive USDM-denominated payouts. Organizers MAY configure a Stripe-SPT or off-chain swap layer to convert MegaETH USDM → Base USDC if their accounting flow expects USDC. The protocol does not perform automatic cross-stablecoin conversion at the contract level.

---

## 3. USDC Source Categories

USDC on each chain arrives through one of three mechanisms.

**Native Circle deployment.** Circle deploys and manages the USDC contract directly on Base, Arbitrum, and Ethereum. The token is a first-class asset on these chains with no bridge dependency. Zero bridge risk.

**Canonical bridge.** World Chain receives USDC through its official OP Stack bridge. USDC is locked on Ethereum L1, and a corresponding amount is minted on World Chain. The bridge is operated by the chain's core team and secured by the same fraud-proof mechanism that secures all L2 state transitions.

**Third-party bridge.** MegaETH does not have native Circle USDC or a canonical bridge at launch. USDC arrives via FastBridge or equivalent third-party bridging infrastructure. This category carries the highest risk profile.

ATLAS monitors bridge health for all non-native USDC sources. The monitoring service checks bridge TVL, withdrawal delays, and contract upgrades on a 5-minute interval. If anomalies are detected (TVL drops >20% in 1 hour, withdrawal delays exceed 2x normal), the ATLAS registry flags the affected chain. Agents receiving a flagged chain in a listing can warn the organizer or route to an alternate chain if the listing specifies multiple options in `atlas:settlement.chains`.

---

## 4. Chain Selection Logic

The organizer selects a settlement chain at event creation time. The choice is final for that event. Changing the settlement chain requires creating a new listing (new CID on IPFS).

```bash
# Single chain (most common)
lemonade event create --chain base ...

# Multiple chains (agent picks the cheapest at purchase time)
lemonade event create --chain base --chain arbitrum ...
```

The listing stores the selection in the `atlas:settlement` object:

```json
{
  "atlas:settlement": {
    "chains": ["base"],
    "contracts": {
      "base": {
        "chain_id": 8453,
        "fee_router": "0x1234...abcd",
        "usdc": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
      }
    }
  }
}
```

When multiple chains are listed, the purchasing agent selects the chain with the lowest total cost (gas + bridge fees) at transaction time. The agent reads contract addresses from the listing and calls `FeeRouter.settle()` on the chosen chain.

---

## 5. Adding a New Chain

Four steps. No protocol changes required.

**Step 1: Deploy contracts.** Deploy all five contracts (FeeRouter, AtlasTicket, RewardLedger, RegistryPointer, PromotionSettlement) using the same Solidity source and constructor parameters. Use Hardhat or Foundry with the chain's RPC endpoint.

```bash
npx hardhat deploy --network megaeth --verify
```

**Step 2: Verify on explorer.** Confirm source code verification on the chain's block explorer. Verified contracts let organizers and agents audit the split logic directly.

**Step 3: Register in registry.** Add the chain to the ATLAS registry with its chain ID, contract addresses, USDC token address, and RPC endpoints.

```bash
lemonade admin chain register \
  --chain-id 7171 \
  --name megaeth \
  --fee-router 0xaaaa...bbbb \
  --usdc 0xcccc...dddd \
  --rpc https://rpc.megaeth.com \
  --explorer https://explorer.megaeth.com
```

**Step 4: Update CLI/SDK.** Add the chain name to the `--chain` option in `lemonade-cli` and the `@atlasprotocol/client` SDK. The listing schema already supports arbitrary chain identifiers in the `atlas:settlement.chains` array, so no schema migration is needed.

---

## 6. Stripe SPT Flow

Most attendees pay with credit cards, Apple Pay, or Google Pay. They never interact with a blockchain. Stripe Stablecoin Payment Tokens (SPTs) bridge fiat payments into the ATLAS settlement layer.

The full pipeline:

```
Attendee taps "Pay $25" (card / Apple Pay / Google Pay)
       |
       v
Stripe charges $25 in attendee's local currency
       |
       v
Stripe takes ~$0.38 (1.5% SPT conversion fee)
       |
       v
Stripe mints SPT representing $24.62 in USDC value
       |
       v
ATLAS backend receives SPT via Stripe webhook
       |
       v
ATLAS redeems SPT for USDC on the organizer's chosen chain
       |
       v
USDC sent to FeeRouter.sol on that chain
       |
       v
FeeRouter splits:
  - Organizer: $24.12 (ticket price minus 2% protocol fee)
  - Protocol treasury: $0.125 (25% of 2% fee)
  - Organizer reward pool: $0.15 (30% of 2% fee)
  - Attendee reward pool: $0.10 (20% of 2% fee)
  - Referral: $0.05 (10% of 2% fee)
  - Reserve: $0.075 (15% of 2% fee)
       |
       v
Receipt (W3C Verifiable Credential) issued to attendee
```

For direct USDC payments, the flow skips Stripe entirely. The agent calls `FeeRouter.settle()` with the USDC amount, and the contract executes the split on-chain in a single transaction.

The 2% fee math above is illustrative for Phase 4 contracts. **Phase 5 contracts use a 0.5% protocol fee** with stacked platform fees represented as a `FeeSplit[]` array passed to `settle()` (see Section 6.5 and [04-SMART-CONTRACTS-SPEC §3](./04-SMART-CONTRACTS-SPEC.md#3-feeroutersol)).

### 6.5 Stacked Platform Fees (FeeSplit)

Phase 5 introduces a stacked fee model. The settlement payload includes a `FeeSplit[]` array of `{recipient, amount}` pairs that FeeRouter forwards atomically. Typical layering for a Lemonade-hosted Space:

```
FeeSplit[0]: { recipient: ATLAS_TREASURY,            amount: 0.5% }   // protocol fee — fixed
FeeSplit[1]: { recipient: LEMONADE_META_FEE_WALLET,  amount: 1.0% }   // Lemonade meta-fee
FeeSplit[2]: { recipient: SPACE_PLATFORM_WALLET,     amount: 2.0% }   // Space platform fee
// remainder routes to organizer
```

For an external platform (e.g. an Eventbrite Org served via the connector), the Lemonade meta-fee MAY be omitted; the array contains only the protocol fee and the platform's own service fee. Constraints enforced on-chain:

- `MAX_TOTAL_PLATFORM_FEES_BPS = 2000` (20%) — sum of all `FeeSplit[i].amount` (excluding the protocol fee) MUST NOT exceed 20% of ticket price.
- `MIN_ORGANIZER_BPS = 7000` (70%) — organizer's share of the gross MUST be at least 70% after all FeeSplit deductions and the protocol fee.

Constraint violations revert the transaction. Fee economics, including the three checkout modes (organizer-absorbs, buyer-pays-on-top, configurable-split), are normatively defined in [09-FEE-ECONOMICS-SPEC](./09-FEE-ECONOMICS-SPEC.md).

### 6.6 Refund Flow (`reverseSettle`)

`FeeRouter.reverseSettle(holdId)` reverses an executed settlement. Refund mechanics:

- **ATLAS protocol fee (0.5%) is always retained** by the protocol treasury and is NOT reversed. Cancelled events still consumed protocol resources (registry storage, signatures, IPFS pinning).
- **Lemonade meta-fee and Space platform fee** are configurable per-platform: each `FeeSplit` recipient declares a `retain_on_refund` boolean in their on-chain platform config. Default is `false` (refunded).
- **Organizer share is fully reversed** to the buyer.
- **Stablecoin source matters**: refund returns the same stablecoin on the same chain the buyer paid in. Cross-chain or cross-stablecoin refunds are out of scope at the contract layer.

`RewardLedger.reverseRewards(holdId)` reverses any reward accruals tied to the refunded sale. Accruals still inside the 14-day timelock are deleted; accruals already claimed are clawed back via a debit-balance mechanism on the participant's next claim. See [04-SMART-CONTRACTS-SPEC §5](./04-SMART-CONTRACTS-SPEC.md#5-rewardledgersol).

---

## 7. Gas Optimization

Three strategies reduce gas costs across all supported chains.

**Batching.** When an agent purchases multiple tickets in a single transaction (e.g., 4 tickets for a group), the FeeRouter processes all splits in one call. A batch of 4 tickets costs roughly 1.3x the gas of a single ticket, not 4x. The `settleBatch()` function accepts an array of ticket parameters and executes all splits in a single EVM execution frame.

**Meta-transactions via relayer.** Organizers and guests can submit gasless transactions through the ATLAS relayer service. The user signs an EIP-712 typed message off-chain. The relayer wraps it in a transaction and submits it on-chain. The protocol treasury covers gas costs and recoups them from the 2% fee. The relayer has no custody over funds: it forwards signed messages, nothing more.

```bash
# Guest purchases a ticket without holding ETH for gas
lemonade ticket buy \
  --event evt_xyz789 \
  --type general_admission \
  --quantity 1 \
  --gasless \
  --format json
```

**World ID gas allowance.** On World Chain, verified humans receive priority blockspace and a gas subsidy from the chain itself. ATLAS transactions from World ID-verified wallets cost zero gas. The protocol detects World ID attestation on-chain and routes World Chain transactions without a gas budget.

---

## 8. Settlement Finality

Each chain has a different security model. ATLAS defines confirmation depths per chain to determine when a settlement is considered final.

| Chain | Confirmation Depth | Approx. Wait | Rationale |
|-------|-------------------|--------------|-----------|
| Base | 1 block | ~2 sec | OP Stack sequencer with fraud-proof window for L1 finality |
| MegaETH | 1 block | ~10 ms | Real-time block production with sequencer confirmation |
| World Chain | 1 block | ~2 sec | OP Stack, same model as Base |
| Arbitrum | 1 block | ~0.25 sec | Nitro sequencer confirmation |
| Ethereum L1 | 12 blocks | ~2.4 min | 2 epochs for economic finality under Casper FFG |

For L2 chains, ATLAS treats sequencer confirmation (1 block) as sufficient for issuing receipts and unlocking ticket delivery. Full L1 finality (fraud-proof window expiration on OP Stack, challenge period on Arbitrum) takes 7 days but is not required for the ticketing use case. A ticket purchase is low enough value that sequencer-level finality provides adequate security.

For Ethereum L1, the 12-block depth (approximately 2.4 minutes) provides finality under normal network conditions. The ATLAS backend waits for this confirmation before issuing the receipt.

Agents poll the settlement status endpoint after submitting payment:

```bash
lemonade settlement status --tx-hash 0xabcd...1234 --chain base --format json
# Returns: { "status": "confirmed", "block": 12345678, "confirmations": 1 }
```

---

## 9. Failure Recovery

Three failure categories and their handling.

**Chain congestion.** If gas prices on the selected chain spike above a configurable threshold (default: 10x the 30-day median), the ATLAS backend holds the settlement in a pending queue. For listings with multiple chains in `atlas:settlement.chains`, the system automatically routes to the cheapest alternative. For single-chain listings, the system retries with exponential backoff (5s, 15s, 45s, 2min, 5min). If settlement fails after 5 retries, the hold is released and the agent receives a `503 Settlement Unavailable` response with a retry-after header.

**RPC failover.** Each chain has a primary and two fallback RPC endpoints registered in the ATLAS registry. If the primary endpoint returns errors or times out (>5s), the backend rotates to the next endpoint. Rotation is automatic and transparent to agents. The registry stores RPC health scores updated every 60 seconds.

```json
{
  "base": {
    "rpc_primary": "https://mainnet.base.org",
    "rpc_fallback": [
      "https://base-mainnet.g.alchemy.com/v2/...",
      "https://base.llamarpc.com"
    ]
  }
}
```

**Stripe SPT failure modes.** Three scenarios require distinct handling. First, if Stripe declines the card, no SPT is minted and the agent receives a `402` with a `payment_failed` reason. The hold remains active for retry. Second, if Stripe charges the card but SPT minting fails (rare), Stripe automatically refunds the charge within 24 hours. ATLAS logs the incident and notifies the agent. Third, if the SPT is minted but USDC redemption fails on-chain, the SPT remains in the ATLAS treasury wallet. A background job retries redemption every 5 minutes for up to 24 hours. If all retries fail, the operations team manually intervenes and the organizer is notified.

---

## 10. Integration Paths (Phase 5.3+)

Phase 5.3 formalises two integration paths for platforms accepting ATLAS settlements. They are not alternatives at the protocol level — both speak to the same on-chain contracts on the same chains — they differ only in **who operates the treasury, signing keys, and RPC layer**. The choice is per-platform, not per-event, and a platform MAY change paths between releases without invalidating any existing on-chain state.

### 10.1 Canonical Path: ATLAS-Managed Services

`POST /atlas/v1/settlements/settle` is the canonical integration path for platforms in Phase 5.3 and later. The platform sends a JSON body — settlement chain, organizer address, total amount, paymentId, fee splits — and the registry's treasury hot wallet broadcasts `FeeRouter.settle()` on the platform's behalf, returning a confirmed `txHash` synchronously. Reward accrual works the same way via `POST /atlas/v1/rewards/record`, which calls `RewardLedger.recordRewards()` on the canonical reward chain (Base — see Section 1).

The full request/response shapes, error envelope, and authentication model are normatively defined in [01-PROTOCOL-SPEC §9](./01-PROTOCOL-SPEC.md).

What the platform offloads to the registry operator:

- **Hot wallet custody.** The treasury wallet that calls `FeeRouter.settle()` is the registry's, not the platform's. The platform never holds platform-side USDC for settlement.
- **Gas funding.** The registry pays gas in the chain's native asset and recoups via the protocol fee.
- **RPC reliability.** The registry maintains the primary + fallback RPC pool and rotates on health failures.
- **IPFS pinning.** Receipt proofs-of-issuance are pinned to the registry's IPFS cluster (see Section 6 of [05-IPFS-DATA-LAYER](./05-IPFS-DATA-LAYER.md)).

What the platform retains:

- **Domain identity and signing keys.** Receipts are signed by the platform's `signing_keys` JWKs as declared in the platform's `/.well-known/atlas.json`. The registry never holds receipt-signing keys.
- **Fee policy.** The `FeeSplit[]` array passed to `settle()` is decided per-call by the platform; the registry forwards it verbatim.
- **Refund authority.** `reverseSettle(holdId)` is initiated by the platform via the same managed surface.

### 10.2 Sovereign Path: Direct Contract Calls

Platforms that prefer to operate their own treasury, signing keys, and RPC infrastructure can continue to call the contracts directly. The SDK ships unsigned-transaction builders for each contract:

- `buildSettleTx({ chain, organizer, totalAmount, paymentId, platformFees })` → `{ to, data, value }` for the platform to sign with its own wallet and broadcast through its own RPC.
- `buildRecordRewardTx({ paymentId, recipients })` → unsigned `RewardLedger.recordRewards()` call data.
- `buildMintTicketTx(...)` → unsigned `AtlasTicket` mint for the NFT chain.

The platform retains full custody of its hot wallet, full discretion over RPC selection and gas pricing, and full control of broadcast timing. The trade-off is operational: the platform now has to fund gas, monitor RPC health, handle retries on chain congestion (Section 9), and run its own IPFS pinner if it wants pinned receipts.

The on-chain idempotency contract (`isSettled(paymentId)` rejects duplicate settlement, `recordRewards()` rejects duplicate accrual for the same `paymentId`) is identical to the managed path. Sovereign and managed broadcasts cannot collide on-chain, so a platform MAY mix paths during migration — for example, settling sovereign on one chain while testing managed on another.

### 10.3 Trade-off Summary

| Concern | Managed (`/atlas/v1/...`) | Sovereign (`buildSettleTx` etc.) |
|---------|--------------------------|----------------------------------|
| Hot-wallet custody | Registry | Platform |
| Gas funding | Registry (recouped via fee) | Platform |
| RPC reliability | Registry | Platform |
| IPFS pinning | Registry-operated cluster | Platform's own pinner |
| Receipt-signing keys | Platform | Platform |
| Fee policy | Platform | Platform |
| Trust assumption | Trust registry's broadcast timing + key custody | None beyond chain |
| Latency | One synchronous HTTP round-trip + on-chain confirmation | Direct broadcast — same on-chain confirmation |
| Failure surface | HTTP error envelope (typed in SDK) | RPC errors directly from the chain |

Most platforms ship faster on the managed path and migrate to sovereign only if their threat model or compliance posture requires platform-controlled keys. Both paths are first-class and supported indefinitely — the protocol does not deprecate sovereign contract calls.

### 10.4 Rewards Claim Flow

Reward **accrual** flows through whichever path the platform chose at settlement time. Reward **claiming** is unchanged across both paths and does not flow through the registry: recipients call `RewardLedger.claim()` (claim to `msg.sender`) or `RewardLedger.claimTo(recipient)` (claim to a different address, e.g. a custodial wallet) directly on the canonical reward chain (Base). The registry has no role in the claim path — it cannot withhold or front-run a claim, and recipients do not need a registered platform identity to claim.

The 14-day timelock on accruals ([04-SMART-CONTRACTS-SPEC §5](./04-SMART-CONTRACTS-SPEC.md)) and the `reverseRewards(holdId)` claw-back semantics (Section 6.6) apply identically to both paths.

---

## References

- ARCHITECTURE.md, Section 3: Settlement Architecture
- WHITEPAPER-CHAIN-AGNOSTIC.md, Section 4.4: Settlement
- WHITEPAPER-CHAIN-AGNOSTIC.md, Section 7: Payment and Settlement
- PROTOCOL-SPEC.md, Section 8: Payment Methods
- FEE-STRUCTURE.md: Fee Mathematics
- PROGRESSIVE-DECENTRALIZATION.md: Stage-by-Stage Deployment Plan
