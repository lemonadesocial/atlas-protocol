# ATLAS Protocol: Architecture Document

**Version 0.1 | March 2026**

**Authors:** Lemonade

---

## 1. System Overview

ATLAS is a seven-layer protocol stack. Each layer operates independently and communicates through standardized interfaces. The stack serves two sides of the event marketplace: guests discover and book through AI agents, organizers create and promote through the same agent infrastructure.

```
+------------------------------------------------------------------+
|                        AGENT LAYER                                |
|  Guest Agents (discover, book)    Organizer Agents (create, CRM)  |
|  MCP Tools | @atlas/client SDK | lemonade-cli                    |
+------------------------------------------------------------------+
|                     COMMUNICATION LAYER                           |
|              XMTP (E2E encrypted organizer-guest messaging)       |
+------------------------------------------------------------------+
|                      AD-NETWORK LAYER                             |
|        Promotion bids | Relevance filtering | Pay-per-sale        |
+------------------------------------------------------------------+
|                       REGISTRY LAYER                              |
|  Federated search | Well-known endpoints | OAuth imports          |
+------------------------------------------------------------------+
|                        DATA LAYER                                 |
|           IPFS (permanent, content-addressed event storage)       |
+------------------------------------------------------------------+
|                     SETTLEMENT LAYER                              |
|  Base | MegaETH | World Chain | Arbitrum | Ethereum L1            |
|  USDC settlement | Fee split contracts                            |
|  MPP payment rails (on-chain USDC + SPTs for fiat)                |
+------------------------------------------------------------------+
|                     SMART CONTRACT LAYER                          |
|  FeeRouter | AtlasTicket | RewardLedger | RegistryPointer |      |
|  PromotionSettlement                                              |
+------------------------------------------------------------------+
```

Data flows downward (agent calls settle on-chain). Trust flows upward (on-chain settlement provides guarantees that agents and users rely on). The registry sits in the middle, coordinating discovery without controlling transactions.

**Related specs:** PROTOCOL-SPEC.md (API contracts), SCHEMAS.md (data formats), PROGRESSIVE-DECENTRALIZATION.md (trust migration), FEE-STRUCTURE.md (economics), TOKENOMICS.md (token phases).

---

## 2. Data Layer: IPFS

Every ATLAS event listing is published to IPFS at creation time. IPFS is the protocol's permanence layer. If every server goes offline, the event data survives.

### 2.1 Event Listing Lifecycle

```
Organizer creates event (CLI / API / Agent)
        |
        v
Listing serialized as JSON-LD (AtlasEvent schema)
        |
        v
Published to IPFS cluster --> CID generated (content-addressed hash)
        |
        v
CID stored in ATLAS Registry index
        |
        v
CID written to on-chain RegistryPointer contract (Stage 4)
```

The CID is derived from the listing content. Identical content always produces the same CID. Different content produces a different CID. The old CID remains valid and accessible on IPFS. Listings are append-only: updates create new versions, never overwrite old ones.

### 2.2 IPFS Node Operations

ATLAS operates a dedicated IPFS cluster (minimum 3 nodes, geographically distributed). The cluster pins all event listings and receipts. Pinned content is replicated across all cluster nodes and will not be garbage-collected.

**Publishing pipeline:**

1. `lemonade event create` (or API call) generates the JSON-LD listing
2. Listing is validated against SCHEMAS.md AtlasEvent schema
3. Listing is submitted to the IPFS cluster via the IPFS HTTP API
4. Cluster returns the CID
5. CID is stored in the registry's PostgreSQL index
6. (Stage 4) CID is written to the RegistryPointer smart contract on the event's settlement chain

**Fallback resolution:** If the ATLAS registry is unavailable, an agent can resolve an event by querying the RegistryPointer contract directly and fetching the CID from any public IPFS gateway. The data layer and the registry layer are decoupled by design.

### 2.3 Receipt Storage

W3C Verifiable Credential receipts (PROTOCOL-SPEC.md Section 7) are also published to IPFS. Each receipt gets its own CID. The ticket holder can verify their receipt against IPFS without contacting the issuing platform. Receipt CIDs are included in the ERC-721 ticket metadata (Stage 2).

**Related specs:** SCHEMAS.md (AtlasEvent, AtlasCredential schemas), PROTOCOL-SPEC.md Section 7 (receipt format and verification).

---

