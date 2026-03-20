# IMPL-PHASE-4: USDC Reward System

**Phase:** 4 — USDC Rewards
**Status:** Ready for Lead Routing (Audit R1 + R2 + R3 + R4 Fixed 2026-03-19)
**Created:** 2026-03-19
**Source PRD:** `atlas-protocol/07-economics/FEE-STRUCTURE.md`
**Depends on:** Phase 2 (Atlas Purchase Flow — AtlasReceipt model)
**Repos:** `lemonade-backend`, `web-new`

---

## Execution Status

| Agent | Task | Status |
|-------|------|--------|
| BE Agent | New models + migrations | NOT STARTED |
| BE Agent | Fee collection service | NOT STARTED |
| BE Agent | Reward accrual service | NOT STARTED |
| BE Agent | Referral service | NOT STARTED |
| BE Agent | Payout job + service | NOT STARTED |
| BE Agent | Refund clawback | NOT STARTED |
| BE Agent | GraphQL resolvers | NOT STARTED |
| FE Agent | Rewards dashboard | NOT STARTED |
| FE Agent | Referral program UI | NOT STARTED |
| BE Agent | Free ticket reward model + service [R4 SV-3] | NOT STARTED |
| BE Agent | Self.xyz verification-tiered rewards [R4 SV-1] | NOT STARTED |
| BE Agent | Anti-gaming rules for verified users [R4 SV-5] | NOT STARTED |
| FE Agent | Dashboard verification CTA [R4 SV-4] | NOT STARTED |

---

## 1. Critical Decisions (Non-Negotiable)

- All rewards denominated and paid in USDC. No custom tokens.
- 2% protocol fee on Atlas MPP transactions only (not native Lemonade ticket sales).
- Fee split (unverified): 40% treasury, 30% organizer cashback, 20% attendee cashback, 10% referral pool. [AUDIT FIX R4 SV-1: verified users get 25/35/25/15 split — see SV-1 tier table above]
- Organizer cashback sent to organizer's Tempo/Base wallet per ticket sold via Atlas.
- Attendee cashback: to Tempo wallet (if USDC payment) or custodial balance (if Stripe).
- Volume bonuses: 0.6% base, 0.8% ($10K+), 1.0% ($50K+), 1.2% ($250K+) monthly GMV.
- Referral: organizer-invites-organizer only. $5 at 25 tickets, $10 at $5K GMV, $50 cap per referral.
- Payout: weekly (Monday), minimum $5 USDC, 12-month expiry on unclaimed rewards.
- Tempo is EVM-compatible — reuse `ethereum` PaymentAccountType with Tempo `chain_id`.

> **AUDIT FIX R4 [SV-1]:** Verification-tiered reward system — Self.xyz verified users earn higher rates.

**Self.xyz Verification-Tiered Reward Table:**

| Feature | Unverified | Self-verified |
|---|---|---|
| Attendee cashback | 0.4% | 0.8% |
| Organizer cashback | 0.6% | 1.0% |
| Free ticket rewards | Not eligible | Fixed per-claim (see SV-3) |
| Referral program | Not eligible | Eligible |
| Discovery bonus | Not eligible | 2x cashback |
| Volume tier progression | Normal | 1.5x GMV multiplier |

**Verification-tiered fee split in `processAtlasFee`:**
- Unverified: Treasury 40%, Organizer 30%, Attendee 20%, Referral 10%
- Verified: Treasury 25%, Organizer 35%, Attendee 25%, Referral 15%
- Extra cashback (boosted rate - base rate) comes from reduced treasury share, NOT from increasing the protocol fee. The 2% protocol fee remains constant regardless of verification status.
- **Agent MUST grep for Self.xyz field on User model to find existing integration point.** Self.xyz verification in lemonade-backend is NOT a simple boolean on the User model. It uses the `UserSelfDisclosure` model (collection: `user_self_disclosures`) and `UserSelfRequest` model (collection: `user_self_requests`). To check if a user is Self-verified:
  1. Query `UserSelfDisclosureModel.find({ user: userId })` — if the user has disclosure records with non-null values, they are verified.
  2. The `nullifier` field on `UserSelfRequest` is the unique identity hash (one per human) — use this as the `selfVerifiedIdentityId` for cross-account deduplication.
  3. Key files: `lemonade-backend/src/app/models/user-self-disclosure.ts`, `lemonade-backend/src/app/models/user-self-request.ts`, `lemonade-backend/src/app/models/partials/self-verification.ts`, `lemonade-backend/src/app/services/self-verification.ts`.
  4. Helper function `getVerificationStatus(config, userId)` in `lemonade-backend/src/app/services/self-verification.ts` returns disclosure verification status — reuse this for Atlas reward tier checks.

> **AUDIT FIX [P4-C1]:** Self-purchase cashback farming prevention.
- **Self-purchase zero-out rule:** If `organizerId === attendeeUserId`, set BOTH organizer cashback AND attendee cashback to `0` for that transaction. The protocol fee is still collected (goes to treasury + referral pool only). Log self-purchases as suspicious activity via `logger.warn({ paymentId, userId: organizerId }, 'Self-purchase detected: cashback zeroed')`.

> **AUDIT FIX [P4-C2]:** Sybil referral attack prevention (anti-fraud rules).
- **Referral anti-fraud rules:**
  1. Referral code CANNOT be applied if referrer and referee share the same IP address (check `x-forwarded-for` at code application time, store on `AtlasReferral`).
  2. Referral code CANNOT be applied if referrer and referee share the same email domain (e.g., both `@company.com`). Exception: common providers (`gmail.com`, `outlook.com`, `yahoo.com`, `hotmail.com`, `icloud.com`, `protonmail.com`).
  3. Referral code CANNOT be applied if referrer and referee share any wallet address (compare against `AtlasPayoutSettings.wallet_address`).
  4. Referral milestones only count tickets purchased by UNIQUE attendees (not self-purchases by the referred organizer). Use `COUNT(DISTINCT attendee_id)` from `AtlasFeeDistribution` where `organizer_id = referredOrganizerId AND attendee_id != organizer_id`.
  5. **Manual review queue:** Referral payouts above $20 cumulative per referral require manual admin approval before payout. Add `requires_manual_review: boolean` flag to `AtlasReferral`. Set to `true` when `referrer_earned_usdc >= "20000000"`. Payout service skips these until admin clears them.
> **AUDIT FIX R2 [PD-1]:** Anti-fraud rules for referral program (RESOLVED).
- **Min account age: 7 days** before a referral code can be CREATED. In `generateReferralCode`, check `user.created_at` vs `Date.now()`. If account is < 7 days old, throw error: "Account must be at least 7 days old to create a referral code."
- **Min 1 published event with 1 non-self attendee** before earning referral REWARDS. The referral code can be shared immediately (after 7-day age gate), but milestone rewards are withheld until: `EventModel.countDocuments({ host: userId, state: 'published' }) >= 1` AND at least 1 ticket on that event was purchased by a different user (`ticket.assigned_to !== event.host`). Track as `referral_rewards_eligible: boolean` on `AtlasReferral`. `checkMilestones` skips reward crediting if `referral_rewards_eligible === false`.
- **Max 3 referral code applications per hour per IP.** Rate limit the `atlasApplyReferralCode` mutation. Use Redis sliding window: key `atlas:referral:ip:{ip}`, TTL 3600s, increment on each application, reject with 429 if count > 3.

> **AUDIT FIX R2 [PD-2]:** Tax compliance via Stripe Connect (RESOLVED).
- **Tax compliance is handled by Stripe Connect.** Stripe Connect collects W-9/W-8BEN, handles KYC, and files 1099-K automatically for connected accounts. Lemonade does NOT build its own tax collection infrastructure.
- **`AtlasTaxInfo` model REMOVED** (see Section 2.9). Stripe Connect handles tax info collection during onboarding.
- **Stripe Connect is REQUIRED as primary payout method.** Organizers MUST have an active Stripe Connected Account (`charges_enabled: true`) to receive ANY payout (USDC or fiat). Gate: if no Stripe Connect, payouts accumulate but do not disburse. Dashboard shows "Connect Stripe to receive your rewards."
- **Crypto wallet is OPTIONAL alternative destination.** Organizers who want crypto payouts must ALSO have Stripe Connect (so tax info is captured). In `AtlasPayoutSettings`: `stripe_connect_account_id` is REQUIRED for any payout, `crypto_wallet_address` + `crypto_wallet_chain` are OPTIONAL. Payout goes to ONE destination based on `preferred_method` — not split across multiple destinations. [AUDIT FIX R3 M-3]
- **Internal tracking only:** `cumulative_annual_usd` field added to `AtlasRewardBalance` for internal records (Stripe handles actual tax filing). Reset on Jan 1.

> **AUDIT FIX R2 [E12]:** Wash trading between colluding organizers — documented known limitation.
- **Cross-organizer wash trading is a known limitation.** Detecting collusion (Organizer A buys B's tickets, B buys A's) programmatically without ML-based fraud detection has too many false positives for automatic blocking.
- **Basic heuristics implemented:** Monthly automated report flags transactions where >80% of Space A's Atlas revenue comes from Space B's owner (and vice versa). See job 4.7.
- **Manual review only** — flagged patterns are surfaced to admin dashboard for investigation. No automatic blocking.

> **AUDIT FIX R4 [SV-5]:** Anti-gaming rules for Self-verified users.
- **Self-purchase exclusion still applies to verified users.** Verification does NOT override P4-C1. `organizerId === attendeeUserId` → zero cashback regardless of verification status. Zero free ticket rewards too.
- **Monthly cap on boosted rewards: max $100/month in BOOSTED DIFFERENCE** (the delta between the verified rate and the base unverified rate). After the cap, verified users earn at the base unverified rate for the remainder of the month. This limits the upside of any gaming strategy. Tracked via `boosted_delta_usdc` field on `AtlasFeeDistribution`.
- **Free ticket reward caps are hard limits:** 100 per user per month, 500 per event. No exceptions for any verification tier. These caps are enforced in `processAtlasFreeTicketReward` (Section 3.5).
- Treasury exposure from free ticket rewards is bounded: max $15/event (500 x $0.03), max $3/user/month (100 x $0.03).

---

## 2. New Models

All new models go in `lemonade-backend/src/app/models/`. Follow the existing pattern: Typegoose + Type-GraphQL decorators on the same class, `@modelOptions` decorator on the class, explicit `created_at`/`updated_at` fields (never `timestamps: true`), `export default <Model>` at the bottom.

### 2.1 AtlasRewardBalance

**File:** `lemonade-backend/src/app/models/atlas-reward-balance.ts`
**Collection:** `atlas_reward_balances`

Tracks the running USDC reward balance for each user (organizer or attendee) per Space. One document per user per Space.

```typescript
import { Field, ObjectType, registerEnumType } from 'type-graphql';
import { type Ref, prop, Severity, modelOptions, getModelForClass, index } from '@typegoose/typegoose';
import { Types } from 'mongoose';

import { type User } from './user';
import { type Space } from './space';

export enum AtlasRewardBalanceType {
  organizer = 'organizer',
  attendee = 'attendee',
}

registerEnumType(AtlasRewardBalanceType, { name: 'AtlasRewardBalanceType' });

@ObjectType()
@index({ user: 1, space: 1, type: 1 }, { unique: true })
@index({ user: 1, type: 1 })
@modelOptions({ options: { allowMixed: Severity.ALLOW }, schemaOptions: { collection: 'atlas_reward_balances' } })
export class AtlasRewardBalance {
  @Field()
  _id!: Types.ObjectId;

  @Field(() => Types.ObjectId)
  @prop({ required: true, ref: () => 'User' })
  user!: Ref<User>;

  @Field(() => Types.ObjectId)
  @prop({ required: true, ref: () => 'Space' })
  space!: Ref<Space>;

  @Field(() => AtlasRewardBalanceType)
  @prop({ enum: AtlasRewardBalanceType, required: true })
  type!: AtlasRewardBalanceType; // organizer or attendee

  @Field()
  @prop({ required: true, default: '0' })
  accrued_usdc!: string; // BigInt string — total ever earned (cents, 6 decimals)

  @Field()
  @prop({ required: true, default: '0' })
  paid_out_usdc!: string; // BigInt string — total paid out

  @Field()
  @prop({ required: true, default: '0' })
  pending_usdc!: string; // BigInt string — accrued minus paid_out minus clawed_back

  @Field()
  @prop({ required: true, default: '0' })
  clawed_back_usdc!: string; // BigInt string — total clawed back from refunds

  @Field()
  @prop({ required: true, default: '0' })
  negative_balance_usdc!: string; // BigInt string — owed back from post-withdrawal refunds

  // AUDIT FIX R2 [PD-2]: Cumulative annual USD tracking (internal only — Stripe handles tax filing)
  @Field()
  @prop({ required: true, default: '0' })
  cumulative_annual_usd!: string; // BigInt string — total payouts this calendar year. Reset on Jan 1.

  @Field({ nullable: true })
  @prop()
  last_payout_at?: Date;

  @Field()
  @prop({ required: true, default: Date.now })
  created_at!: Date;

  @prop()
  updated_at?: Date;
}

export const AtlasRewardBalanceModel = getModelForClass(AtlasRewardBalance);

export default AtlasRewardBalanceModel;
```

**Key design notes:**
- All monetary values are string BigInts in USDC micro-units (6 decimals). A value of `"1000000"` = $1.00 USDC.
- `pending_usdc` = `accrued_usdc` - `paid_out_usdc` - `clawed_back_usdc` (maintained as a derived field for query performance).
- `negative_balance_usdc` tracks debt when a refund clawback exceeds available balance (post-withdrawal). Deducted from next payout. Written off after 90 days.

> **AUDIT FIX R3 [F-3]:** Per-organizer negative balance cap of $1000. If `negative_balance_usdc` exceeds $1000 (`"1000000000"`), new reward accrual is blocked for that organizer until the negative balance recovers below the cap. This limits treasury exposure from long-horizon refunds (beyond the 14-day hold) where the organizer has already withdrawn rewards. The fee service checks this cap before crediting organizer rewards: if `negative_balance_usdc > "1000000000"`, skip organizer cashback + volume bonus (those amounts go to treasury instead). Log: `logger.warn({ userId, negativeBalance }, 'Organizer negative balance cap exceeded — rewards redirected to treasury')`.
- `cumulative_annual_usd` tracks total payouts per calendar year for internal records only (Stripe Connect handles 1099-K filing).

### 2.2 AtlasFeeDistribution

**File:** `lemonade-backend/src/app/models/atlas-fee-distribution.ts`
**Collection:** `atlas_fee_distributions`

Per-transaction fee breakdown log. One document per successful Atlas payment. Immutable audit trail.

```typescript
import { Field, ObjectType, registerEnumType } from 'type-graphql';
import { type Ref, prop, Severity, modelOptions, getModelForClass, index } from '@typegoose/typegoose';
import { Types } from 'mongoose';

import { type User } from './user';
import { type Space } from './space';

export enum AtlasFeePaymentMethod {
  tempo_usdc = 'tempo_usdc',
  stripe = 'stripe',
}

registerEnumType(AtlasFeePaymentMethod, { name: 'AtlasFeePaymentMethod' });

// AUDIT FIX R2 [E10]: Added pending_hold and cancelled statuses for 14-day reward hold
export enum AtlasFeeStatus {
  pending_hold = 'pending_hold',       // reward created, 14-day hold active
  available = 'available',             // hold expired, reward available for payout (was 'accrued')
  paid_out = 'paid_out',
  clawed_back = 'clawed_back',
  partially_clawed_back = 'partially_clawed_back',
  cancelled = 'cancelled',            // refund during hold period — reward cancelled, not clawed back
}

registerEnumType(AtlasFeeStatus, { name: 'AtlasFeeStatus' });

@ObjectType()
@index({ payment_id: 1 }, { unique: true })
@index({ event_id: 1 })
@index({ space_id: 1 })
@index({ organizer_id: 1, created_at: -1 })
@index({ attendee_id: 1, created_at: -1 })
@index({ status: 1 })
@modelOptions({ options: { allowMixed: Severity.ALLOW }, schemaOptions: { collection: 'atlas_fee_distributions' } })
export class AtlasFeeDistribution {
  @Field()
  _id!: Types.ObjectId;

  @Field(() => Types.ObjectId)
  @prop({ required: true })
  payment_id!: Types.ObjectId; // ref to NewPayment._id

  @Field(() => Types.ObjectId)
  @prop({ required: true })
  event_id!: Types.ObjectId;

  @Field(() => Types.ObjectId)
  @prop({ required: true })
  space_id!: Types.ObjectId; // ref to Space._id (the organizer's Space)

  @Field(() => Types.ObjectId)
  @prop({ required: true, ref: () => 'User' })
  organizer_id!: Ref<User>; // event creator / Space owner

  @Field(() => Types.ObjectId, { nullable: true })
  @prop({ ref: () => 'User' })
  attendee_id?: Ref<User>; // buyer (null if guest checkout)

  @Field()
  @prop({ required: true })
  gross_amount_usdc!: string; // BigInt — total ticket price in USDC micro-units

  @Field()
  @prop({ required: true })
  protocol_fee_usdc!: string; // BigInt — 2% of gross_amount

  @Field()
  @prop({ required: true })
  treasury_share_usdc!: string; // BigInt — 40% of protocol_fee

  @Field()
  @prop({ required: true })
  organizer_cashback_usdc!: string; // BigInt — 30% of protocol_fee (base rate, before volume bonus)

  @Field()
  @prop({ required: true })
  attendee_cashback_usdc!: string; // BigInt — 20% of protocol_fee

  @Field()
  @prop({ required: true })
  referral_pool_usdc!: string; // BigInt — 10% of protocol_fee

  @Field()
  @prop({ required: true })
  organizer_volume_bonus_usdc!: string; // BigInt — additional cashback from volume tier (funded by treasury)

  @Field()
  @prop({ required: true, default: '0' })
  attendee_discovery_bonus_usdc!: string; // BigInt — additional cashback from discovery bonus

  // AUDIT FIX R4 [SV-5]: Track boosted reward delta for monthly cap enforcement
  @Field()
  @prop({ required: true, default: '0' })
  boosted_delta_usdc!: string; // BigInt — difference between verified rate and base rate for this transaction

  // AUDIT FIX R4 [SV-1]: Track verification status at time of transaction
  @Field()
  @prop({ required: true, default: false })
  organizer_verified!: boolean; // Was organizer Self-verified at transaction time?

  @Field()
  @prop({ required: true, default: false })
  attendee_verified!: boolean; // Was attendee Self-verified at transaction time?

  @Field(() => AtlasFeePaymentMethod)
  @prop({ enum: AtlasFeePaymentMethod, required: true })
  payment_method!: AtlasFeePaymentMethod;

  @Field(() => AtlasFeeStatus)
  @prop({ enum: AtlasFeeStatus, required: true, default: AtlasFeeStatus.pending_hold })
  status!: AtlasFeeStatus; // AUDIT FIX R2 [E10]: default is pending_hold (was accrued)

  // AUDIT FIX R2 [E10]: 14-day hold — reward not available for payout until this date
  @Field()
  @prop({ required: true })
  hold_expires_at!: Date; // Set to created_at + 14 days. Payout service filters: status === 'available' AND hold_expires_at < now

  // AUDIT FIX R2 [E15]: Track source connection for suspended-connection reward blocking
  @Field(() => Types.ObjectId, { nullable: true })
  @prop()
  connection_id?: Types.ObjectId; // ref to Connection._id — if connection is suspended, reward is not generated

  @Field({ nullable: true })
  @prop()
  refund_amount_usdc?: string; // BigInt — set on partial/full refund

  @Field({ nullable: true })
  @prop()
  transaction_hash?: string; // blockchain tx hash (Tempo payments)

  @Field({ nullable: true })
  @prop()
  stripe_payment_intent?: string; // Stripe intent ID (Stripe payments)

  @Field()
  @prop({ required: true, default: Date.now })
  created_at!: Date;

  @prop()
  updated_at?: Date;
}

export const AtlasFeeDistributionModel = getModelForClass(AtlasFeeDistribution);

export default AtlasFeeDistributionModel;
```

