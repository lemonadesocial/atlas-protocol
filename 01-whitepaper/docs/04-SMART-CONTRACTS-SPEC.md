# ATLAS Smart Contract Specification

**Version 0.1 | April 2026**

**Authors:** Lemonade

---

## 1. Overview

Five Solidity contracts form the ATLAS on-chain layer. Each contract is deployed independently to every supported EVM chain (Base, MegaETH, World Chain, Arbitrum, Ethereum L1). All contracts share a common infrastructure pattern: UUPS proxy upgradeability (EIP-1967), OpenZeppelin AccessControl, ReentrancyGuard, and Pausable.

Contracts activate across four progressive decentralization stages. Stage 1 deploys FeeRouter. Stage 2 adds AtlasTicket. Stage 3 adds RewardLedger. Stage 4 adds RegistryPointer. PromotionSettlement activates via governance transaction at $500K monthly GMV.

---

## 2. Common Patterns

### 2.1 Proxy and Upgrade Model

All contracts use the UUPS (Universal Upgradeable Proxy Standard) pattern. The proxy delegates calls to an implementation contract. Only addresses with the `UPGRADER` role can call `upgradeTo(address newImplementation)`. The proxy stores the implementation address in the EIP-1967 slot (`0x360894...`), preventing storage collisions.

### 2.2 Access Control Roles

Four roles govern contract operations across all five contracts:

| Role | Permissions |
|------|------------|
| `ADMIN` | Grant and revoke roles. Update contract parameters. |
| `PUBLISHER` | Write event pointers (RegistryPointer only). |
| `UPGRADER` | Deploy new implementation contracts via UUPS proxy. |
| `PAUSER` | Invoke `pause()` and `unpause()` on any contract. |

Role assignment follows OpenZeppelin's `AccessControl` model. `ADMIN` is the default admin role for all other roles.

### 2.3 Emergency Pause

Every contract inherits `Pausable`. Calling `pause()` halts all state-modifying functions. Read functions remain operational. The `PAUSER` role can trigger a pause if a vulnerability is discovered or if bridge health degrades on a given chain.

```solidity
function pause() external onlyRole(PAUSER);
function unpause() external onlyRole(PAUSER);
```

### 2.4 Reentrancy Protection

All state-modifying functions that interact with external contracts (USDC transfers, identity verifier calls) use OpenZeppelin's `ReentrancyGuard`. The checks-effects-interactions pattern is enforced throughout.

### 2.5 Upgrade Authority by Stage

Upgrade authority over all contracts transitions as the protocol decentralizes:

| Stage | Authority | Description |
|-------|-----------|-------------|
| Stage 1 | Lemonade multi-sig | Lemonade controls the `UPGRADER` role. Contract behavior is publicly verifiable, but upgrades are unilateral. |
| Stage 2 | Advisory board | An advisory board reviews all contract upgrades before execution. |
| Stage 3 | 3-of-5 multi-sig | Signers include Lemonade, organizer representatives, and platform representatives. No single entity controls upgrades. |
| Stage 4 | DAO governance | $ATLAS token holders vote on upgrades. Lemonade participates as one voter among many. |

---

## 3. FeeRouter.sol

