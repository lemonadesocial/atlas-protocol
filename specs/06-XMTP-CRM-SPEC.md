# 06: Decentralized CRM on XMTP

**ATLAS Protocol | Version 0.1 | April 2026**

---

## 1. XMTP Protocol Overview

XMTP is a decentralized messaging protocol. Messages are end-to-end encrypted. Users control their own keys. No central server stores or reads message content. XMTP is an open protocol, not a Lemonade product.

ATLAS uses XMTP as its communication layer for organizer-guest messaging. The integration gives organizers a self-custody CRM: they hold the keys, they own the data, and they keep the guest relationships if they leave Lemonade or any other ATLAS-compatible platform.

XMTP network nodes relay encrypted message blobs between participants. The nodes cannot decrypt message content. There is no central message store. Conversation history syncs from the XMTP network when a client reconnects, but the network only holds encrypted payloads.

---

## 2. Channel Establishment

A communication channel between organizer and guest is created during the ticket purchase flow. The sequence is explicit and consent-driven.

```
Ticket purchase settles on-chain
        |
        v
Settlement receipt includes organizer's XMTP address
        |
        v
Guest wallet prompts: "Allow [organizer] to message you?"
        |
        v
Guest consents --> XMTP channel established (E2E encrypted)
        |
        v
Organizer's CRM records new guest: channel ID + purchase data
```

The guest must actively consent. There is no default opt-in. If the guest declines, no channel is created and the organizer cannot message them.

Once established, the channel persists across events and platforms. A guest who purchases tickets to three different events from the same organizer uses a single XMTP channel for all communication. The channel is not tied to any specific event, platform, or app.

---

## 3. CRM Data Model

The organizer's CRM is a local-first database. It combines three data sources into a unified guest view.

### 3.1 Data Sources

| Source | Data | Storage Location |
|--------|------|-----------------|
| XMTP conversations | Message history, timestamps, read status, opt-in/opt-out | Organizer's local device or server |
| On-chain receipts | Purchase history, ticket types, amounts, settlement chain | Public blockchain (permanent) |
| Check-in records | Attendance confirmations, timestamps, venue | Organizer's local device or server |

XMTP conversations provide the communication layer. On-chain receipts provide a permanent, verifiable purchase record that no party can alter or delete. Check-in records link ticket ownership to physical attendance.

### 3.2 Storage Architecture

All three sources are joined locally on the organizer's infrastructure. Lemonade does not host CRM data. Lemonade does not have access to CRM data. The organizer runs the CRM on their own device, their own server, or a self-hosted instance.

On-chain purchase history is the exception to local storage: it lives on public blockchains and is accessible to anyone. The organizer's CRM reads from the chain but does not write to it (settlement contracts handle writes at purchase time).

### 3.3 Guest Record Schema

```json
{
  "guest_id": "xmtp_0x7a3b...c4f2",
  "xmtp_address": "0x7a3b...c4f2",
  "channel_id": "ch_abc123",
  "consent_status": "opted_in",
  "consent_timestamp": "2026-03-15T14:22:00Z",
  "purchases": [
    {
      "event_id": "evt_xyz789",
      "ticket_type": "general_admission",
      "amount_usdc": "25.00",
      "chain": "base",
      "tx_hash": "0x9f8e...d1a3",
      "timestamp": "2026-03-15T14:20:00Z"
    }
  ],
  "check_ins": [
    {
      "event_id": "evt_xyz789",
      "venue": "Nublu, 151 Avenue C, NYC",
      "timestamp": "2026-03-15T20:45:00Z"
    }
  ],
  "tags": ["jazz", "brooklyn", "repeat_attendee"],
  "message_count": 12,
  "last_message": "2026-04-01T09:30:00Z"
}
```

---

## 4. Key Management

### 4.1 Identity Keys

Generated locally on the organizer's device. The generation follows the same pattern as crypto wallets: a mnemonic seed phrase (BIP-39) backs up the identity. The organizer stores this seed phrase offline. Losing the seed phrase means losing access to XMTP message history.

### 4.2 Session Keys

Rotated per conversation. Each XMTP channel uses a distinct session key derived from the identity key pair. Compromising one session key does not expose other conversations.

