# DOCUMENTATION.md

## 1. Overview

The Payment and Subscription Slice is a test-mode subscription system: one paid
plan (MONTHLY / YEARLY) sold behind a signed-in shell, with Flutterwave as the
payment provider. The thing being sold is a plan flag on a user record — there
is no real product behind the paywall.

**Stack:** Next.js (App Router, Turbopack) / TypeScript / Prisma 6 / PostgreSQL 16
**Payment provider:** Flutterwave, SDK-free, server-side REST only (test mode)
**Auth:** reused from Assessment 1 (the AuthSlice) — signup, verify, signin,
sessions, password reset. Stated here explicitly per the PRD: reuse is outside
the payment slice and was carried over rather than rebuilt.

## 2. Running locally

1. `docker compose up -d` — starts Postgres 16 (`paymentandsubscriptionslice-postgres`).
2. `cp .env.example .env` and fill `DATABASE_URL` (plus Flutterwave test keys,
   optional `SMTP_*`).
3. `npx prisma migrate dev` — applies migrations.
4. `npm run dev`.

Environment keys the code reads: `DATABASE_URL`, `APP_URL`,
`FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_PUBLIC_KEY`, `FLUTTERWAVE_WEBHOOK_SECRET`,
and optionally `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` /
`SMTP_PASS` / `SMTP_FROM`. Without SMTP credentials, verification emails fall
back to Ethereal (unreachable on the dev network — see `problems.md`), so
verification codes are read from the `verification_codes` table instead.

## 3. Data model

The schema in `Docs/PRD.md` is locked. It decomposes to:

- `users` — user record with a plan-equivalent of nothing (subscription is 1:1).
- `sessions`, `verification_codes`, `password_reset_tokens` — the reused auth layer.
- `subscriptions` — one row per user (`userId @unique`). Holds `plan`,
  `status`, `currentPeriodEnd`, `cancelAtPeriodEnd`, `pendingDowngradeTo`,
  `cancellationReason`.
- `payment_log` (`PaymentEvent`) — append-only event history for every payment
  step, keyed for idempotency on `@@unique([providerReference, eventType])`.

## 4. Payment lifecycle

A payment moves through exactly three server-side-verified stages, each its own
`payment_log` row:

- **INITIATED** — checkout start: tx_ref generated, amount (possibly prorated)
  stored, Flutterwave hosting link returned. No entitlement yet.
- **VERIFIED** — after the customer returns from Flutterwave (or a webhook
  arrives), the transaction is re-checked against
  `GET /transactions/:id/verify` with the secret key. Only a `successful`
  verification proceeds. A `FAILED` event is logged for non-successful statuses.
- **FULFILLED** — the subscription row is updated (plan, `currentPeriodEnd`) and
  the final event is appended.

Entitlement is granted **only** after VERIFIED — never on the strength of a
frontend claim or a redirect alone. Visiting the return URL directly without a
valid `transaction_id` shows an error and grants nothing.

## 5. Concepts

### 5.1 Money is stored in minor units — never a decimal

All amounts are integers in the smallest currency unit (kobo for NGN), with the
currency string stored alongside (`amountMinor Int`, `currency String`).
Decimal types introduce floating-point rounding; integers do not. The boundary
converts to major units (naira) only when calling Flutterwave.

### 5.2 The payment lifecycle is three separate things

Initiation ≠ verification ≠ fulfilment. Initiation is a promise, verification is
the proof, fulfilment is the consequence. Treating them as one step is how
false-succeess / double-grant bugs happen.

### 5.3 The payment log — what it proves in a dispute

`payment_log` is append-only by convention: one row per stage of one
transaction, never updated in place. In a dispute it shows *what actually
happened*: money asked, money proved, plan granted, at what timestamps — not a
mutable snapshot of the current state.

### 5.4 Idempotency in payments

The unique index `@@unique([providerReference, eventType])` is the guarantee: a
repeated webhook insert of the same provider reference + event type fails on the
second insert, and the handler treats that as "already processed", not an error.
Observed live: a payment whose return page verified twice — the duplicate
VERIFIED insert was rejected, fulfillment happened once, and the handler still
returned success.

