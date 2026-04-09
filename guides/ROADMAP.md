# ATLAS Protocol: Strategic Roadmap

> Phase transitions are triggered by adoption milestones, not calendar dates.

**Current Status:** Phase 0. Building.

---

## Phase 0: Launch (0 to $100K Monthly GMV)

**Governance:** Lemonade stewardship. All decisions made by the founding team.
**Token:** USDC only. No custom token.

### What Ships

**Protocol Core.** The ATLAS specification goes live: discovery, listing, purchase, and settlement. JSON-LD event schema extending Schema.org. HTTP 402 purchase flow with ticket holds. Cryptographic receipts.

**OAuth Connectors.** Import existing inventory from Eventbrite, Lu.ma, and Meetup through organizer-authorized OAuth tokens. No platform cooperation required. Read-heavy, write-light adapters.

**ATLAS Registry.** Federated event discovery. Well-known endpoints (`/.well-known/atlas.json`). Search, filter, and recommend across all connected inventory.

**Settlement.** USDC settlement on any supported EVM-compatible chain, including Base, MegaETH, World Chain, and Arbitrum. 2% flat protocol fee. Managed Payment Pointers for organizer payouts.

**Data Layer.** Event data published to IPFS for permanence and censorship resistance. Content-addressed storage from day one.

**Developer Tools.** `lemonade-cli` published to Homebrew, npm, and PyPI with structured JSON output. MCP server for agent tool registries. `@atlas/client` SDK on npm.

**Rewards.** USDC-only cashback to organizers, platforms, and agents. No speculative tokens. Value returned to participants who grow the network.

### Exit Criteria

$100K monthly GMV through organic usage. 1,000 connected organizers. 3-10 registered platforms.

---

## Phase 1: Growth ($100K to $1M Monthly GMV)

**Governance:** Advisory board (5-7 members). Organizer, platform, agent developer, and Lemonade representatives. Board reviews protocol changes and fee adjustments. Lemonade retains operational control.
**Token:** LMC wrapper introduced alongside USDC.

### What Ships

**LMC (Lemonade Coin).** A wrapped utility token backed 1:1 by USDC in the protocol treasury. Always redeemable at par. Not speculative. Three functions: priority listing staking, 1.5x reward multiplier for opt-in organizers, platform quality staking.

**Ad-Network Phase 1.** Basic promotion bids at the $500K GMV trigger. Organizers set per-sale bids in USDC. Agents surface relevant promotions at the moment of purchase intent. Referring agents earn 60% of bids. Manual campaign creation via CLI.

**XMTP CRM Integration.** Decentralized guest relationship management on XMTP. End-to-end encrypted messaging. Self-custody guest data. Organizers own their audience across platforms. Portable by default.

**Organizer AI Agents.** Agents that create events, manage guest lists, process RSVPs, send updates, and handle follow-ups through XMTP. The same agent infrastructure that powers guest discovery also powers organizer operations.

**Space as Platform.** Organizers create spaces that function as lightweight event platforms. AI agents build pages, manage listings, and run promotion. The organizer runs events. The agent runs the platform.

### Exit Criteria

$1M monthly GMV. 25 registered platforms. 5 platforms built natively on ATLAS. Active RFC process.

---

## Phase 2: Scale ($1M to $10M Monthly GMV)

**Governance:** Steering committee with binding authority. 7 elected/appointed seats. $LEMON token holders elect committee members. Working groups for payments, discovery, and security.
**Token:** $LEMON governance token launched.

### What Ships

**$LEMON Governance Token.** Distributed to active protocol participants based on historical contribution. Not sold in a token sale. Holders vote on fee adjustments, reward allocation, registry policies, SDK standards, and grant disbursements.

**Ad-Network Phase 2.** Automated bidding. Agent-side relevance scoring. Real-time bid optimization. Campaign analytics dashboard for organizers.

