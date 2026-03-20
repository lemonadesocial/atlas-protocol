# Atlas Protocol: Progressive Decentralization Architecture

**Version:** 1.0.0-draft
**Status:** Technical Architecture Document
**Date:** 2026-03-19
**Authors:** Lemonade (Founding Contributor)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Trust Analysis](#2-trust-analysis)
3. [Stage 0: Centralized with On-Chain Payments (Current)](#3-stage-0-centralized-with-on-chain-payments-current)
4. [Stage 1: Fee Split Smart Contract](#4-stage-1-fee-split-smart-contract)
5. [Stage 2: On-Chain Ticket Credentials](#5-stage-2-on-chain-ticket-credentials)
6. [Stage 3: On-Chain Reward Ledger](#6-stage-3-on-chain-reward-ledger)
7. [Stage 4: Decentralized Event Registry](#7-stage-4-decentralized-event-registry)
8. [What Stays Centralized (and Why)](#8-what-stays-centralized-and-why)
9. [Governance Transition](#9-governance-transition)
10. [Smart Contract Architecture](#10-smart-contract-architecture)
11. [Migration Strategy Per Stage](#11-migration-strategy-per-stage)
12. [Timeline and Triggers](#12-timeline-and-triggers)

---

## 1. Overview

### Why Progressive Decentralization

Atlas Protocol currently runs on Lemonade's AWS infrastructure: Node.js/Koa backend, MongoDB, Redis, PostgreSQL. Every trust-critical operation -- fee collection, reward calculation, ticket issuance, event indexing -- executes on servers that Lemonade controls. This creates a single point of failure and, more importantly, a single point of manipulation.

Users must trust Lemonade to:
- Collect the stated 2% fee and not more
- Split fees at the published 40/30/20/10 ratio
- Not issue fake tickets or revoke valid ones
- Calculate and distribute rewards honestly
- Not censor events or bias search results

This trust model is acceptable at launch (Phase 0) when Lemonade is the sole operator and the ecosystem is small. It becomes unacceptable as Atlas grows into critical neutral infrastructure that competitors rely on. A protocol that asks competing platforms to trust a single company's database is not a protocol -- it is a product with an API.

Progressive decentralization solves this by moving trust-critical components on-chain in order of impact, while keeping performance-critical components centralized where speed matters more than trustlessness.

### The Trust Spectrum

```
FULLY CENTRALIZED    VERIFIABLE           TRUSTLESS            UNSTOPPABLE
All logic on         Logic on server,     Logic on-chain,      Logic on-chain,
Lemonade servers.    results verifiable   no server needed     immutable contracts,
Must trust           on-chain. "Trust     for critical ops.    no admin keys.
Lemonade entirely.   but verify."         "Don't trust,        Cannot be stopped
                                          verify."             even by creators.

[Stage 0]            [Stage 1-2]          [Stage 3]            [Stage 4]
```

**Where Atlas is today:** Fully centralized (Stage 0). On-chain payments via Tempo USDC provide transaction verifiability, but fee calculation, reward distribution, and ticket issuance all happen server-side.

**Where Atlas is going:** Trustless for money (fee splits, rewards), verifiable for data (tickets, event records), centralized for speed (search, ranking, AI agents).

### Guiding Principle

**Decentralize what needs TRUST first. Keep what needs SPEED centralized.**

Money movement requires trust. Nobody should have to trust Lemonade with their revenue splits. Search ranking requires speed. Sub-200ms query response times require centralized indexing. These are different problems with different solutions.

---

## 2. Trust Analysis

For each component of the Atlas Protocol, we analyze: what can Lemonade manipulate today, what is the impact, and what does decentralization solve?

### 2.1 Fee Collection and Split

| Aspect | Current State |
|--------|--------------|
| **What Lemonade controls** | Fee percentage calculation, split ratio enforcement, treasury allocation |
| **What Lemonade could do** | Take >2% without detection. Change the 40/30/20/10 split silently. Divert treasury funds. |
| **Impact of manipulation** | Direct financial loss to every participant. Organizers receive less, attendees get smaller cashback, referrers are shortchanged. |
| **Detection difficulty** | High. Server-side fee calculation is opaque. Users see the final payout amount but cannot independently verify the split. |
| **Decentralization solution** | Smart contract receives payment, auto-splits per on-chain ratios. Anyone can read the contract to verify. |
| **Priority** | **HIGHEST.** Money is the most trust-sensitive component. This is Stage 1. |

### 2.2 Ticket Issuance

| Aspect | Current State |
|--------|--------------|
| **What Lemonade controls** | Ticket creation, validation, revocation. Currently W3C Verifiable Credentials signed by Lemonade's server keys. |
| **What Lemonade could do** | Issue counterfeit tickets (inflating supply). Revoke valid tickets without refund. Modify ticket metadata post-issuance. |
| **Impact of manipulation** | Attendees denied entry despite valid purchase. Oversold events. Double-selling of tickets. |
| **Detection difficulty** | Medium. VC signatures prove issuance by Lemonade, but Lemonade controls the signing keys and the revocation list. |
| **Decentralization solution** | NFT tickets minted on-chain. Ownership is wallet-native. Revocation requires on-chain transaction (visible, auditable). |
| **Priority** | **HIGH.** Tickets are bearer instruments. Trustless ownership enables secondary markets. This is Stage 2. |

### 2.3 Reward Balances

| Aspect | Current State |
|--------|--------------|
| **What Lemonade controls** | Reward accrual calculation, balance tracking, payout execution. Server-side weekly batch payouts. |
| **What Lemonade could do** | Misreport accrued rewards. Withhold payouts. Apply volume bonuses selectively. Change payout schedules. |
| **Impact of manipulation** | Organizers and attendees receive less than earned. Trust erosion in the reward program. |
| **Detection difficulty** | High. Reward calculation involves volume tiers, discovery bonuses, and referral chains -- all computed server-side. |
| **Decentralization solution** | On-chain reward accumulator. Balances computed by contract from fee split inflows. Users claim directly. |
| **Priority** | **HIGH.** Rewards are the protocol's primary incentive mechanism. This is Stage 3. |

### 2.4 Event Data

| Aspect | Current State |
|--------|--------------|
| **What Lemonade controls** | Event registry storage, indexing, data integrity. MongoDB on AWS. |
| **What Lemonade could do** | Censor events (remove listings). Modify event data (change prices, dates). Delete historical records. |
| **Impact of manipulation** | Organizers' events become undiscoverable. Historical data loss. Selective censorship of competitors. |
| **Detection difficulty** | Medium. Platform manifests (`/.well-known/atlas.json`) provide independent discovery, but the central registry is the primary index. |
| **Decentralization solution** | Events published to IPFS/Arweave with on-chain pointers. Censorship requires controlling every node. |
| **Priority** | **MEDIUM.** Event data is important but less sensitive than money. Federated discovery (DNS TXT, platform manifests) already provides partial decentralization. This is Stage 4. |

### 2.5 Search and Discovery

| Aspect | Current State |
|--------|--------------|
| **What Lemonade controls** | Search ranking algorithm, result ordering, featured placement. |
| **What Lemonade could do** | Bias results toward Lemonade-hosted events. Demote competitor platforms. Sell ranking positions. |
| **Impact of manipulation** | Unfair competitive advantage. Reduced discoverability for non-Lemonade platforms. |
| **Detection difficulty** | Low. Search bias is statistically detectable by comparing results across multiple registry operators. |
| **Decentralization solution** | Multiple competing registry operators can index the same on-chain event data and compete on search quality. |
| **Priority** | **LOW.** Search ranking is competitive advantage, not a trust violation. Multiple registry operators (Stage 4) solve this through competition, not on-chain enforcement. |

### Trust Priority Matrix

```
                    HIGH IMPACT
                        |
    Fee Split [S1]  ----+---- Ticket Issuance [S2]
                        |
    Reward Ledger [S3] -+---- Event Data [S4]
                        |
                        |        Search Ranking [stays centralized]
                    LOW IMPACT
                        |
    EASY TO DETECT -----+------ HARD TO DETECT
```

---

## 3. Stage 0: Centralized with On-Chain Payments (Current)

### Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   LEMONADE AWS INFRASTRUCTURE              │
│                                                           │
│  ┌───────────┐  ┌───────────┐  ┌───────────────────────┐ │
│  │  Node.js  │  │  MongoDB  │  │  Redis / PostgreSQL   │ │
│  │  Koa API  │  │  (primary │  │  (cache / secondary)  │ │
│  │           │  │   store)  │  │                       │ │
│  └─────┬─────┘  └───────────┘  └───────────────────────┘ │
│        │                                                  │
│  ┌─────▼─────────────────────────────────────────────┐   │
│  │              PAYMENT PROCESSING                    │   │
│  │  ├── Stripe (cards, wallets → USD)                 │   │
│  │  ├── Tempo USDC (on-chain settlement)              │   │
│  │  ├── Ethereum relay (payment_splitter_contract)    │   │
│  │  ├── Escrow manager (escrow_manager_contract)      │   │
│  │  └── Stake payment (stake_payment_contract)        │   │
│  └───────────────────────────────────────────────────┘   │
│                                                           │
│  ┌───────────────────────────────────────────────────┐   │
│  │              SERVER-SIDE LOGIC                     │   │
│  │  ├── Fee calculation (2% of ticket price)          │   │
│  │  ├── Fee split (40/30/20/10 in application code)   │   │
│  │  ├── Reward accrual (volume tiers, bonuses)        │   │
│  │  ├── Ticket issuance (W3C VC, server-signed)       │   │
│  │  ├── Event indexing (MongoDB aggregation)          │   │
│  │  └── Payout batching (weekly Agenda jobs)          │   │
│  └───────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
  On-Chain Payments               Existing Contracts
  (Tempo USDC, ETH)              (Chain model references)
  - Verifiable txns              - relay_payment_contract
  - Immutable records            - escrow_manager_contract
                                 - stake_payment_contract
                                 - reward_registry_contract
                                 - poap_contract
                                 - marketplace_contract
                                 - eas_event_contract
```

### Trust Model

Users trust Lemonade entirely. The only on-chain guarantees are:

1. **Payment transactions are verifiable.** Tempo USDC transfers are recorded on-chain. Anyone can verify that a payment of amount X was sent to address Y at time T.
2. **Escrow deposits are contract-held.** The `escrow_manager_contract` holds deposits on-chain with refund policies enforced by the contract (not the server).
3. **Stake payments are contract-held.** The `stake_payment_contract` holds stakes with on-chain slashing/refund logic.

Everything else -- fee percentage, split ratios, reward calculation, ticket validity, event data -- is server-side and unverifiable by third parties.

### Existing Smart Contract Infrastructure

The Lemonade backend already deploys and interacts with contracts on multiple chains. The `Chain` model (defined in `lemonade-backend/src/app/models/chain.ts`) stores per-chain contract addresses:

| Contract | Chain Model Field | Purpose |
|----------|------------------|---------|
| Payment Splitter | `EthereumRelayAccount.payment_splitter_contract` | Splits relay payments to configured addresses |
| Escrow Manager | `escrow_manager_contract` | Holds escrow deposits, enforces refund policies |
| Stake Payment | `stake_payment_contract` | Holds event stakes, supports slash/refund via signatures |
| Reward Registry | `reward_registry_contract` | Tracks reward claims (checkin + ticket rewards) |
| POAP | `poap_contract` | Proof of Attendance Protocol NFTs |
| NFT Marketplace | `marketplace_contract` | NFT marketplace operations |
| EAS Events | `eas_event_contract` | Ethereum Attestation Service for event attestations |
| Proxy Admin | `proxy_admin_contract` | Transparent proxy administration |

**Critical insight:** Lemonade already has a payment splitter contract (`EthereumRelayAccount.payment_splitter_contract`) and a reward registry contract (`reward_registry_contract`). Stage 1 and Stage 3 can build on these existing patterns rather than starting from scratch.

### What Stage 0 Does NOT Guarantee

- Fee percentage is correct (server calculates, no on-chain enforcement)
- Fee split ratios are correct (application code splits, no contract enforcement)
- Rewards are calculated honestly (server-side volume tier logic)
- Tickets cannot be revoked (server controls the signing keys and revocation list)
- Events cannot be censored (server controls the registry index)

---

## 4. Stage 1: Fee Split Smart Contract

**The first and most impactful decentralization step.**

Moving fee collection and splitting on-chain eliminates the highest-impact trust vulnerability: Lemonade's ability to silently take more than the published 2% or misallocate the split.

### 4.1 Contract Design: AtlasFeeSplitter

The `AtlasFeeSplitter` contract receives USDC payment for a ticket purchase and automatically splits it according to on-chain ratios. This replaces the current server-side fee calculation in the payment processing pipeline.

**Design principles:**
- Payment enters the contract as a single USDC transfer
- Contract computes splits using on-chain ratio configuration
- Each pool (treasury, organizer, attendee, referral) receives its share atomically
- Split ratios are readable by anyone (full transparency)
- Ratio changes are time-locked (no silent modification)

### 4.2 Solidity Interface Specification

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title IAtlasFeeSplitter
/// @notice Interface for the Atlas Protocol fee splitting contract
/// @dev Receives USDC payments for ticket purchases and auto-splits per configured ratios
interface IAtlasFeeSplitter {

    /// @notice Emitted when a payment is processed and split
    /// @param purchaseId Unique identifier for this purchase (maps to Atlas challenge_id)
    /// @param payer Address that sent the payment
    /// @param totalAmount Total USDC amount received
    /// @param organizerAmount Amount sent to the organizer
    /// @param protocolFee Total protocol fee deducted
    event PaymentSplit(
        bytes32 indexed purchaseId,
        address indexed payer,
        uint256 totalAmount,
        uint256 organizerAmount,
        uint256 protocolFee
    );

    /// @notice Emitted when protocol fee is distributed to pools
    /// @param purchaseId Matches the PaymentSplit event
    /// @param treasuryAmount Amount to treasury pool
    /// @param organizerRewardAmount Amount to organizer reward pool
    /// @param attendeeRewardAmount Amount to attendee reward pool
    /// @param referralAmount Amount to referral pool
    event FeeDistributed(
        bytes32 indexed purchaseId,
        uint256 treasuryAmount,
        uint256 organizerRewardAmount,
        uint256 attendeeRewardAmount,
        uint256 referralAmount
    );

    /// @notice Emitted when fee ratios are queued for change
    /// @param newProtocolFeeBps New protocol fee in basis points
    /// @param effectiveAt Timestamp when the change takes effect
    event FeeChangeQueued(
        uint256 newProtocolFeeBps,
        uint256 effectiveAt
    );

    /// @notice Emitted when split ratios are queued for change
    /// @param newTreasuryBps New treasury share in basis points
    /// @param newOrganizerBps New organizer reward share in basis points
    /// @param newAttendeeBps New attendee reward share in basis points
    /// @param newReferralBps New referral share in basis points
    /// @param effectiveAt Timestamp when the change takes effect
    event SplitChangeQueued(
        uint256 newTreasuryBps,
        uint256 newOrganizerBps,
        uint256 newAttendeeBps,
        uint256 newReferralBps,
        uint256 effectiveAt
    );

    // ─── Core Operations ───────────────────────────────────────

    /// @notice Process a ticket purchase payment
    /// @dev Caller must have approved this contract to spend `amount` of USDC
    /// @param purchaseId Unique purchase identifier (Atlas challenge_id as bytes32)
    /// @param organizer Address to receive the organizer's share (ticket price minus protocol fee)
    /// @param amount Total USDC amount (ticket price including protocol fee)
    /// @param referrer Address of the referrer (address(0) if no referral)
    function processPayment(
        bytes32 purchaseId,
        address organizer,
        uint256 amount,
        address referrer
    ) external;

    /// @notice Process a batch of payments in a single transaction
    /// @dev For multi-ticket orders. Each entry is split independently.
    /// @param purchaseIds Array of unique purchase identifiers
    /// @param organizers Array of organizer addresses (one per purchase)
    /// @param amounts Array of USDC amounts (one per purchase)
    /// @param referrers Array of referrer addresses (one per purchase, address(0) if none)
    function processPaymentBatch(
        bytes32[] calldata purchaseIds,
        address[] calldata organizers,
        uint256[] calldata amounts,
        address[] calldata referrers
    ) external;

    // ─── Configuration (Owner Only, Time-Locked) ────────────────

    /// @notice Queue a change to the protocol fee percentage
    /// @dev Subject to TIMELOCK_DURATION delay. Fee in basis points (200 = 2.00%).
    /// @param newProtocolFeeBps New fee in basis points (max 1000 = 10%)
    function queueFeeChange(uint256 newProtocolFeeBps) external;

    /// @notice Queue a change to the fee split ratios
    /// @dev Subject to TIMELOCK_DURATION delay. All values in basis points. Must sum to 10000.
    /// @param treasuryBps Treasury share in basis points
    /// @param organizerRewardBps Organizer reward share in basis points
    /// @param attendeeRewardBps Attendee reward share in basis points
    /// @param referralBps Referral share in basis points
    function queueSplitChange(
        uint256 treasuryBps,
        uint256 organizerRewardBps,
        uint256 attendeeRewardBps,
        uint256 referralBps
    ) external;

    /// @notice Execute a queued fee change after timelock expires
    function executeFeeChange() external;

    /// @notice Execute a queued split change after timelock expires
    function executeSplitChange() external;

    /// @notice Cancel a queued fee or split change
    function cancelPendingChanges() external;

    // ─── View Functions ──────────────────────────────────────────

    /// @notice Get the current protocol fee in basis points
    /// @return Protocol fee (e.g., 200 = 2.00%)
    function protocolFeeBps() external view returns (uint256);

    /// @notice Get the current fee split ratios
    /// @return treasuryBps Treasury share in basis points
    /// @return organizerRewardBps Organizer reward share
    /// @return attendeeRewardBps Attendee reward share
    /// @return referralBps Referral share
    function splitRatios() external view returns (
        uint256 treasuryBps,
        uint256 organizerRewardBps,
        uint256 attendeeRewardBps,
        uint256 referralBps
    );

    /// @notice Get pending parameter changes (if any)
    /// @return hasPendingFeeChange Whether a fee change is queued
    /// @return hasPendingSplitChange Whether a split change is queued
    /// @return effectiveAt Timestamp when changes take effect (0 if none)
    function pendingChanges() external view returns (
        bool hasPendingFeeChange,
        bool hasPendingSplitChange,
        uint256 effectiveAt
    );

    /// @notice Get the cumulative amount processed through this contract
    /// @return Total USDC volume (in token units with decimals)
    function totalVolumeProcessed() external view returns (uint256);

    /// @notice Get the cumulative protocol fees collected
    /// @return Total fees in USDC
    function totalFeesCollected() external view returns (uint256);

    /// @notice Check if a purchaseId has already been processed (replay protection)
    /// @param purchaseId The purchase identifier to check
    /// @return Whether this purchaseId has been processed
    function isProcessed(bytes32 purchaseId) external view returns (bool);

    /// @notice Get pool addresses
    /// @return treasury Address of the treasury pool
    /// @return organizerRewardPool Address of the organizer reward pool
    /// @return attendeeRewardPool Address of the attendee reward pool
    /// @return referralPool Address of the referral pool
    function poolAddresses() external view returns (
        address treasury,
        address organizerRewardPool,
        address attendeeRewardPool,
        address referralPool
    );
}
```

### 4.3 Contract Constants and Configuration

```solidity
/// @title AtlasFeeSplitter
/// @notice Implementation of the Atlas Protocol fee splitting mechanism
contract AtlasFeeSplitter is
    Initializable,
    OwnableUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    IAtlasFeeSplitter
{
    using SafeERC20 for IERC20;

    // ─── Constants ──────────────────────────────────────────────

    /// @notice USDC token contract address (set at initialization, immutable after)
    IERC20 public usdc;

    /// @notice Timelock duration for parameter changes (48 hours)
    uint256 public constant TIMELOCK_DURATION = 48 hours;

    /// @notice Maximum protocol fee (10% = 1000 bps). Safety cap.
    uint256 public constant MAX_PROTOCOL_FEE_BPS = 1000;

    /// @notice Basis points denominator
    uint256 public constant BPS_DENOMINATOR = 10000;

    // ─── State ──────────────────────────────────────────────────

    /// @notice Current protocol fee in basis points (200 = 2.00%)
    uint256 public override protocolFeeBps;

    /// @notice Fee split ratios (must sum to BPS_DENOMINATOR)
    uint256 public treasuryBps;
    uint256 public organizerRewardBps;
    uint256 public attendeeRewardBps;
    uint256 public referralBps;

    /// @notice Pool addresses
    address public treasury;
    address public organizerRewardPool;
    address public attendeeRewardPool;
    address public referralPool;

    /// @notice Processed purchase IDs (replay protection)
    mapping(bytes32 => bool) public override isProcessed;

    /// @notice Cumulative counters
    uint256 public override totalVolumeProcessed;
    uint256 public override totalFeesCollected;

    // ─── Pending Changes (Timelocked) ──────────────────────────

    struct PendingFeeChange {
        uint256 newProtocolFeeBps;
        uint256 effectiveAt;
        bool exists;
    }

    struct PendingSplitChange {
        uint256 treasuryBps;
        uint256 organizerRewardBps;
        uint256 attendeeRewardBps;
        uint256 referralBps;
        uint256 effectiveAt;
        bool exists;
    }

    PendingFeeChange public pendingFeeChange;
    PendingSplitChange public pendingSplitChange;

    // ─── Initialization ────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _usdc,
        address _treasury,
        address _organizerRewardPool,
        address _attendeeRewardPool,
        address _referralPool,
        uint256 _protocolFeeBps,
        uint256 _treasuryBps,
        uint256 _organizerRewardBps,
        uint256 _attendeeRewardBps,
        uint256 _referralBps
    ) public initializer {
        __Ownable_init(msg.sender);
        __Pausable_init();
        __UUPSUpgradeable_init();

        require(_protocolFeeBps <= MAX_PROTOCOL_FEE_BPS, "Fee exceeds maximum");
        require(
            _treasuryBps + _organizerRewardBps + _attendeeRewardBps + _referralBps == BPS_DENOMINATOR,
            "Split ratios must sum to 10000"
        );

        usdc = IERC20(_usdc);
        treasury = _treasury;
        organizerRewardPool = _organizerRewardPool;
        attendeeRewardPool = _attendeeRewardPool;
        referralPool = _referralPool;

        protocolFeeBps = _protocolFeeBps;
        treasuryBps = _treasuryBps;
        organizerRewardBps = _organizerRewardBps;
        attendeeRewardBps = _attendeeRewardBps;
        referralBps = _referralBps;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
```

### 4.4 Deployment Strategy

**Primary chain:** Base (low gas, high USDC liquidity, Coinbase ecosystem alignment with Tempo).

**Secondary chain:** Tempo (native Atlas settlement layer, sub-cent fees).

**Deployment sequence:**

1. Deploy `AtlasFeeSplitter` proxy on Base testnet (Sepolia)
2. Integration test with Atlas purchase flow on testnet
3. Security audit (see Section 10.4)
4. Deploy to Base mainnet behind feature flag
5. Route 1% of live traffic through contract (canary deployment)
6. Monitor for 2 weeks: gas costs, settlement latency, edge cases
7. Ramp to 100% over 4 weeks
8. Deploy identical contract on Tempo
9. Route Tempo USDC payments through Tempo contract

**Initial configuration (matching current server-side values):**

```
protocolFeeBps = 200          (2.00%)
treasuryBps = 4000            (40% of fee → 0.80% of GMV)
organizerRewardBps = 3000     (30% of fee → 0.60% of GMV)
attendeeRewardBps = 2000      (20% of fee → 0.40% of GMV)
referralBps = 1000            (10% of fee → 0.20% of GMV)
```

### 4.5 Integration with Existing Purchase Flow

Currently, the Atlas purchase flow (PROTOCOL-SPEC.md Section 6) settles payments as follows:

```
Phase 1: Agent → POST /purchase → 402 with challenge (recipient_address = organizer wallet)
Phase 2: Agent pays → POST /purchase with payment_proof → Server verifies → Tickets issued
```

**The change:** The `recipient_address` in the 402 challenge switches from the organizer's wallet to the `AtlasFeeSplitter` contract address. The contract auto-splits; the organizer receives their share directly.

```
BEFORE (Stage 0):
  Agent pays $100 USDC → Organizer wallet
  Server calculates: $2 fee → Server transfers $2 from organizer to treasury
  Server calculates: $0.60 reward → Server credits organizer account
  (Trust: must trust server did the math right)

AFTER (Stage 1):
  Agent pays $100 USDC → AtlasFeeSplitter contract
  Contract auto-splits:
    $98.00 → Organizer wallet (immediate)
    $0.80  → Treasury address (immediate)
    $0.60  → Organizer reward pool (immediate)
    $0.40  → Attendee reward pool (immediate)
    $0.20  → Referral pool (immediate)
  (Trust: read the contract, verify the math)
```

### 4.6 Migration Path from Server-Side Fee Calculation

**What changes:**
- The 402 challenge `recipient_address` field changes from organizer wallet to contract address
- The `memo` field includes the `purchaseId` for contract replay protection
- Server no longer calculates or transfers fees post-payment
- Server reads `PaymentSplit` events from chain to confirm settlement

**What stays the same:**
- Purchase flow phases (Phase 1 → 402 → Phase 2 → 200)
- Receipt format (W3C Verifiable Credentials)
- Agent-facing API (no breaking changes)
- Stripe SPT flow (fiat payments still processed by server, with on-chain fee split for the USDC portion)

**Backwards compatibility:**
- Agents that already implement the Atlas v1 purchase flow need zero changes -- only the `recipient_address` value changes, which agents treat as opaque
- Stripe SPT payments continue through the existing server path; fee split is executed by the server calling `processPayment()` on the contract with the USDC equivalent

### 4.7 Existing Contract as Starting Point

Lemonade's `EthereumRelayAccount` (defined in `lemonade-backend/src/app/models/new-payment-account.ts:61-65`) already has a `payment_splitter_contract` field. The relay payment flow uses this contract for splitting payments to configured addresses.

The `AtlasFeeSplitter` extends this pattern with:
- Fixed protocol fee percentage (not just arbitrary splits)
- Four named pools with on-chain ratio enforcement
- Timelock on parameter changes (relay splitter has no timelock)
- Replay protection via `purchaseId` mapping
- Cumulative accounting for transparency

### 4.8 Gas Cost Analysis (Base)

| Operation | Estimated Gas | Cost at 0.01 gwei base fee | Cost at 1 gwei |
|-----------|--------------|---------------------------|----------------|
| `processPayment` (4 USDC transfers + storage) | ~180,000 | ~$0.0001 | ~$0.006 |
| `processPaymentBatch` (10 payments) | ~900,000 | ~$0.0005 | ~$0.03 |
| `queueFeeChange` | ~50,000 | <$0.0001 | ~$0.002 |
| `executeFeeChange` | ~45,000 | <$0.0001 | ~$0.002 |

At Base's typical gas prices (<0.01 gwei), the per-transaction cost is negligible. Even at elevated prices, the cost per ticket is sub-cent -- well within the Tempo network fee budget (<$0.001) already budgeted in the fee structure.

---

## 5. Stage 2: On-Chain Ticket Credentials

### 5.1 Overview

Replace server-signed W3C Verifiable Credentials with on-chain NFT tickets. Ticket ownership becomes wallet-native: the holder of the NFT is the ticket holder. No server lookup required for verification.

### 5.2 Token Standard: ERC-1155 (Multi-Token)

ERC-1155 is preferred over ERC-721 for tickets because:

- **Gas efficiency:** A single transaction can mint multiple tickets (batch mint for multi-ticket orders)
- **Fungibility within type:** All "General Admission" tickets for one event are functionally identical (semi-fungible)
- **Metadata per type:** Each ticket type gets its own URI, not each individual ticket
- **Existing precedent:** Lemonade already deploys NFTs via `marketplace_contract` and POAP via `poap_contract`

### 5.3 Solidity Interface: AtlasTicket

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title IAtlasTicket
/// @notice Interface for on-chain Atlas Protocol ticket NFTs
interface IAtlasTicket {

    /// @notice Ticket metadata stored on-chain (not just in URI)
    struct TicketData {
        bytes32 eventId;           // Atlas event ID (UUID v7 as bytes32)
        bytes32 ticketTypeId;      // Atlas ticket type ID
        uint64 validFrom;          // Unix timestamp: event start
        uint64 validUntil;         // Unix timestamp: event end
        bool checkedIn;            // Whether this ticket has been used
        uint64 checkedInAt;        // Timestamp of check-in (0 if not checked in)
        bool revoked;              // Whether this ticket has been revoked (refund)
    }

    /// @notice Emitted when tickets are minted for a purchase
    event TicketsMinted(
        bytes32 indexed eventId,
        bytes32 indexed ticketTypeId,
        address indexed attendee,
        uint256 tokenId,
        uint256 quantity,
        bytes32 purchaseId
    );

    /// @notice Emitted when a ticket is checked in
    event TicketCheckedIn(
        uint256 indexed tokenId,
        address indexed holder,
        bytes32 indexed eventId,
        uint64 timestamp
    );

    /// @notice Emitted when a ticket is revoked (refund)
    event TicketRevoked(
        uint256 indexed tokenId,
        address indexed holder,
        bytes32 indexed eventId,
        bytes32 reason
    );

    // ─── Minting (Authorized Issuers Only) ──────────────────────

    /// @notice Mint tickets for a completed purchase
    /// @dev Only callable by addresses with ISSUER_ROLE
    /// @param to Attendee wallet address
    /// @param eventId Atlas event ID
    /// @param ticketTypeId Atlas ticket type ID
    /// @param quantity Number of tickets to mint
    /// @param validFrom Event start timestamp
    /// @param validUntil Event end timestamp
    /// @param purchaseId Atlas purchase/challenge ID (for cross-reference)
    /// @return tokenId The minted token ID
    function mintTickets(
        address to,
        bytes32 eventId,
        bytes32 ticketTypeId,
        uint256 quantity,
        uint64 validFrom,
        uint64 validUntil,
        bytes32 purchaseId
    ) external returns (uint256 tokenId);

    // ─── Check-in ───────────────────────────────────────────────

    /// @notice Check in a ticket (mark as used)
    /// @dev Callable by CHECKIN_ROLE or by the ticket holder
    /// @param tokenId The token ID to check in
    /// @param holder Address of the ticket holder (must own the token)
    function checkIn(uint256 tokenId, address holder) external;

    /// @notice Batch check-in multiple tickets
    function checkInBatch(uint256[] calldata tokenIds, address[] calldata holders) external;

    // ─── Revocation (Refund) ────────────────────────────────────

    /// @notice Revoke a ticket (on refund). Burns the token.
    /// @dev Only callable by ISSUER_ROLE. Cannot revoke already-checked-in tickets.
    /// @param tokenId The token ID to revoke
    /// @param holder Address of the ticket holder
    /// @param reason Reason code (e.g., "REFUND", "EVENT_CANCELLED")
    function revokeTicket(uint256 tokenId, address holder, bytes32 reason) external;

    // ─── View Functions ─────────────────────────────────────────

    /// @notice Get on-chain ticket data
    /// @param tokenId The token ID
    /// @return Ticket data struct
    function getTicketData(uint256 tokenId) external view returns (TicketData memory);

    /// @notice Verify ticket validity (not expired, not revoked, not checked in)
    /// @param tokenId The token ID
    /// @param holder Address to check ownership for
    /// @return valid Whether the ticket is currently valid for entry
    /// @return reason If invalid, the reason code
    function verifyTicket(uint256 tokenId, address holder)
        external view returns (bool valid, string memory reason);

    /// @notice Get all token IDs for a given event
    /// @param eventId Atlas event ID
    /// @return Array of token IDs minted for this event
    function getEventTokenIds(bytes32 eventId) external view returns (uint256[] memory);
}
```

### 5.4 Token ID Scheme

Token IDs encode the event and ticket type for efficient on-chain querying:

```
Token ID (uint256):
  ┌──────────────────────┬──────────────────────┬──────────────┐
  │   eventId (96 bits)  │ ticketTypeId (96 bits)│ sequence (64)│
  └──────────────────────┴──────────────────────┴──────────────┘
```

- Bits 255-160: First 12 bytes of eventId hash
- Bits 159-64: First 12 bytes of ticketTypeId hash
- Bits 63-0: Sequential counter per (eventId, ticketTypeId) pair

This encoding allows efficient filtering: all tickets for an event share the same upper 96 bits.

### 5.5 Metadata (Off-Chain via URI)

On-chain `TicketData` stores only what is needed for verification. Rich metadata lives at the token URI, served from IPFS:

```json
{
  "name": "Bay Area Tech Mixer - General Admission",
  "description": "General Admission ticket for Bay Area Tech Mixer, April 15, 2026",
  "image": "ipfs://QmEventCoverImage.../ticket-ga.png",
  "external_url": "https://atlas-protocol.org/tickets/{tokenId}",
  "attributes": [
    { "trait_type": "Event Name", "value": "Bay Area Tech Mixer" },
    { "trait_type": "Ticket Type", "value": "General Admission" },
    { "trait_type": "Date", "value": "2026-04-15" },
    { "trait_type": "Venue", "value": "The Fillmore, San Francisco" },
    { "trait_type": "Seat", "value": "General Standing" },
    { "trait_type": "Atlas Event ID", "value": "evt_01HZ3V..." },
    { "trait_type": "Atlas Purchase ID", "value": "rcpt_01HZ3V..." }
  ],
  "atlas": {
    "event_id": "evt_01HZ3V...",
    "ticket_type_id": "tt_01HZ3V...",
    "purchase_id": "rcpt_01HZ3V...",
    "organizer_id": "org_01HZ3V...",
    "valid_from": "2026-04-15T18:00:00Z",
    "valid_until": "2026-04-15T23:59:59Z"
  }
}
```

### 5.6 Check-In: Any App Can Verify

With on-chain tickets, check-in verification no longer requires Lemonade's server:

```
BEFORE (Stage 0):
  Check-in app → Lemonade API → GET /receipts/{id}/verify → { valid: true }
  (Single point of failure: Lemonade API must be online)

AFTER (Stage 2):
  Check-in app → Base RPC → AtlasTicket.verifyTicket(tokenId, holder) → (true, "")
  (Any Base RPC node works. No Lemonade dependency.)
```

**Backwards compatibility:** Lemonade's check-in API continues to work alongside on-chain verification. Apps can use either method. The server-side endpoint internally reads from the contract for NFT tickets and from its own database for legacy VC tickets.

### 5.7 Transferability and Resale

On-chain tickets are ERC-1155 tokens. They are transferable by default, enabling:

- **Trustless resale:** Attendees can sell tickets on any NFT marketplace
- **Gifting:** Transfer tickets to another wallet
- **Delegation:** Transfer to a friend's wallet for event entry

**Organizer controls:**
- Organizers can set `transferable: false` on a ticket type, which triggers the contract's transfer hook to revert non-issuer transfers
- Organizers can set `resellable: false` with a maximum resale price cap
- These restrictions are enforced on-chain via ERC-1155 transfer hooks

### 5.8 Migration from W3C VCs to NFT Tickets

**Transition period:** Both VC and NFT tickets are accepted simultaneously.

| Ticket Type | Issuance | Verification | Check-in |
|-------------|----------|-------------|----------|
| Legacy VC | Server-signed JSON-LD | Signature + API call | API call |
| NFT Ticket | On-chain mint | On-chain `verifyTicket()` | On-chain `checkIn()` |
| Both | Server issues VC + mints NFT | Either method works | Either method works |

**Migration sequence:**
1. Deploy `AtlasTicket` contract on Base
2. New purchases mint NFT tickets in addition to issuing VCs (dual issuance)
3. Check-in apps updated to check both VC signature and on-chain ownership
4. After 6 months, new purchases mint NFT only (VCs deprecated for new tickets)
5. Legacy VC tickets remain valid until their events conclude

### 5.9 Existing Foundation

Lemonade already operates:
- `poap_contract`: POAP NFTs for event attendance (ERC-721). Pattern for event-scoped minting.
- `marketplace_contract`: NFT marketplace operations. Pattern for transfer/resale logic.
- EAS attestations (`eas_event_contract`): On-chain event attestations. Pattern for event-linked on-chain data.

The `AtlasTicket` contract combines these patterns into a purpose-built ticket NFT with check-in and revocation logic.

---

## 6. Stage 3: On-Chain Reward Ledger

### 6.1 Overview

Replace server-side reward calculation and weekly batch payouts with an on-chain reward accumulator. Rewards flow directly from the fee split contract into reward pools. Users claim directly from the contract.

### 6.2 Solidity Interface: AtlasRewardAccumulator

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IAtlasRewardAccumulator
/// @notice Manages reward balances for organizers, attendees, and referrers
/// @dev Receives USDC from AtlasFeeSplitter pool addresses
interface IAtlasRewardAccumulator {

    /// @notice Reward types
    enum RewardType {
        ORGANIZER_CASHBACK,     // 0.60% of ticket price (base rate)
        ATTENDEE_CASHBACK,      // 0.40% of ticket price (base rate)
        REFERRAL,               // Per referral program rules
        DISCOVERY_BONUS,        // 2x/1.5x for early attendees
        VOLUME_BONUS            // Boosted organizer rate at high GMV
    }

    /// @notice Emitted when a reward is credited to a user's balance
    event RewardCredited(
        address indexed recipient,
        RewardType indexed rewardType,
        uint256 amount,
        bytes32 purchaseId,
        uint256 availableAt       // Timestamp when reward becomes claimable
    );

    /// @notice Emitted when a user claims their rewards
    event RewardClaimed(
        address indexed recipient,
        uint256 amount,
        uint256 claimId
    );

    /// @notice Emitted when a reward is clawed back (refund)
    event RewardClawedBack(
        address indexed recipient,
        uint256 amount,
        bytes32 purchaseId,
        bytes32 reason
    );

    // ─── Reward Crediting (Authorized Callers Only) ──────────────

    /// @notice Credit a reward to a recipient's balance
    /// @dev Only callable by authorized reward sources (fee splitter pools)
    /// @param recipient Address to credit
    /// @param amount USDC amount to credit
    /// @param rewardType Type of reward
    /// @param purchaseId Associated purchase ID
    function creditReward(
        address recipient,
        uint256 amount,
        RewardType rewardType,
        bytes32 purchaseId
    ) external;

    // ─── Claiming ────────────────────────────────────────────────

    /// @notice Claim all available rewards
    /// @dev Transfers claimable USDC balance to msg.sender
    /// @return amount Total USDC claimed
    function claimRewards() external returns (uint256 amount);

    /// @notice Claim rewards to a specific address (for custodial wallets)
    /// @param to Destination address for the USDC transfer
    /// @return amount Total USDC claimed
    function claimRewardsTo(address to) external returns (uint256 amount);

    // ─── Clawback (Refund Oracle) ────────────────────────────────

    /// @notice Claw back rewards for a refunded purchase
    /// @dev Only callable by REFUND_ORACLE_ROLE
    /// @param recipient Address whose rewards to claw back
    /// @param purchaseId The refunded purchase ID
    /// @param reason Reason code
    function clawbackReward(
        address recipient,
        bytes32 purchaseId,
        bytes32 reason
    ) external;

    // ─── View Functions ──────────────────────────────────────────

    /// @notice Get total balance (including held)
    function totalBalance(address account) external view returns (uint256);

    /// @notice Get claimable balance (past hold period)
    function claimableBalance(address account) external view returns (uint256);

    /// @notice Get held balance (within hold period, not yet claimable)
    function heldBalance(address account) external view returns (uint256);

    /// @notice Get the hold duration in seconds
    function holdDuration() external view returns (uint256);

    /// @notice Get rewards credited for a specific purchase
    function rewardsForPurchase(bytes32 purchaseId)
        external view returns (
            address[] memory recipients,
            uint256[] memory amounts,
            RewardType[] memory types
        );

    /// @notice Check if an account has Self.xyz verification (for boosted rates)
    function isVerified(address account) external view returns (bool);
}
```

### 6.3 Hold Period Enforcement

The current system uses a server-side weekly payout batch. The on-chain version enforces a 14-day hold via contract-level timelock:

```solidity
/// @notice Hold period: 14 days from credit to claimable
uint256 public constant DEFAULT_HOLD_DURATION = 14 days;

struct RewardEntry {
    uint256 amount;
    uint256 creditedAt;      // Block timestamp when credited
    uint256 availableAt;     // creditedAt + holdDuration
    bytes32 purchaseId;      // For clawback association
    RewardType rewardType;
    bool clawedBack;         // Whether this entry was reverted
}
```

The hold period serves two purposes:
1. **Refund window:** If a ticket is refunded within 14 days, the associated reward can be clawed back
2. **Fraud prevention:** Prevents claim-and-run attacks with fraudulent purchases

### 6.4 Clawback on Refund

When a refund is processed:

```
BEFORE (Stage 0):
  Server sets reward status to "clawed_back" in MongoDB
  If already withdrawn: negative balance on next payout
  (Trust: server controls the refund/clawback logic)

AFTER (Stage 3):
  Refund Oracle (authorized server role) calls clawbackReward()
  Contract reverts the reward entry for that purchaseId
  If already claimed: negative balance tracked, deducted from future claims
  (Trust: Refund Oracle is a server role, but clawback is auditable on-chain)
```

**The Refund Oracle is a centralized component.** This is an intentional compromise: refund decisions require off-chain context (Stripe chargeback status, organizer approval, customer support interactions). The oracle is a single authorized address that can trigger clawbacks. In Stage 4 governance, the oracle can be upgraded to a multi-sig or DAO-controlled process.

### 6.5 Self.xyz Integration for Boosted Rates

The current reward system (FEE-STRUCTURE.md Section 4.2) offers volume bonuses at higher GMV tiers. The on-chain version uses Self.xyz (self-sovereign identity) verification to gate boosted rates:

```solidity
/// @notice Set verification status for an account
/// @dev Only callable by VERIFIER_ROLE (Self.xyz oracle)
function setVerified(address account, bool status) external;
```

Self.xyz verification proves KYC without revealing PII. Verified accounts receive:
- Higher cashback rates at lower volume thresholds
- Faster hold period (7 days instead of 14)
- Priority in referral matching

### 6.6 Eliminating Stripe Connect Dependency

Currently, fiat-only attendees receive rewards via Stripe Connect payouts (FEE-STRUCTURE.md Section 5.3). With on-chain rewards:

- **Crypto-native users:** Claim directly from contract to their wallet
- **Custodial users:** Lemonade's custodial wallet service claims on their behalf
- **Fiat users:** Claim to custodial wallet, off-ramp via Bridge/Coinbase

This eliminates the Stripe Connect dependency for reward distribution, reducing operational complexity and per-payout fees.

### 6.7 Existing Foundation

Lemonade's `reward_registry_contract` (referenced in `Chain` model at `lemonade-backend/src/app/models/chain.ts:168`) already implements on-chain reward claims with signature-based authorization. The `RewardSent` event (defined in `lemonade-backend/src/app/services/token-reward.ts:16-47`) tracks reward distributions.

The `AtlasRewardAccumulator` extends this with:
- USDC-denominated balances (not arbitrary ERC-20 tokens)
- Hold period enforcement (not just claim verification)
- Clawback mechanism for refunds
- Purchase-linked reward tracking

---

## 7. Stage 4: Decentralized Event Registry

### 7.1 Overview

Move event data from MongoDB to permanent, censorship-resistant storage. On-chain pointers map event hashes to content-addressed storage (IPFS/Arweave). Any node can index the pointers and serve search.

### 7.2 Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                    DECENTRALIZED EVENT LAYER                    │
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │               PERMANENT STORAGE                          │  │
│  │                                                          │  │
│  │  IPFS (Pinata)           Arweave                        │  │
│  │  ├── Event JSON-LD       ├── Event JSON-LD (permanent)  │  │
│  │  ├── Cover images        ├── Cover images               │  │
│  │  └── Ticket metadata     └── Historical snapshots       │  │
│  │                                                          │  │
│  │  CID: QmEventData123...  TxID: ar://AbCdEf...          │  │
│  └─────────────────────────────────────────────────────────┘  │
│                              │                                 │
│                              ▼                                 │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │              ON-CHAIN EVENT INDEX (Base/Tempo)           │  │
│  │                                                          │  │
│  │  eventHash → { ipfsCid, arweaveTxId, organizer,         │  │
│  │               category, location, startDate,             │  │
│  │               updatedAt, status }                        │  │
│  │                                                          │  │
│  │  Indexed fields for on-chain filtering:                  │  │
│  │  ├── categoryBloom (bloom filter for categories)         │  │
│  │  ├── locationHash (geohash prefix for proximity)         │  │
│  │  └── dateRange (startDate, endDate as uint64)            │  │
│  └─────────────────────────────────────────────────────────┘  │
│                              │                                 │
│                              ▼                                 │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │              REGISTRY OPERATORS (Indexers)               │  │
│  │                                                          │  │
│  │  Lemonade (primary)    Operator B         Operator C     │  │
│  │  ├── Full index        ├── Full index     ├── Niche index│  │
│  │  ├── AI search         ├── Geo search     ├── Music only │  │
│  │  └── MCP server        └── REST API       └── API       │  │
│  │                                                          │  │
│  │  All operators read the same on-chain pointers.          │  │
│  │  They compete on search quality, speed, and features.    │  │
│  └─────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

### 7.3 Solidity Interface: AtlasEventRegistry

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IAtlasEventRegistry
/// @notice On-chain index of Atlas Protocol events with content-addressed pointers
interface IAtlasEventRegistry {

    enum EventStatus {
        ACTIVE,         // 0: Event is published and discoverable
        CANCELLED,      // 1: Event has been cancelled
        COMPLETED,      // 2: Event has concluded
        DELISTED        // 3: Removed by governance action
    }

    struct EventPointer {
        bytes32 eventId;          // Atlas event ID
        bytes ipfsCid;            // IPFS content identifier (variable length)
        bytes32 arweaveTxId;      // Arweave transaction ID (optional, bytes32(0) if not archived)
        address organizer;        // Organizer wallet address
        uint16 categoryBitfield;  // Bitfield for category filtering (16 categories)
        bytes8 locationGeohash;   // Geohash prefix for proximity search
        uint64 startDate;         // Event start (unix timestamp)
        uint64 endDate;           // Event end (unix timestamp)
        uint64 updatedAt;         // Last update timestamp
        EventStatus status;       // Current event status
    }

    /// @notice Emitted when an event is registered or updated
    event EventRegistered(
        bytes32 indexed eventId,
        address indexed organizer,
        bytes ipfsCid,
        uint64 startDate,
        EventStatus status
    );

    /// @notice Emitted when an event status changes
    event EventStatusChanged(
        bytes32 indexed eventId,
        EventStatus oldStatus,
        EventStatus newStatus
    );

    // ─── Registration ────────────────────────────────────────────

    /// @notice Register a new event or update an existing one
    /// @dev Only callable by the event's organizer or by REGISTRAR_ROLE
    function registerEvent(
        bytes32 eventId,
        bytes calldata ipfsCid,
        bytes32 arweaveTxId,
        uint16 categoryBitfield,
        bytes8 locationGeohash,
        uint64 startDate,
        uint64 endDate
    ) external;

    /// @notice Update event status
    function setEventStatus(bytes32 eventId, EventStatus status) external;

    /// @notice Batch register events (for initial migration)
    function registerEventBatch(EventPointer[] calldata events) external;

    // ─── Query Functions ─────────────────────────────────────────

    /// @notice Get event pointer by ID
    function getEvent(bytes32 eventId) external view returns (EventPointer memory);

    /// @notice Get events by organizer
    function getEventsByOrganizer(address organizer) external view returns (bytes32[] memory);

    /// @notice Get total registered event count
    function eventCount() external view returns (uint256);

    /// @notice Check if an event exists
    function eventExists(bytes32 eventId) external view returns (bool);
}
```

### 7.4 Schema: Atlas JSON-LD on IPFS

Events stored on IPFS use the same Atlas JSON-LD schema defined in PROTOCOL-SPEC.md Section 4, with the addition of a content hash for integrity verification:

```json
{
  "@context": {
    "@vocab": "https://schema.org/",
    "atlas": "https://atlas-protocol.org/v1/vocab#"
  },
  "@type": "Event",
  "@id": "atlas:lemonade:evt_01HZ3V...",
  "name": "Bay Area Tech Mixer",
  "atlas:id": "evt_01HZ3V...",
  "atlas:content_hash": "0xsha256...",
  "atlas:registry_tx": "0xBaseTxHash...",
  "atlas:previous_version_cid": "QmPreviousCid...",
  ...
}
```

The `atlas:content_hash` is the SHA-256 hash of the canonical JSON (sorted keys, no whitespace). The on-chain `EventPointer` stores the IPFS CID; anyone can fetch the content, hash it, and verify it matches.

### 7.5 Multiple Registry Operators

With events stored on IPFS and indexed on-chain, any node can build a search engine:

1. Listen for `EventRegistered` events on Base/Tempo
2. Fetch event JSON-LD from IPFS using the CID
3. Index into local search engine (Elasticsearch, PostgreSQL, etc.)
4. Serve search API with custom ranking, filtering, UX

**Lemonade runs the primary registry operator** but the protocol works without it. If Lemonade goes offline, other operators continue serving search using the same on-chain data.

**Competition improves quality:** Operators compete on search relevance, speed, geographic coverage, and niche focus. A music-focused operator might rank by artist popularity; a corporate operator might rank by venue accessibility. The protocol does not mandate ranking -- it mandates data availability.

### 7.6 Discovery Without Lemonade

```
BEFORE (Stage 0-3):
  Agent → Lemonade Registry API → Events
  (If Lemonade is down, no discovery)

AFTER (Stage 4):
  Agent → Any Registry Operator → Events
  Agent → Direct on-chain read → EventPointers → IPFS fetch
  Agent → DNS TXT (_atlas.domain.com) → Platform manifest → Events
  (Multiple independent discovery paths)
```

### 7.7 Migration from MongoDB to On-Chain + IPFS

**Phase 1: Dual-write (3 months)**
- New events: Written to MongoDB AND published to IPFS + on-chain index
- Existing events: Batch migrated to IPFS, pointers registered on-chain
- Search: Reads from MongoDB (fast, proven)

**Phase 2: On-chain primary (3 months)**
- New events: Published to IPFS + on-chain first, then synced to MongoDB
- Search: Reads from on-chain index for existence, MongoDB for full-text
- MongoDB becomes a cache, not source of truth

**Phase 3: MongoDB optional (ongoing)**
- Registry operators maintain their own indexes
- Lemonade's MongoDB serves as Lemonade's operator index
- Other operators use their own storage

---

## 8. What Stays Centralized (and Why)

Not everything benefits from decentralization. Some components are better centralized because they require speed, involve competitive advantage, or have no trust implications.

### 8.1 Search Ranking Algorithm

**Why centralized:** Search ranking is a competitive differentiator, not a trust-critical function. Users choose registry operators based on search quality. Lemonade's ranking algorithm (incorporating AI, user behavior, and organizer quality signals) is proprietary and performance-sensitive.

**Trust mitigation:** Multiple registry operators (Stage 4) ensure no single operator controls discovery. Bias is detectable by comparing results across operators.

### 8.2 Connector Sync (OAuth, API Calls)

**Why centralized:** OAuth token management, API polling, and data synchronization are internal plumbing. They involve platform API keys, rate limiting, and error handling -- all inherently server-side concerns. There is no trust benefit to decentralizing API polling logic.

**Trust mitigation:** Synced data is published to IPFS (Stage 4), so the output is verifiable even if the process is centralized.

### 8.3 Frontend UX

**Why centralized:** Frontend applications are inherently centralized (someone hosts the HTML/JS). The protocol is designed so that anyone can build alternative frontends.

**Trust mitigation:** The protocol spec is open. SDKs are MIT-licensed. Any developer can build a competing frontend against the same on-chain contracts and IPFS data.

### 8.4 AI Agents and MCP Server

**Why centralized:** AI inference is computationally expensive and latency-sensitive. Running an LLM on-chain is not feasible. The MCP (Model Context Protocol) server is a service layer, not a trust layer.

**Trust mitigation:** Agents interact with on-chain contracts for trust-critical operations (payments, tickets, rewards). The AI layer is convenience, not custody.

### 8.5 Stripe SPT Payment Processing

**Why centralized:** Stripe is inherently centralized (fiat rails). There is no way to decentralize credit card processing. SPT payments flow through Stripe's servers, then settle as USDC via the on-chain fee splitter.

**Trust mitigation:** The fiat-to-USDC conversion is handled by Stripe (a regulated financial institution). Once converted to USDC, the on-chain fee split provides the same guarantees as native USDC payments.

---

## 9. Governance Transition

Governance evolves in lockstep with decentralization stages.

### 9.1 Stage 0-1: Lemonade Controls Contract Parameters

```
CONTRACT OWNER: Lemonade multi-sig (2-of-3)
SIGNERS: Lemonade CTO, Head of Engineering, CEO

Can do:
  - Deploy and upgrade contracts (UUPS proxy)
  - Queue fee/split ratio changes (48h timelock)
  - Pause contracts in emergency
  - Set pool addresses
  - Grant ISSUER_ROLE and CHECKIN_ROLE

Cannot do (contract-enforced):
  - Set fee > 10% (MAX_PROTOCOL_FEE_BPS)
  - Change parameters without 48h public notice (timelock)
  - Process payments while paused
  - Replay processed purchaseIds
```

### 9.2 Stage 2: Multi-Sig with Community Members

```
CONTRACT OWNER: Atlas multi-sig (3-of-5)
SIGNERS:
  - 2 Lemonade representatives
  - 1 Platform operator representative (elected by platforms)
  - 1 Community Advisory Board member
  - 1 Independent security auditor

New capabilities:
  - Contract upgrades require 3-of-5
  - Fee changes require 4-of-5 (supermajority for economic changes)
  - Emergency pause requires 2-of-5 (fast response)

Timelock extended:
  - Fee changes: 7 days (up from 48h)
  - Split ratio changes: 7 days
  - Contract upgrades: 14 days
```

### 9.3 Stage 3: $LEMON Token Governance

```
CONTRACT OWNER: AtlasGovernor (on-chain DAO)
GOVERNANCE TOKEN: $LEMON
VOTING: 1 token = 1 vote (staked tokens: 1.5x weight)

Proposal types:
  - Fee change: 10% quorum, 7-day voting, 30-day timelock
  - Split change: 10% quorum, 7-day voting, 30-day timelock
  - Contract upgrade: 20% quorum, 14-day voting, 60-day timelock
  - Emergency pause: 5% quorum, 48-hour voting, immediate execution
  - Pool address change: 15% quorum, 7-day voting, 14-day timelock

Guardian multi-sig (3-of-5) retained for:
  - Emergency pause (faster than governance vote)
  - Veto on proposals during first 12 months (training wheels)
  - Guardian role revocable by governance vote after 12 months
```

### 9.4 Stage 4: Immutable Contracts + Governance for Upgrades Only

```
CORE CONTRACTS: Immutable (no proxy, no owner)
  - AtlasFeeSplitter: Fixed logic, parameters set by governance
  - AtlasTicket: Fixed logic, roles managed by governance
  - AtlasRewardAccumulator: Fixed logic, hold duration set by governance

GOVERNANCE CONTRACTS: Upgradeable (for protocol evolution)
  - AtlasGovernor: Can be upgraded by super-governance (75% quorum)
  - AtlasEventRegistry: Upgradeable for schema evolution

IMMUTABLE GUARANTEES:
  - Fee split logic cannot be changed (only ratios via governance)
  - Ticket ownership cannot be revoked without on-chain transaction
  - Reward balances cannot be modified except by contract logic
  - No admin keys, no backdoors, no emergency override

TIMELOCK: 48h on all governance-controlled parameter changes
```

### 9.5 Governance Transition Timeline

```
Stage 0          Stage 1          Stage 2          Stage 3          Stage 4
Lemonade sole    Lemonade         Multi-sig        DAO governance    Immutable
operator         multi-sig        + community      + guardian        contracts

───────────────>───────────────>───────────────>───────────────>──────────────
    $100K GMV        $1M GMV         $5M GMV        $10M GMV
    trigger          trigger         trigger         trigger
```

---

## 10. Smart Contract Architecture

### 10.1 Contract Hierarchy

```
                    ┌─────────────────────┐
                    │   AtlasGovernor     │ (Stage 3+)
                    │   (OpenZeppelin     │
                    │    Governor)        │
                    └─────────┬───────────┘
                              │ owns
              ┌───────────────┼───────────────────┐
              │               │                   │
              ▼               ▼                   ▼
    ┌─────────────────┐ ┌──────────────┐ ┌────────────────────┐
    │ AtlasFeeSplitter│ │ AtlasTicket  │ │AtlasRewardAccumulator│
    │ (UUPS Proxy)    │ │ (UUPS Proxy) │ │ (UUPS Proxy)        │
    │                 │ │              │ │                      │
    │ Stage 1         │ │ Stage 2      │ │ Stage 3              │
    └────────┬────────┘ └──────────────┘ └───────────┬──────────┘
             │                                       │
             │          USDC flow                    │
             ├──────────────────────────────────────→│
             │  (pool addresses point to             │
             │   RewardAccumulator)                  │
             │                                       │
             ▼                                       ▼
    ┌─────────────────┐                   ┌────────────────────┐
    │ AtlasEventRegistry│                 │  Refund Oracle     │
    │ (UUPS Proxy)    │                   │  (authorized server│
    │                 │                   │   address)         │
    │ Stage 4         │                   │  Stage 3           │
    └─────────────────┘                   └────────────────────┘
```

### 10.2 Upgrade Pattern

**Stages 1-3: UUPS Transparent Proxy**

All contracts deploy behind OpenZeppelin UUPS proxies. This allows:
- Logic upgrades without changing the contract address
- State migration between versions
- Bug fixes without redeployment

The upgrade authority follows the governance transition (Section 9):
- Stage 1: Lemonade multi-sig
- Stage 2: Community multi-sig (3-of-5)
- Stage 3: DAO governance vote with timelock

**Stage 4: Immutable Deployment**

Once the contracts are battle-tested and governance is mature:
1. Deploy final logic contracts without proxy (plain `CREATE2` deployment)
2. Migrate state from proxy contracts to immutable contracts
3. Self-destruct the proxy admin (irreversible)
4. Only parameter changes (fee %, split ratios) are possible via governance

### 10.3 Audit Requirements

| Stage | Contracts | Audit Scope | Auditors Required | Estimated Cost |
|-------|-----------|-------------|-------------------|----------------|
| Stage 1 | AtlasFeeSplitter | Payment splitting, timelock, replay protection | 1 (minimum) | $30K-50K |
| Stage 2 | AtlasTicket | Minting, check-in, transfer hooks, revocation | 1 (minimum) | $40K-60K |
| Stage 3 | AtlasRewardAccumulator | Balance accounting, hold period, clawback | 2 (independent) | $80K-120K |
| Stage 4 | AtlasEventRegistry + immutable migration | Registry, governance, state migration | 2 (independent) | $100K-150K |

**Audit firms (recommended):** Trail of Bits, OpenZeppelin, Consensys Diligence, Spearbit.

**Bug bounty program:** Launched at Stage 1 deployment. Immunefi-hosted.
- Critical (fund loss): Up to $100K
- High (fund freeze): Up to $25K
- Medium (logic error): Up to $5K

### 10.4 Gas Cost Summary (Base Mainnet)

| Contract | Operation | Gas | Cost @ 0.01 gwei | Cost @ 1 gwei |
|----------|-----------|-----|-------------------|----------------|
| FeeSplitter | processPayment | ~180K | <$0.001 | ~$0.006 |
| FeeSplitter | processPaymentBatch(10) | ~900K | ~$0.001 | ~$0.03 |
| Ticket | mintTickets(1) | ~150K | <$0.001 | ~$0.005 |
| Ticket | mintTickets(10) | ~400K | <$0.001 | ~$0.013 |
| Ticket | checkIn | ~50K | <$0.001 | ~$0.002 |
| Ticket | verifyTicket (view) | 0 | Free | Free |
| Reward | creditReward | ~80K | <$0.001 | ~$0.003 |
| Reward | claimRewards | ~100K | <$0.001 | ~$0.003 |
| Registry | registerEvent | ~200K | <$0.001 | ~$0.007 |
| Registry | registerEventBatch(100) | ~8M | ~$0.008 | ~$0.26 |

**Total per-ticket on-chain cost (Stages 1-3):** ~410K gas = ~$0.003 at typical Base prices. Well under the $0.001 Tempo gas budget.

### 10.5 Emergency Pause Mechanism

All contracts implement OpenZeppelin `Pausable`:

```solidity
/// @notice Emergency pause — halts all state-changing operations
/// @dev Callable by PAUSER_ROLE (multi-sig, 2-of-3 for fast response)
function pause() external onlyRole(PAUSER_ROLE);

/// @notice Resume operations
/// @dev Callable by owner (higher threshold than pause)
function unpause() external onlyOwner;
```

**Pause authority:**
- Stage 1: Lemonade multi-sig (2-of-3)
- Stage 2: Any 2 of the 5 multi-sig members
- Stage 3: Guardian multi-sig OR governance emergency vote (5% quorum, 48h)

**What pause does:**
- `processPayment`: Reverts (payments cannot be processed)
- `mintTickets`: Reverts (no new tickets issued)
- `creditReward`: Reverts (no new rewards)
- `claimRewards`: **NOT paused** (users can always withdraw)
- `verifyTicket`: **NOT paused** (verification always works)
- `checkIn`: **NOT paused** (events in progress must continue)

Critical design decision: claim and verify operations are never pausable. Users must always be able to access their assets and prove their tickets.

---

## 11. Migration Strategy Per Stage

### 11.1 Stage 0 to Stage 1 (Fee Split)

| Aspect | Details |
|--------|---------|
| **What changes** | 402 challenge `recipient_address` points to contract instead of organizer wallet. Server reads `PaymentSplit` events for confirmation. |
| **Backwards compatible** | Yes. Agent API unchanged. Only the payment destination address changes (agents treat this as opaque). |
| **What could break** | Agents that hardcode organizer addresses (violates protocol -- `recipient_address` is per-challenge). Wallets that cannot send to contracts. |
| **Rollback plan** | Feature flag in backend: `USE_FEE_SPLITTER_CONTRACT=false` routes payments back to organizer wallets with server-side fee calculation. |
| **Data migration** | None. New payments go through contract. Existing payments and their fee calculations remain in MongoDB. |
| **Monitoring** | Compare server-calculated fees vs contract-calculated fees for first 1000 transactions. Alert on any discrepancy. |

### 11.2 Stage 1 to Stage 2 (Tickets)

| Aspect | Details |
|--------|---------|
| **What changes** | Purchase response includes `nft_ticket` field alongside existing VC `tickets` array. New `atlas:ticket_contract` and `atlas:token_id` fields in receipt. |
| **Backwards compatible** | Yes. Existing VC tickets continue to work. NFT tickets are additive. |
| **What could break** | Check-in apps that only verify VCs need update for NFT verification. Attendees without wallets cannot receive NFT tickets (custodial wallet auto-created). |
| **Rollback plan** | Disable NFT minting. VC tickets continue as sole ticket type. Already-minted NFTs remain valid on-chain. |
| **Data migration** | Historical tickets are NOT migrated to NFTs. Only new purchases get NFT tickets. |
| **Monitoring** | Track NFT mint success rate. Alert if mint failures >1%. Compare VC issuance count vs NFT mint count. |

### 11.3 Stage 2 to Stage 3 (Rewards)

| Aspect | Details |
|--------|---------|
| **What changes** | Fee splitter pool addresses point to `AtlasRewardAccumulator` contract. Users claim rewards directly instead of receiving weekly payouts. |
| **Backwards compatible** | Partially. Users must interact with the contract (or use Lemonade's claim UI) instead of receiving automatic payouts. |
| **What could break** | Users expecting automatic weekly payouts. Reward calculation for volume bonuses (requires oracle for GMV tier computation). |
| **Rollback plan** | Redirect pool addresses back to Lemonade-controlled wallets. Resume server-side payout batching. Unclaimed on-chain rewards remain claimable. |
| **Data migration** | Existing reward balances in MongoDB are credited to on-chain balances via `creditReward()` batch call. Users notified to claim. |
| **Monitoring** | Track claim success rate. Monitor gas costs per claim. Alert if reward pool USDC balance diverges from expected (sum of unclaimed credits). |

### 11.4 Stage 3 to Stage 4 (Registry)

| Aspect | Details |
|--------|---------|
| **What changes** | Events published to IPFS with on-chain pointers. Multiple registry operators can serve search. MongoDB becomes a cache. |
| **Backwards compatible** | Yes for search consumers (same REST/GraphQL API, backed by IPFS data). Breaking for direct MongoDB consumers (internal only). |
| **What could break** | Search latency (IPFS fetch adds latency vs MongoDB read). Event update propagation (IPFS is eventually consistent). |
| **Rollback plan** | Continue using MongoDB as primary. On-chain pointers remain as a parallel data source. No destructive migration. |
| **Data migration** | All active events published to IPFS. On-chain pointers registered. MongoDB retained as warm cache. ~500K events at $10M GMV: ~$260 in gas for batch registration. |
| **Monitoring** | Track IPFS pin availability. Monitor on-chain vs MongoDB consistency. Alert on events present in MongoDB but missing from on-chain index. |

---

## 12. Timeline and Triggers

### 12.1 Stage Triggers

Each stage is triggered by adoption milestones, not calendar dates. This aligns with the tokenomics phase triggers (TOKENOMICS.md) and governance transitions (GOVERNANCE-CHARTER.md).

| Stage | Trigger | Rationale |
|-------|---------|-----------|
| **Stage 1: Fee Split** | $100K monthly GMV (sustained 3 months) | Same trigger as LMC token (TOKENOMICS.md Phase 1). At this volume, the protocol fee is $2K/month -- enough to justify smart contract development and audit costs. Organizers and platforms have economic incentive to verify fee splits. |
| **Stage 2: Tickets** | Stage 1 stable for 3 months | Fee split contract must be battle-tested before adding more on-chain complexity. No GMV trigger -- stability is the gate. |
| **Stage 3: Rewards** | $1M monthly GMV (sustained 3 months) | Same trigger as $LEMON governance token (TOKENOMICS.md Phase 2). At this volume, monthly rewards total $12K -- material enough that users will actively verify on-chain balances. |
| **Stage 4: Registry** | 50+ registry operators OR $10M monthly GMV | Decentralized registry only makes sense when there are enough operators to run independent indexes. Alternatively, at $10M GMV, the protocol is critical infrastructure that must survive Lemonade's failure. |

### 12.2 Estimated Timeline (Optimistic / Realistic / Pessimistic)

```
                    2026              2027              2028              2029
                Q2  Q3  Q4     Q1  Q2  Q3  Q4     Q1  Q2  Q3  Q4     Q1  Q2

Stage 0         ████████████
(current)       Centralized

Stage 1              ○──████████
(Fee Split)          |  Optimistic
                     ○──────████████
                     |      Realistic
                     ○──────────████████
                                Pessimistic

Stage 2                   ○──████████
(Tickets)                 |  Optimistic
                          ○──────████████
                          |      Realistic
                          ○──────────────████████
                                         Pessimistic

Stage 3                             ○──████████
(Rewards)                           |  Optimistic
                                    ○──────████████
                                    |      Realistic
                                    ○──────────────████████
                                                   Pessimistic

Stage 4                                       ○──████████
(Registry)                                    |  Optimistic
                                              ○──────████████████
                                              |      Realistic
                                              ○──────────────████████████
                                                             Pessimistic
```

### 12.3 Prerequisites Per Stage

**Stage 1 Prerequisites:**
- [ ] AtlasFeeSplitter contract written and tested (Foundry/Hardhat)
- [ ] Security audit completed (1 auditor)
- [ ] Base mainnet USDC integration tested
- [ ] Backend feature flag for contract routing
- [ ] Monitoring and alerting for on-chain events
- [ ] Bug bounty program launched

**Stage 2 Prerequisites:**
- [ ] Stage 1 operational for 3+ months with zero critical incidents
- [ ] AtlasTicket contract written and tested
- [ ] Security audit completed (1 auditor)
- [ ] Custodial wallet service for non-crypto attendees
- [ ] Check-in app updated for dual verification (VC + NFT)
- [ ] Organizer dashboard shows NFT ticket status

**Stage 3 Prerequisites:**
- [ ] AtlasRewardAccumulator contract written and tested
- [ ] Security audit completed (2 independent auditors)
- [ ] Refund Oracle designed and implemented
- [ ] Self.xyz on-chain verification integration
- [ ] Claim UI in organizer and attendee dashboards
- [ ] Volume bonus oracle for GMV tier computation
- [ ] $LEMON governance token launched (TOKENOMICS.md Phase 2)

**Stage 4 Prerequisites:**
- [ ] AtlasEventRegistry contract written and tested
- [ ] Security audit completed (2 independent auditors)
- [ ] IPFS pinning infrastructure (Pinata + self-hosted)
- [ ] Arweave archival pipeline
- [ ] At least 5 independent registry operators committed
- [ ] Atlas Foundation formed (GOVERNANCE-CHARTER.md Phase 3)
- [ ] Immutable contract migration plan validated

### 12.4 What If Triggers Are Never Met?

The protocol works at every stage. If GMV never reaches $100K, Atlas runs as a centralized protocol with on-chain payment verifiability. If it reaches $100K but not $1M, it runs with on-chain fee splits and NFT tickets but server-side rewards. There is no obligation to advance. Each stage is independently valuable.

The worst outcome is not "stuck at Stage 0." The worst outcome is premature decentralization: deploying complex smart contracts before there is enough volume to justify the audit costs, enough users to stress-test the contracts, or enough operators to run the decentralized registry. Progressive decentralization means waiting for the right moment, not rushing to meet a deadline.

---

## Appendix A: Contract Deployment Addresses (To Be Populated)

| Contract | Chain | Address | Deployment Date | Audit Report |
|----------|-------|---------|-----------------|--------------|
| AtlasFeeSplitter | Base | TBD | TBD | TBD |
| AtlasFeeSplitter | Tempo | TBD | TBD | TBD |
| AtlasTicket | Base | TBD | TBD | TBD |
| AtlasRewardAccumulator | Base | TBD | TBD | TBD |
| AtlasEventRegistry | Base | TBD | TBD | TBD |

## Appendix B: References

- [Atlas Protocol Specification v1.0](./PROTOCOL-SPEC.md)
- [Atlas Schema Reference](./SCHEMAS.md)
- [Atlas Fee Structure](../07-economics/FEE-STRUCTURE.md)
- [Atlas Tokenomics](../07-economics/TOKENOMICS.md)
- [Atlas Governance Charter](../09-governance/GOVERNANCE-CHARTER.md)
- [Atlas Roadmap](../09-governance/ROADMAP.md)
- [OpenZeppelin UUPS Proxy](https://docs.openzeppelin.com/contracts/5.x/api/proxy#UUPSUpgradeable)
- [ERC-1155 Multi Token Standard](https://eips.ethereum.org/EIPS/eip-1155)
- [Lemonade Backend Chain Model](../../lemonade-backend/src/app/models/chain.ts) -- existing contract address registry
- [Lemonade Backend Payment Accounts](../../lemonade-backend/src/app/models/new-payment-account.ts) -- existing payment splitter reference
- [Lemonade Backend Reward Registry](../../lemonade-backend/src/app/services/token-reward.ts) -- existing on-chain reward claims