### 4.3 Key Recovery

The organizer restores their identity from the seed phrase on a new device. The XMTP network re-syncs all conversation history (encrypted payloads that the restored key can decrypt). On-chain purchase history requires no recovery since it is permanent and publicly readable.

```bash
# Restore XMTP identity on a new device
lemonade identity restore --seed-phrase "word1 word2 ... word12" --format json
```

```json
{
  "status": "restored",
  "xmtp_address": "0x7a3b...c4f2",
  "conversations_synced": 312,
  "sync_duration_seconds": 8
}
```

---

## 5. Consent and Privacy

**Opt-in at purchase.** The guest explicitly consents to messaging during the ticket purchase flow. The wallet prompt is binary: accept or decline. No pre-checked boxes. No buried terms.

**Opt-out at any time.** The guest revokes consent through their XMTP client or wallet. The organizer's agent checks consent status before every message send. Revoked consent stops all outbound messages to that guest.

**Data minimization.** The protocol transmits only the information required for each message. No behavioral tracking. No read receipts shared with third parties. No analytics beacons embedded in messages.

**End-to-end encryption.** Lemonade, XMTP network nodes, and IPFS cannot read message content. Only the organizer and the guest hold the decryption keys for their channel.

**No server-side message storage.** XMTP nodes relay encrypted blobs. They do not persist plaintext. The organizer's local CRM is the only place where decrypted messages exist.

**No data mining.** The protocol does not analyze message content for advertising, profiling, or recommendation purposes.

---

## 6. Segment Query Language

Organizers query their local CRM using a segment filter syntax. Queries run against local data only. No data leaves the organizer's infrastructure during a query.

### 6.1 Filter Primitives

| Filter | Meaning |
|--------|---------|
| `attended_jazz` | Guests who attended events tagged "jazz" |
| `spent_over_100` | Guests with cumulative spend exceeding $100 USDC |
| `attended_3plus` | Guests who attended 3 or more events |
| `last_event_within_30d` | Guests whose most recent attendance was within the last 30 days |
| `opted_in` | Guests with active messaging consent |
| `checked_in` | Guests who physically checked in (not just purchased) |

### 6.2 Compound Filters

Filters combine with `AND` and `OR` operators. Parentheses control precedence.

```
attended_jazz AND spent_over_100
attended_3plus AND last_event_within_30d
(attended_jazz OR attended_blues) AND opted_in
attended_jazz AND NOT checked_in
```

### 6.3 Query Execution

```bash
lemonade guests list \
  --space bjc_abc123 \
  --segment "attended_jazz AND spent_over_100" \
  --format json
```

```json
{
  "segment": "attended_jazz AND spent_over_100",
  "total_matches": 47,
  "opted_in": 43,
  "guests": [
    {
      "guest_id": "xmtp_0x7a3b...c4f2",
      "total_spent_usdc": "225.00",
      "events_attended": 6,
      "last_attendance": "2026-03-28T21:00:00Z",
      "consent_status": "opted_in"
    }
  ]
}
```

The response separates `total_matches` from `opted_in`. The organizer sees how many guests match the segment, and how many of those are reachable.

---

## 7. Agent Integration

Organizer AI agents interact with the CRM through `lemonade-cli` or MCP tools. Three commands cover the full CRM workflow: list guests, send messages, check delivery status.

### 7.1 List Guests

```bash
lemonade guests list \
  --space bjc_abc123 \
  --segment "attended_jazz" \
  --format json
```

### 7.2 Send Message

```bash
lemonade message send \
  --space bjc_abc123 \
  --segment "attended_jazz" \
  --type event_announcement \
  --body "New jazz night: April 15 at Nublu. $25 GA." \
  --format json
```

```json
{
  "campaign_id": "msg_abc789",
  "segment": "attended_jazz",
  "recipients": 43,
  "sent": 43,
  "failed": 0,
  "status": "delivered"
}
```

### 7.3 Check Delivery Status

```bash
lemonade message status --campaign msg_abc789 --format json
```

