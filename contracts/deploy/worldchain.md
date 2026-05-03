# World Chain — FeeRouter + AtlasTicket deploy runbook

| Field | Value |
|-------|-------|
| Chain ID | `480` |
| Network name | `worldchain` |
| Stablecoin | USDC (native Circle, OP Stack) |
| USDC address | `0x79A02482A880bCe3F13E09da970dC34dB4cD24D1` |
| Block explorer | [worldscan.org](https://worldscan.org) |
| Recommended RPC | `https://worldchain-mainnet.g.alchemy.com/public` |
| Status | Production |

USDC contract verified against Circle's official "USDC contract addresses" page (https://developers.circle.com/stablecoins/usdc-contract-addresses, accessed 2026-05-01).

## 1. Env vars

```bash
export RPC_URL=https://worldchain-mainnet.g.alchemy.com/public
export STABLECOIN=0x79A02482A880bCe3F13E09da970dC34dB4cD24D1   # native Circle USDC on World Chain
export TREASURY=0x...
export ADMIN=0x...
export UPGRADER=0x...
export PAUSER=0x...
export ETHERSCAN_API_KEY=...   # Worldscan / OP Stack explorer API key
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
  --verifier-url https://api.worldscan.org/api \
  -vvv
```

## 3. Verify (manual)

```bash
forge verify-contract \
  --chain 480 \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --verifier-url https://api.worldscan.org/api \
  --constructor-args $(cast abi-encode "constructor(address,bytes)" $IMPL_ADDR $INIT_DATA) \
  $PROXY_ADDR \
  lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy
```

## 4. Post-deploy

- Add proxy address to `packages/server-sdk/src/chain-specs.ts` under `worldchain_usdc`.
- Confirm `pause` / `setFeeSchedule` smoke tests from the operations multisig.
- World Chain offers gas subsidies for World ID-verified humans. ATLAS settlement transactions from World ID-attested wallets are charged $0 gas at the sequencer; consider promoting this in user-facing flows.

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
  --verifier-url https://api.worldscan.org/api \
  -vvv
```

Expected console output:

```text
AtlasTicket impl  : 0x...
AtlasTicket proxy : 0x...
Expected addr     : 0x...
```

Record the proxy in `deployments.json` under `atlasTicket.proxies.worldchain_usdc`.

## 6. Deployed addresses (record after deploy)

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
