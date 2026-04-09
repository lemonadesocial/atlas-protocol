# ATLAS Protocol: Governance Specification

**Version 0.1 | April 2026**

**Authors:** Lemonade

---

## 1. Overview

ATLAS governance evolves through four phases, each triggered by monthly GMV milestones. Early phases prioritize speed and iteration. Later phases transfer authority to the network's participants. No phase is calendar-driven. Each transition fires when the protocol reaches the adoption threshold.

---

## 2. Phase 0: Lemonade Stewardship (Launch to $100K GMV)

Lemonade operates all protocol infrastructure: the reference registry, settlement coordination, SDK, and reward distribution. The protocol specification is open source from day one.

**Decision authority:** Lemonade team, with input from early adopters collected through public channels (GitHub Discussions, Discord).

**RFC process for community contributions:**

1. Any participant opens a GitHub Issue with the `rfc` label
2. The issue describes the proposed change, its motivation, and its impact on existing agents and platforms
3. Lemonade reviews within 14 calendar days
4. Accepted RFCs enter the protocol spec backlog. Rejected RFCs receive a written rationale.
5. Contributors may appeal rejections. Appeals are reviewed by a second Lemonade engineer not involved in the original decision.

Lemonade publishes a quarterly transparency report covering: total GMV, active organizers, active agents, fee revenue, reward payouts, and all protocol changes made during the quarter.

---

## 3. Phase 1: Advisory Board ($100K to $1M GMV)

An advisory board of 5-7 members forms within 30 days of crossing the $100K GMV threshold.

**Composition:**

| Seat | Count | Selection |
|------|-------|-----------|
| Organizer representatives | 2 | Elected by organizers with 3+ events and $500+ GMV |
| Platform representatives | 2 | Nominated by integrated platforms with 100+ events |
| Agent developer representative | 1 | Elected by registered agents with 10+ transactions |
| Lemonade representatives | 1-2 | Appointed by Lemonade |

**Term length:** 12 months. Staggered terms: half the board rotates every 6 months after the initial term.

**Scope:** The board reviews and approves protocol changes, fee adjustments, reward structure modifications, and new chain additions. Lemonade retains operational control but commits to following advisory recommendations. If Lemonade overrides an advisory recommendation, it must publish a written explanation within 7 days.

**Meeting cadence:** Monthly, with minutes published to the protocol's governance repository within 48 hours.

---

## 4. Phase 2: Steering Committee ($1M to $10M GMV)

Governance transitions from advisory to binding. The steering committee replaces the advisory board within 60 days of crossing the $1M GMV threshold.

**Binding authority over:**

- Protocol specification changes
- Fee structure and reward allocation percentages
- Registry federation policies (node requirements, sync protocol changes)
- Grant disbursements from the protocol reserve

**Election:** $LEMON token holders elect steering committee members. One token equals one vote. Voting uses ranked-choice ballots. Lemonade holds a diminishing share of $LEMON. At Phase 2 launch, Lemonade holds no more than 40% of circulating $LEMON. The share decreases by 5 percentage points per year through scheduled token distribution to active participants.

**Committee size:** 7 members. Quorum requires 5 of 7.

**Operational control:** Lemonade continues operating infrastructure (registry, IPFS cluster, relayer services) under a service agreement approved by the committee. The committee may approve alternative operators.

---

## 5. Phase 3: ATLAS Foundation ($10M+ GMV)

A legally independent non-profit foundation assumes protocol stewardship within 180 days of crossing the $10M GMV threshold.

The foundation:

- Employs protocol developers (minimum 3 full-time engineers)
- Operates the reference registry node
- Manages the grant program (funded from the protocol reserve)
- Coordinates with regulatory bodies across jurisdictions
- Stewards the protocol specification and reference implementations
- Publishes annual audited financial statements

Lemonade becomes one participant among many. Lemonade may continue operating its own registry node, platform, and agent tools. It holds no special governance privileges beyond its $LEMON holdings.

---

## 6. Voting Mechanics

### 6.1 Proposal Submission

Any $LEMON holder with a balance exceeding 0.1% of circulating supply may submit a governance proposal. Proposals require a 100-word summary, a full specification, and an impact analysis covering affected contracts, fee changes, and migration steps.

### 6.2 Proposal Types and Parameters

| Type | Quorum | Approval | Voting Period | Timelock |
|------|--------|----------|---------------|----------|
| Fee change | 10% of supply | 66% supermajority | 7 days | 48 hours |
| Chain addition | 5% of supply | Simple majority | 5 days | 24 hours |
| Reward allocation | 10% of supply | 66% supermajority | 7 days | 48 hours |
| Grant disbursement | 5% of supply | Simple majority | 5 days | 24 hours |
| Protocol spec change | 15% of supply | 66% supermajority | 14 days | 72 hours |
| Emergency (security) | 3% of supply | 75% supermajority | 24 hours | None |

### 6.3 Execution

Approved proposals enter a timelock contract. During the timelock period, the PAUSER role may veto proposals that introduce verified security vulnerabilities. Vetoed proposals return to voting with a mandatory security audit attached.

After the timelock expires, any address may call `execute()` on the governance contract to apply the change. Failed executions emit an event log and return the proposal to "pending" status.

---

## 7. Emergency Procedures

### 7.1 Contract Pause

The PAUSER role (initially a 2-of-3 Lemonade multi-sig, later a 3-of-5 multi-sig including committee members) can pause any ATLAS contract. Pausing halts all state-modifying functions. Read operations continue. Active holds are frozen (TTL clock stops).

### 7.2 Security Patch Fast-Track

Critical vulnerabilities bypass the standard voting process. The security fast-track flow:

1. Vulnerability reported to security@atlas.events (or on-chain bounty contract)
2. PAUSER pauses affected contract within 1 hour of confirmation
3. Fix developed and audited by an independent auditor (24-72 hour target)
4. Emergency proposal submitted (24-hour vote, 75% supermajority, no timelock)
5. Patched contract deployed via UUPS upgrade

### 7.3 Post-Incident Review

Within 14 days of any emergency action, the responsible party publishes a post-incident report covering: root cause, timeline, affected users, funds at risk, resolution, and preventive measures. The steering committee (Phase 2+) or advisory board (Phase 1) reviews the report and may mandate additional safeguards.

---

## 8. Governance Contract

The on-chain governance contract (deployed at Phase 2) follows the OpenZeppelin Governor pattern:

- `GovernorVotes`: $LEMON token voting weight
- `GovernorTimelockControl`: execution delay
- `GovernorCountingSimple`: for/against/abstain counting

All governance actions emit events. A public indexer tracks proposal history, vote tallies, and execution status. The governance dashboard is open source.

---

*This document specifies governance for ATLAS Protocol. For protocol APIs, see PROTOCOL-SPEC.md. For token economics, see TOKENOMICS.md. For progressive decentralization stages, see PROGRESSIVE-DECENTRALIZATION.md.*
