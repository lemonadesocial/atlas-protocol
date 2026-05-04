# ATLAS Protocol

**Agent Ticketing, Listing, And Settlement**

ATLAS is an open protocol that makes every event on the internet discoverable, bookable, and settleable by software agents. On the guest side, AI agents find and purchase tickets through a standard HTTP 402 flow. On the organizer side, the same agent infrastructure creates events, manages guest relationships through decentralized CRM, and reaches new audiences through a protocol-native ad-network.

Event data is stored on IPFS for permanence. Settlement occurs in USDC on any supported EVM chain. The protocol charges a flat 2% fee and returns value to participants through USDC cashback.

---

## Repo structure

```
atlas-protocol/
├── specs/                   # Protocol specifications (source of truth)
├── whitepaper/              # Whitepaper + supporting research
├── guides/                  # Integration + partnership guides
├── packages/                # TypeScript SDK packages (pnpm workspace)
│   ├── types/               # Shared types
│   ├── agent-tools/         # Agent SDK (LangChain + MCP)
│   └── server-sdk/          # Reference server implementation
├── contracts/               # Solidity contracts (Foundry)
└── examples/                # Integration quickstarts
```

### Quickstart

```bash
pnpm install
pnpm build
pnpm test
```

Node `>=24` and pnpm `>=9` are required. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full setup, package conventions, and spec-change process.

---

## Documentation

### Whitepaper

| Document | Description |
|----------|-------------|
| [Whitepaper](whitepaper/WHITEPAPER.md) | The complete protocol specification. Problem, vision, design principles, protocol overview, three-layer architecture, settlement, economics, network effects, organizer intelligence layer, progressive decentralization. |
| [Architecture](whitepaper/ARCHITECTURE.md) | System architecture. IPFS data layer, chain-agnostic settlement, registry federation, XMTP CRM, ad-network, smart contracts, security, infrastructure, data flow diagrams. |
| [Market Research](whitepaper/MARKET-RESEARCH.md) | $1T+ events industry analysis. TAM/SAM/SOM, experience economy trends, Gen Z/Gen X behavior, AI agent opportunity, platform fragmentation, competitive landscape. Cited sources. |

### Technical Specifications

| Spec | Description |
|------|-------------|
| [01 Protocol Spec](specs/01-PROTOCOL-SPEC.md) | Core protocol: well-known endpoints, registry API, HTTP 402 purchase flow, W3C receipt format, versioning, error codes. |
| [02 Schemas](specs/02-SCHEMAS.md) | Every JSON schema: AtlasEvent, AtlasTicketType, AtlasManifest, AtlasPurchaseChallenge, AtlasCredential, AtlasCampaign, AtlasMessage. |
| [03 Settlement](specs/03-SETTLEMENT-SPEC.md) | Chain-agnostic settlement: Base, MegaETH, World Chain, Arbitrum, Ethereum. USDC routing, MPP payment integration, gas optimization. |
| [04 Smart Contracts](specs/04-SMART-CONTRACTS-SPEC.md) | Five Solidity contracts: FeeRouter, AtlasTicket (ERC-721), RewardLedger, RegistryPointer, PromotionSettlement. Function signatures, access control, upgrade paths. |
| [05 IPFS Data Layer](specs/05-IPFS-DATA-LAYER.md) | IPFS as the permanence layer: publishing pipeline, CID generation, cluster operations, receipt storage, fallback resolution. |
| [06 XMTP CRM](specs/06-XMTP-CRM-SPEC.md) | Decentralized CRM on XMTP: channel establishment, data model, key management, segment queries, messaging, privacy, portability. |
| [07 Ad-Network](specs/07-AD-NETWORK-SPEC.md) | Protocol-native advertising: campaign model, pay-per-sale bidding, agent relevance, settlement (60/30/10 split), economics vs Meta/Google. |
| [08 Agent Ecosystem](specs/08-AGENT-ECOSYSTEM-SPEC.md) | Two-sided agent layer: 9 MCP tools, lemonade-cli reference, @atlasprotocol/client SDK, @atlasprotocol/server-sdk, agent identity, Space as Platform. |
| [09 Fee Economics](specs/09-FEE-ECONOMICS-SPEC.md) | 2% protocol fee, reward tiers, referral program, promotion revenue, token phases (LMC, $LEMON), fee comparison tables. |
| [10 Progressive Decentralization](specs/10-PROGRESSIVE-DECENTRALIZATION.md) | Five-stage trust migration: on-chain payments, fee splits, tickets, rewards, registry. Governance alignment, migration mechanics. |
| [11 Governance](specs/11-GOVERNANCE-SPEC.md) | Four governance phases: Lemonade stewardship, advisory board, steering committee, ATLAS Foundation. Voting mechanics, emergency procedures. |
| [12 Security & Privacy](specs/12-SECURITY-PRIVACY-SPEC.md) | TLS 1.3, API authentication, purchase security, smart contract security, data privacy (AES-256-GCM), GDPR/CCPA compliance. |

