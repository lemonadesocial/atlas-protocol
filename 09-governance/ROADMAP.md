# Atlas Protocol Strategic Roadmap

**Version:** 1.0.0-draft
**Status:** Phase 0
**Last Updated:** 2026-03-19
**Governance Reference:** See `GOVERNANCE-CHARTER.md` for phase transition rules and decision authority.

---

## Vision

### 1-Year Vision

Atlas is the default protocol for agent-driven event ticketing. Organizers on Lemonade and a growing roster of third-party platforms publish events to the Atlas Registry, where AI agents discover and book them on behalf of users. USDC settlement provides instant, global payouts. The protocol specification is stable, the SDK ecosystem is production-hardened, and governance has transitioned to community advisory.

### 3-Year Vision

Atlas powers a significant share of the global event ticketing market through a network of 100+ integrated platforms. The protocol has expanded beyond basic ticketing into recurring events, subscriptions, and ancillary services. A steering committee of platform operators, organizers, and technical experts governs the specification. The $LEMON governance token enables decentralized decision-making. Atlas is recognized as critical neutral infrastructure for the event industry.

### 5-Year Vision

The Atlas Foundation operates as an independent non-profit governing a multi-vertical commerce protocol. What began as event ticketing has expanded into adjacent verticals -- hospitality, dining, experiences -- under the "Atlas Commerce" umbrella. The protocol processes billions in annual GMV across hundreds of platforms worldwide. Governance is fully decentralized, the registry is operated by a distributed network of validators, and Atlas is to event commerce what SMTP is to email: invisible, ubiquitous, and indispensable.

---

## Phase 0 -- Foundation (Months 1-3)

**Governance:** Benevolent Dictatorship (Lemonade controls all decisions)
**Token:** USDC only
**Exit Criteria:** $100K cumulative GMV OR 10 registered platforms

### Objectives

Build the core protocol, ship the reference implementation, and onboard the first wave of organizers and platforms.

### Milestones

#### M0.1 -- Protocol Specification v1.0 (Month 1)

- [ ] Finalize and publish the Atlas Protocol Specification v1.0
- [ ] Core schemas: Event, Ticket Type, Order, Settlement
- [ ] Agent discovery protocol (search, filter, recommend)
- [ ] Payment flow specification (USDC settlement via Managed Payment Pointers)
- [ ] Registry API specification (REST + WebSocket)
- [ ] Security model and authentication specification
- [ ] Publish specification under CC BY 4.0

#### M0.2 -- Reference Implementation (Month 2)

- [ ] Atlas Registry reference implementation (production-grade)
- [ ] Event lifecycle management (create, publish, update, cancel)
- [ ] Ticket type management and inventory control
- [ ] Order processing and USDC settlement
- [ ] Agent authentication and rate limiting
- [ ] Monitoring, logging, and operational tooling
- [ ] Deploy to production infrastructure

#### M0.3 -- SDK and Developer Experience (Month 2)

- [ ] TypeScript/JavaScript SDK (npm package)
- [ ] Event publishing and management
- [ ] Ticket type CRUD
- [ ] Order creation and settlement queries
- [ ] Agent discovery client
- [ ] Developer documentation site
- [ ] Quickstart guides for organizers, platforms, and agents
- [ ] API reference (auto-generated from OpenAPI spec)

#### M0.4 -- Platform Integrations (Months 2-3)

- [ ] Lemonade platform integration (dogfooding)
- [ ] OAuth 2.0 connect flow for organizer onboarding
- [ ] Platform registration and API key management
- [ ] 2 additional early-adopter platform integrations
- [ ] Integration testing suite for platform partners

#### M0.5 -- Organizer Onboarding (Month 3)

- [ ] Onboard 100 organizers through Lemonade integration
- [ ] Organizer dashboard for Atlas event management
- [ ] Settlement reporting and payout tracking
- [ ] Support documentation and FAQ

### Success Metrics

| Metric | Target |
|--------|--------|
| Cumulative GMV | $100K |
| Registered platforms | 3-10 |
| Active organizers | 100 |
| Events published to Atlas | 500 |
| SDK downloads (npm) | 1,000 |
| Specification issues filed | 25+ (sign of engagement) |
| Mean settlement time | < 24 hours |

---

## Phase 1 -- Growth (Months 3-9)

**Governance:** Community Advisory (CAB established, RFC process live)
**Token:** LMC wrapper introduced
**Exit Criteria:** $1M cumulative GMV AND 25 registered platforms

### Objectives

Scale the ecosystem, harden the protocol through real-world usage, expand SDK coverage, and establish community governance foundations.

### Milestones

#### M1.1 -- Ecosystem Expansion (Months 3-6)

