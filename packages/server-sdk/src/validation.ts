/**
 * Zod schemas for the canonical ATLAS Protocol JSON shapes.
 *
 * The schemas mirror `01-whitepaper/docs/02-SCHEMAS.md` and the existing
 * TypeScript interfaces in `./types/`. They are deliberately additive — the
 * top-level objects use `.passthrough()` so unknown ATLAS-namespaced fields
 * (e.g. `atlas:promoted` on search results) survive validation. Required
 * fields and enum values are still strictly checked.
 *
 * Two layers are exposed:
 *
 *  1. **Raw schemas** (`AtlasManifestSchema`, `AtlasEventSchema`,
 *     `AtlasTicketTypeSchema`, `AtlasReceiptSchema`) for callers that want to
 *     compose with their own Zod pipelines.
 *  2. **Validators** (`validateManifest`, `validateAtlasEvent`,
 *     `validateReceipt`) returning a discriminated union so callers don't need
 *     to import Zod themselves.
 */

import { z, type ZodIssue } from "zod";

// ---------------------------------------------------------------------------
// AtlasManifest (02-SCHEMAS.md §1)
// ---------------------------------------------------------------------------

const ManifestPlatformSchema = z
  .object({
    name: z.string().min(1),
    url: z.string().url(),
    logo: z.string().url().optional(),
    description: z.string().optional(),
    contact_email: z.string().email().optional(),
  })
  .passthrough();

const ManifestCapabilitiesSchema = z
  .object({
    discovery: z.boolean(),
    purchase: z.boolean(),
    refund: z.boolean(),
    holds: z.boolean(),
    oauth_connect: z.boolean(),
    webhooks: z.boolean(),
  })
  .passthrough();

const ManifestEndpointsSchema = z
  .object({
    events: z.string().url(),
    search: z.string().url(),
    purchase: z.string().url(),
    receipt_verify: z.string().url(),
  })
  .passthrough();

const ManifestFeeScheduleSchema = z
  .object({
    protocol_fee_percent: z.number(),
    platform_fee_percent: z.number(),
    payment_processing_note: z.string().optional(),
  })
  .passthrough();

const ManifestRateLimitsSchema = z
  .object({
    search_per_minute: z.number().int().nonnegative(),
    purchase_per_minute: z.number().int().nonnegative(),
  })
  .passthrough();

const SigningKeyJwkSchema = z
  .object({
    kid: z.string().min(1),
    kty: z.string().min(1),
    crv: z.string().optional(),
    x: z.string().optional(),
    y: z.string().optional(),
    alg: z.string().min(1),
    use: z.string().min(1),
  })
  .passthrough();

/**
 * Canonical AtlasManifest schema. Matches the `AtlasManifest` interface in
 * `./types/atlas-manifest.ts`, which is the shape produced by
 * `generateAtlasManifest`. The narrative `02-SCHEMAS.md` table lists a few
 * compact variants (e.g. capabilities as a string array); the SDK has
 * standardised on the structured form, so this schema mirrors that.
 */
export const AtlasManifestSchema = z
  .object({
    "@context": z.string().min(1),
    atlas_version: z.string().min(1),
    platform: ManifestPlatformSchema,
    capabilities: ManifestCapabilitiesSchema,
    endpoints: ManifestEndpointsSchema,
    payment_methods: z.array(z.string()),
    fee_schedule: ManifestFeeScheduleSchema,
    signing_keys: z.array(SigningKeyJwkSchema),
    rate_limits: ManifestRateLimitsSchema,
  })
  .passthrough();

// ---------------------------------------------------------------------------
// AtlasTicketType (02-SCHEMAS.md §3, types/atlas-ticket-type.ts)
// ---------------------------------------------------------------------------

const FeeSchema = z
  .object({
    name: z.string(),
    type: z.enum(["percentage", "fixed"]),
    rate: z.number().optional(),
    amount: z.number(),
    description: z.string(),
  })
  .passthrough();

const PricingSchema = z
  .object({
    base_price: z.number(),
    currency: z.string().min(1),
    fees: z.array(FeeSchema),
    total_price: z.number(),
    fees_total: z.number(),
    tax_included: z.boolean(),
    tax_amount: z.number().nullable(),
  })
  .passthrough();

const TicketAvailabilitySchema = z
  .object({
    status: z.enum(["available", "few_remaining", "sold_out", "not_on_sale", "hidden"]),
    total_quantity: z.number().int().nullable(),
    remaining_quantity: z.number().int().nullable(),
    max_per_order: z.number().int(),
    min_per_order: z.number().int(),
    sale_start: z.string().nullable(),
    sale_end: z.string().nullable(),
    on_sale: z.boolean(),
  })
  .passthrough();