### Guides

| Guide | Description |
|-------|-------------|
| [Connector Architecture](guides/CONNECTOR-ARCHITECTURE.md) | How ATLAS imports events from external platforms: OAuth connectors, sync architecture, event normalization, IPFS publishing. |
| [Organizer Experience](guides/ORGANIZER-EXPERIENCE.md) | The complete organizer journey: onboarding, Space as Platform, AI agents, XMTP CRM, ad-network promotion, rewards. |
| [Partnership Playbook](guides/PARTNERSHIP-PLAYBOOK.md) | Bottom-up and top-down partnership strategy: platform tiers, agent ecosystem, ad-network as partnership lever. |
| [Roadmap](guides/ROADMAP.md) | Strategic roadmap tied to GMV milestones: Phase 0 (launch) through Phase 3 (foundation and full decentralization). |

---

## Protocol Stack

```
AGENT LAYER          Guest Agents (discover, book) + Organizer Agents (create, CRM, promote)
COMMUNICATION        XMTP (E2E encrypted organizer-guest messaging)
AD-NETWORK           Promotion bids + Relevance filtering + Pay-per-sale
REGISTRY             Federated search + Well-known endpoints + OAuth imports
DATA                 IPFS (permanent, content-addressed event storage)
SETTLEMENT           Base + MegaETH + World Chain + Arbitrum + Ethereum L1
CONTRACTS            FeeRouter + AtlasTicket + RewardLedger + RegistryPointer + PromotionSettlement
```

---

## Quick start for event platforms

Any event platform can install a few packages and accept agent purchases over both rails out of the box: discoverable from any agent surface (Claude / ChatGPT / Gemini / your own), settled either on-chain (multi-L2 USDC via x402) or in fiat (Stripe SPT, USDC out), with the buyer's W3C VC receipt pinned to IPFS.

```bash
# Server-side primitives + IPFS pinners (peer dep — only needed if you opt
# into receipt auto-pinning):
pnpm add @atlasprotocol/server-sdk @atlasprotocol/ipfs viem hono
# Optional, only when accepting fiat:
pnpm add stripe
```

1. **Copy the reference server.** [`examples/dual-protocol-server/`](./examples/dual-protocol-server/) is a complete Hono service with all four ATLAS endpoints (`/.well-known/atlas.json`, `/atlas/v1/search`, `/atlas/v1/events/:id`, `/atlas/v1/events/:id/purchase`). Use it as your starter: copy the four route handlers into your existing service and swap [`src/data.ts`](./examples/dual-protocol-server/src/data.ts) for whatever wraps your event database.
2. **Set environment variables.** See [`examples/dual-protocol-server/.env.example`](./examples/dual-protocol-server/.env.example) for the complete list — at minimum `ORGANIZER_ADDRESS`, `STRIPE_SECRET_KEY` (if accepting fiat), and the optional integration block (`ATLAS_TICKET_ADDRESS`, `REWARD_LEDGER_ADDRESS`, `WALLET_PRIVATE_KEY`, `RPC_URL`, `PINATA_JWT`) when you're ready to wire the on-chain mint + reward + receipt-pinning steps.
3. **Deploy contracts on your settlement chain.** Each chain has its own runbook in [`contracts/deploy/`](./contracts/deploy/) — required env vars, canonical stablecoin contract, `forge script` invocation, post-deploy verification command. The proxies write back into [`deployments.json`](./deployments.json) which the SDK accessors then read.
4. **Wire the endpoints.** The example performs the full composition — issue a 402 with `generateMppChallenge`, verify the retry credential with `verifyPayment` / `verifyStripePayment`, mint the AtlasTicket NFT with `buildMintTicketTx`, credit the organizer reward with `buildRecordRewardTx`, and pin the W3C VC receipt with `generateReceipt({ ..., pinner })`. See [`examples/dual-protocol-server/src/index.ts`](./examples/dual-protocol-server/src/index.ts) for the end-to-end flow.
5. **(Agent side.)** For the agent side of the same flow, see [`examples/agent-dual-client/`](./examples/agent-dual-client/) — it pays the 402 with x402 if a wallet is configured and falls back to stripe-mpp if a Stripe key is.

> **Breaking change in 0.4.0.** `generateReceipt` is now `async` and returns `{ receipt, cid? }`. The optional `pinner` parameter is the new pluggable IPFS pinner (`@atlasprotocol/ipfs`). Migrate by adding `await` and destructuring the result.