## 3. Settlement Architecture: Chain-Agnostic

ATLAS deploys identical Solidity contracts to every supported EVM chain. The organizer chooses a settlement chain when creating an event. The choice is stored in the listing's `atlas:settlement` field. Agents read it and route payment accordingly.

### 3.1 Supported Chains

| Chain | Type | Tx Fee | Block Time | USDC Source | Identity |
|-------|------|--------|------------|-------------|----------|
| Base | OP Stack L2 | ~$0.01 | ~2 sec | Native Circle deployment | None |
| MegaETH | EVM L2 (real-time) | <$0.01 | ~10 ms | Bridge (FastBridge) | None |
| World Chain | OP Stack L2 | ~$0.01-0.03 (free for World ID) | ~2 sec | Canonical bridge | World ID |
| Arbitrum | Nitro L2 | ~$0.01 | ~0.25 sec | Native Circle deployment | None |
| Ethereum L1 | Mainnet | $2-50 | ~12 sec | Native Circle deployment | None |

### 3.2 Contract Suite (Deployed Per Chain)

Five contracts form the ATLAS on-chain layer. Each is deployed independently to each supported chain.

| Contract | Purpose | Stage |
|----------|---------|-------|
| FeeRouter.sol | Receives USDC, splits to organizer/treasury/rewards/referral | Stage 1 |
| AtlasTicket.sol | ERC-721 ticket minting with resale rules | Stage 2 |
| RewardLedger.sol | Reward accrual, 14-day timelock, identity-boosted rates | Stage 3 |
| RegistryPointer.sol | Maps event_id to IPFS CID on-chain | Stage 4 |
| PromotionSettlement.sol | Splits ad-network bids (60/30/10) | Phase 1 ($500K GMV) |

All contracts are written in Solidity, compiled with the same version, and verified on each chain's block explorer after deployment.

### 3.3 USDC Source Per Chain

Not all chains have native Circle USDC deployment. The contract suite accepts USDC regardless of source, but the bridging mechanism differs:

- **Native (Base, Arbitrum, Ethereum):** Circle deploys and manages USDC directly. No bridge risk.
- **Canonical bridge (World Chain):** USDC bridged via the chain's official bridge. Backed by locked USDC on Ethereum L1.
- **Third-party bridge (MegaETH):** USDC bridged via FastBridge or similar. Higher bridge risk. ATLAS monitors bridge health and can pause settlement on affected chains.

### 3.4 Adding a New Chain

Adding a chain requires four steps:

1. Deploy the five contracts to the new chain (same Solidity source, same constructor parameters)
2. Verify contracts on the chain's block explorer
3. Register the chain in the ATLAS registry (chain_id, contract addresses, USDC token address, RPC endpoints)
4. Update the CLI and SDK to include the new chain in the `--chain` option

No protocol changes. No schema changes. No agent SDK updates. The listing format already supports arbitrary chain identifiers in the `atlas:settlement.chains` array.

### 3.5 Gas Optimization

- **Batching:** Multiple fee splits can be batched into a single transaction when processing bulk ticket sales
- **Meta-transactions:** Organizers and guests can submit gasless transactions via relayer services. The protocol treasury covers gas costs and recoups from the 2% fee.
- **World ID gas allowance:** Verified humans on World Chain receive priority blockspace and a gas subsidy from the chain itself. Their ATLAS transactions cost nothing.

### 3.6 MPP Payment Integration

ATLAS uses the Machine Payments Protocol (MPP) as its payment layer. MPP is an open standard co-authored by Stripe and Tempo. It defines how AI agents pay for services programmatically.

MPP supports two payment paths:

**Path 1: Direct on-chain USDC.** The agent sends USDC directly to the organizer's chosen chain. No fiat conversion. The transaction settles in one block on L2s (Base, MegaETH, World Chain, Arbitrum) or 12 blocks on Ethereum L1.

**Path 2: Shared Payment Tokens (SPTs) for fiat.** The agent receives an SPT with usage and expiration limits. The SPT abstracts the underlying card details (Visa, Mastercard, Apple Pay, Google Pay, Affirm, Klarna). Stripe processes the charge, converts to USDC, and settles on the organizer's chosen chain.

The full MPP payment flow for a credit card purchase:

