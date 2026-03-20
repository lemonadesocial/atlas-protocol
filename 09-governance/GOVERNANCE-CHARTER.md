# Atlas Protocol Governance Charter

**Version:** 1.0.0-draft
**Status:** Phase 0 (Benevolent Dictatorship)
**Effective Date:** TBD
**Last Updated:** 2026-03-19

---

## Preamble

Atlas is an open protocol for agent-driven event discovery, ticketing, and settlement. It exists to serve an ecosystem of organizers, platforms, agents, and attendees -- not any single company.

This charter establishes the governance framework through which Atlas evolves from a Lemonade-led initiative into an independently governed protocol. Governance transitions are triggered by measurable adoption milestones, not arbitrary timelines, ensuring that decision-making authority expands in proportion to the community that depends on the protocol.

The charter is a living document. Its amendment process is defined in Section 9.

---

## 1. Governing Principles

All governance decisions, regardless of phase, are guided by these principles. When principles conflict, they are applied in the order listed.

### 1.1 Organizer-First

Organizers are the supply side of the ecosystem. Protocol changes that harm organizer economics, autonomy, or user experience require extraordinary justification and supermajority approval.

### 1.2 Openness

The protocol specification, reference implementations, and core SDKs are developed in the open. All governance deliberations occur in public forums. No governance decisions are made in private channels.

### 1.3 Meritocracy

Influence in governance is earned through contribution -- code, documentation, operational experience, community building, and sustained participation. Token holdings alone do not confer technical authority.

### 1.4 Stability

The protocol is infrastructure. Backwards-incompatible changes carry high coordination costs across the ecosystem. Stability is a feature, not a constraint. Breaking changes require formal RFC, extended comment periods, and migration paths.

### 1.5 Neutrality

Atlas is platform-neutral. No single platform, agent provider, or payment processor receives preferential treatment in the specification. The protocol must remain a credible neutral layer for competitors to build upon.

---

## 2. Phase 0 -- Benevolent Dictatorship

**Entry condition:** Protocol inception.
**Exit condition:** $100K cumulative GMV processed through Atlas OR 10 registered platforms, whichever comes first.

### 2.1 Decision Authority

Lemonade, Inc. ("Lemonade") holds sole decision-making authority over all protocol matters, including but not limited to:

- Specification changes
- Registry operations
- SDK releases
- Fee structures
- Partner onboarding
- Dispute resolution

### 2.2 Community Participation

While Lemonade retains final authority, community input is actively solicited through:

- **GitHub Issues:** Any community member may file issues against the specification, SDKs, or governance documents. Lemonade commits to triaging all issues within 14 calendar days.
- **Pull Requests:** External contributions to SDKs and documentation are accepted under standard open-source contribution workflows. Specification PRs are welcome but non-binding.
- **Public Roadmap:** Lemonade publishes and maintains a public roadmap (see `ROADMAP.md`) with quarterly updates.

### 2.3 Transparency Commitments

Even under sole authority, Lemonade commits to:

- Publishing all specification changes with rationale before they take effect
- Providing 30 days notice before fee structure changes
- Disclosing aggregate protocol metrics (GMV, platform count, organizer count) monthly
- Documenting all breaking changes with migration guides

### 2.4 Phase Transition

When exit conditions are met, Lemonade initiates the Phase 1 transition within 60 days. The transition includes:

1. Public announcement of Phase 1 entry
2. Open call for Community Advisory Board nominations
3. Publication of the RFC process
4. First monthly community call

---

## 3. Phase 1 -- Community Advisory

**Entry condition:** $100K cumulative GMV OR 10 registered platforms.
**Exit condition:** $1M cumulative GMV AND 25 registered platforms.

### 3.1 Community Advisory Board

A Community Advisory Board ("CAB") of 3 to 5 external members is established. CAB members are non-voting advisors who provide input on protocol direction, review RFCs, and represent ecosystem perspectives.

#### 3.1.1 Composition

- 1-2 platform operators
- 1 organizer or organizer representative
- 1 technical expert (protocol design, distributed systems, or payments)
- 0-1 agent/AI company representative

#### 3.1.2 Selection

Lemonade selects initial CAB members from active community contributors. Candidates must have at least one of: (a) a registered platform on Atlas, (b) 3+ merged contributions to Atlas repositories, (c) demonstrated expertise relevant to the protocol.

#### 3.1.3 Terms

CAB members serve 1-year terms, renewable once. Lemonade may expand the CAB to 5 members at any time. CAB members may resign with 30 days notice.

### 3.2 RFC Process

The Request for Comments (RFC) process governs all substantive protocol changes during Phase 1. See Section 7 for the detailed RFC process.

### 3.3 Decision Authority

