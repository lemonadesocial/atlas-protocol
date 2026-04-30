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

## 8. Stage 3 — AtlasTicket: cross-chain NFT issuance

### 8.1 Design intent

AtlasTicket is the protocol's NFT ticketing layer. It is **EVM-portable** — operators deploy AtlasTicket on whichever EVM chain best fits their event UX. There is no protocol-level recommendation about which chain to use; it's an operational decision based on tradeoffs (mint cost per ticket, throughput, user reach, ecosystem fit).

The protocol's three primitives — FeeRouter for payment, AtlasTicket for issuance, registry pointer for discovery — are **independent chain decisions**. Operators choose where each lives. They may collapse all three onto a single chain for one-chain UX simplicity, or split them across chains optimized per concern. Both patterns are first-class.

Solana support requires a separate Anchor program (`@atlasprotocol/solana-ticket`) — different language, different VM, separate audit. Post-seed work; not Stage 3 scope. Other non-EVM chains (Sui, Aptos, Move-based) are out of scope until proven operator demand exists.

### 8.2 Cross-chain settlement → mint via signed claims

Payments settle on the FeeRouter chain. Ticket mints happen on the AtlasTicket chain. When these are different chains, the link between them is a **signed claim**, not a bridge:

1. Buyer settles payment via FeeRouter on chain A. FeeRouter emits `PaymentSettled(paymentId, organizer, amount, fee)`.
2. Atlas-compliant operator backend signs a claim with the FeeRouter's authorized signing key:

   ```solidity
   Claim {
     paymentTxHash:  bytes32,
     paymentChainId: uint256,
     eventId:        bytes32,
     ticketTypeId:   bytes32,
     recipient:      address,
     paymentAmount:  uint256,
     nonce:          uint256,
     deadline:       uint256,
   }
   signature: ECDSA signature over Claim
   ```

3. Recipient (or the operator on their behalf) submits claim + signature to AtlasTicket on chain B:

   ```solidity
   AtlasTicket.mintWithClaim(claim, signature)
   ```

   AtlasTicket verifies:
   - Signature recovers to a registered authorizer for `paymentChainId`
   - Claim hasn't been used (nonce check)
   - Deadline not passed
   - Then mints the NFT to `recipient`

When settlement and ticketing are on the **same chain**, the same `mintWithClaim` flow works — the operator signs a claim from the same chain, AtlasTicket verifies and mints. No special case needed.

### 8.3 Why signed claims, not bridges

- Bridges have historically been the largest source of crypto exploits. Adding bridge dependency to mint a $50 ticket is wrong cost-benefit.
- Signed claims add a centralization point (the operator's signing key) but that's acceptable because **the operator is already centralized** — they're the source of truth for the event itself.
- Trust upgrade path: replace signed claims with Hyperlane / CCIP / LayerZero cross-chain messaging at Stage 4 if true trustlessness becomes required.

### 8.4 Required AtlasTicket capabilities (Stage 3)

- **ERC-721** standard NFT for individual ticket ownership and resale.
- **Optional ERC-2981 royalties** so organizers earn on resales.
- **Batch minting.** `batchMintWithClaim(Claim[] claims, bytes[] signatures)` — events with 10K+ attendees would otherwise pay 10K × per-mint gas. Batch sizes up to 500 in a single transaction. Batch limits depend on chain block gas limit; configurable per deployment.
- **Authorized signer registry.** The contract maintains a mapping of `chainId → authorized signer addresses`. Adding a new authorizer is admin-controlled; removing must be possible (compromise mitigation).
- **Event registry.** `mapping(bytes32 eventId => EventConfig)` so tickets reference real events with metadata (CID), max supply, ticket type structure.
- **Transfer hooks.** Optional whitelist / blacklist for tickets that organizers want to restrict to verified accounts.
- **CREATE2 deployment.** Same pattern as FeeRouter — version-aware salt produces the same proxy address on every EVM chain, so AtlasTicket also has a single canonical address across chains.

### 8.5 Solana port

`@atlasprotocol/solana-ticket` is a separate Anchor program when we ship Solana support post-seed. Same semantics:

- Mint with cross-chain claim (signed by an EVM authorizer key)
- Authorizer registry
- Batch issuance (Solana supports much higher throughput — batch sizes can be larger)
- Compatible with Metaplex NFT standard for marketplace interop

Different audit, different package, different deployment ops. Don't try to coordinate single-chain logic across Solana and EVM at the contract level — keep them independent.

### 8.6 Receipt format references all three chains

The IPFS-archived receipt for a transaction includes:

```json
{
  "paymentChainId": 0,
  "paymentTxHash": "0x...",
  "paymentAmount": 0,
  "protocolFee": 0,
  "ticketChainId": 0,
  "ticketTxHash": "0x...",
  "ticketTokenId": 0,
  "eventCID": "ipfs://...",
  "atlasVersion": "0.1"
}
```

This is the canonical record across all three chains involved. When all three primitives are on the same chain, `paymentChainId == ticketChainId` and the receipt is internally consistent — no special case.

---

## 9. Audit and Deployment

### 9.1 Security Audit

An independent security firm audits all five contracts before Stage 1 deployment. The audit covers reentrancy vectors, access control correctness, proxy upgrade safety, integer overflow/underflow (Solidity 0.8+ built-in checks), and USDC transfer edge cases (return value handling). Audit reports are published publicly.

### 9.2 Parallel Operation

Each stage runs a 90-day parallel operation period. The new on-chain component runs alongside the existing centralized component. Both produce results. Discrepancies trigger investigation and resolution before proceeding.

### 9.3 Gradual Migration

Traffic shifts incrementally across four thresholds: 10%, 25%, 50%, 100%. At each threshold, monitoring covers gas costs, transaction success rates, settlement latency, and user experience. The system holds at each threshold for a minimum observation window before advancing.

### 9.4 Rollback Procedure

If a critical bug is discovered during migration, traffic reverts to the centralized system. The on-chain contracts are paused via the `PAUSER` role. The development team patches and re-audits the contracts. Migration restarts from the 10% threshold after the fix is deployed.

### 9.5 Deployment Tooling

Contracts are compiled and deployed using Hardhat or Foundry. Deployment scripts configure constructor parameters (USDC token address, treasury address, initial role assignments) per chain. After deployment, contracts are verified on each chain's block explorer (Etherscan, Basescan, Arbiscan, and chain-specific explorers).

### 9.6 Adding a New Chain

Deploying to a new chain requires four steps. First, deploy the five contracts with the same Solidity source and constructor parameters. Second, verify on the chain's block explorer. Third, register the chain in the ATLAS registry (chain ID, contract addresses, USDC token address, RPC endpoints). Fourth, update the CLI and SDK to include the new chain option. No protocol or schema changes are needed.

---

*For the progressive decentralization roadmap, see WHITEPAPER-CHAIN-AGNOSTIC.md Section 15. For the full architecture, see ARCHITECTURE.md Section 8. For fee economics, see FEE-STRUCTURE.md.*