### 2.3 AtlasReferral

**File:** `lemonade-backend/src/app/models/atlas-referral.ts`
**Collection:** `atlas_referrals`

Tracks organizer-invites-organizer referrals.

```typescript
import { Field, ObjectType, registerEnumType } from 'type-graphql';
import { type Ref, prop, Severity, modelOptions, getModelForClass, index } from '@typegoose/typegoose';
import { Types } from 'mongoose';

import { type User } from './user';

export enum AtlasReferralStatus {
  pending = 'pending',       // referred organizer signed up but no milestones hit
  milestone_1 = 'milestone_1', // 25 tickets sold
  milestone_2 = 'milestone_2', // $5K GMV
  capped = 'capped',         // $50 cap reached
  expired = 'expired',
}

registerEnumType(AtlasReferralStatus, { name: 'AtlasReferralStatus' });

@ObjectType()
@index({ referrer_id: 1 })
@index({ referred_id: 1 }, { unique: true }) // one referrer per referred organizer
@index({ referral_code: 1 })
@modelOptions({ options: { allowMixed: Severity.ALLOW }, schemaOptions: { collection: 'atlas_referrals' } })
export class AtlasReferral {
  @Field()
  _id!: Types.ObjectId;

  @Field(() => Types.ObjectId)
  @prop({ required: true, ref: () => 'User' })
  referrer_id!: Ref<User>; // Organizer A who invited

  @Field(() => Types.ObjectId)
  @prop({ required: true, ref: () => 'User' })
  referred_id!: Ref<User>; // Organizer B who was invited

  @Field()
  @prop({ required: true })
  referral_code!: string; // the code used

  @Field(() => AtlasReferralStatus)
  @prop({ enum: AtlasReferralStatus, required: true, default: AtlasReferralStatus.pending })
  status!: AtlasReferralStatus;

  @Field()
  @prop({ required: true, default: 0 })
  referred_tickets_sold!: number; // running count of referred organizer's Atlas ticket sales

  @Field()
  @prop({ required: true, default: '0' })
  referred_gmv_usdc!: string; // BigInt — running GMV of referred organizer

  @Field()
  @prop({ required: true, default: '0' })
  referrer_earned_usdc!: string; // BigInt — total earned by referrer for this referral

  @Field()
  @prop({ required: true, default: '0' })
  referred_welcome_bonus_usdc!: string; // BigInt — welcome bonus paid to referred ($2)

  @Field({ nullable: true })
  @prop()
  milestone_1_at?: Date; // when 25-ticket milestone was hit

  @Field({ nullable: true })
  @prop()
  milestone_2_at?: Date; // when $5K GMV milestone was hit

  @Field({ nullable: true })
  @prop()
  welcome_bonus_paid_at?: Date;

  // AUDIT FIX [P4-C2]: Anti-fraud fields
  @Field()
  @prop({ required: true, default: false })
  requires_manual_review!: boolean; // set true when referrer_earned_usdc >= $20

  // AUDIT FIX R2 [PD-1]: Referral rewards eligibility gate
  @Field()
  @prop({ required: true, default: false })
  referral_rewards_eligible!: boolean; // true when referrer has >= 1 published event with >= 1 non-self attendee

  @Field({ nullable: true })
  @prop()
  referee_ip?: string; // IP address at referral application time (audit trail)

  @Field({ nullable: true })
  @prop()
  manual_review_cleared_at?: Date; // when admin cleared the manual review

  @Field()
  @prop({ required: true, default: Date.now })
  created_at!: Date;

  @prop()
  updated_at?: Date;
}

export const AtlasReferralModel = getModelForClass(AtlasReferral);

export default AtlasReferralModel;
```

### 2.4 AtlasReferralCode

**File:** `lemonade-backend/src/app/models/atlas-referral-code.ts`
**Collection:** `atlas_referral_codes`

One referral code per organizer. Decoupled from AtlasReferral so the code persists across referrals.

```typescript
import { Field, ObjectType } from 'type-graphql';
import { type Ref, prop, modelOptions, getModelForClass, index } from '@typegoose/typegoose';
import { Types } from 'mongoose';

import { type User } from './user';

@ObjectType()
@index({ user: 1 }, { unique: true })
@index({ code: 1 }, { unique: true })
@modelOptions({ schemaOptions: { collection: 'atlas_referral_codes' } })
export class AtlasReferralCode {
  @Field()
  _id!: Types.ObjectId;

  @Field(() => Types.ObjectId)
  @prop({ required: true, ref: () => 'User' })
  user!: Ref<User>;

  @Field()
  @prop({ required: true })
  code!: string; // 8-char alphanumeric, case-insensitive

  @Field()
  @prop({ required: true, default: Date.now })
  created_at!: Date;
}

export const AtlasReferralCodeModel = getModelForClass(AtlasReferralCode);

export default AtlasReferralCodeModel;
```

### 2.5 AtlasPayoutBatch

**File:** `lemonade-backend/src/app/models/atlas-payout-batch.ts`
**Collection:** `atlas_payout_batches`

Weekly payout batch tracking.

```typescript
import { Field, ObjectType, registerEnumType } from 'type-graphql';
import { prop, Severity, modelOptions, getModelForClass, index } from '@typegoose/typegoose';
import { Types } from 'mongoose';
import { GraphQLJSON } from 'graphql-type-json';

export enum AtlasPayoutBatchStatus {
  pending = 'pending',
  processing = 'processing',
  completed = 'completed',
  partially_failed = 'partially_failed',
  failed = 'failed',
}

registerEnumType(AtlasPayoutBatchStatus, { name: 'AtlasPayoutBatchStatus' });

@ObjectType()
class AtlasPayoutItem {
  @Field(() => Types.ObjectId)
  @prop({ required: true })
  user!: Types.ObjectId;

  @Field()
  @prop({ required: true })
  amount_usdc!: string; // BigInt

  @Field()
  @prop({ required: true })
  payout_method!: string; // 'tempo_usdc' | 'stripe_connect'

  @Field({ nullable: true })
  @prop()
  wallet_address?: string;

  @Field({ nullable: true })
  @prop()
  tx_hash?: string;

  @Field({ nullable: true })
  @prop()
  stripe_transfer_id?: string;

  @Field()
  @prop({ required: true, default: 'pending' })
  status!: string; // 'pending' | 'succeeded' | 'failed'

  @Field({ nullable: true })
  @prop()
  failure_reason?: string;

  // AUDIT FIX [P4-M7]: Retry tracking for failed payouts
  @Field()
  @prop({ required: true, default: 0 })
  retry_count!: number; // max 3 retries with exponential backoff (1h, 6h, 24h)

  @Field({ nullable: true })
  @prop()
  processed_at?: Date;
}

> **AUDIT FIX [P4-H3]:** Unique compound index on period_start + period_end prevents duplicate batches.

@ObjectType()
@index({ status: 1 })
@index({ period_start: 1, period_end: 1 }, { unique: true })
@modelOptions({ options: { allowMixed: Severity.ALLOW }, schemaOptions: { collection: 'atlas_payout_batches' } })
export class AtlasPayoutBatch {
  @Field()
  _id!: Types.ObjectId;

  @Field()
  @prop({ required: true })
  period_start!: Date; // Monday 00:00 UTC of the prior week

  @Field()
  @prop({ required: true })
  period_end!: Date; // Sunday 23:59:59 UTC of the prior week

  @Field(() => AtlasPayoutBatchStatus)
  @prop({ enum: AtlasPayoutBatchStatus, required: true, default: AtlasPayoutBatchStatus.pending })
  status!: AtlasPayoutBatchStatus;

  @Field()
  @prop({ required: true, default: '0' })
  total_amount_usdc!: string; // BigInt — sum of all payouts in batch

  @Field()
  @prop({ required: true, default: 0 })
  total_items!: number;

  @Field()
  @prop({ required: true, default: 0 })
  succeeded_items!: number;

  @Field()
  @prop({ required: true, default: 0 })
  failed_items!: number;

  @Field(() => [AtlasPayoutItem])
  @prop({ type: AtlasPayoutItem, _id: false, default: [] })
  items!: AtlasPayoutItem[];

  @Field()
  @prop({ required: true, default: Date.now })
  created_at!: Date;

  @prop()
  updated_at?: Date;
}

export const AtlasPayoutBatchModel = getModelForClass(AtlasPayoutBatch);

export default AtlasPayoutBatchModel;
```

### 2.6 AtlasOrganizerMonthlyGmv

**File:** `lemonade-backend/src/app/models/atlas-organizer-monthly-gmv.ts`
**Collection:** `atlas_organizer_monthly_gmvs`

Tracks monthly GMV per organizer for volume bonus tier determination.

```typescript
import { Field, ObjectType } from 'type-graphql';
import { type Ref, prop, modelOptions, getModelForClass, index } from '@typegoose/typegoose';
import { Types } from 'mongoose';

import { type User } from './user';

@ObjectType()
@index({ user: 1, year: 1, month: 1 }, { unique: true })
@modelOptions({ schemaOptions: { collection: 'atlas_organizer_monthly_gmvs' } })
export class AtlasOrganizerMonthlyGmv {
  @Field()
  _id!: Types.ObjectId;

  @Field(() => Types.ObjectId)
  @prop({ required: true, ref: () => 'User' })
  user!: Ref<User>;

  @Field()
  @prop({ required: true })
  year!: number; // e.g. 2026

  @Field()
  @prop({ required: true })
  month!: number; // 1-12

  @Field()
  @prop({ required: true, default: '0' })
  gmv_usdc!: string; // BigInt — gross merchandise volume for the month

  @Field()
  @prop({ required: true, default: 0 })
  ticket_count!: number;

  @Field()
  @prop({ required: true, default: Date.now })
  created_at!: Date;

  @prop()
  updated_at?: Date;
}

export const AtlasOrganizerMonthlyGmvModel = getModelForClass(AtlasOrganizerMonthlyGmv);

export default AtlasOrganizerMonthlyGmvModel;
```

> **AUDIT FIX [P4-C3]:** Partial refund tracking without modifying NewPayment state machine.
> Verified: `NewPaymentState` enum in `lemonade-backend/src/app/models/new-payment.ts:19-27` has only `created | initialized | failed | await_capture | succeeded | refunded | cancelled` — no `partially_refunded` state. Adding one would be invasive. Instead, track partial refunds in a separate model.

### 2.7 AtlasRefund

**File:** `lemonade-backend/src/app/models/atlas-refund.ts`
**Collection:** `atlas_refunds`

Tracks partial and full refunds for Atlas payments. Additive model — does NOT change `NewPaymentState` enum.

```typescript
import { Field, ObjectType, registerEnumType } from 'type-graphql';
import { prop, Severity, modelOptions, getModelForClass, index } from '@typegoose/typegoose';
import { Types } from 'mongoose';

export enum AtlasRefundType {
  full = 'full',
  partial = 'partial',
}

registerEnumType(AtlasRefundType, { name: 'AtlasRefundType' });

@ObjectType()
@index({ payment_id: 1 })
@index({ fee_distribution_id: 1 })
@index({ created_at: -1 })
@modelOptions({ options: { allowMixed: Severity.ALLOW }, schemaOptions: { collection: 'atlas_refunds' } })
export class AtlasRefund {
  @Field()
  _id!: Types.ObjectId;

  @Field(() => Types.ObjectId)
  @prop({ required: true })
  payment_id!: Types.ObjectId; // ref to NewPayment._id

  @Field(() => Types.ObjectId)
  @prop({ required: true })
  fee_distribution_id!: Types.ObjectId; // ref to AtlasFeeDistribution._id

  @Field(() => AtlasRefundType)
  @prop({ enum: AtlasRefundType, required: true })
  refund_type!: AtlasRefundType;

  @Field()
  @prop({ required: true })
  refund_amount_usdc!: string; // BigInt — refunded amount in USDC micro-units

  @Field()
  @prop({ required: true })
  refund_percent!: number; // 1-100

  @Field()
  @prop({ required: true })
  organizer_clawback_usdc!: string; // BigInt — amount clawed back from organizer

  @Field()
  @prop({ required: true })
  attendee_clawback_usdc!: string; // BigInt — amount clawed back from attendee

  @Field()
  @prop({ required: true })
  treasury_clawback_usdc!: string; // BigInt — amount returned to treasury (volume bonus portion)

  @Field()
  @prop({ required: true, default: Date.now })
  created_at!: Date;
}

export const AtlasRefundModel = getModelForClass(AtlasRefund);

export default AtlasRefundModel;
```

> **AUDIT FIX [P4-H1]:** Separate payout settings from Space payment accounts.
> Verified: `Space.payment_accounts` in `lemonade-backend/src/app/models/space.ts:179-180` is an array of `NewPaymentAccount` ObjectIds used for RECEIVING ticket revenue. These are Space-level accounts, not personal payout wallets. Conflating them would cause payouts to go to the wrong address.

### 2.8 AtlasPayoutSettings

**File:** `lemonade-backend/src/app/models/atlas-payout-settings.ts`
**Collection:** `atlas_payout_settings`

Per-user payout destination configuration. Decoupled from Space payment accounts.

```typescript
import { Field, ObjectType } from 'type-graphql';
import { type Ref, prop, modelOptions, getModelForClass, index } from '@typegoose/typegoose';
import { Types } from 'mongoose';

import { type User } from './user';

@ObjectType()
@index({ user: 1 }, { unique: true })
@modelOptions({ schemaOptions: { collection: 'atlas_payout_settings' } })
export class AtlasPayoutSettings {
  @Field()
  _id!: Types.ObjectId;

  @Field(() => Types.ObjectId)
  @prop({ required: true, ref: () => 'User' })
  user!: Ref<User>;

  // AUDIT FIX R2 [PD-2]: Stripe Connect is REQUIRED for any payout. Crypto wallet is OPTIONAL secondary.
  @Field({ nullable: true })
  @prop()
  stripe_connect_account_id?: string; // REQUIRED for any payout — Stripe Connect account. Handles tax/KYC via Stripe.

  @Field({ nullable: true })
  @prop()
  wallet_address?: string; // OPTIONAL — EVM wallet address for Tempo/Base USDC payouts (secondary destination, requires Stripe Connect)

  @Field({ nullable: true })
  @prop()
  wallet_chain?: string; // chain_id string (e.g., Tempo chain ID)

  @Field({ nullable: true })
  @prop()
  preferred_method?: string; // 'stripe_connect' | 'tempo_usdc' — user's preferred payout method. Stripe Connect required regardless.

  @Field()
  @prop({ required: true, default: Date.now })
  created_at!: Date;

  @prop()
  updated_at?: Date;
}

export const AtlasPayoutSettingsModel = getModelForClass(AtlasPayoutSettings);

export default AtlasPayoutSettingsModel;
```

> **AUDIT FIX R2 [PD-2]:** AtlasTaxInfo model REMOVED. Tax compliance is handled by Stripe Connect.
> Stripe Connect collects W-9/W-8BEN during onboarding, handles KYC, and files 1099-K automatically.
> Lemonade tracks `cumulative_annual_usd` on `AtlasRewardBalance` for internal records only.

### 2.9 ~~AtlasTaxInfo~~ (REMOVED — AUDIT FIX R2 [PD-2])

This model has been removed. Stripe Connect handles all tax compliance. See PD-2 decision above.

> **AUDIT FIX R3 [M-2]:** AtlasDustPool model for consolidated sub-threshold fee tracking.

### 2.10 AtlasDustPool

**File:** `lemonade-backend/src/app/models/atlas-dust-pool.ts`
**Collection:** `atlas_dust_pools`

Tracks consolidated protocol fees from sub-threshold transactions (< $1.00). One document per month. Periodically swept to treasury.

```typescript
import { Field, ObjectType } from 'type-graphql';
import { prop, modelOptions, getModelForClass, index } from '@typegoose/typegoose';
import { Types } from 'mongoose';

@ObjectType()
@index({ month: 1 }, { unique: true })
@modelOptions({ schemaOptions: { collection: 'atlas_dust_pools' } })
export class AtlasDustPool {
  @Field()
  _id!: Types.ObjectId;

  @Field()
  @prop({ required: true })
  month!: string; // "YYYY-MM" format

  @Field()
  @prop({ required: true, default: '0' })
  total_dust_usdc!: string; // BigInt string — accumulated protocol fees from sub-threshold transactions

  @Field()
  @prop({ required: true, default: 0 })
  transaction_count!: number; // number of sub-threshold transactions this month

  @Field()
  @prop({ required: true, default: Date.now })
  created_at!: Date;

  @prop()
  updated_at?: Date;
}

export const AtlasDustPoolModel = getModelForClass(AtlasDustPool);

export default AtlasDustPoolModel;
```

