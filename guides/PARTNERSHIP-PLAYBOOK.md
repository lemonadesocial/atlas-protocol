# ATLAS Protocol: Partnership Playbook

> Do not ask platforms to integrate. Let organizers make it inevitable.

---

## 1. Strategic Framework

### Bottom-Up: Start with the Organizer

ATLAS does not need platform cooperation to launch. Organizers own their accounts on Eventbrite, Lu.ma, Meetup, and every other platform. They can authorize third-party access via OAuth. No platform approval required.

The sequence:

1. ATLAS builds OAuth connectors that read event data through organizer-authorized tokens.
2. Organizers connect their accounts. Inventory enters the ATLAS registry.
3. Agents discover and book events. Platforms see ATLAS traffic in their API logs.
4. ATLAS approaches the platform: "Your organizers are already here. Want control over how your events appear?"
5. The platform integrates officially. Better data, revenue share, co-marketing.

Platforms cannot block organizer-authorized OAuth access without violating their own API terms and alienating power users. The bottom-up path is structurally protected.

### Top-Down: Traffic Forces the Conversation

As ATLAS-sourced traffic grows, integration shifts from a technical curiosity to a business decision. Platforms that integrate get first-class agent access. Platforms that refuse lose discoverability. Competing platforms already on ATLAS create urgency.

The two strategies compound. Bottom-up creates inventory. Top-down creates trust. Together, they create a standard.

---

## 2. Platform Partnership Tiers

**Level 1: Passive.** ATLAS imports events via organizer OAuth. The platform is unaware or indifferent. Adapters are read-heavy, write-light. Discovery works. Booking deep-links to the platform's native checkout.

**Level 2: Acknowledged.** The platform is aware of ATLAS traffic. Informal contact established. The platform has not integrated but does not block access. Data-sharing conversations begin.

**Level 3: Integrated.** The platform serves a `/.well-known/atlas.json` endpoint. Events are natively discoverable by agents. The platform controls how its events appear in ATLAS results. Revenue share is active. Joint announcements happen.

**Level 4: Native.** The platform builds ON ATLAS as infrastructure. ATLAS handles discovery, settlement, and agent access. The platform focuses on curation, community, and brand. New platforms in this tier ship with agent discoverability from day one.

Each tier reduces platform risk and increases their incentive to go deeper.

---

## 3. Agent Ecosystem Partnerships

### MCP Server and Tool Registries

The ATLAS MCP server is listed in agent tool registries. Any agent that supports MCP can discover and book events through ATLAS without custom integration work.

### Framework Integrations

Integration guides and pre-built connectors for major agent frameworks: LangChain, CrewAI, AutoGen. The `@atlas/client` SDK and `lemonade-cli` are published to npm, PyPI, and Homebrew with structured JSON output for AI coding assistants.

### Agent Platform Partnerships

Direct partnerships with OpenAI, Anthropic, and Google for featured ATLAS integration. The pitch: "Give your agent the ability to find and book events. One SDK. Every event. Every platform." ATLAS reduces agent-side integration work from N platform APIs to one protocol.

### Success Metric

50 agent implementations using ATLAS within 12 months of launch.

---

## 4. Ad-Network as Partnership Lever

The ATLAS ad-network is a structural incentive for platform integration. It operates on a pay-per-sale model: organizers set a USDC bid per ticket sold. Promotions surface through agents at the moment of purchase intent, not during passive scrolling.

**Revenue splits on promotion bids:**

| Recipient | Share | Role |
|-----------|-------|------|
| Referring agent | 60% | Incentive to surface relevant promotions |
| Protocol treasury | 30% | Protocol revenue stream |
| Registry node | 10% | Infrastructure incentive |

**Why platforms care.** Platforms that integrate at Level 3+ give their organizers access to the ad-network. Organizer promotion spend flows through ATLAS. Platforms earn referral fees on agent-driven sales. The ad-network turns integration from a cost center into a revenue stream.

**The comparison with Meta/Google ads.** A $100 budget on Meta buys 11-20 clicks at $5-9 CPC, converting to 0.4-1 sales. The same $100 on ATLAS at a $2 per-sale bid buys 50 confirmed ticket sales. Pay-per-sale eliminates the conversion funnel entirely.

Platforms that integrate early get their organizers access to this channel first. Platforms that delay watch their competitors' organizers capture agent-mediated demand.

---

## 5. Organizer Acquisition Channels

### Direct Outreach

Target the top 1,000 Eventbrite organizers by event volume. These organizers run 100+ events per year and carry outsized influence in the organizer community. Their adoption creates signal for the platform.

### Creator Economy Partnerships

Partner with organizer communities, creator economy platforms, and event industry associations. Frame: "Your members' events become discoverable by every AI agent on the internet."

### Content Marketing

Publish practical content: "How AI agents are changing event discovery." Position ATLAS as the infrastructure layer that makes organizer events agent-accessible. Target organizer-facing channels, not developer channels.

### Referral Program

Organizers invite organizers. Connected organizers earn USDC rewards when their referrals sell tickets through ATLAS. Social proof is built into the reward structure.

### Success Metric

1,000 connected organizers within 6 months of launch.

---

## 6. Success Metrics Summary

| Metric | Target | Timeline |
|--------|--------|----------|
| Connected organizers | 1,000 | 6 months |
| Platform integrations (Level 2+) | 5 | 12 months |
| Platforms built ON ATLAS (Level 4) | 20 | 24 months |
| Agent implementations | 50 | 12 months |
| Ad-network live | Phase 1 (basic bids) | $500K GMV trigger |

---

## 7. Objection Handling

**"Agents bypass our platform."** ATLAS does not bypass platforms. It drives traffic to them. The agent books through ATLAS, which calls the platform's API. The platform earns its standard fee. ATLAS adds 2% on top, paid by the buyer. Net result: incremental sales the platform would not have received otherwise.

**"We have our own API."** ATLAS is a schema standard, not a competing API. Implementing the ATLAS schema on top of an existing API gives instant compatibility with every ATLAS-connected agent. No need to build separate integrations for ChatGPT, Claude, Gemini, and every custom agent.

**"Our organizers have not asked for this."** Early-adopter organizers connect independently. They see agent-driven bookings their peers do not. They talk about it. Non-connected organizers ask how to get the same results. Official integration from the platform is what organizers want next.

**"We do not want to be aggregated."** ATLAS is an open protocol with independent governance. No single entity controls it. Platform data stays on the platform. ATLAS defines how agents query events, not where events live. Platforms that integrate get a seat at the governance table.

---

*Partnership tiers are not exclusive. A platform can exist at multiple levels simultaneously as different organizer cohorts connect independently. The goal is not to negotiate partnerships. The goal is to make ATLAS so useful to organizers that platform integration becomes the obvious business decision.*