- [ ] Onboard 1,000 active organizers
- [ ] Reach 25 registered platforms
- [ ] Onboard 5 Atlas-native platforms (built on Atlas from the ground up)
- [ ] Launch partner program with tiered benefits
- [ ] Establish platform operator communication channel

#### M1.2 -- SDK Expansion (Months 4-6)

- [ ] Python SDK (PyPI package)
- [ ] Event publishing and management
- [ ] Agent discovery client
- [ ] Settlement queries
- [ ] Go SDK (initial release)
- [ ] Mobile SDK evaluation (React Native, Flutter)

#### M1.3 -- Protocol Tooling (Months 4-7)

- [ ] Atlas Validator -- automated compliance checker for platform implementations
- [ ] Validates event schema conformance
- [ ] Tests settlement flow correctness
- [ ] Checks agent discovery protocol compliance
- [ ] Issues "Atlas Compatible" certification badge
- [ ] Atlas Explorer -- public dashboard for protocol metrics
- [ ] Real-time GMV, event count, platform count
- [ ] Settlement status and latency metrics
- [ ] Geographic distribution of events

#### M1.4 -- Specification v1.1 -- Enhanced Discovery (Months 5-8)

- [ ] RFC process for v1.1 changes (first formal RFCs)
- [ ] Enhanced agent discovery protocol
- [ ] Semantic search capabilities
- [ ] Personalization signals (opt-in, privacy-preserving)
- [ ] Multi-agent coordination protocol
- [ ] Rich event metadata extensions
- [ ] Venue capacity and layout data
- [ ] Accessibility information
- [ ] Media attachments (images, video previews)

#### M1.5 -- Governance Establishment (Month 3-4)

- [ ] Appoint Community Advisory Board (3-5 members)
- [ ] Launch RFC repository and process
- [ ] Begin monthly community calls
- [ ] Publish first quarterly transparency report

### Success Metrics

| Metric | Target |
|--------|--------|
| Cumulative GMV | $1M |
| Registered platforms | 25 |
| Atlas-native platforms | 5 |
| Active organizers | 1,000 |
| Events published to Atlas | 5,000 |
| SDK downloads (all languages) | 10,000 |
| RFCs submitted | 10+ |
| Community call attendance | 50+ per call |
| Validator certifications issued | 15 platforms |
| Mean settlement time | < 12 hours |

---

## Phase 2 -- Scale (Months 9-18)

**Governance:** Steering Committee (7 elected/appointed seats)
**Token:** $LEMON governance token launched
**Exit Criteria:** $10M cumulative GMV AND 100 registered platforms

### Objectives

Achieve protocol-market fit at scale, launch governance token, begin multi-vertical exploration, and establish the protocol as industry-standard infrastructure.

### Milestones

#### M2.1 -- Ecosystem Scale (Months 9-14)

- [ ] Reach 10,000 active organizers
- [ ] Reach 100 registered platforms
- [ ] Expand to 20+ countries with active events
- [ ] Enterprise platform partnerships (ticketing incumbents, venue management systems)
- [ ] Agent ecosystem: 50+ registered agent providers

#### M2.2 -- Specification v1.2 -- Recurring Events and Subscriptions (Months 10-14)

- [ ] Recurring event support (weekly, monthly, custom cadences)
- [ ] Subscription ticketing (season passes, memberships)
- [ ] Multi-event packages and bundles
- [ ] Waitlist and dynamic pricing protocols
- [ ] Enhanced cancellation and refund flows

#### M2.3 -- Protocol Extensions -- Vertical Exploration (Months 12-18)

- [ ] Atlas Extensions Framework (formal mechanism for vertical-specific additions)
- [ ] Hospitality Extension (exploratory)
- [ ] Hotel room availability and booking
- [ ] Integration with property management systems
- [ ] Restaurant / Dining Extension (exploratory)
- [ ] Table reservation protocol
- [ ] Menu and dietary information schema
- [ ] Extension registry and discovery mechanism

#### M2.4 -- $LEMON Token Launch (Months 10-12)

- [ ] Token design finalization (supply, distribution, vesting)
- [ ] Smart contract audit (2 independent auditors)
- [ ] Token generation event
- [ ] Governance integration (Community Representative seat election)
- [ ] Anti-concentration mechanisms active

#### M2.5 -- Steering Committee Formation (Month 9-10)

- [ ] Election process for 6 non-permanent seats
- [ ] Steering Committee inaugural meeting
- [ ] Working group establishment (Payments WG, Discovery WG, Security WG)
- [ ] Transition decision authority per Governance Charter

#### M2.6 -- Specification v2.0 -- Multi-Vertical Foundation (Months 15-18)

- [ ] Generalized commerce primitives (abstract from events-only)
- [ ] Unified settlement protocol across verticals
- [ ] Cross-vertical agent discovery
- [ ] Formal specification verification (machine-readable spec)

### Success Metrics

