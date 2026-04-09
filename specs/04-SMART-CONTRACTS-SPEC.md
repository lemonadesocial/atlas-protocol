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

**Purpose.** Receives USDC for ticket purchases and splits it per protocol rules. Deployed at Stage 1.

### 3.1 State Variables

```solidity
IERC20 public usdc;
address public treasury;
uint16 public organizerRewardBps;   // default: 3000 (30%)
uint16 public attendeeRewardBps;    // default: 2000 (20%)
uint16 public referralBps;          // default: 1000 (10%)
uint16 public devBps;               // default: 2500 (25%)
uint16 public reserveBps;           // default: 1500 (15%)
uint16 public constant PROTOCOL_FEE_BPS = 200; // 2%
```

The five reward percentages apply to the 2% protocol fee, not the full ticket price. The organizer receives `ticketPrice - protocolFee`. The protocol fee is then subdivided: 30% organizer reward, 20% attendee reward, 10% referral, 25% dev, 15% reserve.

### 3.2 Functions

```solidity
function routePayment(
    uint256 ticketPrice,
    address organizer,
    address referrer
) external nonReentrant whenNotPaused;
```

Calculates the 2% protocol fee from `ticketPrice`. Transfers `ticketPrice - protocolFee` to `organizer`. Splits the protocol fee across the five pools. Transfers the referral share to `referrer`. Deposits remaining shares to the treasury and reward pool addresses.

```solidity
function updateSplitPercentages(
    uint16 _organizerRewardBps,
    uint16 _attendeeRewardBps,
    uint16 _referralBps,
    uint16 _devBps,
    uint16 _reserveBps
) external onlyRole(ADMIN);
```

Updates the fee subdivision percentages. Reverts if the five values do not sum to 10000 (100%).

```solidity
function pause() external onlyRole(PAUSER);
function unpause() external onlyRole(PAUSER);
```

### 3.3 Events

```solidity
event PaymentRouted(
    address indexed organizer,
    address indexed referrer,
    uint256 ticketPrice,
    uint256 protocolFee,
    uint256 timestamp
);

event SplitUpdated(
    uint16 organizerRewardBps,
    uint16 attendeeRewardBps,
    uint16 referralBps,
    uint16 devBps,
    uint16 reserveBps
);
```

---

## 4. AtlasTicket.sol (ERC-721)

**Purpose.** Mints non-fungible tokens representing event tickets. The token is the ticket. Deployed at Stage 2.

### 4.1 State Variables

```solidity
struct ResaleRules {
    bool transferable;
    uint16 maxMarkupBps;   // e.g., 15000 = 150% of face value
    uint16 royaltyBps;     // e.g., 500 = 5% royalty to organizer
}

mapping(uint256 => ResaleRules) public resaleRules;
mapping(uint256 => bytes32) public tokenEventId;
mapping(uint256 => bytes32) public tokenTicketType;
uint256 private _nextTokenId;
```

### 4.2 Functions

```solidity
function mintTicket(
    bytes32 eventId,
    bytes32 ticketType,
    address holder,
    string calldata metadataURI
) external onlyRole(ADMIN) nonReentrant whenNotPaused returns (uint256 tokenId);
```

Mints a new ERC-721 token to `holder`. Stores `eventId` and `ticketType` in contract state. Sets `tokenURI` to `metadataURI`, which points to an IPFS CID containing the full event listing as JSON-LD. Returns the minted `tokenId`.

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
    bytes32 indexed eventId,
    bytes32 ticketType,
    address indexed holder,
    string metadataURI
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

---

## 5. RewardLedger.sol

**Purpose.** Tracks USDC reward accrual, enforces a 14-day timelock, and pays out claims directly. Deployed at Stage 3.

### 5.1 State Variables

```solidity
struct Accrual {
    uint256 amount;
    uint256 unlockTimestamp;  // block.timestamp + 14 days
    bool claimed;
}

mapping(address => Accrual[]) public accruals;
mapping(address => uint256) public totalAccrued;
mapping(address => uint256) public totalClaimed;

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