> **AUDIT FIX R4 [SV-3]:** AtlasFreeTicketReward model — separate from AtlasFeeDistribution. Free ticket rewards are funded by treasury, not by protocol fees.

### 2.11 AtlasFreeTicketReward

**File:** `lemonade-backend/src/app/models/atlas-free-ticket-reward.ts`
**Collection:** `atlas_free_ticket_rewards`

Tracks fixed per-claim rewards for Self-verified users who claim free tickets via Atlas. Separate from `AtlasFeeDistribution` (which is for paid tickets only). Funded from treasury.

```typescript
import { Field, ObjectType, registerEnumType } from 'type-graphql';
import { type Ref, prop, Severity, modelOptions, getModelForClass, index } from '@typegoose/typegoose';
import { Types } from 'mongoose';

import { type User } from './user';
import { type Space } from './space';

export enum AtlasFreeTicketRewardRole {
  attendee = 'attendee',
  organizer = 'organizer',
}

registerEnumType(AtlasFreeTicketRewardRole, { name: 'AtlasFreeTicketRewardRole' });

export enum AtlasFreeTicketRewardStatus {
  pending_hold = 'pending_hold',       // 14-day hold active
  available = 'available',             // hold expired, available for payout
  paid_out = 'paid_out',
  cancelled = 'cancelled',
}

registerEnumType(AtlasFreeTicketRewardStatus, { name: 'AtlasFreeTicketRewardStatus' });

@ObjectType()
@index({ user_id: 1, created_at: -1 })
@index({ event_id: 1 })
@index({ space_id: 1 })
@index({ status: 1, hold_expires_at: 1 })
@index({ user_id: 1, role: 1, created_at: -1 })  // For monthly cap query
@modelOptions({ options: { allowMixed: Severity.ALLOW }, schemaOptions: { collection: 'atlas_free_ticket_rewards' } })
export class AtlasFreeTicketReward {
  @Field()
  _id!: Types.ObjectId;

  @Field(() => Types.ObjectId)
  @prop({ required: true, ref: () => 'User' })
  user_id!: Ref<User>;

  @Field(() => Types.ObjectId)
  @prop({ required: true })
  event_id!: Types.ObjectId;

  @Field(() => Types.ObjectId)
  @prop({ required: true })
  space_id!: Types.ObjectId;

  @Field(() => AtlasFreeTicketRewardRole)
  @prop({ enum: AtlasFreeTicketRewardRole, required: true })
  role!: AtlasFreeTicketRewardRole; // 'attendee' | 'organizer'

  @Field()
  @prop({ required: true })
  amount_usdc!: string; // BigInt string — $0.01 attendee ("10000"), $0.02 organizer ("20000") in USDC micro-units

  @Field()
  @prop({ required: true, default: true })
  self_verified!: boolean; // always true — unverified users don't get free ticket rewards

  @Field(() => AtlasFreeTicketRewardStatus)
  @prop({ enum: AtlasFreeTicketRewardStatus, required: true, default: AtlasFreeTicketRewardStatus.pending_hold })
  status!: AtlasFreeTicketRewardStatus;

  @Field()
  @prop({ required: true })
  hold_expires_at!: Date; // 14-day hold, same as paid ticket rewards

  @Field()
  @prop({ required: true, default: Date.now })
  created_at!: Date;

  @prop()
  updated_at?: Date;
}

export const AtlasFreeTicketRewardModel = getModelForClass(AtlasFreeTicketReward);

export default AtlasFreeTicketRewardModel;
```

**Key design notes (SV-3):**
- Amounts are fixed: `$0.01` USDC (`"10000"` in micro-units) per attendee claim, `$0.02` USDC (`"20000"` in micro-units) per organizer claim. Funded from treasury.
- **Caps (hard limits — AUDIT FIX R4 [SV-5]):**
  - Max 100 free ticket rewards per user per month (prevents farming)
  - Max 500 free ticket rewards per event (prevents single-event flooding)
  - Treasury exposure: max $15/event (500 x $0.03), max $3/user/month (100 x $0.03)
- Same 14-day hold as paid ticket rewards. Same Stripe Connect requirement for payout.
- Included in the weekly payout batch alongside paid ticket rewards (see Section 3.3 update).
- `self_verified` is always `true` — unverified users are NOT eligible for free ticket rewards.

---

## 3. Services

All services go in `lemonade-backend/src/app/services/`. Follow the existing pattern: export as namespace of async functions (not classes). Import models directly.

### 3.1 Atlas Fee Collection Service

**File:** `lemonade-backend/src/app/services/atlas-fee.ts`

Called after a successful Atlas payment (Phase 2 hook). Creates the AtlasFeeDistribution record and credits reward balances.

```typescript
// Pseudocode interface — implementing agent writes the actual code

import { Types } from 'mongoose';

// --- Constants ---
const PROTOCOL_FEE_BPS = 200;         // 2.00% = 200 basis points

// AUDIT FIX R4 [SV-1]: Verification-tiered fee split
// Unverified user fee split:
const UNVERIFIED_TREASURY_SHARE_BPS = 4000;       // 40% of fee
const UNVERIFIED_ORGANIZER_CASHBACK_BPS = 3000;   // 30% of fee
const UNVERIFIED_ATTENDEE_CASHBACK_BPS = 2000;    // 20% of fee
const UNVERIFIED_REFERRAL_POOL_BPS = 1000;        // 10% of fee

// Self-verified user fee split (extra cashback from reduced treasury share):
const VERIFIED_TREASURY_SHARE_BPS = 2500;          // 25% of fee
const VERIFIED_ORGANIZER_CASHBACK_BPS = 3500;      // 35% of fee
const VERIFIED_ATTENDEE_CASHBACK_BPS = 2500;       // 25% of fee
const VERIFIED_REFERRAL_POOL_BPS = 1500;           // 15% of fee

// Legacy aliases (for backward compat in code that doesn't check verification):
const TREASURY_SHARE_BPS = UNVERIFIED_TREASURY_SHARE_BPS;
const ORGANIZER_CASHBACK_BPS = UNVERIFIED_ORGANIZER_CASHBACK_BPS;
const ATTENDEE_CASHBACK_BPS = UNVERIFIED_ATTENDEE_CASHBACK_BPS;
const REFERRAL_POOL_BPS = UNVERIFIED_REFERRAL_POOL_BPS;

// Volume bonus tiers (monthly GMV thresholds in USDC micro-units)
const VOLUME_TIERS = [
  { threshold: BigInt(250_000_000_000), rate_bps: 120 },  // $250K+ → 1.20%
  { threshold: BigInt(50_000_000_000),  rate_bps: 100 },  // $50K+  → 1.00%
  { threshold: BigInt(10_000_000_000),  rate_bps: 80 },   // $10K+  → 0.80%
  { threshold: BigInt(0),               rate_bps: 60 },   // base   → 0.60%
];

// Discovery bonus multipliers
const DISCOVERY_FIRST_10_MULTIPLIER = 2;   // 2x for first 10 attendees
const DISCOVERY_11_50_MULTIPLIER = 1.5;    // 1.5x for attendees 11-50

// --- Functions ---

/**
 * processAtlasFee — main entry point, called when payment state → succeeded
 *
 * @param paymentId — NewPayment._id
 * @param eventId — Event._id
 * @param spaceId — Space._id (organizer's space)
 * @param organizerId — User._id (event creator)
 * @param attendeeId — User._id | null (buyer, null if guest checkout)
 * @param grossAmountUsdc — BigInt string, total ticket price in USDC micro-units
 * @param currency — payment currency string from NewPayment.currency
 * @param paymentMethod — 'tempo_usdc' | 'stripe'
 * @param transactionHash — string | undefined (for blockchain payments)
 * @param stripePaymentIntent — string | undefined (for Stripe payments)
 */
export async function processAtlasFee(params: {
  paymentId: Types.ObjectId;
  eventId: Types.ObjectId;
  spaceId: Types.ObjectId;
  organizerId: Types.ObjectId;
  attendeeId?: Types.ObjectId;
  grossAmountUsdc: string;
  currency: string;
  paymentMethod: 'tempo_usdc' | 'stripe';
  transactionHash?: string;
  stripePaymentIntent?: string;
  connectionId?: Types.ObjectId; // AUDIT FIX R2 [E15]: source connection for suspended-connection check
}): Promise<void>;

/**
 * getVolumeTier — determine organizer's volume bonus rate
 * Looks up AtlasOrganizerMonthlyGmv for current month.
 * Returns cashback rate in basis points.
 */
export function getVolumeTier(monthlyGmvUsdc: bigint): number;

/**
 * getDiscoveryMultiplier — determine attendee's discovery bonus
 * Counts existing AtlasFeeDistribution records for this event.
 * Returns multiplier (2, 1.5, or 1).
 */
export async function getDiscoveryMultiplier(eventId: Types.ObjectId): Promise<number>;

/**
 * updateMonthlyGmv — increment organizer's monthly GMV
 * Upserts AtlasOrganizerMonthlyGmv for current year/month.
 */
export async function updateMonthlyGmv(
  organizerId: Types.ObjectId,
  amountUsdc: string,
): Promise<void>;
```

**Implementation steps for `processAtlasFee`:**

> **AUDIT FIX [P4-H7]:** Currency guard — verify payment is USDC-denominated before processing.
> Verified: `NewPayment.currency` exists at `lemonade-backend/src/app/models/new-payment.ts:130-131`.

0. **Currency guard:** Assert `params.currency === 'usd' || params.currency === 'usdc'` before any processing. For non-USD/USDC payments, log a warning (`logger.warn({ paymentId, currency: params.currency }, 'Skipping Atlas fee: non-USD currency')`) and return early. Do NOT throw — this must not break the payment flow.

> **AUDIT FIX R2 [E5]:** Dust attack prevention — minimum reward accrual threshold.

> **AUDIT FIX R3 [M-2]:** Dust threshold raised from $0.50 to $1.00 — tickets $0.50-$1.00 are valid purchases but protocol fee goes to consolidated dust pool instead of individual reward records. This prevents document flooding from bots buying 1000 minimum-price tickets to generate 1000 reward records for negligible cashback.

0a. **Dust attack check:** If `grossAmountUsdc < "1000000"` (< $1.00), do NOT create individual reward records. Instead, log to consolidated dust pool:
   ```typescript
   if (grossAmountUsdc < "1000000") { // AUDIT FIX R3 [M-2]: < $1.00 (was $0.50)
     // Protocol fee is still collected (part of the payment from F8 fix),
     // but goes to consolidated dust pool instead of individual distributions.
     await AtlasDustPoolModel.updateOne(
       { month: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}` },
       [{ $set: {
         total_dust_usdc: { $toString: { $add: [
           { $toLong: { $ifNull: ['$total_dust_usdc', '0'] } },
           NumberLong(protocolFee.toString()),
         ] } },
         transaction_count: { $add: [{ $ifNull: ['$transaction_count', 0] }, 1] },
         updated_at: new Date(),
       } }],
       { upsert: true },
     );
     logger.info({ paymentId, amount: grossAmountUsdc, protocolFee: protocolFee.toString() },
       'Sub-threshold transaction: fee logged to dust pool');
     return; // Skip individual fee distribution
   }
   ```
   Log: `logger.info({ paymentId, amount: grossAmountUsdc }, 'Sub-threshold transaction: reward logged to dust pool')`. Return early after collecting the protocol fee (treasury still gets the fee, just no individual reward records created). **The E5 minimum ticket price remains $0.50** — tickets between $0.50 and $1.00 are valid purchases; they just don't generate individual reward records.

> **AUDIT FIX R2 [E15]:** Suspended connection check — no rewards for events on suspended connections.

0b. **Connection status check:** If `params.connectionId` is provided, look up the Connection document. If `connection.status === 'suspended'` (any reason, including `suspended_tier_limit`), do NOT generate rewards. Log: `logger.info({ paymentId, connectionId }, 'Reward skipped: connection suspended')`. Protocol fee is still collected (treasury gets it), but no cashback or referral rewards are generated. Return early.
1. Parse `grossAmountUsdc` to BigInt.
2. Calculate `protocolFee = grossAmount * 200n / 10000n` (2%).

> **AUDIT FIX R4 [SV-1]:** Check Self.xyz verification status before determining fee split.

2a. **Determine verification tier:** Check if the organizer AND/OR attendee is Self-verified. Query `UserSelfDisclosureModel.find({ user: organizerId })` — if at least one disclosure record exists with a non-null `value`, the user is Self-verified. Cache the result per-request.
   ```typescript
   // AUDIT FIX R4 [SV-1]: Check Self.xyz verification status
   import { UserSelfDisclosureModel } from '../models/user-self-disclosure';

   async function isUserSelfVerified(userId: Types.ObjectId): Promise<boolean> {
     const disclosure = await UserSelfDisclosureModel.findOne({
       user: userId,
       value: { $exists: true, $ne: null },
     }).lean();
     return !!disclosure;
   }

   const organizerVerified = await isUserSelfVerified(params.organizerId);
   const attendeeVerified = params.attendeeId ? await isUserSelfVerified(params.attendeeId) : false;
   // Use verified fee split if EITHER party is verified (organizer gets boosted if they're verified,
   // attendee gets boosted if they're verified — each independently)
   ```

3. Split fee using verification-tiered rates:
   ```typescript
   // AUDIT FIX R4 [SV-1]: Select fee split based on organizer/attendee verification
   const orgShareBps = organizerVerified ? VERIFIED_ORGANIZER_CASHBACK_BPS : UNVERIFIED_ORGANIZER_CASHBACK_BPS;
   const attShareBps = attendeeVerified ? VERIFIED_ATTENDEE_CASHBACK_BPS : UNVERIFIED_ATTENDEE_CASHBACK_BPS;
   const refShareBps = (organizerVerified || attendeeVerified) ? VERIFIED_REFERRAL_POOL_BPS : UNVERIFIED_REFERRAL_POOL_BPS;

   const organizerCashback = protocolFee * BigInt(orgShareBps) / 10000n;
   const attendeeCashback = protocolFee * BigInt(attShareBps) / 10000n;
   const referralPool = protocolFee * BigInt(refShareBps) / 10000n;
   const treasuryShare = protocolFee - organizerCashback - attendeeCashback - referralPool; // remainder to treasury
   ```
   Note: treasury share is the remainder to absorb rounding. For verified users, treasury share is ~25% (reduced from 40%) — the extra cashback comes from the reduced treasury share, NOT from increasing the protocol fee.

> **AUDIT FIX [P4-C1]:** Self-purchase cashback zeroing.

4. **Self-purchase check:** If `params.organizerId.equals(params.attendeeId)`:
   - Set `organizerCashback = 0n` and `attendeeCashback = 0n`
   - Redistribute: `treasuryShare = protocolFee - referralPool` (entire non-referral portion goes to treasury)
   - Log: `logger.warn({ paymentId: params.paymentId, userId: params.organizerId }, 'Self-purchase detected: cashback zeroed')`
   - Volume bonus and discovery bonus also set to `0n` for self-purchases.

> **AUDIT FIX R2 [E11]:** Self-purchases excluded from GMV calculation (not just cashback).

   - **ALSO skip step 9** (GMV update) for self-purchases. Self-purchase transactions (`organizerId === attendeeUserId`) are excluded from `AtlasOrganizerMonthlyGmv` aggregation entirely. This prevents volume tier manipulation via bulk self-purchase.
> **AUDIT FIX R4 [SV-1]:** Verified organizers get 1.5x GMV multiplier for volume tier calculation.

5. Look up organizer's monthly GMV via `AtlasOrganizerMonthlyGmvModel`.
5a. **If `organizerVerified`: apply 1.5x GMV multiplier for tier calculation ONLY** (not for actual GMV tracking). `effectiveGmv = monthlyGmv * 3n / 2n`. This means verified organizers reach higher tiers faster. The actual `gmv_usdc` stored in `AtlasOrganizerMonthlyGmv` remains the real value — the 1.5x multiplier is applied only when calling `getVolumeTier()`. [AUDIT FIX R4 SV-1]
6. Determine volume tier using `effectiveGmv` (verified) or `monthlyGmv` (unverified). If tier rate > base 60 bps, calculate bonus:
   - `volumeBonus = grossAmount * (tierRate - 60) / 10000` (funded by treasury)

> **AUDIT FIX [P4-H6]:** Cap volume bonus at treasury share to prevent treasury going negative.

   - **Cap:** `volumeBonus = min(volumeBonus, treasuryShare)`. Treasury share for this transaction cannot go negative. If bonus is capped, log: `logger.info({ paymentId, calculatedBonus, cappedBonus: treasuryShare }, 'Volume bonus capped at treasury share')`
> **AUDIT FIX R4 [SV-1]:** Discovery bonus is only available to Self-verified attendees. Unverified attendees always get multiplier = 1 (no bonus).

7. Determine discovery multiplier for attendee:
   - **If `!attendeeVerified`: multiplier = 1 (no discovery bonus for unverified users). Skip to step 8.** [AUDIT FIX R4 SV-1]
   - Count existing fee distributions for this `event_id`
   - If count < 10: multiplier = 2 (bonus = attendeeCashback * 1 = extra 100%)
   - If count < 50: multiplier = 1.5 (bonus = attendeeCashback * 0.5 = extra 50%)
   - Else: multiplier = 1 (no bonus)
   - `discoveryBonus = attendeeCashback * (multiplier - 1)` (funded by treasury, capped at $500/month global)

> **AUDIT FIX [P4-M3]:** Discovery bonus $500/month cap behavior clarification.

   - **Cap enforcement:** Query current month's total discovery bonus paid (sum `attendee_discovery_bonus_usdc` from `AtlasFeeDistribution` for current month). If `currentMonthTotal + discoveryBonus > $500 cap`, set `discoveryBonus = max(0, cap - currentMonthTotal)`. When cap is hit mid-month, subsequent attendees get `$0` discovery bonus (not partial amounts). This is a hard cutoff, not a pro-rata reduction.
> **AUDIT FIX R2 [E10]:** 14-day reward hold — all rewards start as `pending_hold`.

8. Create `AtlasFeeDistribution` document with:
   - `status: AtlasFeeStatus.pending_hold` (NOT `accrued` — rewards are held for 14 days)
   - `hold_expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)` (14 days from now)
   - `connection_id: params.connectionId` (if provided, for E15 tracking)

> **AUDIT FIX R2 [E11]:** Volume tier calculated on SETTLED GMV only (past 14-day hold).

9. Update `AtlasOrganizerMonthlyGmv` — but ONLY for settled transactions. Since this transaction just started its 14-day hold, do NOT increment GMV here. Instead, the GMV update happens when the hold expires (see new job in Section 4.6). Skip entirely for self-purchases (E11).

> **AUDIT FIX R3 [CC-2]:** `$inc` cannot be used on string BigInt fields — MongoDB `$inc` does not work on strings. All monetary field updates MUST use aggregation pipeline updates with `$toLong` / `$toString`.

10. Credit organizer's `AtlasRewardBalance` (type=organizer): update `accrued_usdc` by (organizerCashback + volumeBonus) using aggregation pipeline update. **Do NOT increment `pending_usdc` yet** — it remains unavailable until hold expires. Skip if self-purchase (both are 0).
   ```typescript
   // CC-2: Cannot use $inc on string BigInt fields. Use aggregation pipeline update.
   const orgTotal = (organizerCashback + volumeBonus).toString();
   await AtlasRewardBalanceModel.updateOne(
     { user: organizerId, space: spaceId, type: 'organizer' },
     [{ $set: {
       accrued_usdc: { $toString: { $add: [{ $toLong: '$accrued_usdc' }, NumberLong(orgTotal)] } },
       updated_at: new Date(),
     } }],
     { upsert: true },
   );
   ```
11. Credit attendee's `AtlasRewardBalance` (type=attendee): update `accrued_usdc` by (attendeeCashback + discoveryBonus) using aggregation pipeline update. **Do NOT increment `pending_usdc` yet** — it remains unavailable until hold expires. Skip if attendeeId is null or self-purchase.
   ```typescript
   // CC-2: Cannot use $inc on string BigInt fields. Use aggregation pipeline update.
   const attTotal = (attendeeCashback + discoveryBonus).toString();
   await AtlasRewardBalanceModel.updateOne(
     { user: attendeeId, type: 'attendee' },
     [{ $set: {
       accrued_usdc: { $toString: { $add: [{ $toLong: '$accrued_usdc' }, NumberLong(attTotal)] } },
       updated_at: new Date(),
     } }],
     { upsert: true },
   );
   ```
> **AUDIT FIX R3 [PD2-3]:** Maximum unredeemed balance of $500 for users without active Stripe Connect.

11a. **Unredeemed balance cap check:** Before crediting organizer or attendee balance, check if the user's total `accrued_usdc - paid_out_usdc - clawed_back_usdc` exceeds $500 (`"500000000"`) AND the user does NOT have an active Stripe Connect account (`AtlasPayoutSettings.stripe_connect_account_id` is unset or Stripe account is not `charges_enabled`):
   ```typescript
   // AUDIT FIX R3 [PD2-3]: Max $500 unredeemed balance for users without Stripe Connect
   const MAX_UNREDEEMED_USDC = BigInt('500000000'); // $500
   const balance = await AtlasRewardBalanceModel.findOne({ user: userId, space: spaceId, type });
   const payoutSettings = await AtlasPayoutSettingsModel.findOne({ user: userId });
   const hasStripeConnect = !!payoutSettings?.stripe_connect_account_id;

   if (!hasStripeConnect && balance) {
     const unredeemed = BigInt(balance.accrued_usdc) - BigInt(balance.paid_out_usdc) - BigInt(balance.clawed_back_usdc);
     if (unredeemed >= MAX_UNREDEEMED_USDC) {
       // Redirect reward to treasury instead of user balance
       logger.info({ userId: userId.toString(), unredeemed: unredeemed.toString() },
         'Unredeemed balance cap hit ($500) — reward redirected to treasury. Connect Stripe to lift cap.');
       // Add reward amount to treasury share instead
       // DO NOT credit user balance
       return; // skip steps 10/11 for this user
     }
   }
   ```
   - Dashboard message when cap hit: "You've earned $500+ in rewards. Connect Stripe to receive payouts. New rewards above $500 go to the Atlas treasury until you connect."
   - Once Stripe Connect is active (`charges_enabled: true`), the cap is removed — no limit for users with active Stripe Connect.

12. Check referral milestones (call referral service).

**All balance mutations MUST use aggregation pipeline updates with `$toLong`/`$toString`.** Never use raw `$inc` on string BigInt fields — MongoDB `$inc` does not work on strings. Never read-modify-write. [AUDIT FIX R3 CC-2]

**Wrap steps 7-11 in `withTransaction` from `lemonade-backend/src/app/helpers/db.ts`.**

### 3.2 Atlas Referral Service

**File:** `lemonade-backend/src/app/services/atlas-referral.ts`

```typescript
> **AUDIT FIX R2 [PD-1]:** Min 7-day account age before referral code creation.
> **AUDIT FIX R4 [SV-1]:** Referral program requires Self.xyz verification. Unverified users cannot create or use referral codes.