**Purpose.** Receives stablecoin for ticket purchases and splits it per protocol rules across the protocol treasury, a stacked array of platform fee recipients, and the organizer. Deployed at Stage 1. Phase 5 introduces FeeRouter v2: a 0.5% protocol fee (down from 2%) and a stacked `FeeSplit` array. See [03-SETTLEMENT-SPEC §6.5](./03-SETTLEMENT-SPEC.md#65-stacked-platform-fees-feesplit).

### 3.1 State Variables

```solidity
IERC20 public stablecoin;            // chain-canonical stablecoin (USDC on Base/OP/Arb/Polygon/Tempo, USDM on MegaETH)
address public treasury;             // ATLAS protocol treasury
uint16 public constant PROTOCOL_FEE_BPS    = 50;   // 0.5% (Phase 5; was 200/2% in Phase 4)
uint16 public constant MAX_TOTAL_PLATFORM_FEES_BPS = 2000; // 20% — sum of all FeeSplit entries
uint16 public constant MIN_ORGANIZER_BPS          = 7000; // 70% — organizer floor

struct FeeSplit {
    address recipient;
    uint16  amountBps;       // basis points of ticket price
    bool    retainOnRefund;  // if true, NOT reversed on reverseSettle
}

// holdId -> settlement record (used by reverseSettle)
mapping(bytes32 => SettlementRecord) public settled;
```

The protocol fee (0.5%) is fixed and **always retained** on refund. Platform fees are stacked: each entry routes to its own recipient. Phase 4's reward-pool subdivision (30/20/10/25/15) is no longer split inside FeeRouter — reward accruals are computed in `RewardLedger` against the protocol fee.

### 3.2 Functions

```solidity
function settle(
    bytes32 holdId,
    uint256 ticketPrice,
    address organizer,
    address referrer,
    FeeSplit[] calldata platformFees
) external nonReentrant whenNotPaused;
```

Calculates the 0.5% protocol fee from `ticketPrice`. Iterates over `platformFees`, transferring each recipient their `amountBps` share. Transfers the remainder to `organizer`. Reverts if the sum of platform-fee BPS exceeds `MAX_TOTAL_PLATFORM_FEES_BPS` or if the organizer's share falls below `MIN_ORGANIZER_BPS`. Persists a `SettlementRecord` keyed by `holdId` for use by `reverseSettle`.

```solidity
function reverseSettle(bytes32 holdId) external nonReentrant whenNotPaused;
```

Reverses an executed settlement. Pulls the previously-settled record. Returns the organizer's share to the buyer. For each `FeeSplit` entry, returns the recipient's share to the buyer **unless** `retainOnRefund == true`. The 0.5% protocol fee is **never** returned. Marks the record `reversed`. Reverts if `holdId` is unknown or already reversed. See refund policy in [03-SETTLEMENT-SPEC §6.6](./03-SETTLEMENT-SPEC.md#66-refund-flow-reversesettle) and reward reversal in [09-FEE-ECONOMICS-SPEC §6](./09-FEE-ECONOMICS-SPEC.md).

```solidity
function pause() external onlyRole(PAUSER);
function unpause() external onlyRole(PAUSER);
```

### 3.3 Events

```solidity
event SettlementExecuted(
    bytes32 indexed holdId,
    address indexed organizer,
    address indexed referrer,
    uint256 ticketPrice,
    uint256 protocolFee,
    uint256 platformFeesTotal,
    uint256 organizerNet
);

event SettlementReversed(
    bytes32 indexed holdId,
    uint256 buyerRefund,
    uint256 retainedTotal
);

event FeeSplitForwarded(
    bytes32 indexed holdId,
    address indexed recipient,
    uint16  amountBps,
    uint256 amount
);
```

---

## 4. AtlasTicket.sol (ERC-721)

**Purpose.** Mints non-fungible tokens representing event tickets. The token is the ticket. Deployed at Stage 2. Phase 5 introduces AtlasTicket v2: multi-chain deployable (the NFT chain may differ from the settlement chain), `MINTER_ROLE` and `BURNER_ROLE` held by the ATLAS protocol multisig, gas-subsidized minting, and a custodial-wallet pattern for email-only buyers.

### 4.1 State Variables

```solidity
struct ResaleRules {
    bool transferable;
    uint16 maxMarkupBps;   // e.g., 15000 = 150% of face value
    uint16 royaltyBps;     // e.g., 500 = 5% royalty to organizer
}

mapping(uint256 => ResaleRules) public resaleRules;
mapping(uint256 => bytes32) public tokenEventUrnHash;   // keccak256(canonical event URN)
mapping(uint256 => bytes32) public tokenTicketType;
uint256 private _nextTokenId;

bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
```

The `MINTER_ROLE` and `BURNER_ROLE` are held by the ATLAS protocol multisig. Platforms call ATLAS-managed mint/burn endpoints rather than holding mint authority directly; this lets the protocol enforce listing validity, fee compliance, and resale rules uniformly across all platforms. The ATLAS treasury subsidizes mint gas in v2 via meta-transaction relayer (see Section 4.5).

### 4.2 Functions

```solidity
function mintTicket(
    bytes32 eventUrnHash,
    bytes32 ticketType,
    address holder,
    string calldata metadataURI
) external onlyRole(MINTER_ROLE) nonReentrant whenNotPaused returns (uint256 tokenId);
```

Mints a new ERC-721 token to `holder`. Stores `eventUrnHash = keccak256(canonical_event_urn)` and `ticketType` in contract state. Sets `tokenURI` to `metadataURI`, which points to an IPFS CID containing the full event listing as JSON-LD. Returns the minted `tokenId`. The `holder` may be a buyer's self-custodied wallet OR a custodial wallet provisioned by the protocol for email-only buyers (see Section 4.5).

```solidity
function setResaleRules(
    uint256 tokenId,
    bool transferable,
    uint16 maxMarkupBps,
    uint16 royaltyBps
) external onlyRole(ADMIN);
```

Configures transfer and resale constraints for a specific token. Organizers set these rules at event creation. The `transferable` flag controls whether the token can change owners. `maxMarkupBps` caps the resale price as a percentage of face value. `royaltyBps` defines the organizer's cut on secondary sales.

```solidity
function burnTicket(uint256 tokenId) external onlyRole(BURNER_ROLE) nonReentrant whenNotPaused;
```

Burns a ticket. Called by the ATLAS protocol on `reverseSettle` (refund) or in response to a verified loss/replacement claim. The `BURNER_ROLE` is held by the ATLAS protocol multisig.

```solidity
function _beforeTokenTransfer(
    address from,
    address to,
    uint256 tokenId,
    uint256 batchSize
) internal override;
```

Enforces resale rules on every transfer. Reverts if `transferable` is false (except for minting, where `from == address(0)`). Resale price enforcement and royalty collection occur in a companion marketplace contract or at the application layer; the ticket contract enforces the transferability gate.

### 4.3 Events

```solidity
event TicketMinted(
    uint256 indexed tokenId,
    bytes32 indexed eventUrnHash,
    bytes32 ticketType,
    address indexed holder,
    string metadataURI
);

event TicketBurned(
    uint256 indexed tokenId,
    bytes32 indexed eventUrnHash,
    address indexed lastHolder,
    bytes32 reason  // "refund", "lost_replaced", "moderation"
);

event ResaleRulesSet(
    uint256 indexed tokenId,
    bool transferable,
    uint16 maxMarkupBps,
    uint16 royaltyBps
);
```

### 4.4 Verification

Any application can call `ownerOf(tokenId)` to verify ticket ownership. The `tokenURI(tokenId)` function returns the IPFS CID, making event details accessible even if the ATLAS registry is offline.

### 4.5 Custodial-Wallet Pattern for Email-Only Buyers

Many event buyers do not hold a self-custodied wallet at purchase time. Phase 5 supports a custodial-wallet pattern where the protocol provisions a deterministic, claimable wallet keyed on the buyer's verified email or phone:

- At purchase, ATLAS-managed mint endpoints derive a custodial address from `(buyer_email_hash, salt)` and mint to that address.
- The buyer can later claim self-custody by completing an email-verified key handoff: the protocol signs a transfer of the underlying tokens to a wallet the buyer chooses.
- Until claimed, the custodial wallet is operated by the ATLAS protocol multisig and is subject to the same `MINTER_ROLE`/`BURNER_ROLE` constraints as any other holder.

The ATLAS treasury subsidizes mint and claim gas via meta-transaction relayer (EIP-712 signed by the protocol). This keeps the email-only checkout flow gasless from the buyer's perspective and is funded out of the 0.5% protocol fee.

---

## 5. RewardLedger.sol

**Purpose.** Tracks reward accrual, enforces a 14-day timelock, and pays out claims directly. Deployed at Stage 3.

**Canonical chain.** RewardLedger v1 is deployed on **Base** with **USDC** as the reward currency. Even when settlement happens on Optimism, Polygon, MegaETH, etc., the reward portion of the protocol fee is bridged to Base and accrued in the canonical RewardLedger. Multi-chain reward accrual lands in Phase 7+ (see [10-PROGRESSIVE-DECENTRALIZATION](./10-PROGRESSIVE-DECENTRALIZATION.md)). This bounds the timelock-claim UX to a single chain in v1.

### 5.1 State Variables

```solidity
struct Accrual {
    bytes32 holdId;           // settlement that produced this accrual
    uint256 amount;
    uint256 unlockTimestamp;  // block.timestamp + 14 days
    bool claimed;
    bool reversed;            // set true by reverseRewards
}

mapping(address => Accrual[]) public accruals;
mapping(address => uint256) public totalAccrued;
mapping(address => uint256) public totalClaimed;
mapping(address => int256)  public clawbackBalance; // negative = owes; reduces next claim

IERC20 public usdc;
address public identityVerifier;     // external verifier contract address
uint16 public identityBoostBps;      // default: 15000 (1.5x multiplier)
uint256 public constant TIMELOCK_DURATION = 14 days;
```

### 5.2 Functions

```solidity
function accrue(
    address participant,
    uint256 amount
) external onlyRole(ADMIN) nonReentrant whenNotPaused;
```

Called by FeeRouter after processing a sale. Creates an `Accrual` record with `unlockTimestamp = block.timestamp + 14 days`. Checks for identity boost before recording the final amount.

```solidity
function claim() external nonReentrant whenNotPaused;
```

Iterates over the caller's accruals. Transfers all USDC where `unlockTimestamp <= block.timestamp` and `claimed == false`. Marks those accruals as claimed. Reverts if no claimable balance exists.

```solidity
function claimFor(
    address participant
) external nonReentrant whenNotPaused;
```

Relay function. A third-party relay service calls this to trigger claims on behalf of users who prefer automatic payouts. The USDC transfers to `participant`, not to `msg.sender`. The relay has no discretion over amounts or destinations.

```solidity
function checkIdentityBoost(
    address participant
) public view returns (bool verified, uint16 multiplierBps);
```

Calls the external `identityVerifier` contract to check for a valid on-chain attestation. Supported providers: World ID, Self.xyz, Civic, Polygon ID. Returns `verified = true` and `multiplierBps = 15000` (1.5x) if an attestation exists. Returns `verified = false` and `multiplierBps = 10000` (1.0x) if not. The multiplier is governance-adjustable via the `ADMIN` role.

```solidity
function setIdentityVerifier(address _verifier) external onlyRole(ADMIN);
function setIdentityBoostBps(uint16 _boostBps) external onlyRole(ADMIN);
```

```solidity
function reverseRewards(bytes32 holdId) external onlyRole(ADMIN) nonReentrant whenNotPaused;
```

Reverses any reward accruals tied to a refunded sale. Called by the protocol on `FeeRouter.reverseSettle`. Behavior:

- Accruals where `claimed == false` and `holdId` matches are marked `reversed`. The amount is removed from `totalAccrued` and the corresponding USDC is returned to the protocol treasury.
- Accruals where `claimed == true` and `holdId` matches add a debit entry to `clawbackBalance[participant]`. The next call to `claim()` or `claimFor()` deducts the debit before paying out.
- Reversal of an already-reversed accrual is a no-op.

See refund policy in [03-SETTLEMENT-SPEC §6.6](./03-SETTLEMENT-SPEC.md#66-refund-flow-reversesettle).

### 5.3 Events

```solidity
event RewardAccrued(
    address indexed participant,
    uint256 amount,
    uint256 unlockTimestamp,
    bool identityBoosted
);

event RewardClaimed(
    address indexed participant,
    uint256 amount,
    uint256 timestamp
);

event RewardsReversed(
    bytes32 indexed holdId,
    address indexed participant,
    uint256 amountUnclaimed,    // returned directly to treasury
    uint256 amountClawback      // added to clawback debit
);
```

---

## 6. RegistryPointer.sol

**Purpose.** Maps ATLAS event identifiers to IPFS content identifiers (CIDs) on-chain. Deployed at Stage 4. Provides censorship-resistant event resolution when the centralized registry is unavailable.

### 6.1 State Variables

```solidity
mapping(bytes32 => bytes) public pointers;  // eventId => IPFS CID
```

### 6.2 Functions

```solidity
function setPointer(
    bytes32 eventId,
    bytes calldata cid
) external onlyRole(PUBLISHER) whenNotPaused;
```

Stores or updates the mapping from `eventId` to `cid`. Emits a `PointerUpdated` event. Authorized publishers (initially Lemonade, later multi-sig/DAO controlled) hold the `PUBLISHER` role.

```solidity
function getPointer(
    bytes32 eventId
) external view returns (bytes memory);
```

Returns the current IPFS CID for the given `eventId`. Returns empty bytes if no pointer exists.

### 6.3 Events

```solidity
event PointerUpdated(
    bytes32 indexed eventId,
    bytes cid
);
```

### 6.4 Version History

The contract does not store previous CIDs in state. Version history is derived from `PointerUpdated` event logs. Each call to `setPointer` emits a new event. Indexers reconstruct the full history of CID changes for any `eventId` by scanning these logs. The old CID remains valid and accessible on IPFS; only the on-chain pointer advances.

---

## 7. PromotionSettlement.sol

**Purpose.** Settles ad-network promotion bids when promoted ticket sales occur. Deployed at launch but disabled. Activated via governance transaction when ATLAS reaches $500K monthly GMV.

### 7.1 State Variables

```solidity
struct Campaign {
    uint256 totalBudget;
    uint256 spent;
    uint256 remaining;
    bool active;
}

mapping(bytes32 => Campaign) public campaigns;
IERC20 public usdc;
address public treasury;
bool public enabled;

uint16 public constant AGENT_SHARE_BPS = 6000;    // 60%
uint16 public constant TREASURY_SHARE_BPS = 3000;  // 30%
uint16 public constant NODE_SHARE_BPS = 1000;       // 10%
```

### 7.2 Functions

```solidity
function settlePromotion(
    bytes32 campaignId,
    address referringAgent,
    address registryNode,
    uint256 bidAmount
) external nonReentrant whenNotPaused;
```

Reverts if `enabled == false`. Reverts if `campaigns[campaignId].remaining < bidAmount`. Splits `bidAmount`: 60% to `referringAgent`, 30% to `treasury`, 10% to `registryNode`. Decrements `campaigns[campaignId].remaining`. Increments `campaigns[campaignId].spent`. Sets `active = false` when `remaining` reaches zero.

```solidity
function createCampaign(
    bytes32 campaignId,
    uint256 totalBudget
) external onlyRole(ADMIN) whenNotPaused;
```

Registers a new campaign. Transfers `totalBudget` in USDC from the caller to the contract. Sets `remaining = totalBudget` and `active = true`.

```solidity
function enableSettlement() external onlyRole(ADMIN);
function disableSettlement() external onlyRole(ADMIN);
```

Governance-controlled activation. `enableSettlement` sets `enabled = true`. Called once the protocol reaches $500K monthly GMV.

### 7.3 Events

```solidity
event PromotionSettled(
    bytes32 indexed campaignId,
    address indexed referringAgent,
    address indexed registryNode,
    uint256 bidAmount,
    uint256 agentShare,
    uint256 treasuryShare,
    uint256 nodeShare
);

event CampaignCreated(
    bytes32 indexed campaignId,
    uint256 totalBudget
);

event CampaignExhausted(
    bytes32 indexed campaignId
);
```

---

## 8. Audit and Deployment

### 8.1 Security Audit

An independent security firm audits all five contracts before Stage 1 deployment. The audit covers reentrancy vectors, access control correctness, proxy upgrade safety, integer overflow/underflow (Solidity 0.8+ built-in checks), and USDC transfer edge cases (return value handling). Audit reports are published publicly.

### 8.2 Parallel Operation

Each stage runs a 90-day parallel operation period. The new on-chain component runs alongside the existing centralized component. Both produce results. Discrepancies trigger investigation and resolution before proceeding.

### 8.3 Gradual Migration

Traffic shifts incrementally across four thresholds: 10%, 25%, 50%, 100%. At each threshold, monitoring covers gas costs, transaction success rates, settlement latency, and user experience. The system holds at each threshold for a minimum observation window before advancing.

### 8.4 Rollback Procedure

If a critical bug is discovered during migration, traffic reverts to the centralized system. The on-chain contracts are paused via the `PAUSER` role. The development team patches and re-audits the contracts. Migration restarts from the 10% threshold after the fix is deployed.

### 8.5 Deployment Tooling

Contracts are compiled and deployed using Hardhat or Foundry. Deployment scripts configure constructor parameters (USDC token address, treasury address, initial role assignments) per chain. After deployment, contracts are verified on each chain's block explorer (Etherscan, Basescan, Arbiscan, and chain-specific explorers).

### 8.6 Adding a New Chain

Deploying to a new chain requires four steps. First, deploy the five contracts with the same Solidity source and constructor parameters. Second, verify on the chain's block explorer. Third, register the chain in the ATLAS registry (chain ID, contract addresses, USDC token address, RPC endpoints). Fourth, update the CLI and SDK to include the new chain option. No protocol or schema changes are needed.

---

*For the progressive decentralization roadmap, see WHITEPAPER-CHAIN-AGNOSTIC.md Section 15. For the full architecture, see ARCHITECTURE.md Section 8. For fee economics, see FEE-STRUCTURE.md.*
