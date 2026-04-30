# ATLAS Contracts

Solidity contracts for the ATLAS Protocol, built with [Foundry](https://book.getfoundry.sh/).

This directory houses the on-chain components defined in [`specs/04-SMART-CONTRACTS-SPEC.md`](../specs/04-SMART-CONTRACTS-SPEC.md):

- **`FeeRouter`** — splits each stablecoin settlement between the organizer and the protocol treasury per a single configurable fee schedule (Stage 1 — shipped). The settlement token is supplied at initialization, so the same contract deploys against USDC, USDm, cUSD, or any other ERC-20 stablecoin.
- **`RegistryPointer`** — on-chain pointer that lets clients resolve the canonical registry endpoint for a given namespace, enabling progressive decentralization of registry hosting (planned).
- **`AtlasTicket`** — ERC-721 ticket NFT minted on settlement; carries event metadata CID, ticket-type CID, and proof-of-purchase that downstream contracts (rewards, gating) can verify (planned).

Additional contracts (`RewardLedger`, `PromotionSettlement`) follow the same spec and will land here as the implementation rolls out.

## Layout

```
contracts/
├── foundry.toml      # Foundry config (solc 0.8.27, via_ir, optimizer 200 runs)
├── remappings.txt    # Solidity import remappings
├── src/              # Contract sources
│   ├── FeeRouter.sol
│   └── interfaces/IFeeRouter.sol
├── script/           # Foundry deployment scripts
│   └── Deploy.s.sol
├── test/             # Forge tests
│   ├── FeeRouter.t.sol
│   └── utils/MockStablecoin.sol
└── lib/              # Forge dependencies (git submodules)
```

## Common commands

```bash
forge build
forge test
forge fmt
forge snapshot
```

External libraries (OpenZeppelin, forge-std) install into `lib/` via `forge install` and are tracked as git submodules.

## Multi-chain deployment

ATLAS contracts are chain-neutral within EVM. See [MULTICHAIN.md](./MULTICHAIN.md) for the deploy-per-chain pattern, capability requirements, and per-chain expansion checklist.

FeeRouter deploys to the **same address on every EVM chain** via CREATE2 with salt `keccak256("atlas-protocol/FeeRouter v0.1.0")`. The expected address is computed and printed during `forge script script/Deploy.s.sol` invocation — no need to hardcode.

## Stage 1 — FeeRouter

`FeeRouter` is a UUPS-upgradeable contract that:

1. Receives a stablecoin `settle(organizer, amount, paymentId)` call from a payer that has already approved the router.
2. Pulls `amount` stablecoin via `transferFrom`.
3. Splits the amount per the current `feeBps`: protocol fee to `treasury`, remainder to `organizer`.
4. Marks `paymentId` as settled (idempotent: a repeated `paymentId` reverts with `PaymentAlreadySettled`).
5. Emits `PaymentSettled(paymentId, organizer, organizerAmount, protocolFee)`.

### Roles

| Role                 | Capability                                              |
|----------------------|---------------------------------------------------------|
| `DEFAULT_ADMIN_ROLE` | `setFeeBps`, `setTreasury`, manage other roles          |
| `UPGRADER_ROLE`      | Authorize UUPS implementation upgrades                  |
| `PAUSER_ROLE`        | `pause` / `unpause` settlements                         |

### Parameters

| Parameter        | Initial value | Bound                                  |
|------------------|---------------|----------------------------------------|
| `feeBps`         | 200 (2%)      | `<= MAX_FEE_BPS = 1000` (10% hard cap) |
| `treasury`       | constructor   | `!= address(0)`                        |
| Stablecoin token | constructor   | `!= address(0)`                        |

### Deployments

CREATE2 deployments share the same proxy address across every major EVM chain. See [MULTICHAIN.md](./MULTICHAIN.md) for the full pattern.

| Network        | Chain ID | Proxy Address | Implementation | Stablecoin (illustrative)                       |
|----------------|----------|---------------|----------------|--------------------------------------------------|
| Base Mainnet   | 8453     | TBD           | TBD            | USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Base Sepolia   | 84532    | TBD           | TBD            | USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

### Audit status

Audit pending. Do not use in production until the contract has been independently audited.

### Deployment

`script/Deploy.s.sol` deploys the implementation and an `ERC1967Proxy` to a deterministic CREATE2 address (same address on every major EVM chain). It is initialized via env vars:

```
STABLECOIN  # ERC-20 stablecoin token on the target chain (USDC, USDm, etc.)
TREASURY    # Receives protocol fee
ADMIN       # DEFAULT_ADMIN_ROLE recipient
UPGRADER    # UPGRADER_ROLE recipient
PAUSER      # PAUSER_ROLE recipient
```

```bash
forge script script/Deploy.s.sol:Deploy \
  --rpc-url $RPC_URL \
  --private-key $DEPLOYER_PK \
  --broadcast
```

The script logs the expected CREATE2 proxy address before broadcasting. See [MULTICHAIN.md](./MULTICHAIN.md) for the full per-chain expansion checklist.

### Gas snapshot

Generated by `forge snapshot`. See `.gas-snapshot` for the canonical version.

```
FeeRouterTest:test_create2_addressIsDeterministic() (gas: 2923)
FeeRouterTest:test_fuzz_settle_anyAmount(uint128) (runs: 256, μ: 131622, ~: 133435)
FeeRouterTest:test_setFeeSchedule_above_cap_reverts() (gas: 19946)
FeeRouterTest:test_setFeeSchedule_admin() (gas: 27435)
FeeRouterTest:test_setFeeSchedule_unauthorized_reverts() (gas: 19908)
FeeRouterTest:test_setTreasury_admin() (gas: 26374)
FeeRouterTest:test_setTreasury_zero_reverts() (gas: 19152)
FeeRouterTest:test_settle_correctSplit_2pct() (gas: 126759)
FeeRouterTest:test_settle_duplicatePaymentId_reverts() (gas: 118057)
FeeRouterTest:test_settle_paused_reverts() (gas: 131628)
FeeRouterTest:test_settle_unauthorizedToken_reverts() (gas: 51100)
FeeRouterTest:test_settle_zeroAmount_reverts() (gas: 21003)
FeeRouterTest:test_settle_zeroOrganizer_reverts() (gas: 18548)
FeeRouterTest:test_upgrade_unauthorized_reverts() (gas: 1174134)
FeeRouterTest:test_upgrade_uupsAuth() (gas: 1182709)
```