/**
 * generateReferralCode — create a unique referral code for an organizer
 * Format: 8-char alphanumeric, uppercase, stored lowercase.
 * Upserts AtlasReferralCode. Idempotent.
 *
 * AUDIT FIX R4 [SV-1]: Before creating, check user is Self-verified.
 * Query UserSelfDisclosureModel.findOne({ user: userId, value: { $exists: true, $ne: null } }).
 * If not verified, throw: "Self.xyz verification required to participate in the referral program."
 *
 * AUDIT FIX R2 [PD-1]: Before creating, check user.created_at.
 * If account is < 7 days old, throw: "Account must be at least 7 days old to create a referral code."
 * const user = await UserModel.findById(userId);
 * if (Date.now() - user.created_at.getTime() < 7 * 24 * 60 * 60 * 1000) throw new Error('...');
 */
export async function generateReferralCode(userId: Types.ObjectId): Promise<string>;

> **AUDIT FIX [P4-C2]:** Anti-fraud validation in referral code application.
> **AUDIT FIX R2 [PD-1]:** Rate limit referral code applications to 3/hour/IP.

/**
 * applyReferralCode — called when a new organizer signs up via referral link
 * Creates AtlasReferral record linking referrer → referred.
 * Validates:
 *   0. AUDIT FIX R2 [PD-1]: Rate limit — max 3 applications per hour per IP.
 *      Redis sliding window: key `atlas:referral:ip:{refereeIp}`, TTL 3600s.
 *      If count > 3, reject with 429 "Too many referral applications from this IP."
 *   1. Code exists and maps to a valid referrer
 *   2. Referred user doesn't already have a referrer
 *   3. ANTI-FRAUD: Referrer and referee do NOT share the same IP address
 *      (store `referee_ip` on AtlasReferral for audit trail)
 *   4. ANTI-FRAUD: Referrer and referee do NOT share the same email domain
 *      (exception list: gmail.com, outlook.com, yahoo.com, hotmail.com, icloud.com, protonmail.com)
 *   5. ANTI-FRAUD: Referrer and referee do NOT share any wallet address
 *      (compare AtlasPayoutSettings.wallet_address for both users)
 * On any anti-fraud violation: reject with error 'referral_fraud_detected',
 * log details, do NOT create the AtlasReferral record.
 *
 * AUDIT FIX R2 [PD-1]: New AtlasReferral records are created with
 * `referral_rewards_eligible: false`. Eligibility is checked in checkMilestones.
 */
export async function applyReferralCode(
  referredUserId: Types.ObjectId,
  code: string,
  refereeIp: string,
): Promise<void>;

/**
 * checkMilestones — called after each Atlas sale by a referred organizer
 * Checks if ticket count or GMV thresholds are hit.
 * Credits referrer and/or referred organizer accordingly.
 *
 * Milestones:
 *   - 25 tickets: referrer gets $5 USDC
 *   - $5K GMV: referrer gets $10 USDC
 *   - Cap: $50 total per referred organizer
 *   - Welcome bonus: referred gets $2 after first sale
 */
export async function checkMilestones(
  referredOrganizerId: Types.ObjectId,
): Promise<void>;

/**
 * getReferralSummary — for dashboard display
 */
export async function getReferralSummary(userId: Types.ObjectId): Promise<{
  referral_code: string;
  total_referred: number;
  total_earned_usdc: string;
  referrals: Array<{
    referred_id: Types.ObjectId;
    status: string;
    tickets_sold: number;
    gmv_usdc: string;
    earned_usdc: string;
    milestones: { milestone_1: boolean; milestone_2: boolean };
  }>;
}>;
```

**Milestone implementation (inside `checkMilestones`):**

> **AUDIT FIX R4 [FT-1]:** Referral milestones count PAID tickets only. Free ticket claims (where `NewPayment.amount === "0"` or no associated payment) do NOT count toward any referral milestone. When counting tickets for milestone evaluation, add filter: `{ 'gross_amount_usdc': { $ne: '0' } }` on `AtlasFeeDistribution` queries. This prevents gaming via mass free ticket claiming to hit the 25-ticket milestone at zero cost. Milestones count PAID ticket purchases only. Free ticket claims do not contribute to milestone progress.

> **AUDIT FIX [P4-C2]:** Milestones count UNIQUE attendees only, excluding self-purchases.
> **AUDIT FIX R2 [PD-1]:** Check referral_rewards_eligible before crediting any rewards.
> **AUDIT FIX R2 [E9]:** Referral rewards require purchase from DIFFERENT user than referrer AND Space owner.

1. Find `AtlasReferral` where `referred_id` = referredOrganizerId.
2. If none found, return (organizer was not referred).
3. If status = `capped`, return.
3a. **AUDIT FIX R2 [PD-1] — Eligibility check:** If `referral_rewards_eligible === false`, check now:
   - Query `EventModel.countDocuments({ host: referral.referrer_id, state: 'published' })`. If >= 1, check if at least 1 ticket on ANY of those events was purchased by a different user (`AtlasFeeDistribution` where `organizer_id = referral.referrer_id AND attendee_id !== referral.referrer_id AND attendee_id exists`).
   - If both conditions met, set `referral_rewards_eligible = true`.
   - If still `false`, return early — no milestone rewards credited yet.
3b. **AUDIT FIX R2 [E9] — Referral fee laundering prevention:** When counting tickets for milestones, exclude purchases where the attendee is the referrer OR the Space owner. Triple-check: `referrer_id !== attendee_id !== space_owner_id`. Purchases violating this are not counted toward milestones and do not generate referral rewards.
4. Query `AtlasOrganizerMonthlyGmv` aggregate for referred organizer's all-time totals (sum all months).
5. Count all-time **unique attendee** PAID ticket sales: `AtlasFeeDistributionModel.distinct('attendee_id', { organizer_id: referredOrganizerId, attendee_id: { $ne: referredOrganizerId, $exists: true }, gross_amount_usdc: { $ne: '0' } })` then `.length`. This excludes self-purchases, guest checkouts, AND free ticket claims (FT-1). Only tickets with `gross_amount_usdc > "0"` (non-zero payment) count toward milestones.
6. Check welcome bonus: if `welcome_bonus_paid_at` is null AND unique attendee ticket count >= 1:
   - Credit referred organizer's AtlasRewardBalance with $2 USDC (`"2000000"`)
   - Set `welcome_bonus_paid_at`, `referred_welcome_bonus_usdc`
7. Check milestone 1: if `milestone_1_at` is null AND ticket count >= 25:
   - Credit referrer's AtlasRewardBalance with $5 USDC (`"5000000"`)
   - Set `milestone_1_at`, update `referrer_earned_usdc`
8. Check milestone 2: if `milestone_2_at` is null AND cumulative GMV >= $5,000 (`"5000000000"`):
   - Credit referrer's AtlasRewardBalance with $10 USDC (`"10000000"`)
   - Set `milestone_2_at`, update `referrer_earned_usdc`
9. If `referrer_earned_usdc` >= $50 (`"50000000"`), set status = `capped`.

> **AUDIT FIX [P4-C2]:** Manual review queue for referral payouts above $20.

10. If `referrer_earned_usdc` >= $20 (`"20000000"`) AND `requires_manual_review` is not already `true`, set `requires_manual_review = true`. Payout service will skip referral bonus payouts for this referral until an admin clears the flag.

### 3.3 Atlas Payout Service

**File:** `lemonade-backend/src/app/services/atlas-payout.ts`

```typescript
> **AUDIT FIX [P4-H3]:** Payout job idempotency — prevent duplicate batches for same period.
> **AUDIT FIX [P4-H1]:** Use `AtlasPayoutSettings` instead of Space payment accounts for wallet lookup.
> **AUDIT FIX [P4-H4]:** Attendee Stripe payout — accumulate as platform credit.
> **AUDIT FIX [P4-M5]:** Notify organizers without payout method configured.

/**
 * createWeeklyPayoutBatch — called by the weekly Agenda job
 *
 * IDEMPOTENCY: Before creating a batch, check for existing batch with same
 * period_start + period_end. If found, return existing batch _id (do not
 * create duplicate). Relies on unique compound index on AtlasPayoutBatch:
 * `{ period_start: 1, period_end: 1 }, { unique: true }`.
 * Wrap batch creation in try/catch — if MongoError code 11000 (duplicate key),
 * log and return null gracefully.
 *
 * AUDIT FIX R2 [E10]: Before querying balances, run hold expiry first:
 * 0. Transition all AtlasFeeDistribution where status === 'pending_hold' AND
 *    hold_expires_at < now to status 'available'. For each transitioned record,
 *    update the corresponding AtlasRewardBalance.pending_usdc (organizer and attendee)
 *    using aggregation pipeline updates with $toLong/$toString (NOT $inc — CC-2).
 *    Also update AtlasOrganizerMonthlyGmv with the settled GMV (E11).
 *
 * 1. Query all AtlasRewardBalance where pending_usdc >= $5 threshold ("5000000")
 *
 * AUDIT FIX R4 [SV-3]: Also query AtlasFreeTicketReward where status === 'available'
 * and include in the payout batch. Free ticket rewards are aggregated per user
 * (sum all available free ticket rewards → single payout item). Same Stripe Connect
 * requirement and 14-day hold applies.
 * Free ticket reward hold expiry is processed by the same atlas-hold-expiry job
 * (see Section 4.6 update).
 *
 * AUDIT FIX R2 [PD-2]: Stripe Connect is REQUIRED for any payout.
 * 2. For each qualifying balance:
 *    a. Determine payout method:
 *       - Look up user's `AtlasPayoutSettings` (NOT Space.payment_accounts)
 *       - **FIRST: Check `stripe_connect_account_id` exists.** If not set:
 *         - Skip this user entirely (no payout without Stripe Connect)
 *         - **SEND NOTIFICATION:** "Connect Stripe to receive your rewards.
 *           You have $X.XX pending." (at most once per week per user)
 *         - Balance remains pending for next week's batch
 *       - If Stripe Connect is set, VALIDATE:
 *           1. Call stripe.accounts.retrieve(accountId) to confirm account exists
 *           2. Check account.charges_enabled === true (can receive transfers)
 *           3. Check account.payouts_enabled === true (can receive payouts)
 *           4. If any check fails: skip this user, set payout_item.status = 'skipped',
 *              payout_item.error = 'stripe_account_invalid: charges_enabled=false'
 *              Balance remains pending for next week's batch
 *           5. Cache account validity for 24h in Redis to avoid repeated Stripe API calls
 *       - If `wallet_address` is ALSO set AND `preferred_method === 'tempo_usdc'`:
 *         - AUDIT FIX R3 [M-3]: Payout goes to ONE destination based on preferred_method
 *           (not split). Send entire payout to crypto wallet. Stripe Connect still required for tax compliance.
 *       - Else: default to Stripe Connect transfer
 *       - NOTE [M-3]: Model supports ONE destination per payout, not split payouts. Split payout support is a future enhancement.
 *       - If balance.type === 'attendee' AND no Stripe Connect:
 *         - Accumulate as platform credit (set payout_item.payout_method = 'platform_credit')
 *         - Credits can be redeemed as discount on next ticket purchase OR
 *           withdrawn to a connected wallet once the user configures AtlasPayoutSettings
 *         - Mark balance as credited, do NOT zero pending_usdc
 *    b. Deduct negative_balance from payout amount
 *    c. Update `cumulative_annual_usd` on AtlasRewardBalance (AUDIT FIX R2 [PD-2])
 *    d. Create payout item
 * 3. Create AtlasPayoutBatch with all items
 * 4. Return batch _id
 */
export async function createWeeklyPayoutBatch(): Promise<Types.ObjectId | null>;

> **AUDIT FIX [P4-M7]:** Retry logic for failed payout items.

/**
 * processPayoutBatch — processes each item in the batch
 * Called after batch creation. Can be retried.
 * For each pending item:
 *   - tempo_usdc: send USDC via ERC20 transfer on Tempo chain
 *   - stripe_connect: create Stripe transfer to connected account
 *   - platform_credit: mark as credited in user's account (no external transfer)
 * On success: update item status, update AtlasRewardBalance (inc paid_out, dec pending)
 * On failure: update item status + failure_reason, increment retry_count.
 *   - If retry_count < 3: schedule retry via Agenda job `atlas-payout-retry`
 *     with exponential backoff: 1h (attempt 1), 6h (attempt 2), 24h (attempt 3)
 *   - If retry_count >= 3: set status = 'permanently_failed', log error,
 *     balance remains in pending_usdc for next week's batch
 */
export async function processPayoutBatch(batchId: Types.ObjectId): Promise<void>;

/**
 * retryFailedPayoutItem — called by atlas-payout-retry Agenda job
 * Retries a single failed payout item. Uses same logic as processPayoutBatch
 * but for a single item identified by batchId + userId.
 */
export async function retryFailedPayoutItem(
  batchId: Types.ObjectId,
  userId: Types.ObjectId,
): Promise<void>;

/**
 * expireUnclaimedRewards — called monthly
 * Find AtlasRewardBalance where pending_usdc > 0
 * and last activity (accrued) was > 12 months ago.
 * Zero out pending_usdc, record as expired (treasury reclaim).
 */