| Metric | Target |
|--------|--------|
| Cumulative GMV | $10M |
| Registered platforms | 100 |
| Active organizers | 10,000 |
| Agent providers | 50 |
| Events published to Atlas | 50,000 |
| Countries with active events | 20+ |
| $LEMON holder count | 5,000+ |
| SC voter participation | 60%+ of eligible voters |
| Protocol uptime | 99.95% |
| Mean settlement time | < 6 hours |

---

## Phase 3 -- Independence (Month 18+)

**Governance:** Independent Foundation (9-seat board, Lemonade permanent without veto)
**Token:** Dual-token model ($LEMON governance + utility token)

### Objectives

Establish the Atlas Foundation as an independent non-profit, decentralize registry operations, and expand into "Atlas Commerce" as a multi-vertical protocol.

### Milestones

#### M3.1 -- Foundation Formation (Months 18-24)

- [ ] Legal entity established (jurisdiction TBD -- Switzerland, Singapore, or Cayman evaluated)
- [ ] Trademark transfer from Lemonade to Foundation
- [ ] Registry operational transfer
- [ ] Repository ownership transfer
- [ ] Foundation Board inaugural meeting
- [ ] Executive Director hired
- [ ] Foundation funding model operational

#### M3.2 -- Decentralized Registry (Months 20-30)

- [ ] Registry federation protocol (multiple registry operators)
- [ ] Consensus mechanism for cross-registry consistency
- [ ] Geographic distribution (minimum 3 continents)
- [ ] Registry operator staking and incentive model
- [ ] Graceful degradation and partition tolerance

#### M3.3 -- Atlas Commerce (Months 24-36)

- [ ] Rebrand protocol layer as "Atlas Commerce Protocol"
- [ ] Hospitality vertical production launch
- [ ] Dining vertical production launch
- [ ] Experiences vertical (tours, activities, classes)
- [ ] Unified cross-vertical agent interface
- [ ] Composite booking protocol (event + hotel + dinner in one transaction)

#### M3.4 -- Dual-Token Model (Months 20-24)

- [ ] Utility token design and audit
- [ ] Migration path for existing $LEMON holders
- [ ] Staking mechanisms for registry operators
- [ ] Fee payment in utility token (USDC alternative)
- [ ] Priority access and premium features via utility token

### Success Metrics

| Metric | Target |
|--------|--------|
| Annual GMV | $100M+ |
| Registered platforms | 500+ |
| Active organizers | 100,000+ |
| Verticals with production traffic | 3+ |
| Foundation annual budget | $5M+ |
| Registry operators | 10+ (3+ continents) |
| Protocol uptime | 99.99% |
| Time to settlement | < 1 hour |

---

## Protocol Extension Roadmap

The protocol specification evolves through versioned releases:

### v1.0 -- Events (Phase 0)

The foundational release. Covers the complete lifecycle of event discovery, ticketing, and settlement.

- Event schema and lifecycle
- Ticket type management
- Order processing and USDC settlement
- Agent discovery protocol
- Platform and organizer registration
- Authentication and authorization

### v1.1 -- Enhanced Discovery (Phase 1)

Deepens the agent experience with richer discovery capabilities.

- Semantic search and filtering
- Personalization signals (privacy-preserving)
- Multi-agent coordination
- Rich media metadata
- Venue and accessibility data
- Geographic and temporal search enhancements

### v1.2 -- Recurring and Subscriptions (Phase 2)

Extends the protocol to cover ongoing relationships between organizers and attendees.

- Recurring event definitions and scheduling
- Subscription and membership ticketing
- Multi-event packages and season passes
- Dynamic pricing protocol
- Enhanced cancellation, refund, and transfer flows

### v2.0 -- Multi-Vertical (Phase 2-3)

Generalizes Atlas from event-specific to commerce-general.

- Abstract commerce primitives (replacing event-specific schemas)
- Vertical extension framework
- Unified settlement across verticals
- Cross-vertical agent discovery and booking
- Composite transaction protocol
- Formal machine-readable specification

### v2.1+ -- Future (Phase 3+)

Speculative extensions considered by the community:

- Decentralized identity integration
- Cross-chain settlement (beyond a single chain)
- AI-native protocol features (agent-to-agent negotiation, dynamic pricing by agents)
- Real-world asset tokenization (ticket NFTs with actual utility)
- Privacy-preserving analytics protocol

---

## Risk Milestones

Strategic decision points where the protocol direction may need to pivot based on observed conditions.

### R1 -- Market Validation Gate (Month 3)

**Decision:** Does the B2C organizer onboarding model generate sufficient organic growth?

- **Proceed if:** 100+ organizers onboarded, 50%+ activation rate, positive NPS
- **Pivot if:** < 50 organizers, < 25% activation, or negative feedback on protocol complexity
- **Pivot options:** Simplify to pure B2B (SDK-only model), reduce scope to settlement-only protocol

