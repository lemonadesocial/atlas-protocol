import { describe, expect, it } from "vitest";

import {
  AtlasManifestSchema,
  AtlasTicketTypeSchema,
  validateAtlasEvent,
  validateManifest,
  validateReceipt,
} from "../validation.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_MANIFEST = {
  "@context": "https://atlas.events/v1",
  atlas_version: "1.0",
  platform: {
    name: "Test Platform",
    url: "https://test.example",
  },
  capabilities: {
    discovery: true,
    purchase: true,
    refund: false,
    holds: true,
    oauth_connect: false,
    webhooks: false,
  },
  endpoints: {
    events: "https://test.example/atlas/v1/events",
    search: "https://test.example/atlas/v1/search",
    purchase: "https://test.example/atlas/v1/purchase",
    receipt_verify: "https://test.example/atlas/v1/receipts/verify",
  },
  payment_methods: ["base_usdc", "stripe_spt"],
  fee_schedule: {
    protocol_fee_percent: 2,
    platform_fee_percent: 3.5,
  },
  signing_keys: [
    {
      kid: "test-2026-04",
      kty: "EC",
      crv: "P-256",
      x: "abc",
      y: "def",
      alg: "ES256",
      use: "sig",
    },
  ],
  rate_limits: {
    search_per_minute: 100,
    purchase_per_minute: 60,
  },
};

const VALID_TICKET_TYPE = {
  "atlas:ticket_type_id": "tt_ga_001",
  "atlas:source_ticket_type_id": "src_tt_ga_001",
  name: "General Admission",
  description: "Standard entry.",
  "atlas:event_id": "evt_abc123",
  "atlas:pricing": {
    base_price: 25,
    currency: "USD",
    fees: [
      {
        name: "Protocol fee",
        type: "percentage",
        rate: 2,
        amount: 0.5,
        description: "ATLAS protocol fee",
      },
    ],
    total_price: 25.5,
    fees_total: 0.5,
    tax_included: false,
    tax_amount: null,
  },
  "atlas:availability": {
    status: "available",
    total_quantity: 100,
    remaining_quantity: 47,
    max_per_order: 4,
    min_per_order: 1,
    sale_start: null,
    sale_end: null,
    on_sale: true,
  },
  "atlas:restrictions": {
    age_minimum: 21,
    age_maximum: null,
    requires_approval: false,
    requires_invitation_code: false,
    geographic_restrictions: [],
    requires_identity_verification: false,
    transferable: true,
    resellable: true,
    custom_restrictions: [],
  },
  "atlas:cancellation_policy": {
    refundable: true,
    refund_type: "full",
    refund_deadline: null,
    partial_refund_schedule: null,
    cancellation_fee: 0,
    policy_text: "Refunds available up to 24h before event.",
    organizer_cancellation_refund: "full",
  },
  "atlas:accepted_payment_methods": ["base_usdc", "stripe_spt"],
  "atlas:metadata": {},
};

const VALID_EVENT = {
  "@context": { "@vocab": "https://schema.org/", atlas: "https://atlas.events/v1#" },
  "@type": "Event",
  "@id": "https://test.example/events/evt_abc123",
  name: "Late Night Jazz at Nublu",
  description: "An intimate jazz night.",
  startDate: "2026-04-15T21:00:00-04:00",
  endDate: "2026-04-16T01:00:00-04:00",
  location: {
    "@type": "Place",
    name: "Nublu",
    address: {
      "@type": "PostalAddress",
      streetAddress: "151 Avenue C",
      addressLocality: "New York",
      addressRegion: "NY",
      postalCode: "10009",
      addressCountry: "US",
    },
  },
  organizer: {
    "@type": "Organization",
    name: "Brooklyn Jazz Collective",
    url: "https://bjc.events",
  },
  eventStatus: "EventScheduled",
  eventAttendanceMode: "OfflineEventAttendanceMode",
  "atlas:id": "evt_abc123",
  "atlas:source_platform": "test",
  "atlas:source_event_id": "src_evt_abc123",
  "atlas:organizer_id": "org_bjc_2026",
  "atlas:organizer_verified": true,
  "atlas:categories": ["music", "jazz"],
  "atlas:tags": ["nightlife"],
  "atlas:availability": "available",
  "atlas:price_range": {
    min_price: 25,
    max_price: 150,
    currency: "USD",
    includes_fees: false,
  },
  "atlas:ticket_types_count": 2,
  "atlas:purchase_endpoint": "https://test.example/atlas/v1/events/evt_abc123/purchase",
  "atlas:currency": "USD",
  "atlas:accepts_payment_methods": ["base_usdc", "stripe_spt"],
  "atlas:last_synced": "2026-04-14T12:00:00Z",
  "atlas:created_at": "2026-04-01T00:00:00Z",
  "atlas:updated_at": "2026-04-14T12:00:00Z",
};

const VALID_RECEIPT = {
  "@context": ["https://www.w3.org/2018/credentials/v1", "https://atlas.events/credentials/v1"],
  type: ["VerifiableCredential", "AtlasTicketReceipt"],
  id: "urn:atlas:receipt:rec_abc123",
  issuer: "did:web:bjc.events",
  issuanceDate: "2026-04-14T21:05:30Z",
  credentialSubject: {
    id: "0x9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e",
    event_id: "evt_abc123",
    hold_id: "hold_xyz789",
    ticket_type: "tt_ga_001",
    quantity: 2,
    settlement: {
      method: "x402",
      amount: "50.000000",
      currency: "USDC",
      tx_hash: "0xabcdef1234",
      chain: "base",
    },
  },
};

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