```json
{
  "campaign_id": "msg_abc789",
  "type": "event_announcement",
  "sent_at": "2026-04-09T10:00:00Z",
  "recipients": 43,
  "delivered": 42,
  "failed": 1,
  "pending": 0,
  "failures": [
    {
      "guest_id": "xmtp_0x91ab...e7d0",
      "reason": "recipient_offline_timeout"
    }
  ]
}
```

The agent reads from the local CRM database and writes to XMTP channels. No data leaves the organizer's infrastructure except the encrypted messages themselves.

---

## 8. Message Types

Each message carries a `type` field that determines its payload structure. Receiving clients use the type to render messages appropriately.

| Type | Purpose | Required Fields |
|------|---------|----------------|
| `event_announcement` | New event notification | `event_id`, `title`, `date`, `venue`, `ticket_url` |
| `promotion` | Discount or special offer | `event_id`, `promo_code`, `discount_description`, `expiry` |
| `rsvp_confirmation` | Purchase or RSVP receipt | `event_id`, `ticket_type`, `confirmation_id` |
| `check_in` | Check-in instructions or confirmation | `event_id`, `venue`, `check_in_time`, `qr_code_url` |
| `post_event_follow_up` | Post-event thank you or survey link | `event_id`, `survey_url`, `feedback_prompt` |
| `survey` | Standalone feedback request | `survey_id`, `questions_url`, `expiry` |

### 8.1 Message Payload Example

```json
{
  "type": "event_announcement",
  "payload": {
    "event_id": "evt_xyz789",
    "title": "Jazz Night at Nublu",
    "date": "2026-04-15T21:00:00Z",
    "venue": "Nublu, 151 Avenue C, NYC",
    "ticket_url": "https://atlas.events/evt_xyz789"
  },
  "body": "New jazz night: April 15 at Nublu. $25 GA.",
  "sent_at": "2026-04-09T10:00:00Z",
  "sender_xmtp": "0x3c9a...b8e1"
}
```

The `body` field contains the human-readable text. The `payload` field contains structured data that agents and rich clients can parse.

---

## 9. Broadcast Mechanics

Segment-based messaging follows a four-step pipeline. Every step runs locally on the organizer's infrastructure until the final XMTP send.

1. **Query.** The agent runs a segment filter against the local CRM. The CRM returns all matching guest records.
2. **Consent filter.** The agent removes guests whose `consent_status` is not `opted_in`. Only consenting guests proceed.
3. **Send.** The agent sends the message via XMTP to each remaining guest's channel. Each message is encrypted individually per channel.
4. **Confirm.** XMTP returns a delivery confirmation per recipient. The agent logs the result to the local CRM.

Failed deliveries (offline recipients, expired sessions) are retried up to 3 times with exponential backoff. After 3 failures, the message is marked `failed` for that recipient. The organizer can retry manually.

Rate limits prevent abuse: maximum 1,000 messages per hour per organizer identity. The limit is enforced client-side by `lemonade-cli` and server-side by the XMTP network.

---

## 10. Portability

The CRM belongs to the organizer. If the organizer leaves Lemonade, every component of the guest relationship transfers with them.

**XMTP identity.** Export the seed phrase. Import it into any XMTP-compatible client. The identity is a key pair, not an account on a platform.

**Conversation history.** The XMTP network re-syncs all encrypted conversations when the identity is restored on a new client. No export file needed. No migration tool required.

**On-chain purchase history.** Settlement transactions are permanent on public blockchains. Any client can read them. The organizer does not need to export purchase data because it was never stored on Lemonade's servers.

**Check-in records.** These are the only component stored exclusively on the organizer's local infrastructure. The organizer exports them as JSON from their CRM instance.

```bash
lemonade crm export --space bjc_abc123 --format json --output ./crm-backup.json
```

After export, the organizer imports the CRM into a different ATLAS-compatible platform or a self-hosted setup. The XMTP channels continue working. The on-chain data is already available. The check-in records load from the export file.

The guest relationship belongs to the organizer, not to the platform.

---

**Related specifications:** ARCHITECTURE.md Section 5 (communication layer architecture), WHITEPAPER Section 11.2 (CRM design rationale), PROTOCOL-SPEC.md Section 11 (security considerations).
