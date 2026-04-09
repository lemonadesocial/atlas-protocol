# ATLAS Progressive Decentralization Roadmap

**Version 0.1 | April 2026**

**Authors:** Lemonade

---

## 1. Principle: Decentralize Trust, Not Performance

ATLAS components fall into two categories. Trust-critical components involve promises a central operator could break: fee splits, ticket validity, reward payouts, event permanence. Performance-critical components involve computation that benefits from speed and flexibility: search ranking, OAuth sync, frontend UX, AI inference.

Trust-critical components move on-chain. Performance-critical components stay centralized.

The test is straightforward. Ask: "Would a user's financial or participatory rights be harmed if this component acted dishonestly?" If yes, decentralize it. If no, optimize it. HTTPS made eavesdropping technically impossible, not merely against policy. On-chain settlement does the same for event finance. It converts social trust ("Lemonade says they will pay you") into cryptographic certainty ("the contract paid you, and anyone can verify it").

Each stage moves one trust-critical component on-chain, proves it works, and creates the foundation for the next.

---

## 2. Stage Overview

| Stage | What Moves On-Chain | Trust Removed | Governance | Trigger |
|-------|--------------------|--------------|-----------:|---------|
| 0 | Payments (USDC) | Payment verifiability | Lemonade stewardship | Launch |
| 1 | Fee split contract | Fee integrity | Lemonade controls contracts | $100K-$1M GMV |
| 2 | ERC-721 tickets | Ticket validity | Advisory board | Post Stage 1 |
| 3 | Reward timelocks | Reward integrity | 3-of-5 multi-sig | Post Stage 2 |
| 4 | IPFS registry pointers | Event permanence | Token holder governance | Post Stage 3 |

---

## 3. Stage 0: Centralized with On-Chain Payments (Launch)

Payments settle in USDC on supported EVM chains (Base, MegaETH, World Chain, Arbitrum, Ethereum L1). Every transaction is verifiable on the public ledger. Anyone can confirm that a payment was made, for what amount, to what address.

Event data publishes to IPFS from day one. Every listing receives a content-addressed CID at creation time.

Everything else runs on Lemonade servers: fee distribution, ticket issuance, reward calculation, event listing, and search indexing. Lemonade operates all components and governs all decisions.

**Users must trust:**
- Lemonade splits fees correctly
- Lemonade issues valid tickets
- Lemonade calculates rewards honestly
- Lemonade keeps the registry available

**Users can verify:**
- Payments were made on-chain
- Correct USDC amounts transferred
- Correct recipient addresses received funds

On-chain payments from day one establish a critical precedent. ATLAS money moves on a public ledger before any smart contract is deployed. The audit trail makes the transition to trustless components natural rather than disruptive.

---

## 4. Stage 1: Fee Split Contract

**Trigger:** $100K to $1M monthly GMV.

**Contract:** `FeeRouter.sol`, deployed to every supported chain.

Today, ticket payments arrive at a Lemonade-controlled address. Lemonade distributes shares manually. In Stage 1, the FeeRouter contract replaces this process. The contract receives all ATLAS payments and executes splits automatically according to encoded rules.

The organizer's share is sent directly to their wallet. The protocol treasury receives exactly 2%. The reward pool receives its designated allocation. The referral share routes to the referring party. Split percentages are stored in the contract and readable by anyone. The contract's execution is deterministic and public.

Lemonade cannot take 3% when the contract says 2%. Lemonade cannot delay an organizer's payout. Lemonade cannot redirect reward pool funds.

Lemonade controls the upgrade key at this stage. Contract upgrades are unilateral but the contract's behavior is publicly verifiable. Anyone can read the deployed bytecode and confirm the split logic.

**Trust removed:** Fee distribution becomes trustless and verifiable.

**Trust remaining:** Ticket validity, reward calculations, registry availability.

---

## 5. Stage 2: On-Chain Tickets

**Contract:** `AtlasTicket.sol` (ERC-721), deployed to every supported chain.

In Stage 1, payments are trustless but tickets are not. If Lemonade's servers go down on event day, ticket verification fails. The attendee has a receipt, but no check-in system can validate it without calling Lemonade's API.

Stage 2 mints an ERC-721 token per ticket purchase on the event's settlement chain. The token encodes event ID, ticket type, and holder wallet. The attendee owns the token, not Lemonade, not the organizer, not the platform.