### 5.5 Webhook signature verification

Flutterwave sends every webhook with a `verif-hash` header. The handler compares
it against `FLUTTERWAVE_WEBHOOK_SECRET` before any processing
(`app/api/webhook/flutterwave/route.ts`); a mismatch is rejected with 401. The
secret is self-assigned in the Flutterwave dashboard (Settings → API →
Webhooks → Secret Hash) and must match `.env`.

### 5.6 Proration

Formula (`lib/proration.ts`):

```
daysRemaining  = floor((currentPeriodEnd − now) / 1 day)
dailyRate      = currentPlanAmount / currentPlanIntervalDays
credit         = floor(dailyRate × daysRemaining)
netCharge      = max(0, newPlanAmount − credit)
```

Real example (observed during the walkthrough): a user upgraded MONTHLY → YEARLY
mid-cycle. MONTHLY = ₦5,000/30 days, YEARLY = ₦48,000. With credit for the
unused portion of the month, the charge was **₦43,000** (= 4,800,000 − 500,000
kobo), i.e. a ₦5,000 credit applied. The INITIATED event recorded the prorated
amount, and the VERIFIED/FULFILLED events matched the paid amount.

Proration is applied only for upgrades (FREE exists to gate). Downgrades are
deferred, not prorated — see 5.8.

### 5.7 Cancellation and period-end access

Cancelling sets `cancelAtPeriodEnd = true` and keeps the row as-is: paid-for
access is never revoked early. The record still says what it says until
`currentPeriodEnd` says otherwise.

### 5.8 Lazy evaluation of deferred plan changes — a deliberate choice

Acceptance criterion "a user can downgrade, with the change applied at the end
of the current period" is implemented with **lazy evaluation, not a scheduler**:
`applyDuePlanChanges` runs inside `getOrCreateSubscription` (and at the start of
the cancel / reactivate service functions), so whenever a request touches a
user's subscription state, the row is brought up to date first:

- period ended **and** `cancelAtPeriodEnd` → plan becomes `FREE`, flags cleared,
  `currentPeriodEnd` reset to null;
- period ended **and** `pendingDowngradeTo` set → plan becomes that plan, field
  cleared, `currentPeriodEnd` reset to null.

This is a documented scope choice, not a shortcut. **Why not a scheduler:**
there is no cron / Vercel Cron / Trigger.dev / external worker in the slice, and
adding standing infrastructure was out of scope for a single-slice assessment.
**Tradeoff:** the flip runs on the user's *next* activity, not at the exact
moment the period ends. For a plan flag with no real product behind it, that
window is acceptable — the only state briefly wrong is a display one, and any
read (billing page, plans page, plan-change or checkout call) reconciles it
before returning. The function is idempotent, so repeated evaluations are no-ops.

### 5.9 Cards are never stored

Card details never touch this system: Flutterwave's hosted checkout collects
them, and this codebase only ever holds tx_refs, provider references, amounts,
and idempotency keys — keeping the slice out of PCI scope.

### 5.10 Rate limiting on payment endpoints

Checkout initiation is rate limited (per-IP, `lib/rate-limit.ts`) to blunt
payment-endpoint abuse; the same helper guards the auth routes reused from
Assessment 1.

## 6. Evidence (live, against real Postgres)

- Subscription record before/after upgrade: MONTHLY → YEARLY, `currentPeriodEnd`
  moved +365 days after a prorated ₦43,000 payment.
- Payment log for one complete transaction: INITIATED → VERIFIED → FULFILLED,
  each its own row with timestamps and the same tx_ref / provider reference.
- Proration with real numbers: see 5.6.
- Duplicate verification: the second VERIFIED insert was rejected by the unique
  constraint and handled as `alreadyProcessed` — no double grant.
- Cancelled subscription: `cancelAtPeriodEnd` set, access retained until the
  real period-end date.

Screenshots to be attached at submission.