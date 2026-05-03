# Tempo — FeeRouter + AtlasTicket + RewardLedger deploy runbook (placeholder)

| Field | Value |
|-------|-------|
| Chain ID | `4217` (provisional — verify with Tempo team before production use) |
| Network name | `tempo` |
| Stablecoin | USDC (Stripe-Tempo native) |
| USDC address | **TODO — pending public mainnet release** |
| Block explorer | TODO |
| Recommended RPC | TODO (`https://rpc.tempo.xyz` listed in some early references; **not verified**) |
| Status | **Placeholder — do not deploy** |

**This runbook is intentionally incomplete.** Tempo (Stripe's L1) has not published a public mainnet release at the time of writing (2026-05-01). The chain id, RPC URL, and USDC contract address fields above are placeholders carried over from earlier prototype work; **none have been independently verified against an official Tempo source**, so production deployment is blocked.

The chain is flagged `experimental: true` in `@atlasprotocol/server-sdk` (`packages/server-sdk/src/chain-specs.ts`, `tempo_usdc`) and excluded from `DEFAULT_ACCEPTED_CHAINS`.

## What to do when Tempo ships

1. Replace every `TODO` field above with the canonical value from Stripe-Tempo's public docs.
2. Confirm the chain id with `cast chain-id --rpc-url <tempo-rpc>` (or the equivalent JSON-RPC `eth_chainId` call) before broadcasting.
3. Verify the USDC contract address against a Stripe-Tempo announcement (treat any address pulled from a community list as untrusted).
4. Update `packages/server-sdk/src/chain-specs.ts`:
   - Set `tempo_usdc.usdcAddress` to the verified address.
   - Set `tempo_usdc.chain.id` to the verified chain id.
   - Set `tempo_usdc.defaultRpcUrl` to the verified RPC.
   - Remove `experimental: true`.
5. Update `MULTICHAIN.md` and this runbook to drop the placeholder language.
6. Then follow the standard pattern from `base.md`.

## Standard env-var template (when ready)

```bash
export RPC_URL=...                 # TODO
export STABLECOIN=0x...             # TODO — verified Tempo USDC contract
export TREASURY=0x...
export ADMIN=0x...
export UPGRADER=0x...
export PAUSER=0x...
```

## Deploy command (when ready)

```bash
cd contracts
forge script script/Deploy.s.sol:Deploy \
  --rpc-url $RPC_URL \
  --account deployer \
  --broadcast \
  -vvv
```

## Verification

Tempo's block explorer + verification API endpoint are not yet publicly documented. Confirm with the Tempo team and update this runbook before relying on automated verification.

## AtlasTicket deploy (when ready)

AtlasTicket has no stablecoin parameter — it only needs role recipients and a (name, symbol)
pair. Use the same `ADMIN` / `PAUSER` / `UPGRADER` multisigs as FeeRouter; `MINTER` is the
operations service that calls `mint(...)` after a successful settlement.

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

Record the proxy in `deployments.json` under `atlasTicket.proxies.tempo_usdc` once Tempo's
public mainnet ships.

### AtlasTicket BURNER_ROLE (post-deploy)

The deploy script grants `MINTER_ROLE`, `PAUSER_ROLE`, and `UPGRADER_ROLE` at initialization
time, but **does not** pre-grant `BURNER_ROLE`. After the AtlasTicket proxy is live, the
`ADMIN` multisig grants `BURNER_ROLE` to the settlement service that drives FeeRouter
refunds (typically the same wallet that holds `REFUND_ROLE` on FeeRouter):

```bash
export PROXY=0x...        # AtlasTicket proxy address from above
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

## RewardLedger deploy (when ready)

RewardLedger takes a `STABLECOIN` parameter (same value as FeeRouter's `STABLECOIN`) plus role
recipients. Use the same `ADMIN` / `PAUSER` / `UPGRADER` multisigs as FeeRouter; `RECORDER` is
the address allowed to call `recordReward(...)` — typically the FeeRouter or the operations
settlement service.

```bash
export ADMIN=0x...
export RECORDER=0x...
export PAUSER=0x...
export UPGRADER=0x...
export STABLECOIN=0x...   # TODO — verified Tempo USDC contract
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

Record the proxy in `deployments.json` under `rewardLedger.proxies.tempo_usdc` once Tempo's
public mainnet ships.