```
Attendee pays $25 in card/wallet
        |
        v
Agent creates SPT via Stripe (usage: 1 charge, expires: 5 min)
        |
        v
Agent submits SPT to ATLAS via MPP payment envelope
        |
        v
Stripe processes charge, converts to USDC
        |
        v
USDC routes to FeeRouter.sol on organizer's chosen chain
        |
        v
FeeRouter splits: organizer + treasury + rewards + referral
```

The attendee never sees a blockchain. The organizer receives USDC. MPP handles the payment layer. ATLAS handles discovery, listing, and settlement routing.

**Related specs:** PROTOCOL-SPEC.md Section 8 (payment methods), FEE-STRUCTURE.md (fee math).

---

## 4. Registry Architecture

The registry is the protocol's coordination layer. ATLAS works without it (agents can crawl well-known endpoints directly), but the registry makes discovery practical at scale.

### 4.1 What the Registry Stores

| Stored | Not Stored |
|--------|-----------|
| Event metadata (title, date, location, categories, pricing) | Attendee PII |
| Source provenance (which platform/organizer provided the listing) | Payment credentials |
| Capability declarations (listing only? purchase? full settlement?) | Ticket holder identities |
| Freshness timestamps (last sync time) | Purchase history |
| IPFS CIDs for each listing | Message content |
| Promotion bids and campaign metadata | |

### 4.2 Indexing Pipeline

The registry builds its index from four sources:

1. **IPFS CIDs:** Published by organizers and platforms at event creation
2. **On-chain pointers:** RegistryPointer.sol entries (Stage 4)
3. **Well-known endpoint crawls:** Hourly crawl of `/.well-known/atlas.json` for known domains
4. **OAuth imports:** Events synced from Eventbrite, Lu.ma, Meetup, Partiful via organizer-authorized OAuth tokens

All four sources produce the same output: an AtlasEvent record in the index. The registry does not distinguish between sources when serving search results.

### 4.3 Federation Protocol

Any entity can operate a registry node. The federation protocol ensures nodes stay in sync.

**Node discovery:** DNS SRV records at `_atlas-registry._tcp.atlas.events` list known nodes. New nodes register by adding their endpoint.

**Gossip mechanism:** When a node indexes a new or updated event, it broadcasts the event_id and CID to all known peers. Peers that do not have the CID fetch it from IPFS and update their index.

**Conflict resolution:** CIDs are content-addressed. Two nodes with the same CID have identical data. No conflicts are possible at the data layer. Index metadata (freshness, ranking scores) may differ between nodes. Each node computes its own ranking.

**Sync protocol:** A new node joining the network requests the full CID list from an existing peer, then fetches each CID from IPFS. Incremental sync uses a timestamp-based cursor: "give me all CIDs updated since timestamp X."

### 4.4 Search Ranking

Search ranking is centralized and competitive. Lemonade's registry node uses the following ranking factors (in priority order):

1. **Relevance:** Text match between query and event title/description/categories
2. **Geographic proximity:** Distance between query location and event venue
3. **Temporal proximity:** Events happening sooner rank higher
4. **Organizer reputation:** Verified organizers with positive track records rank higher
5. **Freshness:** Recently updated listings rank higher
6. **Promotion bid:** Promoted events receive a ranking boost proportional to bid amount (labeled as promoted)

Ranking stays centralized because it is a competitive advantage, not a trust-critical function. Anyone can build their own ranking on top of the same IPFS data. Different registry nodes can use different ranking algorithms.

**SLA:** 95th percentile search latency under 2 seconds.

**Related specs:** PROTOCOL-SPEC.md Section 3.4 (registry API), SCHEMAS.md (AtlasSearchQuery, AtlasSearchResult).

---

## 5. Communication Layer: XMTP CRM

ATLAS integrates XMTP as its communication layer. XMTP is a decentralized messaging protocol with end-to-end encryption and user-controlled keys. No central server stores or reads messages.

### 5.1 Channel Establishment

When a guest purchases a ticket through ATLAS, the settlement receipt includes the organizer's XMTP address. The guest's wallet or ATLAS app creates an XMTP channel between the two parties (with guest consent). The channel persists across events and platforms.

```
Ticket purchase settles on-chain
        |
        v
Receipt includes organizer's XMTP address
        |
        v
Guest wallet prompts: "Allow [organizer] to message you?"
        |
        v
Guest consents --> XMTP channel established (E2E encrypted)
        |
        v
Organizer's CRM records new guest with channel ID + purchase data
```

### 5.2 CRM Data Model