### R2 -- Platform Adoption Gate (Month 6)

**Decision:** Are third-party platforms willing to integrate Atlas?

- **Proceed if:** 10+ platforms integrated or in pipeline, 3+ Atlas-native platforms building
- **Pivot if:** < 5 platforms, resistance to USDC settlement, or competitive protocol emerging
- **Pivot options:** Offer fiat settlement alongside USDC, open-source the registry entirely, pursue strategic partnership with a major ticketing platform

### R3 -- Settlement Economics Gate (Month 9)

**Decision:** Is the USDC settlement model economically sustainable at scale?

- **Proceed if:** Settlement costs < 1% of GMV, mean settlement < 12 hours, no regulatory blockers
- **Pivot if:** Settlement costs exceed 2%, regulatory challenges in key markets, or chain congestion issues
- **Pivot options:** Multi-chain settlement, fiat rails as primary with crypto as option, hybrid settlement model

### R4 -- Governance Readiness Gate (Month 12)

**Decision:** Is the community mature enough for shared governance?

- **Proceed if:** 25+ platforms, active RFC participation, 3+ viable SC candidates per seat
- **Pivot if:** < 15 platforms, minimal RFC engagement, governance apathy
- **Pivot options:** Extend Phase 1, reduce SC to 5 seats, delay token launch

### R5 -- Multi-Vertical Viability Gate (Month 18)

**Decision:** Should Atlas expand beyond events?

- **Proceed if:** Strong demand signals from platforms, 2+ verticals with willing pilot partners, clear protocol generalization path
- **Pivot if:** Event vertical still growing rapidly (focus > diversification), no clear demand, generalization would compromise event UX
- **Pivot options:** Remain events-only, license the pattern to independent vertical protocols, pursue only closely adjacent verticals (conferences + hotels)

---

## Dependencies

### Critical Dependencies

| Dependency | Impact | Mitigation |
|-----------|--------|------------|
| **Managed Payment Pointers (MPP) adoption** | Core to Atlas settlement model. Platforms must support MPP for USDC payouts. | Provide MPP setup tooling and documentation. Offer white-glove onboarding for first 25 platforms. Maintain fallback to direct USDC transfer. |
| **Tempo stability** | Real-time settlement depends on Tempo's throughput and uptime. | Multi-chain readiness in specification (abstract settlement layer). Monitor Tempo performance. Maintain 30-day settlement reserve for manual intervention. |
| **Stripe MPP access** | Stripe's Managed Payment Pointer program is invite-only. Atlas platforms need access for fiat-to-USDC bridging. | Early engagement with Stripe partnership team. Document alternative payment processors. Build processor-agnostic payment abstraction. |
| **USDC regulatory clarity** | Stablecoin regulation varies by jurisdiction and is evolving. | Monitor regulatory developments in key markets (US, EU, Singapore). Design settlement protocol to support multiple stablecoins. Prepare fiat fallback. |

### Non-Critical Dependencies

| Dependency | Impact | Mitigation |
|-----------|--------|------------|
| AI agent ecosystem maturity | Limits demand-side adoption if agents cannot effectively discover and book events. | Provide reference agent implementation. Partner with leading agent platforms (OpenAI, Anthropic, Google). Lower integration barrier with pre-built connectors. |
| Developer community growth | Limits SDK coverage and tooling development. | Developer relations program. Hackathons. Grant program for SDK contributions. |
| Event industry digitization | Markets with low digital ticketing adoption are harder to penetrate. | Focus initial growth on digitally mature markets (US, EU, Japan, South Korea). Provide mobile-first tooling for emerging markets. |

---

## Success Metrics Summary

| Metric | Phase 0 | Phase 1 | Phase 2 | Phase 3 |
|--------|---------|---------|---------|---------|
| Cumulative GMV | $100K | $1M | $10M | $100M+ annual |
| Registered platforms | 3-10 | 25 | 100 | 500+ |
| Active organizers | 100 | 1,000 | 10,000 | 100,000+ |
| Events on Atlas | 500 | 5,000 | 50,000 | 500,000+ |
| Settlement time (mean) | < 24h | < 12h | < 6h | < 1h |
| Protocol uptime | 99.9% | 99.9% | 99.95% | 99.99% |
| SDK languages | 1 (TS) | 2 (TS, Python) | 3+ | 5+ |
| Community RFCs | -- | 10+ | 50+ | 100+/year |
| Governance participation | -- | CAB active | 60%+ voter turnout | Foundation operational |

---

*This roadmap is a living document maintained alongside the Governance Charter. Updates follow the RFC process appropriate to the current governance phase. Timelines are targets, not commitments -- phase transitions are triggered by adoption milestones, not calendar dates.*