const TicketRestrictionsSchema = z
  .object({
    age_minimum: z.number().int().nullable(),
    age_maximum: z.number().int().nullable(),
    requires_approval: z.boolean(),
    requires_invitation_code: z.boolean(),
    geographic_restrictions: z.array(z.string()),
    requires_identity_verification: z.boolean(),
    transferable: z.boolean(),
    resellable: z.boolean(),
    custom_restrictions: z.array(z.string()),
  })
  .passthrough();

const CancellationPolicySchema = z
  .object({
    refundable: z.boolean(),
    refund_type: z.string(),
    refund_deadline: z.string().nullable(),
    partial_refund_schedule: z.unknown(),
    cancellation_fee: z.number(),
    policy_text: z.string(),
    organizer_cancellation_refund: z.string(),
  })
  .passthrough();

/**
 * Canonical AtlasTicketType schema, matching `AtlasTicketType` in
 * `./types/atlas-ticket-type.ts`. ATLAS-namespaced keys (`atlas:pricing`,
 * `atlas:availability`, …) survive `.passthrough()` so platform-specific
 * extensions are preserved.
 */
export const AtlasTicketTypeSchema = z
  .object({
    "atlas:ticket_type_id": z.string().min(1),
    "atlas:source_ticket_type_id": z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    "atlas:event_id": z.string().min(1),
    "atlas:pricing": PricingSchema,
    "atlas:availability": TicketAvailabilitySchema,
    "atlas:restrictions": TicketRestrictionsSchema,
    "atlas:cancellation_policy": CancellationPolicySchema,
    "atlas:accepted_payment_methods": z.array(z.string()),
    "atlas:metadata": z.record(z.unknown()),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// AtlasEvent (02-SCHEMAS.md §2, types/atlas-event.ts)
// ---------------------------------------------------------------------------

const EventLocationAddressSchema = z
  .object({
    "@type": z.literal("PostalAddress"),
    streetAddress: z.string().optional(),
    addressLocality: z.string().optional(),
    addressRegion: z.string().optional(),
    postalCode: z.string().optional(),
    addressCountry: z.string().optional(),
  })
  .passthrough();

const EventLocationGeoSchema = z
  .object({
    "@type": z.literal("GeoCoordinates"),
    latitude: z.number(),
    longitude: z.number(),
  })
  .passthrough();

const EventLocationSchema = z
  .object({
    "@type": z.string().min(1),
    name: z.string().optional(),
    url: z.string().url().optional(),
    address: EventLocationAddressSchema.optional(),
    geo: EventLocationGeoSchema.optional(),
  })
  .passthrough();

const EventOrganizerSchema = z
  .object({
    "@type": z.literal("Organization"),
    name: z.string().min(1),
    url: z.string().url().optional(),
  })
  .passthrough();

const PriceRangeSchema = z
  .object({
    min_price: z.number(),
    max_price: z.number(),
    currency: z.string().min(1),
    includes_fees: z.boolean(),
  })
  .passthrough();

/**
 * Canonical AtlasEvent schema, matching `AtlasEvent` in
 * `./types/atlas-event.ts`. The `@context` is permissive (string or object)
 * to accommodate both the JSON-LD object form used by the SDK and the
 * `["https://schema.org", "https://atlas.events/v1"]` array form shown in
 * 02-SCHEMAS.md §2 examples.
 */
export const AtlasEventSchema = z
  .object({
    "@context": z.union([
      z.array(z.string()),
      z.object({ "@vocab": z.string(), atlas: z.string() }).passthrough(),
    ]),
    "@type": z.literal("Event"),
    "@id": z.string().min(1).optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    startDate: z.string().min(1),
    endDate: z.string().optional(),
    location: EventLocationSchema,
    organizer: EventOrganizerSchema.optional(),
    image: z.string().optional(),
    url: z.string().url().optional(),
    eventStatus: z
      .enum([
        "EventScheduled",
        "EventCancelled",
        "EventEnded",
        "EventPostponed",
        "EventRescheduled",
      ])
      .optional(),
    eventAttendanceMode: z
      .enum(["OnlineEventAttendanceMode", "OfflineEventAttendanceMode", "MixedEventAttendanceMode"])
      .optional(),
    "atlas:id": z.string().min(1).optional(),
    "atlas:availability": z.enum([
      "available",
      "few_remaining",
      "sold_out",
      "cancelled",
      "not_on_sale",
      "draft",
    ]),
    "atlas:organizer_id": z.string().min(1),
    "atlas:categories": z.array(z.string()).optional(),
    "atlas:tags": z.array(z.string()).optional(),
    "atlas:price_range": PriceRangeSchema.optional(),
    "atlas:ticket_types_count": z.number().int().nonnegative().optional(),
    "atlas:purchase_endpoint": z.string().url().optional(),
    "atlas:currency": z.string().optional(),
    "atlas:accepts_payment_methods": z.array(z.string()).optional(),
    "atlas:last_synced": z.string().optional(),
    "atlas:created_at": z.string().optional(),
    "atlas:updated_at": z.string().optional(),
    "atlas:source_platform": z.string().optional(),
    "atlas:source_event_id": z.string().optional(),
    "atlas:organizer_verified": z.boolean().optional(),
    "atlas:ticketTypes": z.array(AtlasTicketTypeSchema).optional(),
    "atlas:settlement": z
      .object({ chains: z.array(z.string()), token: z.string() })
      .passthrough()
      .optional(),
    "atlas:ipfs_cid": z.string().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// AtlasReceipt / AtlasCredential (02-SCHEMAS.md §5, receipt.ts)
// ---------------------------------------------------------------------------

const ReceiptSettlementSchema = z
  .object({
    method: z.enum(["x402", "stripe_spt"]),
    amount: z.string().min(1),
    currency: z.string().min(1),
    tx_hash: z.string().optional(),
    chain: z.string().optional(),
    payment_intent_id: z.string().optional(),
  })
  .passthrough();

const ReceiptCredentialSubjectSchema = z
  .object({
    id: z.string().min(1),
    event_id: z.string().min(1),
    hold_id: z.string().min(1),
    ticket_type: z.string().optional(),
    quantity: z.number().int().positive().optional(),
    settlement: ReceiptSettlementSchema,
  })
  .passthrough();

const ReceiptProofSchema = z
  .object({
    type: z.string().min(1),
    created: z.string().min(1),
    verificationMethod: z.string().min(1),
    proofPurpose: z.string().optional(),
    jws: z.string().optional(),
    proofValue: z.string().optional(),
  })
  .passthrough();

/**
 * Canonical AtlasReceipt (W3C VC) schema. Matches `AtlasReceipt` in
 * `./receipt.ts`. The `proof` block is optional because `generateReceipt`
 * returns an unsigned credential — the host attaches the ES256 JWS proof
 * before publishing.
 */
export const AtlasReceiptSchema = z
  .object({
    "@context": z.array(z.string()).min(1),
    type: z.array(z.string()).min(1),
    id: z.string().optional(),
    issuer: z.string().min(1),
    issuanceDate: z.string().min(1),
    credentialSubject: ReceiptCredentialSubjectSchema,
    proof: ReceiptProofSchema.optional(),
  })
  .passthrough()
  .refine((value) => value.type.includes("AtlasTicketReceipt"), {
    message: 'type must include "AtlasTicketReceipt"',
    path: ["type"],
  });

// ---------------------------------------------------------------------------
// Validator surface
// ---------------------------------------------------------------------------

/**
 * Result returned by the `validate*` helpers. Mirrors the shape used by other
 * SDK verifiers (see `payment-verify.ts`) — a discriminated union so callers
 * can `if (result.valid)` without needing a `try/catch`.
 */
export type ValidationResult<T> = { valid: true; data: T } | { valid: false; errors: ZodIssue[] };

function fromZod<S extends z.ZodTypeAny>(schema: S, input: unknown): ValidationResult<z.infer<S>> {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return { valid: true, data: parsed.data as z.infer<S> };
  }
  return { valid: false, errors: parsed.error.issues };
}

/** Validate an AtlasManifest JSON object. */
export function validateManifest(
  json: unknown,
): ValidationResult<z.infer<typeof AtlasManifestSchema>> {
  return fromZod(AtlasManifestSchema, json);
}

/** Validate an AtlasEvent JSON-LD object. */
export function validateAtlasEvent(
  json: unknown,
): ValidationResult<z.infer<typeof AtlasEventSchema>> {
  return fromZod(AtlasEventSchema, json);
}

/** Validate an AtlasReceipt (W3C VC) JSON object. */
export function validateReceipt(
  json: unknown,
): ValidationResult<z.infer<typeof AtlasReceiptSchema>> {
  return fromZod(AtlasReceiptSchema, json);
}