Lemonade retains final decision-making authority on all matters. However, Lemonade commits to:

- Submitting all specification changes through the RFC process
- Documenting rationale when overriding CAB recommendations
- Never overriding unanimous CAB opposition without a 30-day public deliberation period

### 3.4 Monthly Community Calls

Lemonade hosts monthly community calls (recorded, transcript published) covering:

- Protocol metrics and adoption update
- Upcoming RFC previews
- Open Q&A (minimum 30 minutes)
- CAB member perspectives

### 3.5 Phase Transition

When exit conditions are met, Lemonade initiates the Phase 2 transition within 90 days. The transition includes:

1. Public announcement and election timeline
2. Steering Committee seat elections
3. Ratification of updated governance charter

---

## 4. Phase 2 -- Steering Committee

**Entry condition:** $1M cumulative GMV AND 25 registered platforms.
**Exit condition:** $10M cumulative GMV AND 100 registered platforms.

### 4.1 Steering Committee Composition

The Steering Committee ("SC") consists of 7 seats:

| Seat | Holder | Selection Method |
|------|--------|-----------------|
| 1 | Lemonade, Inc. | Permanent (appointed) |
| 2-3 | Platform representatives | Elected by registered platform operators (1 vote per platform) |
| 4 | Organizer representative | Elected by top-100 organizers by GMV (1 vote per organizer) |
| 5 | Agent / AI company representative | Elected by registered agent providers (1 vote per provider) |
| 6 | Independent technical expert | Nominated by SC, confirmed by community ratification vote |
| 7 | Community representative | Elected by $LEMON token holders (1 token = 1 vote, quadratic voting) |

#### 4.1.1 Terms

