# Arbitrum One — FeeRouter + AtlasTicket + RewardLedger deploy runbook

| Field | Value |
|-------|-------|
| Chain ID | `42161` |
| Network name | `arbitrum` |
| Stablecoin | USDC (native Circle) |
| USDC address | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| Block explorer | [arbiscan.io](https://arbiscan.io) |
| Recommended RPC | `https://arb1.arbitrum.io/rpc` |
| Status | Production |

USDC contract verified against Circle's official "USDC contract addresses" page (https://developers.circle.com/stablecoins/usdc-contract-addresses, accessed 2026-05-01). The bridged `USDC.e` (`0xFF970…`) is the older bridged form and is **not** the canonical USDC on Arbitrum One — use the address above only.

## 1. Env vars

```bash
export RPC_URL=https://arb1.arbitrum.io/rpc
export STABLECOIN=0xaf88d065e77c8cC2239327C5EDb3A432268e5831   # native Circle USDC on Arbitrum One
export TREASURY=0x...
export ADMIN=0x...
export UPGRADER=0x...
export PAUSER=0x...
export ETHERSCAN_API_KEY=...   # Arbiscan key
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
  --verifier-url https://api.arbiscan.io/api \
  -vvv
```

## 3. Verify (manual)

```bash
forge verify-contract \
  --chain 42161 \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --verifier-url https://api.arbiscan.io/api \
  --constructor-args $(cast abi-encode "constructor(address,bytes)" $IMPL_ADDR $INIT_DATA) \
  $PROXY_ADDR \
  lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy
```

## 4. Post-deploy

- Add proxy address to `packages/server-sdk/src/chain-specs.ts` under `arbitrum_usdc`.
- Confirm `pause` / `setFeeSchedule` smoke tests from the operations multisig.
- Note: Arbitrum's default 64-confirmation count for Circle USDC means the server-side verifier waits ~16 seconds at sequencer cadence before treating a transfer as final.

## 5. AtlasTicket deploy

AtlasTicket has no stablecoin parameter — it only needs role recipients and a (name, symbol)
pair. The same `ADMIN` / `PAUSER` / `UPGRADER` multisigs from FeeRouter are reused; `MINTER`
is the operations service that calls `mint(...)` after a successful settlement.

```bash
export ADMIN=0x...
export MINTER=0x...
export PAUSER=0x...
export UPGRADER=0x...
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
  --verifier-url https://api.arbiscan.io/api \
  -vvv
```

Expected console output:

```text
AtlasTicket impl  : 0x...
AtlasTicket proxy : 0x...
Expected addr     : 0x...
```

Record the proxy in `deployments.json` under `atlasTicket.proxies.arbitrum_usdc`.

## 6. RewardLedger deploy

RewardLedger takes a `STABLECOIN` parameter (same value as FeeRouter's `STABLECOIN`) plus
role recipients. The same `ADMIN` / `PAUSER` / `UPGRADER` multisigs from FeeRouter are reused;
`RECORDER` is the address allowed to call `recordReward(...)` — typically the FeeRouter or the
operations settlement service.

```bash
export ADMIN=0x...
export RECORDER=0x...
export PAUSER=0x...
export UPGRADER=0x...
export STABLECOIN=0xaf88d065e77c8cC2239327C5EDb3A432268e5831   # native Circle USDC on Arbitrum One
```

```bash
cd contracts
forge script script/DeployRewardLedger.s.sol:DeployRewardLedger \
  --rpc-url $RPC_URL \
  --account deployer \
  --broadcast \
  --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --verifier-url https://api.arbiscan.io/api \
  -vvv
```

Expected console output:

```text
RewardLedger impl  : 0x...
RewardLedger proxy : 0x...
Expected addr      : 0x...
```

Record the proxy in `deployments.json` under `rewardLedger.proxies.arbitrum_usdc`.

## 7. Deployed addresses (record after deploy)

| Role | Address |
|------|---------|
| FeeRouter proxy | _record after deploy_ |
| FeeRouter impl | _record after deploy_ |
| AtlasTicket proxy | _record after deploy_ |
| AtlasTicket impl | _record after deploy_ |
| RewardLedger proxy | _record after deploy_ |
| RewardLedger impl | _record after deploy_ |
| Treasury (TREASURY) | _… your value_ |
| Admin multisig (ADMIN) | _… your value_ |
| Upgrader multisig (UPGRADER) | _… your value_ |
| Pauser multisig (PAUSER) | _… your value_ |
| Minter (MINTER) | _… your value_ |
| Recorder (RECORDER) | _… your value_ |
