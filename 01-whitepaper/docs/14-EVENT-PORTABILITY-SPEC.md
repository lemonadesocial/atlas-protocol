# 14: Event Portability Specification

**ATLAS Protocol | Version 0.1 | May 2026**

**Status:** Draft

**References:** [01-PROTOCOL-SPEC §1.4](./01-PROTOCOL-SPEC.md#14-event-urn-format), [02-SCHEMAS §2](./02-SCHEMAS.md#2-atlasevent), [02-SCHEMAS §10](./02-SCHEMAS.md#10-platform), [13-FEDERATION-SPEC](./13-FEDERATION-SPEC.md), [10-PROGRESSIVE-DECENTRALIZATION §12](./10-PROGRESSIVE-DECENTRALIZATION.md#12-phase-sequencing-phase-5-onward)

---

## 1. Overview

Organizers move events between platforms. A Lu.ma host migrates to a Lemonade-hosted Space. An Eventbrite Org consolidates onto a single platform. A community decides to split off a meetup series under its own domain. Without protocol support, these moves shatter the historical record: ticket buyers lose access, search results dangle, the event's history fragments across two systems with no canonical link.

ATLAS solves this with a **URN supersession** model. The original URN remains permanent. The original platform's sales record stays immutable. A signed transfer intent declares a new canonical URN. Registries propagate the supersession through the federation sync protocol. Agents resolving the old URN see `successor_urn` and can route discovery to the new home while still honoring the old platform's tickets.

This document specifies:

- The URN supersession primitive (Section 2)
- The signed transfer intent (Section 3)
- Registry propagation via federation (Section 4)
- Sales-history immutability rules (Section 5)
- Within-platform vs. cross-platform transfer (Section 6)
- Reverse and dispute mechanics (Section 7)

The transfer protocol is the Phase 5.5 deliverable in the protocol roadmap.

---

## 2. URN Supersession

Every ATLAS event has a stable URN per [01-PROTOCOL-SPEC §1.4](./01-PROTOCOL-SPEC.md#14-event-urn-format):

```
urn:atlas:event:<resolver-domain>:<platform-event-id>
```

When an event transfers from Platform A to Platform B, two things happen:

1. **A new URN is minted on Platform B** with B's resolver domain and B's platform-internal event id. This URN is canonical going forward.
2. **The old URN on Platform A is marked `superseded_by: <new URN>`.** It is NOT deleted. It remains resolvable. Its sales history remains immutable.

In schema terms, the AtlasEvent record on Platform A gets:

- `atlas:availability` set to `"superseded"`.
- `atlas:successor_urn` set to the new URN.

The AtlasEvent on Platform B is a fresh record with no `successor_urn`, but its registry metadata records `predecessor_urn` for back-resolution.

```json
// On Platform A (Eventbrite, after transfer)
{
  "atlas:urn": "urn:atlas:event:eventbrite.com:1234567890",
  "atlas:platform_id": "eventbrite.com",
  "atlas:availability": "superseded",
  "atlas:successor_urn": "urn:atlas:event:lemonade.social:65f9a2c14b1d2e0001a3f5b7",
  "name": "Late Night Jazz at Nublu",
  "startDate": "2026-04-15T21:00:00-04:00",
  ...
}

// On Platform B (Lemonade, after transfer)
{
  "atlas:urn": "urn:atlas:event:lemonade.social:65f9a2c14b1d2e0001a3f5b7",
  "atlas:platform_id": "lemonade.social",
  "atlas:availability": "available",
  "atlas:predecessor_urn": "urn:atlas:event:eventbrite.com:1234567890",
  "name": "Late Night Jazz at Nublu",
  "startDate": "2026-04-15T21:00:00-04:00",
  ...
}
```

Agents resolving the old URN see `superseded` + `successor_urn` and follow the chain. Agents resolving the new URN see `predecessor_urn` and can reconstruct the history if needed (e.g. to merge ticket-holder lists at check-in).

---

## 3. Signed Transfer Intent

An organizer initiates a transfer by signing a **transfer intent**: a structured declaration that they own both the old URN and the new URN and authorize the link. The signature is checked by both platforms and by every registry that observes the supersession.

### 3.1 Intent Structure

```json
{
  "@type": "AtlasTransferIntent",
  "predecessor_urn": "urn:atlas:event:eventbrite.com:1234567890",
  "successor_urn": "urn:atlas:event:lemonade.social:65f9a2c14b1d2e0001a3f5b7",
  "organizer_did": "did:web:bjc.events",
  "issued_at": "2026-05-03T10:00:00Z",
  "reason": "platform_consolidation",
  "preserve_sales_history": true
}
```

The intent is signed by the organizer's DID-resolved key. The signature is a JWS over the canonicalized JSON (JCS, RFC 8785) using ES256.

### 3.2 Intent Validation

A platform receiving a transfer intent validates:

1. The signature resolves to the organizer DID stated in `organizer_did`.
2. The organizer DID is the registered organizer of `predecessor_urn` on the predecessor platform AND the new event being created on the successor platform.
3. The predecessor URN is not already superseded (no chain of length > 2 in a single transaction; multi-hop transfers require sequential intents, each individually signed).
4. The successor URN does not yet exist or is being created in the same transaction.
5. `issued_at` is within the last 24 hours (intents do not pre-date or back-date).

If validation passes, the predecessor platform updates its AtlasEvent record (sets `atlas:availability = "superseded"` and `atlas:successor_urn`), and the successor platform creates the new AtlasEvent with `atlas:predecessor_urn`. Both platforms persist a copy of the signed intent. The intent's IPFS CID is included in the federation change record (Section 4) for auditability.

### 3.3 Intent Revocation

A signed intent can be revoked **only before it has been propagated to any registry**. Once any registry has indexed the supersession, revocation requires a new signed intent with `reason: "transfer_reversal"` (see Section 7).

---

## 4. Registry Propagation via Federation

Registries learn about transfers through the existing federation change feed defined in [13-FEDERATION-SPEC §4](./13-FEDERATION-SPEC.md#4-pull-based-peer-sync). The transfer surfaces as an `event_superseded` change record:

```json
{
  "kind": "event_superseded",
  "event_urn": "urn:atlas:event:eventbrite.com:1234567890",
  "successor_urn": "urn:atlas:event:lemonade.social:65f9a2c14b1d2e0001a3f5b7",
  "transfer_intent_cid": "bafy...",
  "transfer_intent_signature": "z3FXs1...",
  "ts": "2026-05-03T10:43:00Z"
}
```

Each receiving registry:

1. Fetches the signed intent by CID.
2. Re-validates the signature against the organizer's DID.
3. Confirms the predecessor URN is currently in its index and not already superseded.
4. Updates its index: marks the predecessor as `superseded`, records the successor URN, updates discovery rankings to point new traffic at the successor.

Registries that follow each other converge on the same supersession state without any single registry being authoritative. Registries that fail to validate the intent log the failure and skip the change (the federation feed is fault-tolerant; see [13-FEDERATION-SPEC §4.4](./13-FEDERATION-SPEC.md#44-trust-boundary)).

### 4.1 Idempotency

`event_superseded` is idempotent at the receiver. A registry that has already processed a supersession ignores duplicates without error.

### 4.2 Conflicts

Two transfer intents for the same predecessor URN are conflicting. Resolution: registries adopt the intent with the earlier `issued_at` timestamp. The losing intent is rejected and logged. Organizers SHOULD coordinate with their platforms to avoid concurrent intents; the protocol resolves conflicts deterministically but does not prevent them.

---

## 5. Sales-History Immutability

The single most important rule of the transfer protocol:

**Sales that completed on Platform A stay on Platform A. They are not migrated, not re-issued, not duplicated, not invalidated.**

Rationale:

- Receipts (W3C Verifiable Credentials) signed by Platform A reference the predecessor URN. Re-signing them under the successor URN would forge new credentials and break receipt verifiability.
- Refunds for Platform A sales are processed by Platform A's FeeRouter deployment, against the FeeSplit recipients recorded at sale time. Platform B has no record of those settlements.
- The buyer holds a receipt with the predecessor URN. That receipt remains valid for entry to the (physical) event regardless of which platform now hosts the listing.

### 5.1 New Sales Go to the Successor

Once supersession propagates, registries route new discovery traffic at the successor URN. New ticket holds, settlements, mints, and receipts use Platform B's contracts and Platform B's signing key. Platform A continues to honor its existing sales but stops accepting new ones (its `atlas:availability` is `superseded`, not `available`).

Operationally, Platform A's purchase endpoint MAY return a 410 Gone with a body redirecting to the successor:

```json
{
  "error": "event_superseded",
  "message": "This event has moved to a new platform.",
  "successor_urn": "urn:atlas:event:lemonade.social:65f9a2c14b1d2e0001a3f5b7",
  "successor_purchase_url": "https://lemonade.social/atlas/v1/purchase/65f9a2c14b1d2e0001a3f5b7"
}
```

### 5.2 Check-In Across Platforms

At the venue, the check-in app verifies receipts against both platforms' signing keys. The receipt's `event_urn` resolves through `predecessor_urn`/`successor_urn` chains to the same physical event. Implementations SHOULD use the wallet aggregator endpoint defined in [08-AGENT-ECOSYSTEM-SPEC §2.5](./08-AGENT-ECOSYSTEM-SPEC.md#25-atlas_list_my_tickets-wallet-aggregator) to fetch all of the buyer's tickets across both URNs in a single call.

### 5.3 Ticket-Holder List Reconstruction

The successor platform MAY request a ticket-holder summary from the predecessor for check-in coordination. This is **out of band** of the protocol — neither registries nor the IPFS layer carry per-buyer data. The two platforms negotiate this directly under their existing data-sharing terms with the organizer's consent.

---

## 6. Within-Platform vs. Cross-Platform Transfer

Two cases must be distinguished:

### 6.1 Within-Platform (Internal)

A Lemonade Space owner moving an event from one of their Spaces to another (both under `lemonade.social`). The URN does NOT change because the resolver domain stays the same and the platform-internal event id stays the same — only the `atlas:organizer_id` (the Space) updates. This is platform-internal bookkeeping. No transfer intent is required at the protocol layer. The platform handles it through its existing organizer-management UI.

Similarly, a host moving an event between two Lu.ma calendars they own is internal to `lu.ma`.

### 6.2 Cross-Platform (Protocol)

The event's resolver domain changes (e.g. `eventbrite.com` → `lemonade.social`). The URN itself changes. A signed transfer intent is required. Sections 2-5 of this document apply.

The decision is purely based on whether the URN's `<resolver-domain>` segment changes. If yes, it is a cross-platform transfer; if no, it is internal.

---

## 7. Reverse and Dispute Mechanics

### 7.1 Voluntary Reversal

If the organizer decides to undo a transfer (e.g. the new platform doesn't work out), they sign a new transfer intent with `reason: "transfer_reversal"` and `predecessor_urn` and `successor_urn` swapped. The original predecessor URN is reactivated (`atlas:availability` returns to `available`); the original successor URN is marked `superseded` pointing back at the predecessor.

Receipts issued during the brief tenure of the original successor remain valid under that URN. Sales-history immutability applies in both directions: any sales completed on the successor stay there.

### 7.2 Dispute

If the predecessor platform contests the supersession (e.g. the organizer DID was compromised), it MAY publish a `transfer_dispute` change to the federation feed, pointing at the disputed transfer intent and providing counter-evidence (e.g. the platform's own organizer-of-record record). Registries faced with a contested transfer SHOULD demote the supersession to `pending_dispute` until resolved, and SHOULD continue serving the predecessor as `available`. Resolution is out-of-band (the organizer, the two platforms, and any affected registries communicate; ATLAS does not arbitrate) and ends with either a confirmation intent (signed by the now-recovered organizer DID) or a withdrawal intent.

### 7.3 Forged Intents

A forged transfer intent would require the attacker to compromise the organizer's DID-resolved key. The signing key lives in the organizer's wallet (or HSM if the organizer is a platform-managed account). Recovery from a key compromise follows the same DID rotation flow used for receipt-signing keys; once the new DID is established, the dispute mechanism in §7.2 reverses any forged transfers.

---

## 8. Phase Sequencing

The transfer protocol is the Phase 5.5 deliverable. It depends on Phase 5 federation: the supersession primitive only matters once events propagate across multiple registries, and the transfer intent's CID is propagated through the federation change feed. See [10-PROGRESSIVE-DECENTRALIZATION §12](./10-PROGRESSIVE-DECENTRALIZATION.md#12-phase-sequencing-phase-5-onward).

Phase 6 (secondary market, donations, sponsorship) layers on top of stable URNs. The market contract addresses tickets by URN; if URNs were not stable across transfers, secondary trades would orphan when the underlying event moved.

---

*This document specifies cross-platform event transfer for ATLAS Protocol. For URN format, see [01-PROTOCOL-SPEC §1.4](./01-PROTOCOL-SPEC.md#14-event-urn-format). For the AtlasEvent fields involved, see [02-SCHEMAS §2](./02-SCHEMAS.md#2-atlasevent). For the federation primitives this protocol builds on, see [13-FEDERATION-SPEC](./13-FEDERATION-SPEC.md). For phase ordering, see [10-PROGRESSIVE-DECENTRALIZATION §12](./10-PROGRESSIVE-DECENTRALIZATION.md#12-phase-sequencing-phase-5-onward).*