**FeeRouter.sol On-Chain (Stage 1 Decentralization).** The fee split contract moves on-chain. Every ATLAS payment splits automatically: organizer share, protocol treasury (2%), reward pool, referral share. Deterministic, public, and tamper-proof. No single entity can modify splits or delay payouts.

**AtlasTicket.sol ERC-721 (Stage 2 Decentralization).** Tickets become attendee-owned NFTs. Offline verification survives server downtime. Resale rules encoded in the token contract. Composable with loyalty programs and reputation systems.

**25+ Platform Integrations.** Enterprise platform partnerships. Ticketing incumbents and venue management systems join the network. 50+ registered agent providers consuming the protocol.

### Exit Criteria

$10M monthly GMV. 100 registered platforms. 50+ agent providers. 20+ countries with active events.

---

## Phase 3: Maturity ($10M+ Monthly GMV)

**Governance:** Independent ATLAS Foundation (non-profit). 9-seat board. Lemonade holds a permanent seat without veto power. Foundation employs protocol developers, operates the reference registry, manages grants, and stewards the specification.
**Token:** Dual-token model (LMC + $LEMON).

### What Ships

**Dual-Token Model.** LMC remains the utility and staking token (stable, USDC-backed). $LEMON governs the protocol and drives ecosystem growth (floating, market-determined). Two tokens, two functions, zero ambiguity.

**RewardLedger.sol On-Chain (Stage 3 Decentralization).** Reward mechanics move on-chain. Timelocks enforce hold periods. Direct claims from contracts. No batch processing, no intermediary approval. Identity verification via pluggable providers (World ID, Self.xyz, Civic).

**RegistryPointer.sol On-Chain (Stage 4 Decentralization).** On-chain pointers link event identifiers to IPFS content hashes. Anyone can run a registry node. Lemonade operates the primary node with the best performance. The protocol functions without it.

**Full Progressive Decentralization.** Trust-critical components live on-chain. Performance-critical components stay centralized. Fee splits, tickets, rewards, and event data are all verifiable without trusting any single operator.

**100+ Platforms. Protocol as Public Infrastructure.** ATLAS becomes what DNS did for domain names and SMTP did for email. Invisible, ubiquitous, and indispensable. Any platform can implement it. Any agent can consume it. Any organizer can participate.

### Exit Criteria

$100M+ annual GMV. 500+ registered platforms. 100,000+ active organizers. Foundation operational and independently funded.

---

## Progressive Decentralization Stages

Each stage removes one category of trust dependency while preserving performance.

| Stage | What Moves On-Chain | Trust Removed | Governance |
|-------|--------------------| --------------|------------|
| 0: Launch | USDC payments | Payment verifiability | Lemonade stewardship |
| 1: Fee Splits | FeeRouter.sol | Fee integrity | Lemonade controls contracts |
| 2: Tickets | AtlasTicket.sol (ERC-721) | Ticket validity | Advisory board oversight |
| 3: Rewards | RewardLedger.sol | Reward integrity | Multi-sig governance |
| 4: Registry | RegistryPointer.sol + IPFS | Event permanence | Token holder governance |

Principle: decentralize trust, not performance. Search ranking, connector sync, frontend UX, and AI inference stay centralized. These are performance problems, not trust problems.

---

## What Stays Centralized (and Why)

**Search ranking.** A competitive advantage, not a trust-critical function. Putting ranking on-chain would make it slow and gameable. Anyone can build their own ranking on top of the decentralized registry data.

**OAuth connector sync.** Internal plumbing. Handles API rate limits and credential refresh. No trust dimension. Imported data is verifiable against the source platform.

**AI agent infrastructure.** Agent inference and recommendation models require sub-second latency. Consensus mechanisms would make them unusable. Outputs are suggestions, not commitments.

---

*Timelines are targets. Phase transitions fire when adoption milestones are met. The protocol earns each phase through real usage, not calendar pressure.*
