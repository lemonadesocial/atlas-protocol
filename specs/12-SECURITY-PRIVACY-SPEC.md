# ATLAS Protocol: Security and Privacy Specification

**Version 0.1 | April 2026**

**Authors:** Lemonade

---

## 1. Transport Security

All ATLAS API endpoints require TLS 1.3. Plaintext HTTP connections are rejected at the load balancer. TLS termination occurs at the API gateway. Internal service-to-service communication uses mutual TLS (mTLS) with certificates issued by the ATLAS internal CA.

Certificate requirements: RSA 2048-bit minimum (4096-bit recommended) or ECDSA P-256. Certificates must be issued by a publicly trusted CA for external endpoints. Expiration: 90 days maximum. Automated renewal via ACME (Let's Encrypt or equivalent).

---

## 2. API Authentication

### 2.1 Key Format

| Key Type | Prefix | Usage |
|----------|--------|-------|
| Secret (production) | `atlas_sk_live_` | Server-side API calls. Never exposed to clients. |
| Publishable (production) | `atlas_pk_live_` | Client-side calls (search, event details). Rate-limited. |
| Secret (test) | `atlas_sk_test_` | Testnet operations. No real funds. |
| Publishable (test) | `atlas_pk_test_` | Client-side test calls. |

Keys are 32 bytes of cryptographically random data, Base62-encoded after the prefix. Total key length: prefix + 43 characters.

### 2.2 Key Lifecycle

Rotation is required every 90 days. The API rejects keys older than 90 days with a `401 Unauthorized` response and an `X-Atlas-Key-Expired: true` header. Agents should automate rotation. Keys are scoped per agent: one agent cannot use another agent's key. Revoked keys are rejected immediately. Key creation, rotation, and revocation events are logged with timestamps and source IP.

---

## 3. Agent Identity

Every API request must include the `X-Atlas-Agent-Id` header. The value is the agent's registered identifier in the ATLAS registry. Requests without this header receive a `400 Bad Request` response.

Agent registration requires: a valid API key, a human-readable agent name, a contact email, and a capability declaration (search-only, purchase-capable, or full-settlement). The registry assigns the agent ID. Agents declare their capabilities at registration. Capability changes require re-registration.

---

## 4. Purchase Security

### 4.1 Idempotency

Every purchase request must include an `Idempotency-Key` header containing a UUID v4 value. The server stores each key for 24 hours, scoped to the requesting agent. Duplicate requests within the 24-hour window return the original response with a `200 OK` status and an `X-Atlas-Idempotent-Replay: true` header. Keys from different agents do not collide.

### 4.2 Hold Mechanism

The `atlas_hold_ticket` endpoint locks inventory for a minimum of 300 seconds (5 minutes). The hold TTL is returned in the response body. Agents must complete payment before the TTL expires. Expired holds release automatically. The server runs a background process every 10 seconds to release expired holds. No manual intervention is needed.

### 4.3 Double-Spend Prevention

Each `hold_id` accepts exactly one payment. The FeeRouter contract stores a mapping of settled hold IDs. A second settlement attempt for the same `hold_id` reverts with `HOLD_ALREADY_SETTLED`. On the API layer, the server checks hold status before forwarding to the contract. Both layers enforce the constraint independently.

---

## 5. Payment Verification

ATLAS is an MPP-compliant service. MPP (Machine Payments Protocol) is the open payment standard co-authored by Stripe and Tempo. MPP supports two rails: direct on-chain USDC and Shared Payment Tokens (SPTs) for fiat. The server verifies each rail as follows.

**MPP on-chain USDC:** The server verifies the transaction hash against three fields: recipient address (must match the FeeRouter contract), amount (must match the hold amount), and memo field (must contain the `hold_id`). Verification queries the chain's RPC endpoint. The server waits for 1 block confirmation on L2 chains and 12 confirmations on Ethereum L1.

**SPT (via Stripe):** The server verifies the SPT intent status equals `succeeded` via the Stripe API. The SPT intent metadata must contain the `hold_id`. Stripe webhook events provide redundant confirmation. The server reconciles webhook data against API responses daily.

---

## 6. Smart Contract Security

### 6.1 Proxy Pattern

All ATLAS contracts use the UUPS (Universal Upgradeable Proxy Standard) pattern. The upgrade function is protected by the UPGRADER role. Upgrade authority transitions across stages: Lemonade multi-sig (Stage 1), 3-of-5 multi-sig (Stage 3), DAO governance (Stage 4).

### 6.2 Reentrancy Protection

All state-modifying functions use OpenZeppelin's `ReentrancyGuard`. External calls follow the checks-effects-interactions pattern. The FeeRouter executes all USDC transfers after updating internal state.

### 6.3 Access Control

OpenZeppelin `AccessControl` manages four roles:

| Role | Capability |
|------|-----------|
| ADMIN | Grant/revoke roles. Update fee percentages. |
| PUBLISHER | Write event pointers to RegistryPointer.sol. |
| UPGRADER | Execute UUPS proxy upgrades. |
| PAUSER | Pause/unpause all contract functions. |

Role assignment requires a transaction from an existing ADMIN. The ADMIN role is held by the governance multi-sig (not a single EOA).

### 6.4 Pausable

All contracts implement OpenZeppelin's `Pausable` modifier. When paused, state-modifying functions revert. View functions remain operational. The PAUSER role triggers pause/unpause. Pause events are emitted on-chain and monitored by the alerting system.

---

## 7. Data Privacy

### 7.1 Encryption at Rest

Attendee PII (name, email, phone) is encrypted using AES-256-GCM before storage. Encryption keys are managed by AWS KMS (or equivalent HSM). Each organizer's data uses a distinct data encryption key (DEK), wrapped by a master key (KEK). Key rotation occurs every 12 months.

### 7.2 PII Boundaries

PII never appears in: the ATLAS registry, application logs, IPFS listings, on-chain transactions, or error messages returned to API clients. Log sanitization strips known PII patterns (email regex, phone patterns) before ingestion. Quarterly audits verify that no PII has leaked into non-PII stores.

### 7.3 XMTP Messages

All XMTP messages are end-to-end encrypted using the MLS (Messaging Layer Security) protocol. Lemonade has no access to message content. XMTP network nodes relay encrypted ciphertext without decryption capability. Message metadata (sender, recipient, timestamp) is visible to XMTP nodes but not to Lemonade's infrastructure.

### 7.4 On-Chain Data

Settlement transactions on public blockchains expose: payment amounts, wallet addresses, contract interactions, and timestamps. Attendee identity is not linked to wallet addresses at the protocol level. Users who connect a wallet to a named account do so voluntarily. The protocol does not publish or index wallet-to-identity mappings.

---

## 8. Receipt Integrity

### 8.1 Signing

Receipts (W3C Verifiable Credentials) are signed using ES256 (ECDSA with P-256 curve and SHA-256). The signing key is stored in an HSM. Each platform operating on ATLAS maintains its own signing key pair.

### 8.2 Key Publication

Public keys are published as JWK (JSON Web Key) entries in the platform's `/.well-known/atlas.json` manifest. Verification uses DID:web resolution: the verifier fetches the manifest, extracts the JWK matching the receipt's `kid` (Key ID), and validates the signature.

### 8.3 Key Rotation

Multiple signing keys may be active simultaneously during rotation. The new key is added to the manifest before the old key signs its last receipt. Revoked keys are removed from the manifest within 24 hours. Verifiers check key validity at the receipt's issuance timestamp, not at verification time.

---

## 9. Rate Limiting

Rate limits are enforced per agent, per endpoint. The server uses a sliding window algorithm with 1-minute windows. Default limits:

| Endpoint Category | Limit |
|-------------------|-------|
| Search | 60 requests/minute |
| Event details | 120 requests/minute |
| Hold/purchase | 20 requests/minute |
| Administrative | 10 requests/minute |

When a client exceeds the limit, the server returns `429 Too Many Requests` with a `Retry-After` header (value in seconds). The `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers are included on every response. Agents with elevated trust (high transaction volume, long history) may request higher limits through the registry.

---

## 10. Compliance

### 10.1 GDPR

Data subjects may request deletion of their personal data. Upon receiving a verified deletion request, the system removes: XMTP channel data (via XMTP's deletion API), PII from the encrypted store, and any cached references. On-chain transaction data is immutable but contains no PII. Wallet addresses alone do not constitute personal data under GDPR unless linked to an identified person. The protocol does not maintain such links.

### 10.2 CCPA

California residents may opt out of data sale. ATLAS does not sell personal data. The opt-out mechanism is provided for compliance. Opt-out requests are processed within 10 business days.

### 10.3 Data Retention

| Data Type | Retention Period |
|-----------|-----------------|
| API request logs (no PII) | 90 days |
| Idempotency keys | 24 hours |
| Hold records | 30 days after expiration |
| Attendee PII (encrypted) | Until deletion requested or 3 years after last activity |
| On-chain data | Permanent (immutable) |
| Audit logs | 7 years |

### 10.4 Audit Logging

Security-relevant events are logged to a tamper-evident audit log. Logged events include: authentication attempts (success and failure), key creation/rotation/revocation, role changes, contract pauses, governance proposals, and data deletion requests. Audit logs are retained for 7 years. Access to audit logs requires the ADMIN role and produces its own audit entry.

---

*This document specifies security and privacy for ATLAS Protocol. For protocol APIs, see PROTOCOL-SPEC.md. For smart contract details, see 04-SMART-CONTRACTS-SPEC.md. For governance, see 11-GOVERNANCE-SPEC.md.*