**Offline verification.** Any check-in application can verify a ticket by querying the blockchain. Server downtime does not invalidate tickets.

**Trustless resale.** Organizers encode resale rules directly in the token contract: maximum markup percentage, royalty basis points on secondary sales, or transfer prohibition. Rules are transparent and self-enforcing. No intermediary needed.

**Composability.** On-chain tickets compose with POAPs and existing NFT infrastructure. Attendees accumulate verifiable attendance histories useful for loyalty programs and reputation systems.

An advisory board oversees contract upgrades at this stage. Significant on-chain assets require oversight beyond a single company.

**Trust removed:** Ticket validity survives server downtime.

**Trust remaining:** Reward calculations, registry availability.

---

## 6. Stage 3: On-Chain Rewards

**Contract:** `RewardLedger.sol`, deployed to every supported chain.

At launch, reward balances are tracked on Lemonade servers. Weekly payouts process in batches. The 14-day hold period is enforced by application logic. Stage 3 moves all reward mechanics on-chain.

**Accrual and timelock.** When FeeRouter processes a sale, it calls `RewardLedger.accrue(participant, amount, timestamp)`. The reward enters a 14-day timelock in the contract. No batch process, no intermediary.

**Direct claims.** After the timelock expires, the participant calls `RewardLedger.claim()`. The contract verifies expiration and transfers USDC directly to the caller's wallet.

**Relay service.** A third-party relay can call `RewardLedger.claimFor(participant)` for users who prefer automatic payouts. The relay has no discretion over amounts or destinations. It can trigger a claim or not trigger it. It cannot redirect funds, modify amounts, or extend hold periods.

**Identity-boosted rates.** The contract checks for valid on-chain attestations from pluggable identity providers: World ID, Self.xyz, Civic, Polygon ID. Verified participants receive a reward multiplier (1.5x at launch, governance-adjustable). The verification proof lives in the user's wallet. The contract checks the proof and applies the rate. No server-side decision.

Governance transitions to a 3-of-5 multi-sig at this stage. Signers include Lemonade representatives, organizer representatives, and platform representatives. No single entity controls contract upgrades when multiple financial components are on-chain.

**Trust removed:** Rewards become self-custodied with direct contract claims.

**Trust remaining:** Registry availability.

---

## 7. Stage 4: Decentralized Registry

**Contract:** `RegistryPointer.sol`, deployed to every supported chain.

IPFS data exists from Stage 0. Every event listing has a permanent CID. Stages 1 through 3 decentralize the financial layer. Stage 4 decentralizes the coordination layer: the search index that makes IPFS listings discoverable.

`RegistryPointer.sol` stores on-chain mappings from `event_id` to IPFS CID. Authorized publishers call `setPointer(eventId, cid)`. Anyone calls `getPointer(eventId)` to retrieve the current CID. The contract emits an event log for each update, creating a permanent on-chain history of all pointer changes.

**Federated registry nodes.** Anyone can run a registry node. A node crawls on-chain pointers, fetches IPFS data, builds a local search index, and serves queries. Lemonade operates the primary node with the best performance, the most complete index, and the most sophisticated ranking. The protocol functions without it.

A community operator in Buenos Aires can run a node focused on Latin American events. A university can run a node for academic conferences. An open-source project can run a node as a public service. Each node computes its own ranking.

Governance transitions to token holder governance. $ATLAS token holders vote on protocol changes, contract upgrades, and registry policies. Lemonade participates as one voter among many.

**Trust removed:** Event permanence becomes censorship-resistant.

**Trust remaining:** None. Every critical component is verifiable on-chain or on IPFS.

---

## 8. What Stays Centralized

Four components remain centralized permanently. Each lacks a trust dimension that would justify the performance cost of decentralization.

**Search ranking** is a competitive advantage. Lemonade's ranking considers freshness, relevance, geographic proximity, organizer reputation, and promotion bids. Putting ranking on-chain would make it slow, expensive, and gameable. Anyone can build alternative ranking on top of the same decentralized registry data.

**OAuth connector sync** handles event imports from Eventbrite, Lu.ma, Meetup, and Partiful. Connectors manage API rate limits, credential refresh, and schedule-based polling. The imported data is verifiable against the source platform. No trust dimension exists.

**Frontend UX** is a presentation layer. Lemonade provides the primary ATLAS frontend, but it is one implementation among potentially many. Anyone can build a frontend that reads from the decentralized registry.