All elected and appointed seats (except Lemonade's permanent seat) serve 2-year terms. Members may serve a maximum of 3 consecutive terms. Elections are staggered: seats 2, 4, and 6 are elected in odd years; seats 3, 5, and 7 in even years.

#### 4.1.2 Eligibility

Candidates must disclose all material conflicts of interest. No individual may hold more than one seat. No single organization may hold more than 2 seats (including the Lemonade permanent seat).

#### 4.1.3 Vacancies

If a seat is vacated mid-term, the SC appoints an interim holder from the same constituency. A special election is held within 90 days if more than 6 months remain in the term.

### 4.2 Decision Rules

#### 4.2.1 Minor Decisions (Simple Majority -- 4 of 7)

- Non-breaking specification amendments
- SDK release approvals
- Operational policy changes
- Budget allocations under $50K
- Working group creation

#### 4.2.2 Major Decisions (Supermajority -- 5 of 7)

- Breaking specification changes
- Fee structure modifications
- New protocol extensions
- Registry operational changes
- Budget allocations over $50K
- Governance charter amendments
- Trademark licensing terms

#### 4.2.3 Quorum

A minimum of 5 SC members must participate for any vote to be valid. Lemonade's seat is counted for quorum whether or not Lemonade votes.

#### 4.2.4 Conflict of Interest

SC members must recuse themselves from votes where they have a direct financial interest beyond their general ecosystem participation. Recused members do not count toward quorum for that vote.

### 4.3 Working Groups

The SC may establish working groups for focused technical or operational areas (e.g., Payments WG, Discovery WG, Security WG). Working groups operate under charters approved by the SC and report monthly.

### 4.4 Phase Transition

When exit conditions are met, the SC initiates foundation formation. The transition includes:

1. Legal entity selection and jurisdiction
2. Asset transfer plan (registry, trademarks, repositories)
3. Foundation charter ratification (supermajority SC vote + community ratification)
4. 12-month transition period with SC operating in parallel

---

## 5. Phase 3 -- Foundation

**Entry condition:** $10M cumulative GMV AND 100 registered platforms.

### 5.1 Foundation Structure

The Atlas Foundation ("Foundation") is established as a non-profit entity with the mission of maintaining, developing, and promoting the Atlas Protocol for the benefit of the global event ecosystem.

### 5.2 Foundation Board

The Foundation Board consists of 9 seats:

| Seat | Holder | Selection Method |
|------|--------|-----------------|
| 1 | Lemonade, Inc. | Permanent (no veto power) |
| 2-3 | Platform representatives | Elected by member platforms |
| 4-5 | Organizer representatives | Elected by organizer constituency |
| 6 | Agent / AI company representative | Elected by agent providers |
| 7 | Independent technical expert | Nominated by Board, confirmed by membership |
| 8 | Community representative | Elected by $LEMON holders (quadratic voting) |
| 9 | Executive Director | Hired by the Board (non-voting, ex officio) |

#### 5.2.1 Lemonade's Role

Lemonade holds a permanent board seat but does not hold veto power. Lemonade is a member of the Foundation on equal terms with other members. This ensures continuity of institutional knowledge while preventing capture.

### 5.3 Foundation Responsibilities

- Operating the Atlas Registry
- Maintaining the protocol specification
- Publishing and maintaining reference SDKs
- Administering the RFC process
- Managing the "Atlas" trademark and certification program
- Funding ecosystem development through grants

### 5.4 Funding

The Foundation is funded through:

- **Protocol fees:** A percentage of transaction fees processed through the Atlas Registry, as defined in the Economics specification
- **Membership dues:** Tiered annual membership for platforms and organizations
- **Grants:** External grants from technology foundations, government programs, and ecosystem funds
- **Donations:** Individual and corporate donations

### 5.5 Decision Rules

The Foundation Board operates under the same decision rules as the Phase 2 Steering Committee (Section 4.2), with the following modifications:

- Quorum requires 6 of 9 members
- Supermajority is 6 of 9
- Constitutional changes (Foundation charter, dissolution) require 7 of 9 plus community ratification

---

## 6. Token Governance Integration

Token governance evolves alongside the protocol's adoption phases.

### 6.1 Token Phase 0 -- USDC Only

No governance token exists. All transactions settle in USDC.

### 6.2 Token Phase 1 -- LMC Wrapper

LMC (Lemonade Credit) is introduced as a protocol-internal accounting wrapper. LMC has no governance function. It is a technical mechanism, not a governance instrument.

### 6.3 Token Phase 2 -- $LEMON Governance Token

$LEMON is introduced as a governance token with the following properties:

- **Voting:** $LEMON holders elect the Community Representative seat on the Steering Committee (quadratic voting)
- **Proposal rights:** Holders above a threshold (defined by the SC) may submit RFCs
- **Signal voting:** Non-binding sentiment polls on protocol direction
- **No protocol fee claims:** $LEMON does not entitle holders to protocol revenue

Distribution, vesting, and anti-concentration mechanisms are defined in the Economics specification.

### 6.4 Token Phase 3 -- Dual-Token

The dual-token model introduces a utility token alongside the governance token. Governance authority remains with $LEMON. The utility token serves operational functions (staking, fee payment, priority access). The Foundation Board governs the interaction between the two tokens.

---

## 7. RFC Process

The RFC (Request for Comments) process is the formal mechanism for proposing changes to the Atlas Protocol.

### 7.1 RFC Stages

| Stage | Duration | Description |
|-------|----------|-------------|
| **0 -- Draft** | No limit | Author drafts the proposal. Not yet formally submitted. |
| **1 -- Proposal** | 7 days | Submitted to the RFC repository. Checked for completeness. |
| **2 -- Comment** | 30 days | Open for public comment. All community members may participate. |
| **3 -- Revision** | 14 days | Author addresses comments, revises proposal. |
| **4 -- Decision** | 14 days | Decision authority (per phase) accepts, rejects, or defers. |
| **5 -- Final** | -- | Accepted RFCs are assigned a number and merged into the specification. |

### 7.2 Who May Submit

- **Phase 0:** Anyone, but RFCs are non-binding (Lemonade decides).
- **Phase 1:** Anyone. CAB members may fast-track to Stage 2.
- **Phase 2:** Anyone. SC members may fast-track. $LEMON holders above threshold may submit directly to Stage 2.
- **Phase 3:** Anyone. Foundation members may fast-track.

### 7.3 Decision Authority

- **Phase 0:** Lemonade.
- **Phase 1:** Lemonade, with documented consideration of CAB input.
- **Phase 2:** Steering Committee, per decision rules in Section 4.2.
- **Phase 3:** Foundation Board, per decision rules in Section 5.5.

### 7.4 RFC Content Requirements

Every RFC must include:

1. **Abstract** -- One-paragraph summary
2. **Motivation** -- Why is this change needed? What problem does it solve?
3. **Specification** -- Precise technical description of the change
4. **Rationale** -- Why this design over alternatives?
5. **Backwards Compatibility** -- Impact on existing implementations
6. **Migration Path** -- How existing platforms/organizers transition (if breaking)
7. **Security Considerations** -- Threat analysis relevant to the change
8. **Reference Implementation** -- Link to working code (may be submitted after Stage 2)

### 7.5 Emergency RFCs

For critical security vulnerabilities or operational emergencies, the decision authority (per phase) may invoke an emergency process:

1. Private disclosure to the decision authority
2. 48-hour expedited review
3. Immediate implementation if approved
4. Public RFC filed retroactively within 7 days

---

## 8. Intellectual Property

### 8.1 Protocol Specification

Licensed under **Creative Commons Attribution 4.0 International (CC BY 4.0)**. Anyone may implement the specification. Attribution to "The Atlas Protocol" is required.

### 8.2 SDKs and Reference Implementations

Licensed under the **MIT License**. No restrictions on commercial use.

### 8.3 Registry Software

Licensed under the **Business Source License 1.1 (BSL 1.1)**. The change license is the MIT License. The change date is 3 years from each release date. This means:

- For the first 3 years after a release, the Registry software may only be used in production with a commercial license from the rights holder (Lemonade in Phase 0-1, the Foundation in Phase 3).
- After 3 years, each release automatically converts to MIT.

The purpose of this model is to protect the operational integrity of the Registry during early growth while guaranteeing eventual open-source availability.

### 8.4 Trademark

The "Atlas Protocol" and "Atlas" (in the context of event technology) trademarks are held by Lemonade, Inc. during Phases 0-2. Upon Foundation formation (Phase 3), trademarks are transferred to the Foundation under the following conditions:

- The Foundation must maintain a certification program for "Atlas Compatible" implementations
- The trademark may not be sold, sublicensed exclusively, or abandoned
- If the Foundation dissolves, trademarks revert to Lemonade or a successor entity designated by the Board

---

## 9. Amendment Process

### 9.1 Phase 0

Lemonade may amend this charter at will, with 30 days public notice before changes take effect.

### 9.2 Phase 1

Amendments require:

1. RFC process (Section 7)
2. CAB review and recommendation
3. Lemonade approval
4. 30 days notice before changes take effect

### 9.3 Phase 2

Amendments require:

1. RFC process (Section 7)
2. Supermajority SC vote (5 of 7)
3. 30-day community ratification period (no majority opposition from registered platforms)
4. 60 days notice before changes take effect

### 9.4 Phase 3

Amendments require:

1. RFC process (Section 7)
2. Constitutional supermajority Board vote (7 of 9)
3. Community ratification (majority of voting $LEMON holders, minimum 10% participation)
4. 90 days notice before changes take effect

---

## 10. Code of Conduct

### 10.1 Scope

This Code of Conduct applies to all Atlas Protocol community spaces, including GitHub repositories, community calls, forums, chat channels, and in-person events.

### 10.2 Standards

Community members are expected to:

- **Be respectful.** Disagreement is welcome; personal attacks are not. Critique ideas, not individuals.
- **Be constructive.** Propose solutions alongside problems. Engage with RFCs substantively.
- **Be inclusive.** The event ecosystem is global and diverse. Assume good faith. Accommodate different communication styles, time zones, and levels of technical expertise.
- **Be transparent.** Disclose conflicts of interest. Represent your affiliation honestly.
- **Be professional.** This is infrastructure that businesses depend on. Maintain the seriousness appropriate to that responsibility.

### 10.3 Prohibited Conduct

- Harassment, intimidation, or discrimination of any kind
- Personal attacks, trolling, or deliberately inflammatory commentary
- Spam, self-promotion unrelated to Atlas, or commercial solicitation in governance channels
- Deliberate disruption of governance processes
- Sharing private or confidential information without consent

### 10.4 Enforcement

- **Phase 0-1:** Lemonade moderates community spaces. Violations result in warnings, then temporary or permanent bans.
- **Phase 2:** The SC appoints a Code of Conduct Committee (3 members, no more than 1 from any single organization). The Committee handles reports, investigates, and recommends action to the SC.
- **Phase 3:** The Foundation maintains a permanent Code of Conduct Committee with independent authority to issue sanctions up to and including permanent bans. SC/Board member sanctions require Board vote.

### 10.5 Reporting

Reports may be submitted confidentially to `conduct@atlasprotocol.org` (or the designated governance email). All reports are reviewed within 7 days. Reporters are protected from retaliation.

---

## 11. Definitions

- **Atlas Protocol** -- The open protocol specification for agent-driven event discovery, ticketing, and settlement.
- **Registry** -- The operational infrastructure that maintains the canonical record of events, tickets, and settlements.
- **Platform** -- A software system that integrates with the Atlas Protocol to offer event functionality to its users.
- **Organizer** -- An individual or entity that creates and manages events through an Atlas-integrated platform.
- **Agent** -- An AI system that interacts with the Atlas Protocol on behalf of users for discovery, booking, or management.
- **GMV** -- Gross Merchandise Value; the total dollar value of transactions settled through the Atlas Protocol.
- **RFC** -- Request for Comments; a formal proposal for protocol changes.
- **SC** -- Steering Committee; the Phase 2 governance body.
- **CAB** -- Community Advisory Board; the Phase 1 advisory body.
- **$LEMON** -- The Atlas governance token, introduced in Token Phase 2.

---

*This charter is maintained in the Atlas Protocol governance repository. The canonical version is the one committed to the `main` branch.*