export async function expireUnclaimedRewards(): Promise<void>;
```

**Tempo USDC transfer implementation:**

The payout service needs a server-side wallet (treasury wallet) to send USDC on Tempo. This uses the same `ethers` infrastructure already in the codebase (`lemonade-backend/src/app/services/blockchain.ts`).

1. Load treasury wallet private key from env: `ATLAS_TREASURY_WALLET_KEY`
2. Load Tempo chain config from `ChainModel` where `chain_id` = `TEMPO_CHAIN_ID` (env var)
3. Create ethers provider + signer for Tempo RPC
4. Execute ERC20 `transfer(recipient, amount)` on the USDC contract address (from chain.tokens where symbol = 'USDC')
5. Wait for tx confirmation (chain.safe_confirmations blocks)
6. Record tx_hash on the payout item

**New environment variables needed:**
- `ATLAS_TREASURY_WALLET_KEY` — private key of the treasury hot wallet
- `ATLAS_TEMPO_CHAIN_ID` — Tempo chain_id string
- `ATLAS_DISCOVERY_BONUS_MONTHLY_CAP_USDC` — default `"500000000"` ($500)

### 3.4 Atlas Refund Handling

**File:** `lemonade-backend/src/app/services/atlas-refund.ts`

```typescript
/**
 * handleAtlasRefund — called when a payment transitions to 'refunded'
 *
 * @param paymentId — the refunded NewPayment._id
 * @param refundPercent — 100 for full refund, 1-99 for partial
 */
export async function handleAtlasRefund(
  paymentId: Types.ObjectId,
  refundPercent: number,
): Promise<void>;

/**
 * writeOffNegativeBalances — called monthly by Agenda job
 * Finds AtlasRewardBalance with negative_balance_usdc > 0
 * where the negative was created > 90 days ago.
 * Zeros out the negative balance (write-off against treasury).
 */
export async function writeOffNegativeBalances(): Promise<void>;
```

**Implementation for `handleAtlasRefund`:**

> **AUDIT FIX R2 [E10]:** Refund behavior depends on whether the 14-day hold has expired.

1. Find `AtlasFeeDistribution` by `payment_id`.
2. If not found, return (not an Atlas payment).
2a. **AUDIT FIX R2 [E10] — Check hold status:**
   - If `status === 'pending_hold'` (refund during hold period):
     - Set `status = 'cancelled'`. Reward is simply cancelled — no clawback needed.
     - Do NOT decrement `pending_usdc` (it was never incremented — rewards weren't available yet).
     - Decrement `accrued_usdc` by the reward amounts (organizer + attendee).
     - Create `AtlasRefund` record with `refund_type: 'full'` and note `hold_period_cancellation: true`.
     - Skip steps 3-6 below — no clawback math needed.
     - Continue to step 7 (GMV decrement) and step 8 (audit record).
   - If `status === 'available'` or `status === 'paid_out'`: proceed with clawback logic below.
3. Calculate proportional clawback:
   - `clawbackOrganizer = organizerCashback * refundPercent / 100`
   - `clawbackAttendee = attendeeCashback * refundPercent / 100`
   - `clawbackVolumeBonus = organizerVolumeBonus * refundPercent / 100`
   - `clawbackDiscoveryBonus = attendeeDiscoveryBonus * refundPercent / 100`
4. Update `AtlasFeeDistribution`:
   - Set `refund_amount_usdc`
   - Set status to `clawed_back` (full) or `partially_clawed_back` (partial)
> **AUDIT FIX [P4-M4]:** Atomic negative balance handling with `findOneAndUpdate` pipeline.

5. Update organizer's `AtlasRewardBalance` atomically using `findOneAndUpdate` with an aggregation pipeline update:
   ```typescript
   AtlasRewardBalanceModel.findOneAndUpdate(
     { user: organizerId, space: spaceId, type: 'organizer' },
     [{ $set: {
       clawed_back_usdc: { $toString: { $add: [{ $toLong: '$clawed_back_usdc' }, clawbackTotal] } },
       pending_usdc: { $toString: { $max: [{ $subtract: [{ $toLong: '$pending_usdc' }, clawbackTotal] }, 0] } },
       negative_balance_usdc: { $toString: {
         $add: [
           { $toLong: '$negative_balance_usdc' },
           { $max: [{ $subtract: [clawbackTotal, { $toLong: '$pending_usdc' }] }, 0] }
         ]
       } },
       updated_at: new Date(),
     } }]
   );
   ```
   This prevents race conditions — the negative balance is computed from the CURRENT `pending_usdc` value in a single atomic operation. Never read-modify-write.
6. Update attendee's `AtlasRewardBalance` (same atomic pipeline logic).

> **AUDIT FIX [P4-M2]:** Cross-month refund GMV — decrement the ORIGINAL month, not current month.

7. Decrement organizer's `AtlasOrganizerMonthlyGmv` for the **original payment month** (derived from `AtlasFeeDistribution.created_at`), NOT the current month. Use the year/month from the fee distribution's `created_at` to find the correct GMV document:
   ```typescript
   // AUDIT FIX R3 [CC-2]: gmv_usdc is a string BigInt — cannot use $inc on strings.
   // Use aggregation pipeline update with $toLong/$toString.
   const feeDate = feeDistribution.created_at;
   await AtlasOrganizerMonthlyGmvModel.updateOne(
     { user: organizerId, year: feeDate.getFullYear(), month: feeDate.getMonth() + 1 },
     [{ $set: {
       gmv_usdc: { $toString: { $subtract: [{ $toLong: '$gmv_usdc' }, NumberLong(refundAmount)] } },
       ticket_count: { $add: ['$ticket_count', -1] },
       updated_at: new Date(),
     } }]
   );
   ```

> **AUDIT FIX [P4-C3]:** Create AtlasRefund record for audit trail.

8. Create `AtlasRefund` document recording: `payment_id`, `fee_distribution_id`, `refund_type` (full/partial), `refund_amount_usdc`, `refund_percent`, `organizer_clawback_usdc`, `attendee_clawback_usdc`, `treasury_clawback_usdc`.

> **AUDIT FIX R4 [SV-3]:** Free ticket reward service for Self-verified users.

### 3.5 Atlas Free Ticket Reward Service

**File:** `lemonade-backend/src/app/services/atlas-free-ticket-reward.ts`

Called when a Self-verified user claims a free ticket via Atlas. Creates `AtlasFreeTicketReward` records for both attendee and organizer (if organizer is also verified).

```typescript
import { Types } from 'mongoose';
import { AtlasFreeTicketRewardModel, AtlasFreeTicketRewardStatus } from '../models/atlas-free-ticket-reward';
import { UserSelfDisclosureModel } from '../models/user-self-disclosure';

// AUDIT FIX R4 [SV-3]: Fixed per-claim amounts (funded from treasury)
const ATTENDEE_REWARD_USDC = '10000';   // $0.01 in USDC micro-units
const ORGANIZER_REWARD_USDC = '20000';  // $0.02 in USDC micro-units

// AUDIT FIX R4 [SV-5]: Hard caps — no exceptions
const MAX_FREE_REWARDS_PER_USER_PER_MONTH = 100;
const MAX_FREE_REWARDS_PER_EVENT = 500;

/**
 * processAtlasFreeTicketReward — called when a free ticket is claimed via Atlas
 *
 * ONLY creates rewards if:
 * 1. User is Self-verified (has UserSelfDisclosure records with non-null values)
 * 2. Monthly per-user cap not exceeded (100/month)
 * 3. Per-event cap not exceeded (500/event)
 *
 * Creates TWO records: one for attendee, one for organizer (if organizer is also verified).
 */
export async function processAtlasFreeTicketReward(params: {
  attendeeId: Types.ObjectId;
  organizerId: Types.ObjectId;
  eventId: Types.ObjectId;
  spaceId: Types.ObjectId;
}): Promise<void> {
  // 1. Check if attendee is Self-verified
  const attendeeVerified = await isUserSelfVerified(params.attendeeId);
  if (!attendeeVerified) {
    // Unverified users get NO rewards on free tickets [SV-3]
    return;
  }

  // 2. Check per-event cap
  const eventRewardCount = await AtlasFreeTicketRewardModel.countDocuments({
    event_id: params.eventId,
  });
  if (eventRewardCount >= MAX_FREE_REWARDS_PER_EVENT) {
    logger.info({ eventId: params.eventId.toString(), count: eventRewardCount },
      'Free ticket reward skipped: event cap reached (500)');
    return;
  }

  // 3. Check attendee monthly cap
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const attendeeMonthlyCount = await AtlasFreeTicketRewardModel.countDocuments({
    user_id: params.attendeeId,
    created_at: { $gte: startOfMonth },
  });
  if (attendeeMonthlyCount < MAX_FREE_REWARDS_PER_USER_PER_MONTH) {
    // Create attendee reward
    await AtlasFreeTicketRewardModel.create({
      user_id: params.attendeeId,
      event_id: params.eventId,
      space_id: params.spaceId,
      role: 'attendee',
      amount_usdc: ATTENDEE_REWARD_USDC,
      self_verified: true,
      status: AtlasFreeTicketRewardStatus.pending_hold,
      hold_expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14-day hold
    });
  }

  // 4. Check if organizer is Self-verified and within caps
  const organizerVerified = await isUserSelfVerified(params.organizerId);
  if (organizerVerified && params.organizerId.toString() !== params.attendeeId.toString()) {
    // Self-purchase exclusion still applies [SV-5] — P4-C1 not overridden by verification
    const organizerMonthlyCount = await AtlasFreeTicketRewardModel.countDocuments({
      user_id: params.organizerId,
      created_at: { $gte: startOfMonth },
    });
    if (organizerMonthlyCount < MAX_FREE_REWARDS_PER_USER_PER_MONTH) {
      await AtlasFreeTicketRewardModel.create({
        user_id: params.organizerId,
        event_id: params.eventId,
        space_id: params.spaceId,
        role: 'organizer',
        amount_usdc: ORGANIZER_REWARD_USDC,
        self_verified: true,
        status: AtlasFreeTicketRewardStatus.pending_hold,
        hold_expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      });
    }
  }
}

async function isUserSelfVerified(userId: Types.ObjectId): Promise<boolean> {
  const disclosure = await UserSelfDisclosureModel.findOne({
    user: userId,
    value: { $exists: true, $ne: null },
  }).lean();
  return !!disclosure;
}
```

> **AUDIT FIX R4 [SV-5]:** Anti-gaming rules for free ticket rewards:
> - Self-purchase exclusion (P4-C1) still applies — `organizerId === attendeeId` gets zero rewards regardless of verification status.
> - Free ticket caps are hard limits: 100/user/month, 500/event. No exceptions for any verification tier.

### 3.6 Atlas Boosted Reward Cap Service

> **AUDIT FIX R4 [SV-5]:** Monthly cap on boosted rewards — max $100/month in BOOSTED DIFFERENCE.

**Added to:** `lemonade-backend/src/app/services/atlas-fee.ts` (inside `processAtlasFee`)

After calculating the verification-boosted amounts in step 3 (SV-1), enforce the monthly boosted reward cap:

```typescript
// AUDIT FIX R4 [SV-5]: Monthly cap on boosted rewards
const MONTHLY_BOOSTED_CAP_USDC = BigInt('100000000'); // $100 in micro-units

// Calculate the DELTA (boosted - base) for this transaction
const baseOrgCashback = protocolFee * BigInt(UNVERIFIED_ORGANIZER_CASHBACK_BPS) / 10000n;
const baseAttCashback = protocolFee * BigInt(UNVERIFIED_ATTENDEE_CASHBACK_BPS) / 10000n;
const orgBoostDelta = organizerVerified ? (organizerCashback - baseOrgCashback) : 0n;
const attBoostDelta = attendeeVerified ? (attendeeCashback - baseAttCashback) : 0n;

// Query: sum of boost deltas paid to this user this month
// Track via a new field on AtlasFeeDistribution: boosted_delta_usdc
// If user's cumulative boosted delta >= $100/month, revert to base rates
if (orgBoostDelta > 0n) {
  const orgMonthlyBoosted = await getMonthlyBoostedTotal(params.organizerId);
  if (orgMonthlyBoosted >= MONTHLY_BOOSTED_CAP_USDC) {
    // Cap hit: revert organizer to base rate
    organizerCashback = baseOrgCashback;
    // Redirect delta back to treasury
    treasuryShare += orgBoostDelta;
    logger.info({ userId: params.organizerId.toString() },
      'Organizer boosted reward cap ($100/month) reached — reverting to base rate');
  }
}

if (attBoostDelta > 0n) {
  const attMonthlyBoosted = await getMonthlyBoostedTotal(params.attendeeId!);
  if (attMonthlyBoosted >= MONTHLY_BOOSTED_CAP_USDC) {
    attendeeCashback = baseAttCashback;
    treasuryShare += attBoostDelta;
    logger.info({ userId: params.attendeeId!.toString() },
      'Attendee boosted reward cap ($100/month) reached — reverting to base rate');
  }
}
```

To track the boosted delta, add a new field to `AtlasFeeDistribution`:
```typescript
// AUDIT FIX R4 [SV-5]: Track boosted reward delta for monthly cap enforcement
@Field()
@prop({ required: true, default: '0' })
boosted_delta_usdc!: string; // BigInt — the difference between verified rate and base rate for this transaction
```

---

## 4. Agenda Jobs

All jobs go in `lemonade-backend/src/app/jobs/`. Follow the existing pattern from `payment-verify.ts`: export a `JobDefinition` with `name`, `handler`, and optional `options`.

### 4.1 atlas-weekly-payout.ts

**File:** `lemonade-backend/src/app/jobs/atlas-weekly-payout.ts`

```typescript
import { JobName } from '../models/job';
import { type JobDefinition, type JobHandler } from '../helpers/agenda';
import * as AtlasPayout from '../services/atlas-payout';

const handler: JobHandler = async function handler(_job, logger) {
  logger.info('Starting weekly Atlas reward payout batch');

  const batchId = await AtlasPayout.createWeeklyPayoutBatch();

  if (!batchId) {
    logger.info('No qualifying balances for payout');
    return;
  }

  logger.info({ batchId }, 'Created payout batch, processing...');
  await AtlasPayout.processPayoutBatch(batchId);
  logger.info({ batchId }, 'Payout batch processing complete');
};

const definition: JobDefinition = {
  name: 'atlas-weekly-payout',
  handler,
};

export = definition;
```

**Scheduling:** Add to agenda startup in `lemonade-backend/src/bin/app.ts` (or wherever recurring jobs are scheduled):

```typescript
agenda.every('0 6 * * 1', 'atlas-weekly-payout'); // Every Monday at 06:00 UTC
```

### 4.2 atlas-expire-rewards.ts

**File:** `lemonade-backend/src/app/jobs/atlas-expire-rewards.ts`

Runs monthly. Expires unclaimed rewards older than 12 months.

```typescript
import { type JobDefinition, type JobHandler } from '../helpers/agenda';
import * as AtlasPayout from '../services/atlas-payout';

const handler: JobHandler = async function handler(_job, logger) {
  logger.info('Expiring unclaimed Atlas rewards (12+ months)');
  await AtlasPayout.expireUnclaimedRewards();
};

const definition: JobDefinition = {
  name: 'atlas-expire-rewards',
  handler,
};

export = definition;
```

**Scheduling:** `agenda.every('0 2 1 * *', 'atlas-expire-rewards');` (1st of each month, 02:00 UTC)

### 4.3 atlas-writeoff-negative-balances.ts

**File:** `lemonade-backend/src/app/jobs/atlas-writeoff-negative-balances.ts`

Runs monthly. Writes off negative balances older than 90 days.

```typescript
import { type JobDefinition, type JobHandler } from '../helpers/agenda';
import * as AtlasRefund from '../services/atlas-refund';

const handler: JobHandler = async function handler(_job, logger) {
  logger.info('Writing off negative Atlas reward balances (90+ days)');
  await AtlasRefund.writeOffNegativeBalances();
};

const definition: JobDefinition = {
  name: 'atlas-writeoff-negative-balances',
  handler,
};

export = definition;
```

**Scheduling:** `agenda.every('0 3 1 * *', 'atlas-writeoff-negative-balances');` (1st of each month, 03:00 UTC)

> **AUDIT FIX [P4-M1]:** Monthly referral pool sweep — unused funds return to treasury.

### 4.4 atlas-referral-pool-sweep.ts

**File:** `lemonade-backend/src/app/jobs/atlas-referral-pool-sweep.ts`

Runs monthly. Sweeps unused referral pool funds from the previous month to treasury.

```typescript
import { type JobDefinition, type JobHandler } from '../helpers/agenda';
import { AtlasFeeDistributionModel } from '../models/atlas-fee-distribution';

const handler: JobHandler = async function handler(_job, logger) {
  logger.info('Sweeping unused referral pool funds to treasury');

  // Calculate total referral pool accumulated last month
  const lastMonth = new Date();
  lastMonth.setMonth(lastMonth.getMonth() - 1);
  const year = lastMonth.getFullYear();
  const month = lastMonth.getMonth(); // 0-indexed

  const startOfMonth = new Date(year, month, 1);
  const endOfMonth = new Date(year, month + 1, 1);

  // Sum referral_pool_usdc from all fee distributions in the period
  // Compare against actual referral payouts made
  // Difference = unused pool → log as treasury reclaim
  // (Actual referral payouts are tracked via AtlasReferral.referrer_earned_usdc
  //  and AtlasRewardBalance credits for referral bonuses)

  const result = await AtlasFeeDistributionModel.aggregate([
    { $match: { created_at: { $gte: startOfMonth, $lt: endOfMonth } } },
    { $group: { _id: null, total_pool: { $sum: { $toLong: '$referral_pool_usdc' } } } },
  ]);

  // AUDIT FIX R3 [CC-3]: $toLong in MongoDB aggregation produces MongoDB Long (Number), not BigInt.
  // Using ?? 0n would cause a TypeError. Convert explicitly to BigInt.
  const totalPool = BigInt(result[0]?.total_pool ?? 0);
  logger.info({ year, month: month + 1, totalPool: totalPool.toString() }, 'Referral pool sweep complete');
  // Treasury accounting: the unused portion is implicitly treasury's
  // since referral payouts are only made against earned milestones
};

const definition: JobDefinition = {
  name: 'atlas-referral-pool-sweep',
  handler,
};

export = definition;
```

**Scheduling:** `agenda.every('0 4 1 * *', 'atlas-referral-pool-sweep');` (1st of each month, 04:00 UTC)

> **AUDIT FIX [P4-M7]:** Retry job for failed payout items.

### 4.5 atlas-payout-retry.ts

**File:** `lemonade-backend/src/app/jobs/atlas-payout-retry.ts`

Retries a single failed payout item with exponential backoff.

```typescript
import { type JobDefinition, type JobHandler } from '../helpers/agenda';
import * as AtlasPayout from '../services/atlas-payout';
import { Types } from 'mongoose';

const handler: JobHandler = async function handler(job, logger) {
  const { batchId, userId } = job.attrs.data as {
    batchId: string;
    userId: string;
  };

  logger.info({ batchId, userId }, 'Retrying failed payout item');
  await AtlasPayout.retryFailedPayoutItem(
    new Types.ObjectId(batchId),
    new Types.ObjectId(userId),
  );
};