**AI agent inference** requires sub-second latency incompatible with consensus mechanisms. Recommendation models, natural language processing, and search relevance scoring are performance-critical. Their outputs are suggestions, not commitments. No financial or participatory rights depend on inference accuracy.

The rule: if a component involves a promise that could be broken, it moves on-chain. If it involves computation that benefits from speed, it stays centralized.

---

## 9. Governance Alignment

Each technical decentralization stage corresponds to a governance transition. The people who govern the protocol match the trust model the protocol operates under.

| Stage | Governance | Rationale |
|-------|-----------|-----------|
| 0: Centralized | Lemonade stewardship | Controls all components, governs all decisions. Simple, fast, accountable. |
| 1: Fee splits | Lemonade controls contracts | Contracts deployed by Lemonade. Upgrade key is Lemonade's. Behavior is publicly verifiable: a check on governance power. |
| 2: Tickets | Advisory board | Significant on-chain assets need independent oversight. Contract upgrades require advisory review. |
| 3: Rewards | Multi-sig (3-of-5) | Multiple financial components on-chain. Distributed control across Lemonade, organizer reps, and platform reps. |
| 4: Registry | Token holder governance | Protocol is fully decentralized. Lemonade is the original builder, not the sole authority. |

Premature decentralization of governance is as dangerous as premature decentralization of infrastructure. Token holder governance when Lemonade controls every server is theater. Lemonade unilateral control when the protocol's financial layer is trustless is irresponsible. The alignment table prevents both failure modes.

---

## 10. Migration Mechanics

Every stage transition follows five steps. The process is deliberately conservative. Moving financial infrastructure on-chain is a trust transfer, not a feature launch.

### 10.1 Build and Audit

An independent security firm audits the smart contract before deployment. ATLAS does not move financial infrastructure on-chain with unaudited code. The audit covers formal verification of split logic, reentrancy analysis, upgrade path review, and access control validation.

### 10.2 Parallel Operation

The new on-chain component runs alongside the existing centralized component for a minimum of 90 days. Both systems process identical transactions. Discrepancies between on-chain results and centralized results are investigated and resolved before proceeding.

### 10.3 Gradual Migration

Traffic shifts incrementally through four thresholds: 10%, 25%, 50%, 100%. At each threshold, the system is monitored for edge cases, performance degradation, gas cost anomalies, and user experience impact. A threshold is held for a minimum of 14 days before advancing.

### 10.4 Cutover

The centralized component is retired. The on-chain component becomes canonical. The centralized version may continue as a read cache or emergency fallback, but the blockchain is the source of truth for all state.

### 10.5 Governance Update

The governance model updates to match the new trust architecture per the alignment table in Section 9. New signers are onboarded. Old authority structures are deprecated. The transition is announced publicly with a 30-day notice period.

---

## 11. Contract Deployment

The same Solidity source is deployed to every supported EVM chain: Base, MegaETH, World Chain, Arbitrum, Ethereum L1. Constructor parameters are identical across chains. Contracts are verified on each chain's block explorer (Etherscan, Basescan, Arbiscan, and chain-specific equivalents).

Adding a new chain follows the same deployment process. Same source, same parameters, same verification. No protocol changes required. The listing format already supports arbitrary chain identifiers.

**Rollback procedure.** If a critical bug is discovered post-deployment, traffic reverts to the centralized system. The on-chain contracts are paused via the `PAUSER` role. Patched contracts are re-audited before redeployment. The gradual migration restarts from the 10% threshold.

---

## 12. Related Specifications

- **ARCHITECTURE.md Section 3:** Settlement architecture and chain-agnostic contract deployment
- **ARCHITECTURE.md Section 8:** Smart contract specifications (FeeRouter, AtlasTicket, RewardLedger, RegistryPointer, PromotionSettlement)
- **04-SMART-CONTRACTS-SPEC.md:** Full contract interfaces, access control, and upgrade patterns
- **WHITEPAPER Section 13:** Governance evolution phases
- **WHITEPAPER Section 15:** Progressive decentralization rationale and vision

---

*This document specifies the ATLAS trust migration roadmap. For contract-level interfaces, see 04-SMART-CONTRACTS-SPEC.md. For settlement chain details, see 03-SETTLEMENT-SPEC.md. For the strategic rationale, see WHITEPAPER Section 15.*
