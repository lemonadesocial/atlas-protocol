# ATLAS IPFS Data Layer

**Version 1.0 | April 2026**

**Status:** Draft

---

## 1. Purpose

IPFS is the ATLAS permanence layer. Every event listing and every **proof-of-issuance** for a purchase receipt is published to IPFS at creation time. Each piece of content receives a Content Identifier (CID): a cryptographic hash derived from the content itself. The CID cannot be altered, forged, or revoked.

If every ATLAS server goes offline, every listing and every issuance proof ever published remains accessible through the public IPFS network. No single party controls the data. No single party can remove it.

The data layer is independent of the registry layer, the settlement layer, and any specific EVM chain. IPFS stores the content. The registry indexes it. The settlement chain (optionally) anchors it. Each layer can fail without destroying the others.

### 1.1 Privacy-Preserving Receipt Model

ATLAS does **NOT** publish full receipt content to IPFS. A receipt contains the holder's wallet address, the event URN, and ticket-type details that, in combination, can identify the buyer. Pinning the full receipt would make per-buyer attendance history globally and permanently public.

Instead, ATLAS publishes only **proof-of-issuance**: a tuple of `{canonical_hash, signature, issuer_did, issuance_timestamp}`. The full receipt — including the holder identifier, ticket-type identifier, and any optional metadata — stays in:

1. The issuing platform's encrypted database (the platform's source of truth for the buyer's order).
2. The attendee's wallet (or the email-keyed custodial wallet in v2).

A verifier compares the full receipt's hash against the pinned proof-of-issuance hash off-chain. If they match and the signature is valid, the receipt is authentic. The verifier never needs the IPFS layer to reveal the receipt body.

This is the same trust model used for log-of-claims systems: prove that the issuer issued **something** matching this hash at this time, without publishing **what** they issued.

---

## 2. CID Generation

ATLAS uses Content Identifier v1 with the `dag-json` codec.

**Properties:**

- Identical content always produces the same CID.
- Different content always produces a different CID.
- Old CIDs remain valid forever. IPFS is append-only at the content level.
- Updates to a listing produce a new CID. The previous CID still resolves to the previous version.

Listings are never overwritten. Every version of every listing persists on the network. An agent holding a CID from six months ago can still fetch the exact content that CID referenced at publish time.

**Example CID:**

```
bafyreig5k7v3z6x4q8t2n1m0j9h8g7f6e5d4c3b2a1z0y9x8w7v6u5t4s3
```

The `bafy` prefix indicates CIDv1 with dag-cbor/dag-json encoding. The remainder is a base32-encoded multihash of the content.

---

## 3. Event Listing Lifecycle

An event listing moves through six stages from creation to on-chain anchoring.

```
1. Organizer creates event (CLI / API / Agent)
          |
          v
2. Listing serialized as JSON-LD (AtlasEvent schema)
          |
          v
3. Listing validated against AtlasEvent schema
          |
          v
4. Published to IPFS cluster --> CID generated
          |
          v
5. CID stored in registry index (PostgreSQL)
          |
          v
6. CID written to RegistryPointer.sol (Stage 4)
```

**Step 1.** The organizer runs `lemonade event create` (or calls the ATLAS API, or instructs an AI agent). The command accepts event details: title, date, location, ticket types, pricing, capacity.

**Step 2.** The ATLAS backend serializes the event into a JSON-LD document conforming to the AtlasEvent schema (see SCHEMAS.md). The document includes Schema.org properties extended with `atlas:` namespace fields for settlement chain, ticket configuration, and organizer DID.

**Step 3.** The serialized document is validated against the AtlasEvent JSON Schema. Invalid documents are rejected before reaching IPFS. Validation checks required fields, date formats, price ranges, and settlement chain identifiers.

**Step 4.** The validated document is submitted to the ATLAS IPFS cluster. The cluster computes the CID and replicates the content across all nodes.

**Step 5.** The CID is stored in the registry's PostgreSQL index alongside event metadata (title, date, location, categories). The registry uses this index for search and discovery.

**Step 6.** In Stage 4 of progressive decentralization, the CID is written to the RegistryPointer.sol smart contract on the event's settlement chain. The on-chain pointer creates a permanent, trustless link between the event identifier and its IPFS content.

---

## 4. IPFS Cluster Operations

### 4.1 Cluster Topology

ATLAS operates a dedicated IPFS cluster with a minimum of three nodes, geographically distributed:

| Node | Region | Role |
|------|--------|------|
| ipfs-us-east | US-East (Virginia) | Primary ingest, API endpoint |
| ipfs-eu-west | EU-West (Frankfurt) | Replica, European gateway |
| ipfs-apac | APAC (Singapore) | Replica, Asia-Pacific gateway |

All nodes run Kubo (go-ipfs), the reference IPFS implementation. The cluster uses IPFS Cluster (ipfs-cluster) for coordinated pinning and replication.

### 4.2 Pinning Policy

Every event listing and every receipt is pinned on all cluster nodes. Pinned content is never garbage-collected. The cluster enforces a `replication_factor_min` of 3: content is not considered published until at least three nodes confirm the pin.