const definition: JobDefinition = {
  name: 'atlas-payout-retry',
  handler,
};

export = definition;
```

**Scheduling:** Not recurring — scheduled on-demand by `processPayoutBatch` when a payout item fails. Backoff delays: 1h (attempt 1), 6h (attempt 2), 24h (attempt 3).

> **AUDIT FIX R2 [E10]:** Hold expiry job — transitions pending_hold rewards to available.

### 4.6 atlas-hold-expiry.ts

**File:** `lemonade-backend/src/app/jobs/atlas-hold-expiry.ts`

Runs hourly. Transitions rewards past their 14-day hold to `available` status and updates balances/GMV.

```typescript
import { type JobDefinition, type JobHandler } from '../helpers/agenda';
import { withTransaction } from '../helpers/db'; // AUDIT FIX R3 [CC-4]: transactional hold-expiry
import { AtlasFeeDistributionModel, AtlasFeeStatus } from '../models/atlas-fee-distribution';
import { AtlasRewardBalanceModel } from '../models/atlas-reward-balance';
import { AtlasOrganizerMonthlyGmvModel } from '../models/atlas-organizer-monthly-gmv';

const handler: JobHandler = async function handler(_job, logger) {
  logger.info('Processing expired reward holds');

  // Find all fee distributions past their hold period
  const expired = await AtlasFeeDistributionModel.find({
    status: AtlasFeeStatus.pending_hold,
    hold_expires_at: { $lt: new Date() },
  });

  for (const fee of expired) {
    // AUDIT FIX R3 [CC-4]: Wrap per-record processing in withTransaction for atomicity
    await withTransaction(async (session) => {
      // Transition to available
      await AtlasFeeDistributionModel.updateOne(
        { _id: fee._id, status: AtlasFeeStatus.pending_hold },
        { $set: { status: AtlasFeeStatus.available, updated_at: new Date() } },
        { session },
      );

      // AUDIT FIX R3 [CC-2]: Cannot use $inc on string BigInt fields.
      // pending_usdc is stored as a string (@prop({ default: '0' })).
      // MongoDB $inc does not work on string fields — it throws or produces garbage.
      // Use aggregation pipeline updates with $toLong/$toString instead.

      // Credit organizer pending_usdc (reward now available for payout)
      const orgReward = BigInt(fee.organizer_cashback_usdc) + BigInt(fee.organizer_volume_bonus_usdc);
      if (orgReward > 0n) {
        await AtlasRewardBalanceModel.updateOne(
          { user: fee.organizer_id, space: fee.space_id, type: 'organizer' },
          [{ $set: {
            pending_usdc: { $toString: { $add: [{ $toLong: '$pending_usdc' }, NumberLong(orgReward.toString())] } },
            updated_at: new Date(),
          } }],
          { session },
        );
      }

      // Credit attendee pending_usdc
      const attReward = BigInt(fee.attendee_cashback_usdc) + BigInt(fee.attendee_discovery_bonus_usdc);
      if (attReward > 0n && fee.attendee_id) {
        await AtlasRewardBalanceModel.updateOne(
          { user: fee.attendee_id, type: 'attendee' },
          [{ $set: {
            pending_usdc: { $toString: { $add: [{ $toLong: '$pending_usdc' }, NumberLong(attReward.toString())] } },
            updated_at: new Date(),
          } }],
          { session },
        );
      }

      // AUDIT FIX R2 [E11]: Update GMV with settled transaction (past hold period)
      // AUDIT FIX R3 [CC-2]: gmv_usdc is a string BigInt — use pipeline update, not $inc
      const feeDate = fee.created_at;
      await AtlasOrganizerMonthlyGmvModel.updateOne(
        { user: fee.organizer_id, year: feeDate.getFullYear(), month: feeDate.getMonth() + 1 },
        [{ $set: {
          gmv_usdc: { $toString: { $add: [{ $toLong: { $ifNull: ['$gmv_usdc', '0'] } }, NumberLong(fee.gross_amount_usdc)] } },
          ticket_count: { $add: [{ $ifNull: ['$ticket_count', 0] }, 1] },
          updated_at: new Date(),
        } }],
        { upsert: true, session },
      );
    });
  }

  logger.info({ count: expired.length }, 'Hold expiry processing complete (paid ticket rewards)');

  // AUDIT FIX R4 [SV-3]: Also process free ticket reward hold expiry
  const expiredFreeRewards = await AtlasFreeTicketRewardModel.find({
    status: AtlasFreeTicketRewardStatus.pending_hold,
    hold_expires_at: { $lt: new Date() },
  });

  for (const reward of expiredFreeRewards) {
    await AtlasFreeTicketRewardModel.updateOne(
      { _id: reward._id, status: AtlasFreeTicketRewardStatus.pending_hold },
      { $set: { status: AtlasFreeTicketRewardStatus.available, updated_at: new Date() } },
    );
    // Credit the user's AtlasRewardBalance with the free ticket reward amount
    // CC-2: Use aggregation pipeline update for string BigInt fields
    const balanceType = reward.role === 'organizer' ? 'organizer' : 'attendee';
    await AtlasRewardBalanceModel.updateOne(
      { user: reward.user_id, space: reward.space_id, type: balanceType },
      [{ $set: {
        pending_usdc: { $toString: { $add: [{ $toLong: '$pending_usdc' }, NumberLong(reward.amount_usdc)] } },
        accrued_usdc: { $toString: { $add: [{ $toLong: '$accrued_usdc' }, NumberLong(reward.amount_usdc)] } },
        updated_at: new Date(),
      } }],
      { upsert: true },
    );
  }

  logger.info({ paidCount: expired.length, freeCount: expiredFreeRewards.length },
    'Hold expiry processing complete (paid + free ticket rewards)');
};

const definition: JobDefinition = {
  name: 'atlas-hold-expiry',
  handler,
};

export = definition;
```

**Scheduling:** `agenda.every('0 * * * *', 'atlas-hold-expiry');` (every hour on the hour)

> **AUDIT FIX R3 [XP-1]:** Agenda job for guaranteed fee processing with retry.

### 4.7 atlas-process-fee.ts

**File:** `lemonade-backend/src/app/jobs/atlas-process-fee.ts`

Processes the Atlas protocol fee for a single payment. Replaces fire-and-forget `.catch(...)` pattern with guaranteed delivery via Agenda. If the job fails (e.g., MongoDB down, process crash), Agenda retries automatically (default: 3 retries with exponential backoff).

```typescript
import { type JobDefinition, type JobHandler } from '../helpers/agenda';
import * as AtlasFee from '../services/atlas-fee';
import { Types } from 'mongoose';

const handler: JobHandler = async function handler(job, logger) {
  const {
    paymentId, eventId, spaceId, organizerId, attendeeId,
    grossAmountUsdc, currency, paymentMethod,
    transactionHash, stripePaymentIntent, connectionId,
  } = job.attrs.data as {
    paymentId: string;
    eventId: string;
    spaceId: string;
    organizerId: string;
    attendeeId: string;
    grossAmountUsdc: string;
    currency: string;
    paymentMethod: 'tempo_usdc' | 'stripe';
    transactionHash?: string;
    stripePaymentIntent?: string;
    connectionId?: string;
  };

  logger.info({ paymentId }, 'Processing Atlas fee via Agenda job');

  await AtlasFee.processAtlasFee({
    paymentId: new Types.ObjectId(paymentId),
    eventId: new Types.ObjectId(eventId),
    spaceId: new Types.ObjectId(spaceId),
    organizerId: new Types.ObjectId(organizerId),
    attendeeId: new Types.ObjectId(attendeeId),
    grossAmountUsdc,
    currency,
    paymentMethod,
    transactionHash,
    stripePaymentIntent,
    connectionId: connectionId ? new Types.ObjectId(connectionId) : undefined,
  });

  logger.info({ paymentId }, 'Atlas fee processing complete');
};

const definition: JobDefinition = {
  name: 'atlas-process-fee',
  handler,
};

export = definition;
```

**Scheduling:** Not recurring — scheduled on-demand by the Phase 2 payment success handler via `agenda.now('atlas-process-fee', {...})`.

> **AUDIT FIX R3 [XP-1]:** Reconciliation job for missed fee distributions.

### 4.8 atlas-fee-reconciliation.ts

**File:** `lemonade-backend/src/app/jobs/atlas-fee-reconciliation.ts`

Runs daily. Safety net that scans for succeeded Atlas payments with no corresponding `AtlasFeeDistribution`. If any are found, it creates the missing fee distribution. This catches payments where the `atlas-process-fee` job failed all retries.

```typescript
import { type JobDefinition, type JobHandler } from '../helpers/agenda';
import { AtlasFeeDistributionModel } from '../models/atlas-fee-distribution';
import * as AtlasFee from '../services/atlas-fee';
// Import NewPaymentModel from the existing payments model
import { NewPaymentModel, NewPaymentState } from '../models/new-payment';

const handler: JobHandler = async function handler(_job, logger) {
  logger.info('Running daily Atlas fee reconciliation');

  // Find succeeded Atlas payments from the last 48 hours with no fee distribution
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const succeededPayments = await NewPaymentModel.find({
    state: NewPaymentState.succeeded,
    'metadata.atlas_purchase': true,
    created_at: { $gte: cutoff },
  }).lean();

  if (succeededPayments.length === 0) {
    logger.info('No recent Atlas payments to reconcile');
    return;
  }

  const paymentIds = succeededPayments.map((p) => p._id);

  // Find which payments already have fee distributions
  const existingDistributions = await AtlasFeeDistributionModel.find({
    payment_id: { $in: paymentIds },
  }).distinct('payment_id');

  const existingSet = new Set(existingDistributions.map((id) => id.toString()));
  const missing = succeededPayments.filter((p) => !existingSet.has(p._id.toString()));

  if (missing.length === 0) {
    logger.info('All recent Atlas payments have fee distributions — no reconciliation needed');
    return;
  }

  logger.warn(
    { count: missing.length, paymentIds: missing.map((p) => p._id.toString()) },
    'RECONCILIATION: Found succeeded Atlas payments without fee distributions — reprocessing',
  );

  for (const payment of missing) {
    try {
      await AtlasFee.processAtlasFee({
        paymentId: payment._id,
        eventId: payment.ref_data.event,
        spaceId: payment.metadata.atlas_space_id,
        organizerId: payment.metadata.atlas_organizer_id,
        attendeeId: payment.user,
        grossAmountUsdc: payment.amount,
        currency: payment.currency,
        paymentMethod: payment.metadata.atlas_payment_method,
        transactionHash: payment.transfer_metadata?.tx_hash,
        stripePaymentIntent: payment.transfer_metadata?.intent_id,
        connectionId: payment.metadata.atlas_connection_id,
      });
      logger.info({ paymentId: payment._id }, 'Reconciliation: fee distribution created');
    } catch (err) {
      logger.error({ err, paymentId: payment._id }, 'Reconciliation: failed to create fee distribution — will retry tomorrow');
    }
  }
};

const definition: JobDefinition = {
  name: 'atlas-fee-reconciliation',
  handler,
};

export = definition;
```

**Scheduling:** `agenda.every('0 7 * * *', 'atlas-fee-reconciliation');` (daily at 07:00 UTC)

> **AUDIT FIX R2 [E12]:** Wash trading detection — monthly suspicious pattern report.

### 4.9 atlas-wash-trading-report.ts

**File:** `lemonade-backend/src/app/jobs/atlas-wash-trading-report.ts`

Runs monthly. Detects potential wash trading between colluding organizers.

```typescript
import { type JobDefinition, type JobHandler } from '../helpers/agenda';
import { AtlasFeeDistributionModel } from '../models/atlas-fee-distribution';

const handler: JobHandler = async function handler(_job, logger) {
  logger.info('Running monthly wash trading detection report');

  // AUDIT FIX R2 [E12]: Detect circular purchasing patterns
  // Query: For each Space, find if >80% of Atlas revenue comes from
  // a single other Space's owner (and vice versa)
  const lastMonth = new Date();
  lastMonth.setMonth(lastMonth.getMonth() - 1);
  const startOfMonth = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 1);
  const endOfMonth = new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 1);

  // Aggregate: group by (space_id, attendee_id), sum gross_amount_usdc
  // Then for each space, check if any single attendee accounts for >80% of revenue
  const results = await AtlasFeeDistributionModel.aggregate([
    { $match: { created_at: { $gte: startOfMonth, $lt: endOfMonth } } },
    { $group: {
      _id: { space_id: '$space_id', attendee_id: '$attendee_id' },
      total: { $sum: { $toLong: '$gross_amount_usdc' } },
      count: { $sum: 1 },
    } },
  ]);

  // Build per-space revenue map and check for concentration
  const spaceRevenue: Record<string, { total: bigint; byAttendee: Record<string, bigint> }> = {};
  for (const r of results) {
    const spaceId = r._id.space_id.toString();
    const attendeeId = r._id.attendee_id?.toString();
    if (!attendeeId) continue;
    if (!spaceRevenue[spaceId]) spaceRevenue[spaceId] = { total: 0n, byAttendee: {} };
    spaceRevenue[spaceId].total += BigInt(r.total);
    spaceRevenue[spaceId].byAttendee[attendeeId] =
      (spaceRevenue[spaceId].byAttendee[attendeeId] ?? 0n) + BigInt(r.total);
  }

  const flagged: Array<{ spaceId: string; attendeeId: string; percent: number }> = [];
  for (const [spaceId, data] of Object.entries(spaceRevenue)) {
    for (const [attendeeId, amount] of Object.entries(data.byAttendee)) {
      const percent = Number(amount * 100n / data.total);
      if (percent > 80) {
        flagged.push({ spaceId, attendeeId, percent });
      }
    }
  }

  if (flagged.length > 0) {
    logger.warn({ flagged }, 'WASH TRADING ALERT: Spaces with >80% revenue concentration from single buyer');
    // TODO: Send alert to admin dashboard / Slack channel
  } else {
    logger.info('No suspicious wash trading patterns detected');
  }
};

const definition: JobDefinition = {
  name: 'atlas-wash-trading-report',
  handler,
};

export = definition;
```

**Scheduling:** `agenda.every('0 5 1 * *', 'atlas-wash-trading-report');` (1st of each month, 05:00 UTC)

---

## 5. GraphQL Resolvers

### 5.1 Atlas Reward Resolver

**File:** `lemonade-backend/src/graphql/resolvers/atlas-reward.ts`

```typescript
// All queries require @Authorized() — only the authenticated user can view their own rewards.

// --- Queries ---

/**
 * atlasRewardSummary(space: MongoId!) → AtlasRewardSummaryOutput
 *
 * Returns aggregated reward data for the current user in a given Space.
 * Looks up AtlasRewardBalance for (user, space, type=organizer) and (user, space, type=attendee).
 */
// Output type:
@ObjectType()
class AtlasRewardSummaryOutput {
  @Field() organizer_accrued_usdc!: string;
  @Field() organizer_pending_usdc!: string;
  @Field() organizer_paid_out_usdc!: string;
  @Field() attendee_accrued_usdc!: string;
  @Field() attendee_pending_usdc!: string;
  @Field() attendee_paid_out_usdc!: string;
  @Field() volume_tier!: string;          // 'base' | 'tier_1' | 'tier_2' | 'tier_3'
  @Field() monthly_gmv_usdc!: string;
  @Field() next_tier_threshold_usdc!: string;
  @Field({ nullable: true }) next_payout_date?: Date;    // next Monday
}

/**
 * atlasRewardHistory(space: MongoId!, limit: Int, offset: Int) → [AtlasFeeDistribution]
 *
 * Returns paginated AtlasFeeDistribution records where organizer_id or attendee_id = current user.
 * Sorted by created_at DESC.
 */

/**
 * atlasReferralSummary → AtlasReferralSummaryOutput
 *
 * Calls atlas-referral service's getReferralSummary.
 */

/**
 * atlasPayoutHistory(limit: Int, offset: Int) → [AtlasPayoutHistoryItem]
 *
 * Queries AtlasPayoutBatch.items where user = current user.
 * Returns flat list of payout items across batches, sorted by date DESC.
 */
```

### 5.2 GraphQL Input/Output Types

**File:** `lemonade-backend/src/graphql/types/atlas-reward.ts`

Define all input/output types here following existing pattern in `lemonade-backend/src/graphql/types/`.

### 5.3 Atlas Referral Mutations

Add to `atlas-reward.ts` resolver:

```typescript
/**
 * atlasGenerateReferralCode → AtlasReferralCode
 * Generates (or returns existing) referral code for current user.
 */

/**
 * atlasApplyReferralCode(code: String!) → Boolean
 * Applies a referral code during organizer onboarding.
 * Validates code, creates AtlasReferral link.
 * Passes request IP (from ctx.request.ip) for anti-fraud check.
 */

> **AUDIT FIX [P4-H1]:** Payout settings mutations for user wallet configuration.

/**
 * atlasUpdatePayoutSettings(input: AtlasPayoutSettingsInput!) → AtlasPayoutSettings
 * Allows users to configure their payout destination (wallet address or Stripe Connect).
 * Input: { wallet_address?: string, wallet_chain?: string, stripe_connect_account_id?: string, preferred_method?: string }
 * Validates wallet address format if provided. Upserts AtlasPayoutSettings for current user.
 */

/**
 * atlasGetPayoutSettings → AtlasPayoutSettings | null
 * Returns current user's payout settings. Null if not configured.
 */
```

---

## 6. Integration Points

### 6.1 Hook into Phase 2 Payment Completion

The fee collection must be triggered when an Atlas payment succeeds. Locate the point in Phase 2 where `NewPayment.state` transitions to `succeeded` for Atlas transactions.

**File to modify:** The Phase 2 payment success handler (expected at `lemonade-backend/src/app/services/atlas-payment.ts` or equivalent).

Add after the payment succeeds:

```typescript
> **AUDIT FIX [P4-H5]:** Atlas fee errors must NOT break payment flow.
> **AUDIT FIX [P4-H7]:** Pass payment.currency for currency guard.
> **AUDIT FIX R3 [XP-1]:** Fire-and-forget replaced with Agenda job for guaranteed delivery.
> If the process crashes or MongoDB is temporarily down, Agenda retries automatically.
> Fire-and-forget `.catch(...)` silently loses money on failure — no retry, no reconciliation.