The cross-cutting invariants (paymentId carries unchanged through verify → mint → reward → receipt; replays are rejected; pinner is called exactly once) are exercised by [`packages/server-sdk/src/__tests__/end-to-end.test.ts`](./packages/server-sdk/src/__tests__/end-to-end.test.ts), which composes the same SDK primitives the example server uses.

---

## Phase 5.3 — ATLAS-managed services

Phase 5.3 introduces an operator-side path for platforms that don't want to run their own IPFS pinner, treasury hot wallet, or RPC clients. The ATLAS registry deployment runs the pinner, holds the settlement funds, and broadcasts the on-chain calls; platforms call four HTTP endpoints and get back a confirmed result.

The registry exposes four `/atlas/v1/*` endpoints (full request/response shapes in [`01-whitepaper/docs/01-PROTOCOL-SPEC.md`](./01-whitepaper/docs/01-PROTOCOL-SPEC.md)):

| Endpoint | Purpose | Spec |
|----------|---------|------|
| `POST /atlas/v1/receipts/pin` | Pin a receipt's proof-of-issuance to IPFS, return its URN + CID. | [05-IPFS-DATA-LAYER §6](./01-whitepaper/docs/05-IPFS-DATA-LAYER.md) |
| `POST /atlas/v1/receipts/verify` | Re-canonicalise + hash a receipt and confirm it matches a pinned proof. Accepts either the full receipt or a `{ urn, cid }` lookup. | [05-IPFS-DATA-LAYER §6](./01-whitepaper/docs/05-IPFS-DATA-LAYER.md) |
| `POST /atlas/v1/settlements/settle` | Execute a `FeeRouter.settle()` call from the ATLAS treasury hot wallet on the platform's behalf. Idempotent on `paymentId`. | [03-SETTLEMENT-SPEC §10](./01-whitepaper/docs/03-SETTLEMENT-SPEC.md) |
| `POST /atlas/v1/rewards/record` | Accrue organizer / attendee / referral rewards via `RewardLedger.recordRewards()` on Base (the canonical reward chain). Recipients claim directly via `claim()` / `claimTo()`. | [03-SETTLEMENT-SPEC §10](./01-whitepaper/docs/03-SETTLEMENT-SPEC.md) |

The SDK ships a typed client wrapping all four:

```bash
pnpm add @atlasprotocol/server-sdk@^0.7.0
```

```ts
import { createAtlasManagedClient } from '@atlasprotocol/server-sdk';

const atlas = createAtlasManagedClient({
  baseUrl: 'https://registry.atlas-protocol.org',
  platformAuthToken: process.env.ATLAS_PLATFORM_TOKEN, // optional
});

// After verifying the buyer's payment proof, hand settlement to ATLAS:
const settled = await atlas.settle({
  platformDomain: 'atlas.bjc.events',
  chain: 'base',
  organizer: organizerAddress,
  totalAmount: 50_000_000n,            // 50 USDC, 6 decimals
  paymentId: holdId,                   // doubles as idempotency key
  platformFees: [{ recipient: protocolTreasury, amount: 250_000n }],
});

// Record rewards (Base canonical chain):
await atlas.recordRewards({
  platformDomain: 'atlas.bjc.events',
  paymentId: holdId,
  recipients: [
    { recipient: organizerAddress, kind: 'organizer', amount: 600_000n },
    { recipient: attendeeAddress,  kind: 'attendee',  amount: 200_000n },
  ],
});

// Pin + verify the W3C VC receipt:
const { urn, cid } = await atlas.pinReceipt(receipt);
const { valid }    = await atlas.verifyReceipt({ urn, cid });
```

See [`packages/server-sdk/README.md`](./packages/server-sdk/README.md) for the full client API and [`packages/server-sdk/src/__tests__/atlas-managed-integration.test.ts`](./packages/server-sdk/src/__tests__/atlas-managed-integration.test.ts) for an end-to-end mocked-fetch lifecycle.

**Auth model.** Receipt endpoints (`pin`, `verify`) identify the calling platform from the receipt's URN domain — the registry resolves the URN against `registered_platforms` and verifies the caller. Settlement endpoints (`settle`, `recordRewards`) take the platform identity in the request body via `platform_domain` and authenticate via the optional `Authorization: Bearer <platformAuthToken>` header.

**Sovereignty is preserved.** Platforms that want to keep control of their own treasury and signing keys can still call the contracts directly — `buildSettleTx` and `buildRecordRewardTx` continue to be supported alongside the managed path. The trade-off is operational: managed mode shifts the burden of key custody, RPC reliability, and gas funding to the registry operator, at the cost of trusting that operator with broadcast timing.

---

## Quick reference

**For agent developers:**
```bash
npm install @atlasprotocol/agent-tools @atlasprotocol/mpp
```

**For platform integrators:**
```bash
npm install @atlasprotocol/server-sdk @atlasprotocol/mpp
```

