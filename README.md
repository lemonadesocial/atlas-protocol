# ATLAS Protocol

**Agent Ticketing, Listing, And Settlement**

ATLAS is an open protocol that makes every event on the internet discoverable, bookable, and settleable by software agents. On the guest side, AI agents find and purchase tickets through a standard HTTP 402 flow. On the organizer side, the same agent infrastructure creates events, manages guest relationships through decentralized CRM, and reaches new audiences through a protocol-native ad-network.

Event data is stored on IPFS for permanence. Settlement occurs in USDC on any supported EVM chain. The protocol charges a flat 2% fee and returns value to participants through USDC cashback.

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
| [03 Settlement](specs/03-SETTLEMENT-SPEC.md) | Chain-agnostic settlement: Base, MegaETH, World Chain, Arbitrum, Ethereum. USDC routing, Stripe SPT integration, gas optimization. |
| [04 Smart Contracts](specs/04-SMART-CONTRACTS-SPEC.md) | Five Solidity contracts: FeeRouter, AtlasTicket (ERC-721), RewardLedger, RegistryPointer, PromotionSettlement. Function signatures, access control, upgrade paths. |
| [05 IPFS Data Layer](specs/05-IPFS-DATA-LAYER.md) | IPFS as the permanence layer: publishing pipeline, CID generation, cluster operations, receipt storage, fallback resolution. |
| [06 XMTP CRM](specs/06-XMTP-CRM-SPEC.md) | Decentralized CRM on XMTP: channel establishment, data model, key management, segment queries, messaging, privacy, portability. |
| [07 Ad-Network](specs/07-AD-NETWORK-SPEC.md) | Protocol-native advertising: campaign model, pay-per-sale bidding, agent relevance, settlement (60/30/10 split), economics vs Meta/Google. |
| [08 Agent Ecosystem](specs/08-AGENT-ECOSYSTEM-SPEC.md) | Two-sided agent layer: 9 MCP tools, lemonade-cli reference, @atlas/client SDK, @atlas/server-sdk, agent identity, Space as Platform. |
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

## Quick Start

**For agent developers:**
```bash
npm install @atlas/client
```

**For platform integrators:**
```bash
npm install @atlas/sdk
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