The organizer's CRM is a local-first database that combines three data sources:

| Source | Data | Storage |
|--------|------|---------|
| XMTP channels | Message history, read status, opt-in/opt-out status | Organizer's local device/server |
| On-chain receipts | Purchase history, ticket types, amounts, settlement chain | Public blockchain (permanent) |
| Check-in records | Attendance data, timestamps, venue | Organizer's local device/server |

The CRM runs on the organizer's infrastructure. Lemonade does not host, access, or process CRM data. The organizer holds the XMTP identity keys. Losing the keys means losing access to message history (not purchase history, which is on-chain).

### 5.3 Key Management

- **Identity keys:** Generated locally on the organizer's device. Backed up via mnemonic seed phrase (same pattern as crypto wallets).
- **Session keys:** Rotated per conversation. Compromising one session does not compromise others.
- **Key recovery:** Organizer restores from seed phrase on a new device. XMTP network re-syncs conversation history.

### 5.4 Consent and Privacy

- **Opt-in:** Guest explicitly consents to messaging at purchase time. No default opt-in.
- **Opt-out:** Guest can revoke consent at any time. The organizer's agent respects opt-out status and stops messaging.
- **Data minimization:** The protocol transmits only the information required for the message. No behavioral tracking, no read receipts shared with third parties.
- **Encryption:** All messages are end-to-end encrypted. Lemonade, XMTP network nodes, and IPFS cannot read message content.

### 5.5 Agent Integration

Organizer AI agents interact with the CRM through lemonade-cli or MCP tools:

```bash
# Query CRM for a guest segment
lemonade guests list --space bjc_abc123 --segment "attended_jazz AND spent_over_100" --format json

# Send a promotional message to a segment
lemonade message send --space bjc_abc123 --segment "attended_jazz" --body "New jazz night: April 15 at Nublu. $25 GA." --format json

# Check message delivery status
lemonade message status --campaign msg_abc789 --format json
```

The agent reads from the local CRM database and writes to XMTP channels. No data leaves the organizer's infrastructure except the encrypted messages themselves.

### 5.6 Portability

If the organizer leaves Lemonade:

1. Export XMTP identity (seed phrase)
2. On-chain purchase history is permanent and public
3. Import identity into any XMTP-compatible client
4. All conversation history re-syncs from the XMTP network
5. The CRM is fully functional on a different platform or a self-hosted setup

The guest relationship belongs to the organizer, not to the platform.

**Related specs:** Whitepaper Section 11.2 (CRM design rationale).

---

## 6. Ad-Network Architecture

The ATLAS ad-network connects organizers who want to reach new guests with AI agents that serve recommendations. Settlement is on-chain. The model is pay-per-sale.

### 6.1 Promotion Lifecycle

```
Organizer creates campaign (CLI / API / Agent)
        |
        v
Campaign stored in ATLAS Registry
(event_id, bid_per_sale, budget, targeting, start/end dates)
        |
        v
Guest agent queries registry for events
        |
        v
Registry returns organic results + promoted results (flagged)
        |
        v
Agent's relevance model scores promoted results against user query
        |
        v
Agent surfaces promoted results only if relevance threshold met
(labeled as "promoted" in agent output)
        |
        v
Guest purchases ticket
        |
        v
PromotionSettlement.sol executes on-chain:
  - 60% of bid --> referring agent
  - 30% of bid --> protocol treasury
  - 10% of bid --> registry node that served the query
        |
        v
Campaign budget decremented. Campaign pauses when exhausted.
```

### 6.2 Campaign Data Model

```json
{
  "campaign_id": "camp_abc123",
  "event_id": "evt_xyz789",
  "bid_per_sale": "2.00",
  "currency": "USDC",
  "total_budget": "100.00",
  "spent": "0.00",
  "remaining": "100.00",
  "status": "active",
  "targeting": {
    "categories": ["music", "jazz"],
    "geography": { "lat": 40.7128, "lng": -74.006, "radius_km": 50 },
    "age_range": { "min": 21, "max": 45 }
  },
  "start_date": "2026-04-01T00:00:00Z",
  "end_date": "2026-04-15T21:00:00Z",
  "created_at": "2026-03-25T10:00:00Z"
}
```

### 6.3 Agent-Side Mechanics

Guest agents receive promoted listings in the same API response as organic results. The response includes a `promoted` flag and the bid amount (for transparency). The agent decides whether to surface the promotion based on:

1. **Relevance to user query:** Does the event match what the user asked for?
2. **Event quality signals:** Organizer reputation, ticket availability, pricing
3. **Agent policy:** The agent's own rules for showing promotions (frequency caps, user preferences)

Agents that surface irrelevant promotions lose user trust and queries. The market aligns quality with spend. No central authority enforces relevance. Agent reputation is the enforcement mechanism.

### 6.4 Settlement Contract

`PromotionSettlement.sol` receives the bid amount in USDC when a promoted ticket sells:

```
function settlePromotion(
    bytes32 campaignId,
    address referringAgent,
    address registryNode,
    uint256 bidAmount
) external {
    require(campaigns[campaignId].remaining >= bidAmount, "Budget exhausted");

    uint256 agentShare = bidAmount * 60 / 100;
    uint256 treasuryShare = bidAmount * 30 / 100;
    uint256 nodeShare = bidAmount - agentShare - treasuryShare;

    USDC.transfer(referringAgent, agentShare);
    USDC.transfer(treasury, treasuryShare);
    USDC.transfer(registryNode, nodeShare);

    campaigns[campaignId].remaining -= bidAmount;
    campaigns[campaignId].spent += bidAmount;

    if (campaigns[campaignId].remaining == 0) {
        campaigns[campaignId].status = "paused";
    }
}
```

### 6.5 Analytics

Organizers see campaign performance through the CLI or dashboard:

```bash
lemonade promote stats --campaign camp_abc123 --format json
```

Returns: impressions (how many agents received the listing), surfaces (how many agents showed it to users), conversions (ticket sales from promotion), total spend, cost per sale, and ROI vs. organic sales for the same event.

### 6.6 Phased Rollout

| Phase | Trigger | Capabilities |
|-------|---------|-------------|
| Phase 0 | Launch | No ad-network. Organic discovery only. |
| Phase 1 | $500K monthly GMV | Basic promotion bids. Flat per-sale model. CLI campaign creation. |
| Phase 2 | $5M monthly GMV | Automated bidding. Relevance scoring. Real-time optimization. Dashboard. |

**Related specs:** Whitepaper Section 11.3 (ad-network rationale and economics), FEE-STRUCTURE.md Section 8.5 (promotion revenue projections).

---

## 7. Agent Ecosystem Architecture

The agent layer is two-sided. Guest agents discover and book events. Organizer agents create events, manage guests, and run promotions. Both sides use the same infrastructure.

### 7.1 Guest-Side Tools

| Tool | Input | Output |
|------|-------|--------|
| atlas_search_events | location, date range, category | Array of AtlasEvent records |
| atlas_get_event | event_id | Full event details + ticket types |
| atlas_hold_ticket | event_id, ticket_type, quantity | Hold ID + payment challenge (402 envelope) |
| atlas_complete_purchase | hold_id, payment proof | Receipt (W3C Verifiable Credential) |

### 7.2 Organizer-Side Tools

| Tool | Input | Output |
|------|-------|--------|
| atlas_create_event | space_id, title, date, location, pricing | Event ID + IPFS CID + registry confirmation |
| atlas_manage_guests | space_id, segment query | Array of guest records (from local CRM) |
| atlas_send_message | space_id, segment, message body | Delivery confirmation + message IDs |
| atlas_promote_event | event_id, bid, budget, targeting | Campaign ID + status |
| atlas_get_analytics | event_id or space_id | Views, conversions, revenue, demographics |

### 7.3 Interface Layers

All tools are accessible through three interfaces:

- **MCP server:** For LLM agents (Claude, ChatGPT, Gemini) running in MCP-compatible environments. Tools registered per MCP specification with Zod schemas for validation.
- **lemonade-cli:** For terminal-based agents (Claude Code, Cursor, GitHub Copilot) and human developers. Every command accepts `--format json` for machine consumption.
- **@atlas/client SDK:** TypeScript library for programmatic integration. Pluggable payment handlers per chain.

The protocol does not distinguish between a human and an agent calling the same endpoint. A `lemonade event create` command produces the same result regardless of who typed it.

### 7.4 Agent Identity and Rewards

Agents register with the ATLAS registry and receive an `X-Atlas-Agent-Id` header for all requests. The registry tracks which agent referred which transaction. Agent referral rewards (5% of protocol fees, perpetually) are calculated from this tracking and paid out via the RewardLedger contract.