describe("validateManifest / AtlasManifestSchema", () => {
  it("accepts a spec-compliant manifest", () => {
    const result = validateManifest(VALID_MANIFEST);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.atlas_version).toBe("1.0");
    }
  });

  it("preserves unknown ATLAS fields via passthrough", () => {
    const manifest = { ...VALID_MANIFEST, "atlas:custom_field": "extra" };
    const result = AtlasManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>)["atlas:custom_field"]).toBe("extra");
    }
  });

  it("reports the path of the missing required field", () => {
    const broken = { ...VALID_MANIFEST };
    delete (broken as Partial<typeof VALID_MANIFEST>).atlas_version;
    const result = validateManifest(broken);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]?.path).toEqual(["atlas_version"]);
    }
  });

  it("reports nested path for missing platform.name", () => {
    const broken = {
      ...VALID_MANIFEST,
      platform: { url: "https://test.example" }, // name missing
    };
    const result = validateManifest(broken);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]?.path).toEqual(["platform", "name"]);
    }
  });
});

// ---------------------------------------------------------------------------
// Event
// ---------------------------------------------------------------------------

describe("validateAtlasEvent / AtlasEventSchema", () => {
  it("accepts a spec-compliant event", () => {
    const result = validateAtlasEvent(VALID_EVENT);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.name).toBe("Late Night Jazz at Nublu");
    }
  });

  it("accepts the `@context` array form from 02-SCHEMAS.md §2", () => {
    const eventArray = {
      ...VALID_EVENT,
      "@context": ["https://schema.org", "https://atlas.events/v1"],
    };
    const result = validateAtlasEvent(eventArray);
    expect(result.valid).toBe(true);
  });

  it("rejects an event missing `name` and reports the path", () => {
    const broken: Record<string, unknown> = { ...VALID_EVENT };
    delete broken["name"];
    const result = validateAtlasEvent(broken);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]?.path).toEqual(["name"]);
    }
  });

  it("rejects an unknown atlas:availability value", () => {
    const broken = { ...VALID_EVENT, "atlas:availability": "bogus" };
    const result = validateAtlasEvent(broken);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]?.path).toEqual(["atlas:availability"]);
    }
  });

  it("validates a nested ticketType through AtlasTicketTypeSchema", () => {
    const eventWithTickets = {
      ...VALID_EVENT,
      "atlas:ticketTypes": [VALID_TICKET_TYPE],
    };
    const result = validateAtlasEvent(eventWithTickets);
    expect(result.valid).toBe(true);
  });

  it("AtlasTicketTypeSchema accepts a spec-compliant ticket type", () => {
    const parsed = AtlasTicketTypeSchema.safeParse(VALID_TICKET_TYPE);
    expect(parsed.success).toBe(true);
  });

  it("AtlasTicketTypeSchema rejects missing pricing fields", () => {
    const broken = {
      ...VALID_TICKET_TYPE,
      "atlas:pricing": {
        ...VALID_TICKET_TYPE["atlas:pricing"],
        currency: undefined,
      },
    };
    delete (broken["atlas:pricing"] as Record<string, unknown>)["currency"];
    const parsed = AtlasTicketTypeSchema.safeParse(broken);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path).toEqual(["atlas:pricing", "currency"]);
    }
  });
});

// ---------------------------------------------------------------------------
// Receipt
// ---------------------------------------------------------------------------

describe("validateReceipt / AtlasReceiptSchema", () => {
  it("accepts an unsigned x402 receipt", () => {
    const result = validateReceipt(VALID_RECEIPT);
    expect(result.valid).toBe(true);
  });

  it("accepts a signed receipt with a proof block", () => {
    const signed = {
      ...VALID_RECEIPT,
      proof: {
        type: "EcdsaSecp256r1Signature2019",
        created: "2026-04-14T21:05:30Z",
        verificationMethod: "did:web:bjc.events#bjc-2026-04",
        proofPurpose: "assertionMethod",
        proofValue: "z3FXs1GYbKm",
      },
    };
    const result = validateReceipt(signed);
    expect(result.valid).toBe(true);
  });

  it("accepts a stripe_spt receipt", () => {
    const stripeReceipt = {
      ...VALID_RECEIPT,
      credentialSubject: {
        ...VALID_RECEIPT.credentialSubject,
        settlement: {
          method: "stripe_spt",
          amount: "50.00",
          currency: "USD",
          payment_intent_id: "pi_test_abc",
        },
      },
    };
    const result = validateReceipt(stripeReceipt);
    expect(result.valid).toBe(true);
  });

  it("rejects a receipt missing the AtlasTicketReceipt type", () => {
    const broken = { ...VALID_RECEIPT, type: ["VerifiableCredential"] };
    const result = validateReceipt(broken);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]?.path).toEqual(["type"]);
    }
  });

  it("rejects a receipt missing credentialSubject.event_id", () => {
    const broken = {
      ...VALID_RECEIPT,
      credentialSubject: { ...VALID_RECEIPT.credentialSubject, event_id: undefined },
    };
    delete (broken.credentialSubject as Record<string, unknown>)["event_id"];
    const result = validateReceipt(broken);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]?.path).toEqual(["credentialSubject", "event_id"]);
    }
  });

  it("rejects a receipt with bogus settlement.method", () => {
    const broken = {
      ...VALID_RECEIPT,
      credentialSubject: {
        ...VALID_RECEIPT.credentialSubject,
        settlement: { ...VALID_RECEIPT.credentialSubject.settlement, method: "lightning" },
      },
    };
    const result = validateReceipt(broken);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]?.path).toEqual(["credentialSubject", "settlement", "method"]);
    }
  });
});
