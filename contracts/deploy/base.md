# Base mainnet — FeeRouter deploy runbook

| Field | Value |
|-------|-------|
| Chain ID | `8453` |
| Network name | `base` |
| Stablecoin | USDC (native Circle) |
| USDC address | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Block explorer | [basescan.org](https://basescan.org) |
| Recommended RPC | `https://mainnet.base.org` |
| Status | Production |

USDC contract verified against Circle's official "USDC contract addresses" page (https://developers.circle.com/stablecoins/usdc-contract-addresses, accessed 2026-05-01).

## 1. Env vars

```bash
export RPC_URL=https://mainnet.base.org
export STABLECOIN=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913   # native Circle USDC on Base
export TREASURY=0x...     # protocol fee recipient (multisig)
export ADMIN=0x...        # DEFAULT_ADMIN_ROLE
export UPGRADER=0x...     # UPGRADER_ROLE (multisig + timelock recommended)
export PAUSER=0x...       # PAUSER_ROLE (operations multisig)
export ETHERSCAN_API_KEY=...   # Basescan key for --verify
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
  --verifier-url https://api.basescan.org/api \
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
  --chain 8453 \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --verifier-url https://api.basescan.org/api \
  --constructor-args $(cast abi-encode "constructor(address,bytes)" $IMPL_ADDR $INIT_DATA) \
  $PROXY_ADDR \
  lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy
```

(Use the impl address + initData logged by the deploy script.)

## 4. Post-deploy

- Add the proxy address to `@atlasprotocol/server-sdk` chain config (`packages/server-sdk/src/chain-specs.ts`, `base_usdc.feeRouterAddress` once that field is added in a follow-up).
- Add the chain entry to the registry index when the registry service ships.
- Confirm `pause` / `setFeeSchedule` smoke tests from the operations multisig.

## 5. Deployed addresses (record after deploy)

| Role | Address |
|------|---------|
| FeeRouter proxy | _record after deploy_ |
| FeeRouter impl | _record after deploy_ |
| Treasury (TREASURY) | _… your value_ |
| Admin multisig (ADMIN) | _… your value_ |
| Upgrader multisig (UPGRADER) | _… your value_ |
| Pauser multisig (PAUSER) | _… your value_ |