**Related specs:** AGENT-INTEGRATIONS.md (framework-specific integration), CLIENT-SDK-SPEC.md (SDK API), SERVER-SDK-SPEC.md (server middleware).

---

## 8. Smart Contract Specifications

Five contracts form the ATLAS on-chain layer. Each is deployed independently to each supported chain. All contracts use the UUPS proxy pattern for upgradeability.

### 8.1 FeeRouter.sol

**Purpose:** Receives USDC payment for ticket purchases and splits it according to protocol rules.

**Inputs:**
- `ticketPrice` (uint256): total USDC amount
- `organizer` (address): organizer's wallet
- `referrer` (address): referring agent or organizer (for referral rewards)

**Split logic (percentages stored in contract, governance-updatable):**
- Organizer: `ticketPrice - protocolFee`
- Protocol fee (2%): split further into treasury (25%), organizer reward (30%), attendee reward (20%), referral (10%), reserve (15%)

**Upgrade authority:**
- Stage 1: Lemonade multi-sig
- Stage 3: 3-of-5 multi-sig (Lemonade + organizer reps + platform reps)
- Stage 4: DAO governance ($ATLAS token holders)

### 8.2 AtlasTicket.sol (ERC-721)

**Purpose:** Mints a non-fungible token representing a ticket. The token is the ticket.

**Mint parameters:**
- `eventId` (bytes32): ATLAS event identifier
- `ticketType` (bytes32): ticket type identifier
- `holder` (address): purchaser's wallet
- `metadataURI` (string): IPFS CID of the full event listing

**Transfer rules (set per event by organizer):**
- `transferable` (bool): can the ticket be transferred?
- `maxMarkup` (uint16): maximum resale price as percentage of face value (e.g., 150 = 1.5x)
- `royaltyBps` (uint16): basis points paid to organizer on resale (e.g., 500 = 5%)

**Verification:** Any application can call `ownerOf(tokenId)` to verify ticket ownership. The token metadata includes the IPFS CID, so the event details are permanently accessible even if the ATLAS registry is offline.

### 8.3 RewardLedger.sol

**Purpose:** Tracks reward accrual, enforces a 14-day hold, and allows direct claims.

**Accrual:** When FeeRouter processes a sale, it calls `RewardLedger.accrue(participant, amount, timestamp)`. The reward enters a timelock.

**Claim:** After 14 days, the participant calls `RewardLedger.claim()`. The contract verifies the timelock has expired and transfers USDC directly to the caller's wallet.

**Identity boost:** The contract checks for a valid on-chain attestation (World ID, Self.xyz, Civic, Polygon ID). If present, a reward multiplier applies (1.5x at launch, governance-adjustable). The attestation is verified by calling the identity provider's on-chain verifier contract.

**Relay:** A third-party relay service can call `RewardLedger.claimFor(participant)` to trigger claims on behalf of users who prefer automatic payouts. The relay has no discretion over amounts or destinations.

### 8.4 RegistryPointer.sol

**Purpose:** Stores on-chain mappings from event identifiers to IPFS CIDs.

**Write:** Authorized publishers (initially Lemonade, later multi-sig/DAO controlled) call `setPointer(eventId, cid)`.

**Read:** Anyone calls `getPointer(eventId)` to retrieve the current CID. Returns the CID as a bytes value.

**Update:** New CID replaces old in the contract. The old CID remains valid on IPFS. The contract emits an event log for each update, creating a permanent on-chain history of all CID changes.

### 8.5 PromotionSettlement.sol

**Purpose:** Settles ad-network promotion bids when promoted ticket sales occur.

**Inputs:**
- `campaignId` (bytes32): promotion campaign identifier
- `bidAmount` (uint256): USDC bid for this sale
- `referringAgent` (address): agent that surfaced the promotion
- `registryNode` (address): node that served the query

**Split:** 60% to referring agent, 30% to protocol treasury, 10% to registry node.

**Budget tracking:** Each campaign has a `remaining` balance. The contract decrements on each settlement and pauses the campaign when the balance reaches zero.

**Activation:** The contract is deployed at launch but disabled. A governance transaction enables it when the protocol reaches $500K monthly GMV.

### 8.6 Audit and Deployment

