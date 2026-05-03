# MegaETH — FeeRouter + AtlasTicket + RewardLedger deploy runbook (experimental)

| Field | Value |
|-------|-------|
| Chain ID | `4326` |
| Network name | `megaeth` |
| Stablecoin | **USDM** (chain-native — Circle does not yet ship a canonical USDC for MegaETH) |
| USDM address | `0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7` |
| Block explorer | [megaeth.blockscout.com](https://megaeth.blockscout.com) |
| Recommended RPC | `https://mainnet.megaeth.com/rpc` |
| Status | **Experimental** — see notes below |

**Status note.** Circle's "USDC contract addresses" page (https://developers.circle.com/stablecoins/usdc-contract-addresses, accessed 2026-05-01) does not list MegaETH; the chain-native USDM stablecoin is the closest equivalent. Bridged USDC via FastBridge / similar carries third-party bridge risk. Consult the operations multisig before deploying production fee flows on MegaETH; the chain spec is flagged `experimental: true` in `@atlasprotocol/server-sdk` until Circle publishes a canonical USDC for the chain.

If you intend to settle in **bridged USDC** instead of USDM, replace `STABLECOIN` with the bridge's contract address and document the bridge provenance in the deploy log.

## 1. Env vars

```bash
export RPC_URL=https://mainnet.megaeth.com/rpc
export STABLECOIN=0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7   # USDM (native MegaETH stablecoin)
export TREASURY=0x...
export ADMIN=0x...
export UPGRADER=0x...
export PAUSER=0x...
```

> Etherscan-style verification on MegaETH typically goes through Blockscout. The Foundry `--verify` flag points at the chain's verification endpoint; current MegaETH docs at https://docs.megaeth.com/ list the endpoint as a Blockscout proxy. Confirm the URL with the MegaETH team before relying on `--verify` in CI.

## 2. Deploy

```bash
cd contracts
forge script script/Deploy.s.sol:Deploy \
  --rpc-url $RPC_URL \
  --account deployer \
  --broadcast \
  -vvv
```

## 3. Verify

If MegaETH's Blockscout instance supports Etherscan-style API verification:

```bash
forge verify-contract \
  --chain 4326 \
  --verifier blockscout \
  --verifier-url https://megaeth.blockscout.com/api \
  --constructor-args $(cast abi-encode "constructor(address,bytes)" $IMPL_ADDR $INIT_DATA) \
  $PROXY_ADDR \
  lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy
```

If automated verification is not yet supported, paste the flattened source via the explorer's manual verification UI.

## 4. Post-deploy

- Add proxy address to `packages/server-sdk/src/chain-specs.ts` under `megaeth_usdm`. The chain stays `experimental: true` in `DEFAULT_ACCEPTED_CHAINS` until Circle USDC ships.
- Decide whether to advertise the chain in `.well-known/atlas.json`. Most platforms should leave it out of `settlement.chains` until USDC is available.
- Confirm `pause` / `setFeeSchedule` smoke tests from the operations multisig.

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
  -vvv
```

Expected console output:

```text
AtlasTicket impl  : 0x...
AtlasTicket proxy : 0x...
Expected addr     : 0x...
```

Record the proxy in `deployments.json` under `atlasTicket.proxies.megaeth_usdm`.

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

## 6. RewardLedger deploy

RewardLedger takes a `STABLECOIN` parameter (same value as FeeRouter's `STABLECOIN` — USDM on
MegaETH) plus role recipients. The same `ADMIN` / `PAUSER` / `UPGRADER` multisigs from FeeRouter
are reused; `RECORDER` is the address allowed to call `recordReward(...)` — typically the
FeeRouter or the operations settlement service.

```bash
export ADMIN=0x...
export RECORDER=0x...
export PAUSER=0x...
export UPGRADER=0x...
export STABLECOIN=0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7   # USDM (native MegaETH stablecoin)
```

```bash
cd contracts
forge script script/DeployRewardLedger.s.sol:DeployRewardLedger \
  --rpc-url $RPC_URL \
  --account deployer \
  --broadcast \
  -vvv
```

Expected console output:

```text
RewardLedger impl  : 0x...
RewardLedger proxy : 0x...
Expected addr      : 0x...
```

Record the proxy in `deployments.json` under `rewardLedger.proxies.megaeth_usdm`.

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