Unpinning requires explicit operator action and multi-party authorization. The protocol does not support deletion of published content.

### 4.3 Node Software

| Component | Version | Purpose |
|-----------|---------|---------|
| Kubo | 0.28+ | IPFS node daemon |
| ipfs-cluster | 1.1+ | Cluster coordination, pinning |
| Nginx | 1.25+ | TLS termination, rate limiting |

---

## 5. Publishing Pipeline

### 5.1 CLI Flow

```bash
# Create an event and publish to IPFS in one command
lemonade event create \
  --space bjc_abc123 \
  --title "Jazz Night at Nublu" \
  --date "2026-04-15T20:00:00-04:00" \
  --location "151 Avenue C, New York, NY 10009" \
  --ticket-type "GA" --price 25.00 --capacity 100 \
  --chain base \
  --format json
```

The CLI returns:

```json
{
  "event_id": "evt_xyz789",
  "cid": "bafyreig5k7v3z6x4q8t2n1m0j9h8g7f6e5d4c3b2a1z0y9x8w7v6u5t4s3",
  "registry_indexed": true,
  "ipfs_replication": 3,
  "on_chain_pointer": null
}
```

The `on_chain_pointer` field is `null` until Stage 4, when the CID is written to RegistryPointer.sol.

### 5.2 HTTP API

The ATLAS backend publishes to the IPFS cluster via the Kubo HTTP API:

```
POST /api/v0/add?cid-version=1&hash=sha2-256
Content-Type: multipart/form-data

(JSON-LD listing as file payload)
```

The cluster processes the request and returns:

```json
{
  "Name": "atlas-event-evt_xyz789.jsonld",
  "Hash": "bafyreig5k7v3z6x4q8t2n1m0j9h8g7f6e5d4c3b2a1z0y9x8w7v6u5t4s3",
  "Size": "2847"
}
```

The `Hash` field is the CID. The ATLAS backend stores it in PostgreSQL and returns it to the caller.

---

## 6. Receipt Proof-of-Issuance

Receipts are NOT published to IPFS in their full form. Only a privacy-preserving **proof-of-issuance** record is pinned. The proof-of-issuance JSON document contains:

```json
{
  "@type": "AtlasReceiptProofOfIssuance",
  "issuer": "did:web:lemonade.social",
  "issuance_timestamp": "2026-04-14T21:05:30Z",
  "receipt_hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "signature": "z3FXs1GYbKm...truncated...7dN2p",
  "event_urn": "urn:atlas:event:lemonade.social:65f9a2c14b1d2e0001a3f5b7"
}
```

The `receipt_hash` is the SHA-256 of the canonicalized full receipt body. The `event_urn` is included so a verifier can resolve the event without revealing the buyer or the ticket type. No holder identifier, no ticket-type identifier, no settlement transaction hash is included in the pinned proof.

The full receipt — the W3C Verifiable Credential defined in [02-SCHEMAS §5](./02-SCHEMAS.md#5-atlascredential) — is held by:

- The issuing platform's encrypted database (the buyer's order record).
- The attendee's wallet (or email-keyed custodial wallet, v2).

### 6.1 Verification Flow

1. The attendee (or their agent) presents the full receipt JSON.
2. The verifier computes `sha256(canonicalize(receipt))` locally.
3. The verifier resolves `did:web:<issuer>` to fetch the issuer's manifest.
4. The verifier fetches the proof-of-issuance from IPFS using the CID embedded in the ticket's ERC-721 `tokenURI` (or via the registry's `getProofOfIssuance(receipt_hash)` lookup).
5. The verifier checks: (a) the computed hash matches `receipt_hash`, (b) the signature is valid for the issuer's signing key as of `issuance_timestamp`, (c) the event URN matches the receipt's claimed event.

If all three checks pass, the receipt is authentic. The IPFS layer never reveals the receipt body; it only attests "the issuer issued *something* matching this hash at this time for this event."

### 6.2 ATLAS-Operated Pinning Service

ATLAS operates a pinning service for both event listings and receipt proofs-of-issuance, subsidized by the 0.5% protocol fee (see [09-FEE-ECONOMICS-SPEC](./09-FEE-ECONOMICS-SPEC.md)). Pinning is free at the point of use for any compliant platform. Platforms may also self-pin to additional clusters; the protocol does not require exclusive pinning to ATLAS infrastructure.

### 6.3 Managed Pinning Endpoint (Phase 5.3+)

Phase 5.3 exposes the pinning service as an HTTP endpoint on the registry, so platforms that don't want to run their own IPFS pinner can offload pinning entirely:

```
POST /atlas/v1/receipts/pin
```

The body is `{ "receipt": <full AtlasReceipt VC> }`. The registry computes the canonical hash of the receipt body, builds the proof-of-issuance JSON document (Section 6, above), pins **only that document** to its IPFS cluster, and returns the URN + CID. The full receipt is never transmitted to IPFS — the privacy boundary in Section 1.1 is preserved end-to-end. The full request/response contract, including the companion `POST /atlas/v1/receipts/verify` endpoint, is normatively defined in [01-PROTOCOL-SPEC §9](./01-PROTOCOL-SPEC.md).