- Independent security firm audits all contracts before Stage 1 deployment
- 90-day parallel operation: centralized and on-chain systems run simultaneously, discrepancies investigated
- Gradual traffic migration: 10% to 25% to 50% to 100%
- Rollback procedure: if critical bugs are found, traffic reverts to centralized system while contracts are patched and re-audited

**Related specs:** PROGRESSIVE-DECENTRALIZATION.md (stage-by-stage deployment plan and governance transitions).

---

## 9. Security Architecture

### 9.1 Transport and Authentication

- **TLS 1.3** required for all API endpoints. No unencrypted HTTP.
- **API keys** scoped per agent. Rotation required every 90 days. Keys prefixed `atlas_sk_live_` (secret) and `atlas_pk_live_` (publishable).
- **Agent identity:** `X-Atlas-Agent-Id` header on all requests. Registry tracks agent reputation and referral history.

### 9.2 Purchase Security

- **Idempotency:** UUID v4 keys stored for 24 hours per agent. Duplicate purchase requests return the original response. Prevents double charges.
- **Hold mechanism:** Ticket inventory locked for minimum 300 seconds (5 minutes). Automatic release on expiration. Prevents overselling.
- **Payment verification:** On-chain path: check tx hash for correct recipient, amount, and memo field. SPT fiat path: check Stripe PaymentIntent status equals "succeeded" and the resulting USDC settlement lands on FeeRouter.
- **Double-spend prevention:** Each hold_id accepts exactly one payment. The FeeRouter contract rejects duplicate settlement attempts for the same hold_id.

### 9.3 Data Privacy

- **Attendee PII:** Encrypted at rest (AES-256-GCM). Never stored in the registry. Never written to logs. Never included in IPFS listings.
- **XMTP messages:** End-to-end encrypted. Lemonade has no access to message content. XMTP network nodes relay encrypted blobs without decryption capability.
- **On-chain data:** Settlement transactions are public (amounts, addresses). Attendee identity is not linked to wallet addresses unless the user chooses to connect them.

### 9.4 Receipt Integrity

- **Signing algorithm:** ES256 (ECDSA with P-256 curve and SHA-256)
- **Key format:** JSON Web Key (JWK), listed in the platform's `/.well-known/atlas.json` manifest
- **Verification:** DID:web resolution to retrieve public keys. Signature verified against matched key. Issuance date checked (not in future).
- **Key rotation:** Multiple active signing keys supported during rotation. Revoked keys removed from manifest within 24 hours. Verification checks key validity at issuance time.

### 9.5 Smart Contract Security

- **Proxy pattern:** UUPS (Universal Upgradeable Proxy Standard). Upgrade authority transitions from Lemonade to multi-sig to DAO across stages.
- **Reentrancy protection:** All external calls follow checks-effects-interactions pattern. ReentrancyGuard on all state-modifying functions.
- **Access control:** OpenZeppelin AccessControl for role-based permissions. Roles: ADMIN, PUBLISHER, UPGRADER, PAUSER.
- **Emergency pause:** All contracts implement Pausable. The PAUSER role can halt operations if a vulnerability is discovered.

**Related specs:** PROTOCOL-SPEC.md Section 11 (full security considerations).

---

## 10. Infrastructure and Deployment

### 10.1 Production Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| API gateway | Node.js / Koa | Request routing, rate limiting, auth |
| Event database | PostgreSQL | Event metadata, organizer profiles, hold state |
| Search index | Elasticsearch | Full-text and geo search for registry queries |
| Cache | Redis | Hot event data, rate limit counters, session state |
| IPFS cluster | Kubo (3+ nodes) | Event listing and receipt storage |
| Smart contracts | Solidity (Hardhat/Foundry) | On-chain settlement, tickets, rewards |
| Message relay | XMTP SDK | Organizer-guest communication |
| Payment layer | MPP (on-chain USDC + SPTs for fiat) | Agent-to-service payments |

### 10.2 Deployment

- **Regions:** Multi-region (US-East, EU-West minimum) for registry SLA compliance
- **CI/CD:** GitHub Actions. Contract deployment: testnet staging, manual promotion to mainnet.
- **Contract verification:** Automated verification on Etherscan, Basescan, Arbiscan, and chain-specific explorers after deployment.
- **Environment separation:** Testnet (Sepolia, Base Goerli) for development. Mainnet for production. Test API keys prefixed `atlas_sk_test_`.

### 10.3 Monitoring and Alerting