// After payment.state = NewPaymentState.succeeded for Atlas transactions:
// Schedule via Agenda for guaranteed delivery with retry on failure.
await agenda.now('atlas-process-fee', {
  paymentId: payment._id.toString(),
  eventId: payment.ref_data.event.toString(),
  spaceId: event.space.toString(),
  organizerId: event.creator.toString(),
  attendeeId: payment.user.toString(),
  grossAmountUsdc: payment.amount,
  currency: payment.currency,
  paymentMethod: isTempoPayment ? 'tempo_usdc' : 'stripe',
  transactionHash: (payment.transfer_metadata as BlockchainTransferMetadata)?.tx_hash,
  stripePaymentIntent: (payment.transfer_metadata as StripeTransferMetadata)?.intent_id,
  connectionId: event.atlas_connection_id?.toString(), // AUDIT FIX R2 [E15]: source connection for suspended check
});
```

### 6.2 Hook into Refund Flow

**File to modify:** The existing refund handler in `lemonade-backend/src/app/services/event-payment.ts` or the Phase 2 refund handler.

Add after a successful refund:

```typescript
import * as AtlasRefund from './atlas-refund';

// After refund succeeds:
await AtlasRefund.handleAtlasRefund(payment._id, refundPercent);
```

> **AUDIT FIX [P4-M6]:** Fee deduction mechanism specified per payment method.

### 6.3 Fee Deduction from Settlement

**For Stripe payments:** Use Stripe's `application_fee_amount` parameter on PaymentIntent creation. This is the standard Stripe Connect pattern for platform fees.
- **File to modify:** The Phase 2 Stripe payment creation handler (where `stripe.paymentIntents.create()` is called)
- Add `application_fee_amount: Math.round(grossAmountCents * 0.02)` to the PaymentIntent params
- Stripe automatically deducts this from the connected account's settlement and routes it to the platform account
- This is cleaner than post-hoc transfer amount adjustments and provides built-in Stripe reporting

**For Tempo/Base USDC (crypto) payments:** Deduct 2% before transfer to organizer wallet.
- **File to modify:** The Phase 2 crypto settlement handler (where on-chain transfer to organizer is executed)
- Calculate: `organizerAmount = grossAmount * 98n / 100n`
- Calculate: `treasuryAmount = grossAmount - organizerAmount` (handles rounding)
- Transfer `organizerAmount` to organizer's wallet, `treasuryAmount` to Atlas treasury wallet
- Both transfers in same transaction where possible (multicall or sequential with same nonce batch)

### 6.4 Agenda Job Registration

**File to modify:** Wherever recurring Agenda jobs are registered (likely in `lemonade-backend/src/bin/app.ts` or a startup script).

Add:

```typescript
await agenda.every('0 * * * *', 'atlas-hold-expiry');                  // Every hour             [AUDIT FIX R2 E10]
await agenda.every('0 6 * * 1', 'atlas-weekly-payout');              // Monday 06:00 UTC
await agenda.every('0 2 1 * *', 'atlas-expire-rewards');              // 1st of month 02:00 UTC
await agenda.every('0 3 1 * *', 'atlas-writeoff-negative-balances');  // 1st of month 03:00 UTC
await agenda.every('0 4 1 * *', 'atlas-referral-pool-sweep');         // 1st of month 04:00 UTC  [AUDIT FIX P4-M1]
await agenda.every('0 5 1 * *', 'atlas-wash-trading-report');         // 1st of month 05:00 UTC  [AUDIT FIX R2 E12]
await agenda.every('0 7 * * *', 'atlas-fee-reconciliation');          // Daily 07:00 UTC         [AUDIT FIX R3 XP-1]
// atlas-process-fee is scheduled on-demand by payment success handler                            [AUDIT FIX R3 XP-1]
// atlas-payout-retry is scheduled on-demand, not recurring                                       [AUDIT FIX P4-M7]
```

---

## 7. Database Migration

**File:** `lemonade-backend/src/db/migrations/<timestamp>-create-atlas-reward-collections.ts`

Generate with `yarn migrate:generate` and implement:

```typescript
export async function up() {
  const db = mongoose.connection.db;

  // Create collections (models auto-create on first write, but explicit creation ensures indexes)
  await db.createCollection('atlas_reward_balances');
  await db.createCollection('atlas_fee_distributions');
  await db.createCollection('atlas_referrals');
  await db.createCollection('atlas_referral_codes');
  await db.createCollection('atlas_payout_batches');
  await db.createCollection('atlas_organizer_monthly_gmvs');
  await db.createCollection('atlas_refunds');             // AUDIT FIX [P4-C3]
  await db.createCollection('atlas_payout_settings');     // AUDIT FIX [P4-H1]
  await db.createCollection('atlas_dust_pools');           // AUDIT FIX R3 [M-2]
  await db.createCollection('atlas_free_ticket_rewards');  // AUDIT FIX R4 [SV-3]
  // AUDIT FIX R2 [PD-2]: atlas_tax_infos REMOVED — Stripe Connect handles tax compliance

  // Indexes are created by Typegoose @index decorators on model load,
  // but we ensure them here for safety:
  await db.collection('atlas_reward_balances').createIndex(
    { user: 1, space: 1, type: 1 }, { unique: true }
  );
  await db.collection('atlas_reward_balances').createIndex(
    { user: 1, type: 1 }
  );
  await db.collection('atlas_fee_distributions').createIndex(
    { payment_id: 1 }, { unique: true }
  );
  await db.collection('atlas_fee_distributions').createIndex(
    { event_id: 1 }
  );
  await db.collection('atlas_fee_distributions').createIndex(
    { space_id: 1 }
  );
  await db.collection('atlas_fee_distributions').createIndex(
    { organizer_id: 1, created_at: -1 }
  );
  await db.collection('atlas_fee_distributions').createIndex(
    { attendee_id: 1, created_at: -1 }
  );
  await db.collection('atlas_referrals').createIndex(
    { referrer_id: 1 }
  );
  await db.collection('atlas_referrals').createIndex(
    { referred_id: 1 }, { unique: true }
  );
  await db.collection('atlas_referral_codes').createIndex(
    { user: 1 }, { unique: true }
  );
  await db.collection('atlas_referral_codes').createIndex(
    { code: 1 }, { unique: true }
  );
  await db.collection('atlas_organizer_monthly_gmvs').createIndex(
    { user: 1, year: 1, month: 1 }, { unique: true }
  );

  // AUDIT FIX [P4-H3]: Unique compound index for payout batch idempotency
  await db.collection('atlas_payout_batches').createIndex(
    { period_start: 1, period_end: 1 }, { unique: true }
  );

  // AUDIT FIX [P4-C3]: AtlasRefund indexes
  await db.collection('atlas_refunds').createIndex({ payment_id: 1 });
  await db.collection('atlas_refunds').createIndex({ fee_distribution_id: 1 });
  await db.collection('atlas_refunds').createIndex({ created_at: -1 });

  // AUDIT FIX [P4-H1]: AtlasPayoutSettings indexes
  await db.collection('atlas_payout_settings').createIndex(
    { user: 1 }, { unique: true }
  );

  // AUDIT FIX R3 [M-2]: AtlasDustPool indexes
  await db.collection('atlas_dust_pools').createIndex(
    { month: 1 }, { unique: true }
  );

  // AUDIT FIX R2 [PD-2]: atlas_tax_infos indexes REMOVED — Stripe Connect handles tax compliance

  // AUDIT FIX R2 [E10]: Index for hold expiry job (query pending_hold by hold_expires_at)
  await db.collection('atlas_fee_distributions').createIndex(
    { status: 1, hold_expires_at: 1 }
  );

  // AUDIT FIX R4 [SV-3]: AtlasFreeTicketReward indexes
  await db.collection('atlas_free_ticket_rewards').createIndex(
    { user_id: 1, created_at: -1 }
  );
  await db.collection('atlas_free_ticket_rewards').createIndex(
    { event_id: 1 }
  );
  await db.collection('atlas_free_ticket_rewards').createIndex(
    { space_id: 1 }
  );
  await db.collection('atlas_free_ticket_rewards').createIndex(
    { status: 1, hold_expires_at: 1 }
  );
  await db.collection('atlas_free_ticket_rewards').createIndex(
    { user_id: 1, role: 1, created_at: -1 }
  );
}

export async function down() {
  const db = mongoose.connection.db;
  await db.dropCollection('atlas_reward_balances');
  await db.dropCollection('atlas_fee_distributions');
  await db.dropCollection('atlas_referrals');
  await db.dropCollection('atlas_referral_codes');
  await db.dropCollection('atlas_payout_batches');
  await db.dropCollection('atlas_organizer_monthly_gmvs');
  await db.dropCollection('atlas_refunds');           // AUDIT FIX [P4-C3]
  await db.dropCollection('atlas_payout_settings');   // AUDIT FIX [P4-H1]
  await db.dropCollection('atlas_dust_pools');         // AUDIT FIX R3 [M-2]
  await db.dropCollection('atlas_free_ticket_rewards'); // AUDIT FIX R4 [SV-3]
  // AUDIT FIX R2 [PD-2]: atlas_tax_infos REMOVED
}
```

---

## 8. Frontend: Space Dashboard Rewards Section

### 8.1 New Route

**File:** `web-new/app/[domain]/(blank)/s/manage/[uid]/rewards/page.tsx`

```typescript
'use client';

import { AtlasRewards } from '$lib/components/features/community-manage/AtlasRewards';
import { useCommunityManageSpace } from '$lib/components/features/community-manage/CommunityManageSpaceContext';

export function Page() {
  const ctx = useCommunityManageSpace();
  if (!ctx) return null;

  return <AtlasRewards space={ctx.space} />;
}

export default Page;
```

### 8.2 Add "Rewards" to Community Manage Layout Menu

**File to modify:** `web-new/lib/components/features/community-manage/CommunityManageLayout.tsx:16-25`

Add `{ name: 'Rewards', page: 'rewards' }` to the `menu` array, between 'Payments' and 'Launchpad':

```typescript
const menu = [
  { name: 'Overview', page: 'overview' },
  { name: 'Events', page: 'events' },
  { name: 'Submissions', page: 'submissions' },
  { name: 'People', page: 'people' },
  { name: 'Agents', page: 'agents' },
  { name: 'Payments', page: 'payments' },
  { name: 'Rewards', page: 'rewards' },      // NEW
  { name: 'Launchpad', page: 'launchpad' },
  { name: 'Settings', page: 'settings' },
];
```

### 8.3 AtlasRewards Component

**File:** `web-new/lib/components/features/community-manage/AtlasRewards.tsx`

```
'use client';

Component structure:
├── AtlasRewards (main container)
│   ├── RewardSummaryCards (top row)
│   │   ├── Card: Total Earned (accrued_usdc — organizer + attendee combined)
│   │   ├── Card: Pending Payout (pending_usdc, next payout date)
│   │   ├── Card: Total Paid Out (paid_out_usdc)
│   │   └── Card: Volume Tier (current tier name, progress bar to next)
│   ├── RewardHistoryTable (main content)
│   │   ├── Filter tabs: All | Organizer Cashback | Attendee Cashback | Referral
│   │   ├── Table columns: Date, Event, Type, Amount, Status
│   │   └── Pagination
│   ├── VerificationCTABanner [AUDIT FIX R4 SV-4] (shown for unverified organizers)
│   │   ├── Message: "You're earning 0.6% cashback. Verify with Self to earn 1.0%"
│   │   ├── Dollar difference: "— that's an extra $X.XX based on your last month's sales."
│   │   ├── Verify button → https://lemonade.social/settings/verify
│   │   └── Dismissable (but re-shown monthly)
│   └── ReferralProgramCard (bottom section)
│       ├── Referral code with copy button
│       ├── Share link
│       ├── Stats: total referred, total earned
│       └── Referred organizers list (name, status, milestones, earned)
```

> **AUDIT FIX R4 [SV-4]:** Dashboard verification CTA for unverified organizers.

**VerificationCTABanner implementation:**
- Show ONLY for unverified organizers (check `atlasRewardSummary.is_self_verified === false`)
- Calculate actual dollar difference: `extraDollars = lastMonthGmv * (0.01 - 0.006)` = 0.4% of last month's GMV
  - Example: $10K GMV last month → "that's an extra $40.00"
- Use the `atlasRewardSummary.monthly_gmv_usdc` value to compute the real difference
- Verify button links to `https://lemonade.social/settings/verify` (existing Self.xyz verification flow)
- Dismissable per-session, but re-shown if user returns next month

**Add to `AtlasRewardSummaryOutput` type (backend):**
```typescript
// AUDIT FIX R4 [SV-4]: Verification status and CTA data
@Field()
is_self_verified!: boolean;  // true if user has Self.xyz disclosures

@Field({ nullable: true })
verification_cta_extra_usdc?: string; // BigInt — calculated: monthly_gmv * (boosted_rate - base_rate). Null if verified.
```

**GraphQL documents needed (add to codegen):**

```graphql
query AtlasRewardSummary($space: MongoId!) {
  atlasRewardSummary(space: $space) {
    organizer_accrued_usdc
    organizer_pending_usdc
    organizer_paid_out_usdc
    attendee_accrued_usdc
    attendee_pending_usdc
    attendee_paid_out_usdc
    volume_tier
    monthly_gmv_usdc
    next_tier_threshold_usdc
    next_payout_date
    is_self_verified                    # AUDIT FIX R4 [SV-4]
    verification_cta_extra_usdc         # AUDIT FIX R4 [SV-4]
  }
}

query AtlasRewardHistory($space: MongoId!, $limit: Int, $offset: Int) {
  atlasRewardHistory(space: $space, limit: $limit, offset: $offset) {
    _id
    event_id
    gross_amount_usdc
    organizer_cashback_usdc
    attendee_cashback_usdc
    organizer_volume_bonus_usdc
    attendee_discovery_bonus_usdc
    payment_method
    status
    created_at
  }
}

query AtlasReferralSummary {
  atlasReferralSummary {
    referral_code
    total_referred
    total_earned_usdc
    referrals {
      referred_id
      status
      tickets_sold
      gmv_usdc
      earned_usdc
      milestones { milestone_1 milestone_2 }
    }
  }
}

mutation AtlasGenerateReferralCode {
  atlasGenerateReferralCode {
    code
  }
}

# AUDIT FIX [P4-H1]: Payout settings queries/mutations
query AtlasPayoutSettings {
  atlasGetPayoutSettings {
    wallet_address
    wallet_chain
    stripe_connect_account_id
    preferred_method
  }
}

mutation AtlasUpdatePayoutSettings($input: AtlasPayoutSettingsInput!) {
  atlasUpdatePayoutSettings(input: $input) {
    wallet_address
    wallet_chain
    stripe_connect_account_id
    preferred_method
  }
}
```

### 8.4 USDC Formatting Utility

**File:** `web-new/lib/utils/atlas-rewards.ts`

> **AUDIT FIX [P4-H2]:** Fixed `formatUsdc` math. Previous implementation was wrong:
> `formatUsdc("1999999")` produced `"$1.100"` instead of `"$1.99"`.
> Root cause: `Number(fraction) / 10_000` uses floating-point division, then `Math.round`
> rounds 99.9999 to 100, producing `.100` after padStart.
> Fix: Use pure BigInt arithmetic — divide remainder by 10_000n to get cents as integer.

```typescript
/**
 * Format USDC micro-units (6 decimals) to human-readable string.
 * "1000000" → "$1.00"
 * "500000" → "$0.50"
 * "1999999" → "$1.99"
 * "123456789" → "$123.45"
 */
export function formatUsdc(microUnits: string): string {
  const total = BigInt(microUnits);
  const dollars = total / 1_000_000n;
  const cents = Number((total % 1_000_000n) / 10_000n); // truncate to 2 decimal places
  return `$${dollars}.${cents.toString().padStart(2, '0')}`;
}

/**
 * Volume tier display names.
 */
export const VOLUME_TIER_LABELS: Record<string, string> = {
  base: 'Base (0.6%)',
  tier_1: 'Silver (0.8%)',
  tier_2: 'Gold (1.0%)',
  tier_3: 'Platinum (1.2%)',
};

/**
 * Volume tier thresholds for progress bar.
 */
export const VOLUME_TIER_THRESHOLDS = [
  { key: 'base', label: 'Base', min: 0, max: 10_000, rate: '0.6%' },
  { key: 'tier_1', label: 'Silver', min: 10_000, max: 50_000, rate: '0.8%' },
  { key: 'tier_2', label: 'Gold', min: 50_000, max: 250_000, rate: '1.0%' },
  { key: 'tier_3', label: 'Platinum', min: 250_000, max: Infinity, rate: '1.2%' },
];
```

### 8.5 UI Design Tokens

Use existing dark-mode-first Tailwind tokens from the web-new design system:
- Cards: `bg-card`, `border-card-border`, `rounded-md`
- Text: `text-primary`, `text-secondary`, `text-tertiary`
- Status chips: `Chip` component from `$lib/components/core`
- Tables: follow pattern from `Settings.tsx` (`web-new/lib/components/features/event-manage/payments/Settings.tsx`)
- Progress bars: Tailwind `bg-primary` with `bg-primary/16` track

---

## 9. File Inventory

### New Files (Backend — 25 files, 1 removed)

