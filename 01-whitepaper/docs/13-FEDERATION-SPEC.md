# 13: Registry Federation Specification

**ATLAS Protocol | Version 0.1 | May 2026**

**Status:** Draft

**References:** [01-PROTOCOL-SPEC](./01-PROTOCOL-SPEC.md), [02-SCHEMAS §1](./02-SCHEMAS.md#1-atlasmanifest), [02-SCHEMAS §10](./02-SCHEMAS.md#10-platform), [10-PROGRESSIVE-DECENTRALIZATION §12](./10-PROGRESSIVE-DECENTRALIZATION.md#12-phase-sequencing-phase-5-onward), [14-EVENT-PORTABILITY-SPEC](./14-EVENT-PORTABILITY-SPEC.md)

---

## 1. Overview

ATLAS is registry-federated. Anyone can stand up a registry. Multiple registries operate in parallel and converge on a shared view of the network through a pull-based sync protocol. Platforms self-register with whichever registries they choose. Domain ownership is cryptographically verified before a registry indexes a platform's events. Per-platform signing keys (declared in the manifest) make every event-feed payload independently verifiable.

This document specifies:

- The self-registration handshake (Section 2)
- Domain-ownership verification via well-known challenge (Section 3)
- Peer-to-peer registry sync (Section 4)
- Peer discovery via DNS SRV (Section 5)
- Cryptographic event provenance (Section 6)
- The trust model for federated registries (Section 7)
- Platform vs. registry federation distinction (Section 8)

Registry federation is the Phase 5 deliverable in the protocol roadmap (see [10-PROGRESSIVE-DECENTRALIZATION §12](./10-PROGRESSIVE-DECENTRALIZATION.md#12-phase-sequencing-phase-5-onward)).

---

## 2. Self-Registration

A platform announces itself to a registry by `POST /atlas/v1/register`.

### 2.1 Request

```http
POST /atlas/v1/register HTTP/1.1
Host: registry.atlas.events
Content-Type: application/json
Atlas-Version: 1.0

{
  "manifest_url": "https://lemonade.social/.well-known/atlas.json"
}
```

The body contains exactly one field, `manifest_url`. The registry fetches the manifest, parses it per [02-SCHEMAS §1](./02-SCHEMAS.md#1-atlasmanifest), and proceeds to verification.

### 2.2 Response (initial)

```http
HTTP/1.1 202 Accepted
Content-Type: application/json

{
  "platform_id": "lemonade.social",
  "verification_status": "pending",
  "verification_challenge": {
    "method": "well_known_file",
    "path": "/.well-known/atlas-verification.txt",
    "expected_content": "atlas-verify=h7s8d2j4k9...",
    "expires_at": "2026-05-04T12:00:00Z"
  }
}
```

The platform places the `expected_content` string at the indicated path on its resolver domain. See Section 3 for the well-known challenge.

### 2.3 Verification Confirmation

The platform calls `POST /atlas/v1/register/verify`:

```http
POST /atlas/v1/register/verify HTTP/1.1
Content-Type: application/json

{ "platform_id": "lemonade.social" }
```

The registry performs an HTTP GET against `https://<resolver_domain>/.well-known/atlas-verification.txt`, compares the response body to the expected challenge, and on match transitions `verification_status` from `pending` to `verified`. From that point on, the registry begins polling the platform's `events_url` and indexing its events.

### 2.4 Idempotency and Re-Registration

A platform that re-registers (e.g. after a manifest URL change) MUST repeat the challenge. The registry generates a fresh challenge token and the previous one is invalidated. Re-verification windows of 24 hours are RECOMMENDED — registries SHOULD periodically re-issue the challenge to detect domain handover or DNS hijack.

---

## 3. Domain Ownership Verification

The verification model follows the same shape as Let's Encrypt's ACME HTTP-01 challenge: prove domain control by serving a registry-issued token at a well-known path.

### 3.1 Well-Known File

```
GET https://<resolver_domain>/.well-known/atlas-verification.txt
```

Response MUST be `text/plain` and contain exactly the challenge string the registry issued during self-registration:

```
atlas-verify=h7s8d2j4k9aPq3rTuV5wXyZ
```

Trailing whitespace and a single trailing newline are tolerated. Any other content fails verification.

### 3.2 Properties

- The challenge token is opaque, unguessable, and at least 16 bytes of entropy (Base62-encoded).
- The token expires 24 hours after issuance. Late verification fails closed.
- Challenges are scoped per `(registry, platform_id)`: the same platform receives a different token from each registry it registers with.
- A successful verification MUST be re-run at least every 90 days. Registries that go more than 90 days without re-verifying SHOULD demote the platform's `verification_status` to `unverified` and label its events accordingly until re-verified.

### 3.3 Failure Modes

| Failure | Registry behavior |
|---------|-------------------|
| File not present (404) | `verification_status` stays `pending`. Retries up to 3 times over 24 hours, then expires. |
| File present but content mismatch | Same as above. |
| Expected origin redirects to a different domain | Verification fails. The platform's resolver domain MUST serve the file directly. |
| TLS error or invalid certificate | Verification fails. ATLAS requires TLS 1.3 (see [12-SECURITY-PRIVACY-SPEC §1](./12-SECURITY-PRIVACY-SPEC.md#1-transport-security)). |

The well-known path is reserved per [RFC 8615](https://www.rfc-editor.org/rfc/rfc8615) under the `atlas-verification` suffix.

---

## 4. Pull-Based Peer Sync

Registries federate by pulling each other's change feeds. There is no push, no broker, no consensus protocol. Each registry independently decides which peers to follow.

### 4.1 Changes Endpoint

Every registry exposes:

```
GET /atlas/v1/changes?since=<iso-8601-timestamp>
```

The response is an ordered list of change records emitted since the cursor:

```json
{
  "atlas_version": "1.0",
  "registry_id": "registry.atlas.events",
  "since": "2026-05-03T10:00:00Z",
  "now": "2026-05-03T11:00:00Z",
  "changes": [
    {
      "kind": "platform_registered",
      "platform_id": "lemonade.social",
      "verification_status": "verified",
      "manifest_url": "https://lemonade.social/.well-known/atlas.json",
      "ts": "2026-05-03T10:15:00Z"
    },
    {
      "kind": "event_upserted",
      "event_urn": "urn:atlas:event:lemonade.social:65f9a2c14b1d2e0001a3f5b7",
      "ipfs_cid": "bafy...",
      "ts": "2026-05-03T10:42:00Z"
    },
    {
      "kind": "event_superseded",
      "event_urn": "urn:atlas:event:eventbrite.com:1234567890",
      "successor_urn": "urn:atlas:event:lemonade.social:65f9a2c14b1d2e0001a3f5b7",
      "transfer_intent_signature": "z3FXs1...",
      "ts": "2026-05-03T10:43:00Z"
    }
  ],
  "next_cursor": "2026-05-03T11:00:00Z"
}
```

Change kinds:

| Kind | Meaning |
|------|---------|
| `platform_registered` | A new Platform was verified and added to this registry's index. |
| `platform_revoked` | A Platform's verification was revoked (failed re-verification, abuse, voluntary deregistration). |
| `event_upserted` | An event was added or its content changed (new IPFS CID). |
| `event_superseded` | An event was transferred via the cross-platform transfer protocol; see [14-EVENT-PORTABILITY-SPEC](./14-EVENT-PORTABILITY-SPEC.md). |
| `event_cancelled` | An event was cancelled by its issuing platform. |

### 4.2 Sync Cadence

Following registries SHOULD poll each peer at least once per 5 minutes. Registries MAY poll more frequently if their hosting cost permits. The `since` cursor advances monotonically per peer; a registry stores `(peer, last_cursor)` per peer it follows.

### 4.3 Convergence

Two registries that follow each other reach eventual consistency on every event known to either, modulo IPFS pin propagation delay. Conflict resolution: an `event_upserted` for an event the receiving registry has not seen is treated as a new event. An `event_upserted` with an older `ts` than the receiver's local copy is discarded. An `event_superseded` always wins over a stale `event_upserted` (transfer is monotonic).

### 4.4 Trust Boundary

A receiving registry MUST NOT blindly trust a peer's `event_upserted` change. It re-fetches the IPFS-pinned event payload by CID and re-verifies the issuing Platform's signature against the Platform's `signing_key` from the manifest (Section 6). If verification fails, the change is logged and discarded. Federated trust is in the **Platform's** signature, not in the peer registry.

---

## 5. Peer Discovery (DNS SRV)

Registries announce themselves via DNS SRV records under the `atlas.events` zone:

```
_atlas-registry._tcp.atlas.events. 3600 IN SRV 10 50 443 registry.atlas.events.
_atlas-registry._tcp.atlas.events. 3600 IN SRV 10 50 443 registry.latam.atlas.events.
_atlas-registry._tcp.atlas.events. 3600 IN SRV 20 50 443 mirror.eu.example.com.
```

SDK clients and registry operators resolve `_atlas-registry._tcp.atlas.events` to discover the current set of public registries. Discovery is advisory: clients MAY hardcode preferred registries (see [08-AGENT-ECOSYSTEM-SPEC §1.1](./08-AGENT-ECOSYSTEM-SPEC.md#11-multi-registry-configuration)) and registries MAY follow peers not listed in DNS. The SRV record is convenience, not a directory of authority.

Private or in-progress registries MAY skip SRV publication and operate as private federation networks (e.g. a regional partner's pilot deployment).

---

## 6. Cryptographic Event Provenance

Every event payload published by a Platform is signed with the Platform's `signing_key` (a per-platform JWK declared in the manifest at the top level — distinct from `signing_keys[]`, which is for receipts). Registries verify signatures before indexing.

### 6.1 Signing

The Platform serves event payloads with a detached signature:

```http
HTTP/1.1 200 OK
Content-Type: application/json
Atlas-Signature: keyid="platform-bjc-2026-04",alg="ES256",sig="z3FXs1..."

{ ...event payload... }
```

The signature covers the canonicalized JSON of the body using JCS (RFC 8785). The `keyid` matches the manifest's `signing_key.kid`.

### 6.2 Verification

A registry receiving an event:

1. Resolves the issuing Platform's manifest by `atlas:platform_id`.
2. Confirms the `keyid` in `Atlas-Signature` matches the manifest's `signing_key.kid` (or a previously trusted, recently rotated key).
3. Verifies the ES256 signature.
4. Indexes the event only on success. Failures are logged with the event URN and the offending signature; repeated failures from a Platform demote it to `unverified`.

### 6.3 Key Rotation

A Platform rotates its `signing_key` by:

1. Publishing the new key in `signing_key` and moving the previous key to a `signing_keys_history[]` array (with `valid_until` timestamps).
2. Continuing to serve events signed with the new key.
3. Allowing registries a 24-hour grace window to refresh the manifest. During the window, registries SHOULD accept signatures from either the current `signing_key` or any `signing_keys_history` entry whose `valid_until` is in the future.
4. After 24 hours, only the current `signing_key` is accepted.

### 6.4 Revocation

If a Platform's signing key is compromised, the Platform publishes a manifest update with the new `signing_key` and lists the compromised key in a `revoked_keys[]` array. Registries that observe `revoked_keys` MUST invalidate any cached signatures by that key and re-fetch affected events under the new key. Events that cannot be re-signed (because the Platform itself is compromised) are flagged in the `event_upserted` feed with a `provenance_warning` and the registry MAY demote them.

---

## 7. Trust Model

The federated trust model has three layers:

1. **Platform → Registry trust** is one-shot, established by domain-ownership verification (Section 3) and refreshed every 90 days. Once verified, a Platform's events are trusted **only as long as their signatures verify against the Platform's current `signing_key`**.
2. **Registry → Registry trust** is *not* transitive. Receiving a change from a peer registry does not authenticate the underlying event; the receiving registry MUST re-verify the Platform's signature (Section 4.4). Federated registries are conduits, not authorities.
3. **Agent → Registry trust** is the agent's discretion. Agents MAY query multiple registries in parallel and surface conflicts (see [08-AGENT-ECOSYSTEM-SPEC §1.1](./08-AGENT-ECOSYSTEM-SPEC.md#11-multi-registry-configuration)). The protocol does not designate a canonical registry; quality is competitive.

This three-layer model means a malicious or compromised registry can withhold events or serve stale data, but it cannot forge an event without also compromising the Platform's signing key.

---

## 8. Platforms vs. Registries: Who Federates What

It is essential to keep the two axes of federation separate:

- **Platforms federate with registries.** A Platform serves its own events at its own resolver domain. It self-registers with one or more registries. It does NOT pull from other Platforms. Lu.ma serves Lu.ma events; Eventbrite serves Eventbrite events; lemonade.social serves Lemonade-hosted events.
- **Registries federate with each other.** Registries pull peer change feeds (Section 4) so that an event published by one Platform reaches every registry without the Platform having to register everywhere.

A Platform appears in registry A → registry A's federation pushes the event to registry B → an agent querying registry B sees the event. The Platform did nothing to make this happen. This is the value proposition of federated indexing.

The transfer protocol (cross-platform event handoff) is layered on top of this in [14-EVENT-PORTABILITY-SPEC](./14-EVENT-PORTABILITY-SPEC.md): when an event moves between Platforms, supersession propagates through the same registry federation channel.

---

## 9. Multi-Registry Deployability

Reference registry implementations ship as a single Docker container:

```
docker run -p 443:443 \
  -e ATLAS_REGISTRY_DOMAIN=registry.example.org \
  -e ATLAS_REGISTRY_PEERS="https://registry.atlas.events,https://registry.latam.atlas.events" \
  -v ./data:/var/lib/atlas-registry \
  ghcr.io/atlasprotocol/registry:1.0
```

The container runs:

- The HTTP API (search, register, verify, changes endpoints).
- A peer-sync daemon that polls configured peers per Section 4.
- A signature-verification worker that verifies Platform signatures before indexing.
- A local PostgreSQL or SQLite store for the event index (operator-configurable).
- An optional IPFS pin daemon (operators that want to host their own pins).

Operators that prefer a managed deploy can run the registry on a cloud-managed Postgres + a single application server. The reference implementation supports horizontal scaling behind a load balancer.

---

## 10. Phase Sequencing

Federation lands in Phase 5. The cross-platform transfer protocol (Phase 5.5) builds directly on the federation primitives in this document — supersession events propagate through the same change feed. See [10-PROGRESSIVE-DECENTRALIZATION §12](./10-PROGRESSIVE-DECENTRALIZATION.md#12-phase-sequencing-phase-5-onward) for the full Phase roadmap.

The on-chain `RegistryPointer.sol` (Phase 7+) provides a decentralized fallback root: when no off-chain registry is reachable, agents resolve events directly via on-chain pointers and IPFS. Federation in Phase 5 is the off-chain coordination layer; Phase 7+ adds the on-chain coordination layer beneath it.

---

*This document specifies registry federation for ATLAS Protocol. For the manifest format, see [02-SCHEMAS §1](./02-SCHEMAS.md#1-atlasmanifest). For the cross-platform transfer protocol that builds on federation, see [14-EVENT-PORTABILITY-SPEC](./14-EVENT-PORTABILITY-SPEC.md). For the Phase roadmap, see [10-PROGRESSIVE-DECENTRALIZATION §12](./10-PROGRESSIVE-DECENTRALIZATION.md#12-phase-sequencing-phase-5-onward).*