| Metric | Target | Alert Threshold |
|--------|--------|----------------|
| Registry search latency (p95) | < 2 seconds | > 3 seconds |
| Settlement confirmation | < 30 seconds on L2 | > 60 seconds |
| IPFS publish success rate | > 99.9% | < 99% |
| Hold expiration accuracy | Within 5 seconds of TTL | > 30 seconds drift |
| MPP SPT fiat settlement | > 99% success | < 95% success |

Dashboards: Grafana. Alerting: PagerDuty for SLA breaches.

### 10.4 Disaster Recovery

- **PostgreSQL:** Automated daily backups. Point-in-time recovery to any second within 7 days.
- **IPFS:** Data is permanent by design. Cluster replication ensures availability. Public IPFS gateways provide fallback reads.
- **Smart contracts:** State lives on-chain. No backup needed. Contract code verified and immutable (proxy upgrades require governance approval).
- **Redis:** Ephemeral cache. Rebuilt from PostgreSQL on failure. No persistent state in Redis.

---

## 11. Data Flow Diagrams

### 11.1 Event Creation

| Step | Action |
|------|--------|
| 1 | Organizer (or agent) calls `lemonade event create --space bjc_abc123 --title "Jazz Night" ...` |
| 2 | ATLAS API validates input against AtlasEvent schema |
| 3 | JSON-LD listing generated, published to IPFS, CID returned |
| 4 | Registry indexes event_id, CID, metadata, and searchable fields |
| 5 | (Stage 4) RegistryPointer.sol stores `setPointer(event_id, CID)` on-chain |
| 6 | Event is live. Discoverable by all agents. Purchasable via 402 flow. |

### 11.2 Guest Discovery and Purchase

```
Guest: "Find me a jazz event in Brooklyn this weekend"
    |
    v
Guest Agent --> atlas_search_events(lat, lng, radius, category, dates)
    |
    v
ATLAS Registry returns ranked results (organic + promoted)
    |
    v
Agent presents options to guest. Guest selects event.
    |
    v
Agent --> atlas_hold_ticket(event_id, ticket_type, quantity)
    |
    v
Server responds: 402 Payment Required + payment challenge
    |
    v
Agent --> MPP payment (on-chain USDC OR SPT fiat rail)
    |
    v
FeeRouter.sol splits payment: organizer + treasury + rewards
    |
    v
(Stage 2) AtlasTicket.sol mints ERC-721 to guest wallet
    |
    v
Receipt (W3C VC) issued --> published to IPFS --> delivered to guest
    |
    v
XMTP channel established between organizer and guest (with consent)
```

### 11.3 Promotion and Ad Settlement

| Step | Action |
|------|--------|
| 1 | Organizer: "Promote Jazz Night with $2 per sale, $100 budget" |
| 2 | `lemonade promote create --event evt_xyz --bid 2.00 --budget 100.00` |
| 3 | Campaign stored in registry alongside event listing |
| 4 | Guest agent queries registry, receives promoted listing (flagged) |
| 5 | Agent relevance model scores result. If relevant, shows to user labeled "promoted" |
| 6 | Guest purchases ticket |
| 7 | FeeRouter.sol executes standard 2% fee split |
| 8 | PromotionSettlement.sol splits $2 bid: 60% agent, 30% treasury, 10% node |
| 9 | Campaign budget: $100 minus $2 = $98 remaining |

### 11.4 CRM and Messaging

| Step | Action |
|------|--------|
| 1 | Organizer: "Send a promo to guests who attended my last 3 jazz events" |
| 2 | Agent calls `lemonade guests list --segment "attended_jazz_3plus"` |
| 3 | Local CRM queries XMTP channels + on-chain purchase history |
| 4 | Returns 47 guests matching segment (all with opt-in consent) |
| 5 | Agent calls `lemonade message send --segment "attended_jazz_3plus" --body "New jazz night April 15. $5 off with code JAZZ5."` |
| 6 | XMTP broadcasts encrypted message to 47 guest channels |
| 7 | Delivery confirmation returned to organizer |

---

*This document specifies the architecture of ATLAS Protocol. For API-level contracts, see PROTOCOL-SPEC.md. For data schemas, see SCHEMAS.md. For the progressive decentralization roadmap, see PROGRESSIVE-DECENTRALIZATION.md. For economic models, see FEE-STRUCTURE.md and TOKENOMICS.md.*