The proof-of-issuance verification flow is unchanged: a verifier presents the full receipt, the registry (or any verifier) re-canonicalises the receipt body, computes its SHA-256, and compares against the `receipt_hash` in the pinned proof. The signature is verified against the issuer's manifest signing key (`/.well-known/atlas.json`), which is platform-controlled and never held by the registry. Three checks pass → receipt is authentic.

### 6.4 Supported Pinner Backends

The reference pinner abstraction in [`@atlasprotocol/ipfs`](../../packages/ipfs) supports four backends. Platforms running their own pinner pick one; the ATLAS-operated registry can run any of them or a heterogeneous mix.

| Backend | Type | Notes |
|---------|------|-------|
| Pinata | Hosted | Default for the reference deployment. Per-file pinning with billing-tier replication. |
| web3.storage (w3up) | Hosted | UCAN-authenticated client. Includes Filecoin storage deals on top of IPFS replication. |
| Filebase | Hosted | S3-compatible API mapped onto IPFS. Useful when an existing S3 toolchain is in place. |
| Self-hosted Kubo | Self-operated | Reference IPFS daemon (Section 4.3). Requires running ipfs-cluster (Section 4.1) for replication. |

The pinner interface (`Pinner.pin(content) → { cid }`) is identical across backends, so platforms can swap backends without changing receipt-issuance code. The managed pinning endpoint hides the backend choice from the caller entirely — the response contract is the same regardless of which backend the registry happens to use.

**Related specs:** [02-SCHEMAS §5](./02-SCHEMAS.md#5-atlascredential) (AtlasCredential schema), [01-PROTOCOL-SPEC §4](./01-PROTOCOL-SPEC.md) (receipt format and verification), [01-PROTOCOL-SPEC §9](./01-PROTOCOL-SPEC.md) (managed pin/verify endpoints), [12-SECURITY-PRIVACY-SPEC §7](./12-SECURITY-PRIVACY-SPEC.md#7-data-privacy) (PII boundaries).

---

## 7. Fallback Resolution

If the ATLAS registry is unavailable, agents resolve events through on-chain pointers and public IPFS gateways.

**Resolution path:**

1. Agent queries `RegistryPointer.sol.getPointer(event_id)` on the settlement chain.
2. Contract returns the CID as a bytes value.
3. Agent fetches the listing from any public IPFS gateway.

```
https://ipfs.io/ipfs/{CID}
https://dweb.link/ipfs/{CID}
https://w3s.link/ipfs/{CID}
```

The data layer and the registry layer are fully decoupled. The registry makes discovery fast and convenient. IPFS and the on-chain pointers make discovery possible without the registry.

In Stages 0-3 (before on-chain pointers), the IPFS cluster itself serves as the fallback. Agents that have previously resolved a CID can re-fetch it from any IPFS node, including public gateways. The registry outage blocks new discovery but does not affect access to previously resolved content.

---

## 8. SLA Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| Publish latency (p95) | < 5 seconds | Time from API submission to CID confirmation |
| Cluster replication | < 30 seconds | Time from ingest node pin to all-node pin |
| Public gateway availability | 99.9% | Uptime of ATLAS-operated gateway endpoints |
| Content persistence | Permanent | Pinned content is never garbage-collected |
| Retrieval latency (p95) | < 2 seconds | Time from gateway request to first byte |

Publish latency is measured from the moment the ATLAS backend submits the document to the IPFS cluster API until the cluster returns a confirmed CID with `replication_factor_min` satisfied. The 5-second target accounts for content hashing, block creation, and initial replication.

Content persistence is absolute for pinned content. The cluster pins all event listings and all receipts. Garbage collection runs only on unpinned, cached content from external IPFS traffic.

---

## 9. Security Considerations

**Immutability.** CIDs are cryptographic hashes. Altering content produces a different CID. An attacker cannot modify a listing without changing its CID, and the original CID continues to resolve to the original content.

**Availability.** Geographic distribution across three regions protects against single-region outages. Public IPFS gateways provide a tertiary fallback. On-chain pointers (Stage 4) provide a quaternary fallback.

**Access control.** Publishing to the ATLAS IPFS cluster requires authentication. The cluster API is not publicly writable. Only the ATLAS backend (authenticated via API key) can pin new content. Reading is unrestricted: any IPFS node can fetch pinned content.

**PII exclusion.** Event listings on IPFS contain no attendee PII. Receipts are NEVER published in full to IPFS — only the privacy-preserving proof-of-issuance hash and signature (Section 6). The full receipt's holder identifier, ticket-type details, and any per-buyer metadata stay in the platform's encrypted database and the attendee's wallet. PII never reaches IPFS in any form.

---

*This document specifies the ATLAS IPFS data layer. For the AtlasEvent schema, see SCHEMAS.md. For receipt format and verification, see 01-PROTOCOL-SPEC.md Section 7. For the RegistryPointer contract, see ARCHITECTURE.md Section 8.4. For progressive decentralization stages, see PROGRESSIVE-DECENTRALIZATION.md.*
