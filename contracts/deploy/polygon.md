# Polygon PoS — FeeRouter + AtlasTicket deploy runbook

| Field | Value |
|-------|-------|
| Chain ID | `137` |
| Network name | `polygon` |
| Stablecoin | USDC (native Circle) |
| USDC address | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` |
| Block explorer | [polygonscan.com](https://polygonscan.com) |
| Recommended RPC | `https://polygon-rpc.com` |
| Status | Production |

USDC contract verified against Circle's official "USDC contract addresses" page (https://developers.circle.com/stablecoins/usdc-contract-addresses, accessed 2026-05-02). Use the **native** Circle USDC above — the legacy bridged `USDC.e` (`0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`) is **not** the canonical USDC on Polygon and must not be passed as `STABLECOIN`.

## 1. Env vars

```bash
export RPC_URL=https://polygon-rpc.com
export STABLECOIN=0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359   # native Circle USDC on Polygon PoS
export TREASURY=0x...     # protocol fee recipient (multisig)
export ADMIN=0x...        # DEFAULT_ADMIN_ROLE (governance multisig)
export UPGRADER=0x...     # UPGRADER_ROLE (multisig + timelock recommended)
export PAUSER=0x...       # PAUSER_ROLE (operations multisig)
export ETHERSCAN_API_KEY=...   # Polygonscan API key for --verify
```

## 2. Deploy

```bash
cd contracts
forge script script/Deploy.s.sol:Deploy \
  --rpc-url $RPC_URL \
  --account deployer \
  --broadcast \
  --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --verifier-url https://api.polygonscan.com/api \
  -vvv
```

The script logs the expected proxy address before broadcasting:

```text
FeeRouter impl  : 0x...
FeeRouter proxy : 0x...
Expected addr   : 0x...
```

Capture the proxy address into the table below.

## 3. Verify (manual, if `--verify` did not run)

```bash
forge verify-contract \
  --chain 137 \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --verifier-url https://api.polygonscan.com/api \
  --constructor-args $(cast abi-encode "constructor(address,bytes)" $IMPL_ADDR $INIT_DATA) \
  $PROXY_ADDR \
  lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy
```

(Use the impl address + initData logged by the deploy script.)

## 4. Post-deploy

- Add the proxy address to `deployments.json` under `feeRouter.proxies.polygon_usdc`.
- Confirm `pause` / `setFeeSchedule` smoke tests from the operations multisig.

### 4a. FeeRouter REFUND_ROLE (post-deploy)

The deploy script grants `DEFAULT_ADMIN_ROLE`, `UPGRADER_ROLE`, and `PAUSER_ROLE` at initialization
time, but **does not** pre-grant `REFUND_ROLE`. After the FeeRouter proxy is live, the `ADMIN`
multisig grants `REFUND_ROLE` to the settlement service that calls `reverseSettle(...)` on
refunds:

```bash
export PROXY=0x...        # FeeRouter proxy address from §2
export REFUNDER=0x...     # REFUND_ROLE recipient (settlement service / refund worker)

cast send $PROXY "grantRole(bytes32,address)" \
  $(cast keccak "REFUND_ROLE") \
  $REFUNDER \
  --rpc-url $RPC_URL \
  --account admin
```

Without this grant, `reverseSettle(...)` reverts with `AccessControlUnauthorizedAccount`.

## 5. AtlasTicket deploy

AtlasTicket has no stablecoin parameter — it only needs role recipients and a (name, symbol)
pair. The same `ADMIN` / `PAUSER` / `UPGRADER` multisigs from FeeRouter are reused; `MINTER`
is the operations service that calls `mint(...)` after a successful settlement.

```bash
export ADMIN=0x...        # DEFAULT_ADMIN_ROLE (reuse FeeRouter's value)
export MINTER=0x...       # MINTER_ROLE (operations service / settlement worker)
export PAUSER=0x...       # PAUSER_ROLE (reuse FeeRouter's value)
export UPGRADER=0x...     # UPGRADER_ROLE (reuse FeeRouter's value)
export NAME="ATLAS Ticket"
export SYMBOL="ATLAS"
```

```bash
cd contracts
forge script script/DeployAtlasTicket.s.sol:DeployAtlasTicket \
  --rpc-url $RPC_URL \
  --account deployer \
  --broadcast \
  --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --verifier-url https://api.polygonscan.com/api \
  -vvv
```

Expected console output:

```text
AtlasTicket impl  : 0x...
AtlasTicket proxy : 0x...
Expected addr     : 0x...
```

Record the proxy in `deployments.json` under `atlasTicket.proxies.polygon_usdc`.

### 5a. AtlasTicket BURNER_ROLE (post-deploy)

The deploy script grants `MINTER_ROLE`, `PAUSER_ROLE`, and `UPGRADER_ROLE` at initialization
time, but **does not** pre-grant `BURNER_ROLE`. After the AtlasTicket proxy is live, the
`ADMIN` multisig grants `BURNER_ROLE` to the settlement service that drives FeeRouter
refunds (typically the same wallet that holds `REFUND_ROLE` on FeeRouter):

```bash
export PROXY=0x...        # AtlasTicket proxy address from §5
export BURNER=0x...       # BURNER_ROLE recipient (settlement service / refund worker)

cast send $PROXY "grantRole(bytes32,address)" \
  $(cast keccak "BURNER_ROLE") \
  $BURNER \
  --rpc-url $RPC_URL \
  --account admin
```

Without this grant, refund-side calls to `AtlasTicket.burn(...)` revert with
`AccessControlUnauthorizedAccount`. The custodial-wallet pattern (mints to an ATLAS-managed
holder for email-only buyers) does not require any extra grant — it reuses `MINTER_ROLE`.

## 6. RewardLedger — not deployed on Polygon

RewardLedger v1 is **canonical-chain only**: the proxy slots in [`deployments.json`](../../deployments.json) cover Base mainnet (`base_usdc`) and Base Sepolia (`base_sepolia_usdc`) — and nothing else. The contract bytecode is portable across every EVM chain in `chain-specs.ts`, but the v1 protocol economics keep reward accrual on a single chain so referral, organizer, and attendee balances accumulate against one ledger without cross-chain reconciliation. SDK consumers asking for `getRewardLedgerAddress("polygon_usdc")` receive `undefined`. Multi-chain RewardLedger is Phase 7+ per [`01-whitepaper/docs/10-PROGRESSIVE-DECENTRALIZATION.md`](../../01-whitepaper/docs/10-PROGRESSIVE-DECENTRALIZATION.md).

## 7. Deployed addresses (record after deploy)

| Role | Address |
|------|---------|
| FeeRouter proxy | _record after deploy_ |
| FeeRouter impl | _record after deploy_ |
| AtlasTicket proxy | _record after deploy_ |
| AtlasTicket impl | _record after deploy_ |
| Treasury (TREASURY) | _… your value_ |
| Admin multisig (ADMIN) | _… your value_ |
| Upgrader multisig (UPGRADER) | _… your value_ |
| Pauser multisig (PAUSER) | _… your value_ |
| Minter (MINTER) | _… your value_ |
| Refunder (REFUND_ROLE) | _… your value_ |
| Burner (BURNER_ROLE) | _… your value_ |