**For organizers and builders:**
```bash
# Install the CLI
npm install -g lemonade-cli

# Create a space (= create an event platform)
lemonade space create --name "Brooklyn Jazz Collective" --domain bjc.events --type music

# Create an event
lemonade event create --space bjc_abc123 --title "Late Night Jazz" --date 2026-04-15T21:00 --price 25.00
```

## Per-chain deploy runbooks

Each supported settlement chain has its own deploy runbook in [`contracts/deploy/`](./contracts/deploy/) — required env vars, canonical stablecoin contract, `forge script` invocation, post-deploy verification command. Production-ready: Base, Optimism, Arbitrum, World Chain. Experimental: MegaETH (USDM until Circle ships canonical USDC). Placeholder: Tempo (pending public mainnet).

---

## Deployments

> **Phase 5 status (May 2026).** FeeRouter v2, AtlasTicket v2, and RewardLedger v2 are all spec-complete. **No proxies are deployed yet on any chain** — every entry in [`deployments.json`](./deployments.json) is `null`. Per-chain deploy runbooks live in [`contracts/deploy/`](./contracts/deploy/) (Base, Optimism, Arbitrum, Polygon, zkSync, World Chain, MegaETH, Tempo). RewardLedger v1 ships **canonical-chain only** — Base mainnet (`base_usdc`) and Base Sepolia (`base_sepolia_usdc`); multi-chain RewardLedger is Phase 7+ per [`specs/10-PROGRESSIVE-DECENTRALIZATION.md`](./specs/10-PROGRESSIVE-DECENTRALIZATION.md).

[`deployments.json`](./deployments.json) at the repo root is the canonical registry of deployed ATLAS contracts — currently `feeRouter` (Stage 1 payment settlement), `atlasTicket` (Stage 2 ERC-721 NFT tickets), and `rewardLedger` (Stage 3 organizer / attendee / referral reward accrual + claim ledger). For each contract family it records the CREATE2 salt for the implementation contract (deterministic across chains) and the per-chain UUPS proxy addresses (per-chain by design — chain-specific init params produce per-chain digests). Every chain present in the SDK's `CHAIN_SPECS` has an entry in `feeRouter.proxies` and `atlasTicket.proxies`, including testnet variants; entries are `null` until that chain has a real deployment. `rewardLedger.proxies` covers only the canonical Base + Base Sepolia slots in v1.

The SDK exposes typed accessors over this registry:

```ts
import {
  getAtlasTicketAddress,
  getAtlasTicketImplementation,
  getFeeRouterAddress,
  getFeeRouterImplementation,
  getRewardLedgerAddress,
  getRewardLedgerImplementation,
  listDeployedChains,
  listKnownChains,
} from "@atlasprotocol/server-sdk";

getFeeRouterAddress("base_usdc");     // → "0x..." once deployed, undefined otherwise
getFeeRouterImplementation();         // → CREATE2 implementation address
getAtlasTicketAddress("base_usdc");   // → AtlasTicket proxy on Base, undefined otherwise
getAtlasTicketImplementation();       // → AtlasTicket CREATE2 implementation address
getRewardLedgerAddress("base_usdc");  // → RewardLedger proxy on Base, undefined otherwise
getRewardLedgerImplementation();      // → RewardLedger CREATE2 implementation address
listDeployedChains();                 // → chain slugs that have a non-null FeeRouter proxy
listKnownChains();                    // → every chain slug in deployments.json
```

When adding a new chain, update `CHAIN_SPECS` and `feeRouter.proxies` + `atlasTicket.proxies` + `rewardLedger.proxies` in `deployments.json` together — the SDK's parity test fails if any side has an orphan key. See [`contracts/MULTICHAIN.md`](./contracts/MULTICHAIN.md) for the deploy procedure and CREATE2 derivation details.

---

## Settlement Chains

| Chain | Type | Tx Fee | Block Time | USDC |
|-------|------|--------|------------|------|
| Base | OP Stack L2 | ~$0.01 | ~2 sec | Native |
| MegaETH | EVM L2 | <$0.01 | ~10 ms | Bridge |
| World Chain | OP Stack L2 | ~$0.01-0.03 | ~2 sec | Bridge |
| Arbitrum | Nitro L2 | ~$0.01 | ~0.25 sec | Native |
| Ethereum | Mainnet | $2-50 | ~12 sec | Native |

---

## Contributing

ATLAS is an open protocol. The specification is public. Contributions are welcome via pull request.

For protocol changes, submit an RFC as a GitHub issue. The governance process (see [Governance Spec](specs/11-GOVERNANCE-SPEC.md)) determines how changes are reviewed and approved.

---

## License

[MIT](LICENSE)

---

*ATLAS Protocol is created by [Lemonade](https://lemonade.social). The protocol specification is open source.*