| File | Purpose |
|------|---------|
| `lemonade-backend/src/app/models/atlas-reward-balance.ts` | Reward balance model |
| `lemonade-backend/src/app/models/atlas-fee-distribution.ts` | Fee distribution audit log model |
| `lemonade-backend/src/app/models/atlas-referral.ts` | Referral tracking model (with anti-fraud fields) |
| `lemonade-backend/src/app/models/atlas-referral-code.ts` | Referral code model |
| `lemonade-backend/src/app/models/atlas-payout-batch.ts` | Payout batch model (with idempotency index) |
| `lemonade-backend/src/app/models/atlas-organizer-monthly-gmv.ts` | Monthly GMV tracking model |
| `lemonade-backend/src/app/models/atlas-refund.ts` | Refund tracking model [AUDIT FIX P4-C3] |
| `lemonade-backend/src/app/models/atlas-payout-settings.ts` | Per-user payout settings [AUDIT FIX P4-H1] (Stripe Connect required [AUDIT FIX R2 PD-2]) |
| ~~`lemonade-backend/src/app/models/atlas-tax-info.ts`~~ | REMOVED [AUDIT FIX R2 PD-2] — Stripe Connect handles tax |
| `lemonade-backend/src/app/services/atlas-fee.ts` | Fee collection + distribution service |
| `lemonade-backend/src/app/services/atlas-referral.ts` | Referral program service (with anti-fraud) |
| `lemonade-backend/src/app/services/atlas-payout.ts` | Weekly payout service (with retry logic) |
| `lemonade-backend/src/app/services/atlas-refund.ts` | Refund clawback service |
| `lemonade-backend/src/app/jobs/atlas-weekly-payout.ts` | Weekly payout Agenda job |
| `lemonade-backend/src/app/jobs/atlas-expire-rewards.ts` | Monthly reward expiry job |
| `lemonade-backend/src/app/jobs/atlas-writeoff-negative-balances.ts` | Monthly negative balance write-off job |
| `lemonade-backend/src/app/jobs/atlas-referral-pool-sweep.ts` | Monthly referral pool sweep [AUDIT FIX P4-M1] |
| `lemonade-backend/src/app/jobs/atlas-payout-retry.ts` | Failed payout retry job [AUDIT FIX P4-M7] |
| `lemonade-backend/src/app/jobs/atlas-hold-expiry.ts` | Hourly hold expiry processor [AUDIT FIX R2 E10] |
| `lemonade-backend/src/app/jobs/atlas-process-fee.ts` | On-demand fee processing with Agenda retry [AUDIT FIX R3 XP-1] |
| `lemonade-backend/src/app/jobs/atlas-fee-reconciliation.ts` | Daily reconciliation for missed fee distributions [AUDIT FIX R3 XP-1] |
| `lemonade-backend/src/app/models/atlas-dust-pool.ts` | Consolidated dust pool for sub-threshold fees [AUDIT FIX R3 M-2] |
| `lemonade-backend/src/app/models/atlas-free-ticket-reward.ts` | Free ticket reward model for verified users [AUDIT FIX R4 SV-3] |
| `lemonade-backend/src/app/services/atlas-free-ticket-reward.ts` | Free ticket reward service [AUDIT FIX R4 SV-3] |
| `lemonade-backend/src/app/jobs/atlas-wash-trading-report.ts` | Monthly wash trading detection [AUDIT FIX R2 E12] |
| `lemonade-backend/src/graphql/resolvers/atlas-reward.ts` | GraphQL resolver |
| `lemonade-backend/src/graphql/types/atlas-reward.ts` | GraphQL input/output types |
| `lemonade-backend/src/db/migrations/<ts>-create-atlas-reward-collections.ts` | Migration |

### New Files (Frontend — 3 files)

| File | Purpose |
|------|---------|
| `web-new/app/[domain]/(blank)/s/manage/[uid]/rewards/page.tsx` | Rewards page route |
| `web-new/lib/components/features/community-manage/AtlasRewards.tsx` | Rewards dashboard component |
| `web-new/lib/utils/atlas-rewards.ts` | USDC formatting + tier display utilities |

### Modified Files

| File | Change |
|------|--------|
| `web-new/lib/components/features/community-manage/CommunityManageLayout.tsx` | Add 'Rewards' to menu array (line ~17) |
| Phase 2 Atlas payment success handler (TBD path) | Call `AtlasFee.processAtlasFee()` after payment succeeds |
| Phase 2 Atlas refund handler (TBD path) | Call `AtlasRefund.handleAtlasRefund()` after refund succeeds |
| Agenda startup file (TBD — likely `src/bin/app.ts`) | Register 5 recurring jobs (was 3, added hold-expiry [R2 E10] + wash-trading-report [R2 E12]) |
| `lemonade-backend/src/config/index.ts` | Add `ATLAS_TREASURY_WALLET_KEY`, `ATLAS_TEMPO_CHAIN_ID`, `ATLAS_DISCOVERY_BONUS_MONTHLY_CAP_USDC` env vars |

---

## 10. Testing Requirements

### Backend Unit Tests

| Test file | Coverage |
|-----------|----------|
| `atlas-fee.test.ts` | Fee calculation: 2% of various amounts, split correctness (40/30/20/10 add up to 100%), BigInt rounding, zero-amount handling |
| `atlas-fee.test.ts` | Self-purchase detection: organizerId === attendeeId → both cashbacks zeroed [P4-C1] |
| `atlas-fee.test.ts` | Volume tier determination: boundary values ($9,999.99, $10,000.00, $50,000.00, $250,000.00) |
| `atlas-fee.test.ts` | Volume bonus cap: bonus cannot exceed treasury share [P4-H6] |
| `atlas-fee.test.ts` | Currency guard: non-USD/USDC payments skipped gracefully [P4-H7] |
| `atlas-fee.test.ts` | Discovery bonus: correct multiplier for positions 1, 10, 11, 50, 51 |
| `atlas-fee.test.ts` | Discovery bonus $500/month cap: $0 after cap, not partial [P4-M3] |
| `atlas-referral.test.ts` | Code generation uniqueness, milestone triggers at exact boundaries (24→25 tickets, $4,999→$5,000 GMV), cap enforcement, welcome bonus |
| `atlas-referral.test.ts` | Anti-fraud: same IP rejection, same email domain rejection, same wallet rejection [P4-C2] |
| `atlas-referral.test.ts` | Milestones count unique attendees only (exclude self-purchases) [P4-C2] |
| `atlas-referral.test.ts` | Manual review flag set when earned >= $20 [P4-C2] |
| `atlas-refund.test.ts` | Full refund clawback, partial refund (50%) proportional clawback, negative balance creation when pending < clawback |
| `atlas-refund.test.ts` | Cross-month refund: GMV decremented in original month, not current month [P4-M2] |
| `atlas-refund.test.ts` | AtlasRefund record created with correct amounts [P4-C3] |
| `atlas-refund.test.ts` | Atomic negative balance: findOneAndUpdate pipeline correctness [P4-M4] |
| `atlas-payout.test.ts` | Batch creation with threshold filter ($4.99 excluded, $5.00 included), negative balance deduction, Tempo vs Stripe routing |
| `atlas-payout.test.ts` | Idempotency: duplicate batch for same period rejected [P4-H3] |
| `atlas-payout.test.ts` | Wallet lookup uses AtlasPayoutSettings, not Space.payment_accounts [P4-H1] |
| `atlas-payout.test.ts` | Attendee Stripe payout accumulated as platform credit [P4-H4] |
| `atlas-payout.test.ts` | Failed payout retry: 3 attempts with backoff, then permanently_failed [P4-M7] |
| `atlas-fee.test.ts` | Dust attack: grossAmount < $1.00 → no individual reward record, AtlasDustPool incremented [R2 E5] [R3 M-2] |
| `atlas-fee.test.ts` | Suspended connection: connection.status === 'suspended' → no rewards generated [R2 E15] |
| `atlas-fee.test.ts` | 14-day hold: new AtlasFeeDistribution has status=pending_hold, hold_expires_at=+14d [R2 E10] |
| `atlas-fee.test.ts` | Self-purchase GMV exclusion: organizerId === attendeeId → no GMV update [R2 E11] |
| `atlas-referral.test.ts` | Account age gate: user < 7 days old → code creation rejected [R2 PD-1] |
| `atlas-referral.test.ts` | IP rate limit: >3 applications/hour/IP → 429 rejection [R2 PD-1] |
| `atlas-referral.test.ts` | Rewards eligibility: no published event → milestones withheld [R2 PD-1] |
| `atlas-referral.test.ts` | Fee laundering: referrer === attendee OR space_owner === attendee → excluded from milestones [R2 E9] |
| `atlas-refund.test.ts` | Hold period cancellation: refund during pending_hold → status=cancelled, no clawback [R2 E10] |
| `atlas-refund.test.ts` | Post-hold refund: refund after available → standard clawback logic [R2 E10] |
| `atlas-payout.test.ts` | Stripe Connect required: no stripe_connect_account_id → skip payout, send notification [R2 PD-2] |
| `atlas-payout.test.ts` | Hold expiry: pending_hold + hold_expires_at < now → transition to available + inc pending_usdc [R2 E10] |
| `atlas-payout.test.ts` | Settled GMV: GMV updated only when hold expires, not at accrual time [R2 E11] |
| `atlas-wash-trading.test.ts` | Wash trading detection: >80% revenue concentration flagged [R2 E12] |
| `atlas-fee.test.ts` | Pipeline update: all monetary $inc replaced with $toLong/$toString aggregation pipeline [R3 CC-2] |
| `atlas-fee.test.ts` | Agenda job: fee processing scheduled via atlas-process-fee, not fire-and-forget [R3 XP-1] |
| `atlas-fee.test.ts` | Reconciliation: missed fee distributions detected and reprocessed [R3 XP-1] |
| `atlas-fee.test.ts` | Dust threshold: grossAmount $0.50-$0.99 → AtlasDustPool incremented, no individual record [R3 M-2] |
| `atlas-payout.test.ts` | Unredeemed balance cap: $500 cap for users without Stripe Connect, rewards redirected to treasury [R3 PD2-3] |
| `atlas-payout.test.ts` | Unredeemed balance cap removed once Stripe Connect active [R3 PD2-3] |
| `atlas-hold-expiry.test.ts` | Hold expiry transactional: per-record processing wrapped in withTransaction [R3 CC-4] |
| `atlas-hold-expiry.test.ts` | Pipeline update in hold-expiry: pending_usdc and gmv_usdc use $toLong/$toString [R3 CC-2] |
| `atlas-referral.test.ts` | $toLong produces MongoDB Long not BigInt: ?? 0 instead of ?? 0n [R3 CC-3] |
| `atlas-refund.test.ts` | Negative balance cap: organizer with negative_balance > $1000 → new accrual blocked [R3 F-3] |
| `atlas-refund.test.ts` | GMV decrement uses pipeline update not $inc [R3 CC-2] |
| `atlas-payout.test.ts` | Single destination payout: preferred_method selects ONE destination, no split [R3 M-3] |

### Frontend Tests

| Test | Coverage |
|------|----------|
| `AtlasRewards.test.tsx` | Renders summary cards with formatted USDC values, renders empty state when no rewards |
| `atlas-rewards.test.ts` | `formatUsdc` edge cases: "0", "1", "999999", "1000000", "1999999" (must be "$1.99" not "$1.100"), "123456789000" [P4-H2] |

---

## 11. Sequencing & Dependencies

```
Phase 2 (Atlas Purchase Flow) MUST be complete before Phase 4 work begins.
The fee collection service hooks into Phase 2's payment success event.

BE work order:
  1. Models + migration (no dependencies) — includes AtlasRefund [P4-C3], AtlasPayoutSettings [P4-H1]. AtlasTaxInfo REMOVED [R2 PD-2]. AtlasFeeDistribution updated with hold_expires_at + connection_id [R2 E10, E15]. AtlasReferral updated with referral_rewards_eligible [R2 PD-1]. AtlasRewardBalance updated with cumulative_annual_usd [R2 PD-2].
  2. atlas-fee service (depends on models) — includes self-purchase check [P4-C1], currency guard [P4-H7], volume bonus cap [P4-H6], dust attack prevention [R2 E5], suspended connection check [R2 E15], 14-day hold [R2 E10], self-purchase GMV exclusion [R2 E11]
  3. atlas-referral service (depends on models + atlas-fee for milestone checks) — includes anti-fraud [P4-C2], 7-day account age gate [R2 PD-1], IP rate limiting [R2 PD-1], referral_rewards_eligible gate [R2 PD-1], triple-check referrer/attendee/space_owner [R2 E9]
  4. atlas-refund service (depends on atlas-fee) — includes AtlasRefund creation [P4-C3], atomic clawback [P4-M4], cross-month GMV [P4-M2], hold period cancellation [R2 E10]
  5. atlas-payout service (depends on models + blockchain infrastructure) — includes idempotency [P4-H3], retry logic [P4-M7], platform credit [P4-H4], Stripe Connect requirement [R2 PD-2], hold expiry integration [R2 E10]
  6. Agenda jobs (depends on payout + refund services) — includes referral pool sweep [P4-M1], payout retry [P4-M7], hold expiry [R2 E10], wash trading report [R2 E12], atlas-process-fee [R3 XP-1], atlas-fee-reconciliation [R3 XP-1]
  7. GraphQL resolvers (depends on all services) — includes payout settings mutations [P4-H1]
  8. Integration hooks into Phase 2 handlers (depends on resolvers being tested) — fire-and-forget [P4-H5], pass connectionId [R2 E15]

FE work order (can start after BE step 7):
  1. GraphQL codegen with new queries/mutations
  2. atlas-rewards.ts utility
  3. AtlasRewards component
  4. Route + menu update
```

---

## 12. Environment Configuration

Add to `lemonade-backend/src/config/index.ts`:

```typescript
export const atlasTreasuryWalletKey = env.get('ATLAS_TREASURY_WALLET_KEY').asString();
export const atlasTempoChainId = env.get('ATLAS_TEMPO_CHAIN_ID').asString();
export const atlasDiscoveryBonusMonthlyCap = env.get('ATLAS_DISCOVERY_BONUS_MONTHLY_CAP_USDC')
  .default('500000000')
  .asString();
```

Add to `.env.example`:

```
ATLAS_TREASURY_WALLET_KEY=        # Private key for Atlas treasury hot wallet (USDC payouts)
ATLAS_TEMPO_CHAIN_ID=             # Tempo chain ID string
ATLAS_DISCOVERY_BONUS_MONTHLY_CAP_USDC=500000000  # $500 in USDC micro-units
```

---

## 13. Security Considerations

1. **Treasury wallet key** — stored in AWS SSM Parameter Store, loaded via Chamber. Never committed to git. Only the payout service reads it.
2. **Atomic balance updates** — all `AtlasRewardBalance` mutations use `findOneAndUpdate`/`updateOne` with aggregation pipeline updates (`$toLong`/`$toString`) to prevent race conditions. **Raw `$inc` MUST NOT be used on string BigInt fields** — MongoDB `$inc` does not work on strings. Never read-modify-write. [AUDIT FIX P4-M4] [AUDIT FIX R3 CC-2]
3. **Transaction wrapping** — fee distribution + balance credit + GMV update wrapped in MongoDB transaction (`withTransaction`).
4. **Referral code brute force** — 8-char alphanumeric = 36^8 = ~2.8 trillion combinations. Rate-limit the `atlasApplyReferralCode` mutation.
5. **Payout authorization** — only the Agenda job (server-side) can trigger payouts. No user-facing "withdraw" mutation in Phase 4. Users see accrued balances; payouts are automatic.
6. **GraphQL authorization** — all reward queries require `@Authorized()`. Users can only query their own balances (filter by `ctx.user._id`).
7. **BigInt precision** — all USDC amounts stored as string BigInts to avoid floating-point errors. Frontend formats with `formatUsdc`. Never use `Number` for monetary calculations.
8. **Self-purchase prevention** — organizer === attendee transactions receive zero cashback (both sides). Logged as suspicious. [AUDIT FIX P4-C1]
9. **Sybil referral prevention** — IP, email domain, and wallet address checks block same-person referrals. Unique attendee counting for milestones. Manual review for payouts >$20. [AUDIT FIX P4-C2]
10. **Currency guard** — only USD/USDC payments processed for Atlas fees. Non-matching currencies gracefully skipped. [AUDIT FIX P4-H7]
11. **Payout idempotency** — unique compound index on `{period_start, period_end}` prevents duplicate payout batches from concurrent job executions. [AUDIT FIX P4-H3]
12. **Payment flow isolation** — Atlas fee processing is fire-and-forget (not awaited in payment success path). Fee failures cannot break purchases. [AUDIT FIX P4-H5]
13. **Tax compliance via Stripe Connect** — Stripe Connect handles W-9/W-8BEN, KYC, and 1099-K filing. Stripe Connect is REQUIRED for any payout. `cumulative_annual_usd` tracked on `AtlasRewardBalance` for internal records only. [AUDIT FIX R2 PD-2]
14. **14-day reward hold** — all rewards start as `pending_hold` and transition to `available` after 14 days. Refunds during hold cancel the reward (no clawback needed). Refunds after payout use existing clawback logic. This prevents cashback-then-refund timing attacks. [AUDIT FIX R2 E10]
15. **Dust attack prevention** — transactions with ticket price < $1.00 (was $0.50) do not create individual reward records. Protocol fee still collected but goes to consolidated `AtlasDustPool` for monthly treasury sweep. Tickets $0.50-$1.00 are valid purchases but too small for individual reward tracking. [AUDIT FIX R2 E5] [AUDIT FIX R3 M-2]
16. **Referral fee laundering prevention** — referral rewards require purchase from a DIFFERENT user than the referrer AND the Space owner. Triple-check: `referrer !== attendee !== space_owner`. [AUDIT FIX R2 E9]
17. **Volume tier on settled GMV only** — volume tiers calculated on transactions past the 14-day hold, not pending. Self-purchases excluded from GMV aggregation entirely. [AUDIT FIX R2 E11]
18. **Wash trading heuristics** — monthly automated report flags Spaces where >80% of revenue comes from a single buyer. Manual review, not automatic blocking (too many false positives). Known limitation: cross-organizer collusion is hard to detect without ML. [AUDIT FIX R2 E12]
19. **Referral anti-fraud gates** — min 7-day account age for code creation, min 1 published event with 1 non-self attendee for reward eligibility, max 3 code applications per hour per IP. [AUDIT FIX R2 PD-1]
20. **Suspended connection reward blocking** — rewards only accrue for events on ACTIVE connections. Suspended connections (including tier downgrades) generate no rewards. [AUDIT FIX R2 E15]
21. **Guaranteed fee processing** — Atlas fee processing uses Agenda jobs with automatic retry instead of fire-and-forget `.catch()`. Daily reconciliation job catches any payments that fell through all retries. No money lost on transient failures. [AUDIT FIX R3 XP-1]
22. **Maximum unredeemed balance** — users without active Stripe Connect have a $500 cap on unredeemed rewards. Rewards above cap are redirected to treasury. Cap removed once Stripe Connect is active. Prevents indefinite liability accumulation. [AUDIT FIX R3 PD2-3]
23. **Per-organizer negative balance cap** — organizers with negative balance exceeding $1000 have new reward accrual blocked until balance recovers. Limits treasury exposure from long-horizon post-withdrawal refunds. [AUDIT FIX R3 F-3]
24. **Hold-expiry transactional safety** — per-record processing in the hold-expiry job is wrapped in `withTransaction` to prevent partial updates if the job crashes between status transition and balance update. [AUDIT FIX R3 CC-4]
