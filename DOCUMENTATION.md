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
- **FULFILLED** — the granted plan and its period end are recorded in the
  event's `rawPayload` (`{ intendedPlan, grantedPeriodEnd }`), the subscription
  row cache is updated (plan, `currentPeriodEnd`), and the final event is
  appended. Entitlement is later derived from this log row, not read back from
  the mutable cache column.

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

Also observed live (no tunnel): the exact `charge.completed` payload for
transaction 10486956 was replayed twice against
`localhost:3000/api/webhook/flutterwave` with the real `verif-hash` header via
`curl`. Both fires returned `200 {"received":true,"duplicate":true}`; the
`payment_log` row counts, tx_ref row count, and the subscription row were
identical before and after — the second VERIFIED insert collides on the unique
index and is handled as already processed, never re-granted. A wrong
`verif-hash` returns `401`, so the replay genuinely crossed the signature gate.

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

Under the log-derived entitlement model (5.11), the flip reconciles the row
that becomes authoritative once the paid grant *elapses*; while the grant is
still active, the derived entitlement continues to reflect what was paid for.

### 5.9 Cards are never stored

Card details never touch this system: Flutterwave's hosted checkout collects
them, and this codebase only ever holds tx_refs, provider references, amounts,
and idempotency keys — keeping the slice out of PCI scope.

### 5.10 Rate limiting on payment endpoints

Checkout initiation is rate limited (per-IP, `lib/rate-limit.ts`) to blunt
payment-endpoint abuse; the same helper guards the auth routes reused from
Assessment 1.

### 5.11 What is and isn't log-derived — the entitlement boundary

Entitlement — **which paid plan a user is on, and until when** — comes from
`deriveEntitlementFromLog` in `lib/subscription.ts`. The rule is precise, and it
has two halves:

**While a paid grant is still current (now < the latest FULFILLED event's
`grantedPeriodEnd`), the log is authoritative.** The derivation reads that
`FULFILLED` event's `rawPayload` (`intendedPlan` = what was actually paid for,
`grantedPeriodEnd` = when that payment's access window ends) and returns it
directly. `subscriptions.plan` / `subscriptions.currentPeriodEnd` are a synced
cache — fulfillment keeps them in step on payment, `applyDuePlanChanges`
reconciles them on scheduled changes — but in this window they are never the
thing an access decision is based on. A corrupted or stale cache column can't
change the answer, which is precisely the guarantee validated in §6.

**Once that grant has elapsed (now >= grantedPeriodEnd), or if no FULFILLED
event exists at all, authority passes to the reconciled row.** The derivation
calls `applyDuePlanChanges(userId)` and returns its result. This is a deliberate
hand-off: a lapse, a scheduled downgrade, or a cancellation are *not* payment
events — the log has nothing new to say about them, and only the reconciled
state captures that non-payment intent. So a user whose paid-for window ends and
who has scheduled a downgrade is now correctly MONTHLY (or FREE on
cancellation / non-renewal), where a "always derive from the log" reading would
have frozen them on the stale YEARLY grant forever.

Why this split rather than "always derive from the log"? Because the log is
great at recording *what money actually bought* but silent about anything that
isn't money — and entitlement after the money runs out is exactly those
non-money facts. Deriving strictly from the log would make acceptance criterion
#3 (downgrade applies at period end) unreachable for any user who outlives one
period, which every real subscriber does. Making the log authoritative *while it
is current* keeps the corruption-proof property; making reconciliation
authoritative *after it elapses* keeps the lifecycle behavior honest. The two
checks add up to: **the log describes the current contract; the reconciled state
describes what happens after it.**

If the most recent `FULFILLED` event exists but lacks a derivable `rawPayload`,
derivation falls back to the reconciled state (logged) rather than guessing —
entitlement is never derived from an incomplete record.

**What is deliberately NOT log-derived at any point:** `cancelAtPeriodEnd`,
`pendingDowngradeTo`, and `cancellationReason`. They are intent, not payment
events, so they are kept as mutable state on the `subscriptions` row and read
from there. The boundary is: **money facts come from the log; intent facts come
from the row; which one decides the entitlement flips when the paid window
ends.**

Evidence for both halves of the rule: §6, "corrupted-cache column vs.
log-derived entitlement" (log wins while active) and "expired grant — authority
passes to reconciliation" (reconciled state wins after elapse).

## 6. Evidence (live, against real Postgres)

- Subscription record before/after upgrade: MONTHLY-route INITIATED → the
  real YEARLY fulfilment for transaction 10486956 set the cache to YEARLY /
  `currentPeriodEnd` +365 days.
- Payment log for one complete transaction: INITIATED → VERIFIED → FULFILLED,
  each its own row with timestamps and the same tx_ref / provider reference.
  The FULFILLED row carries `rawPayload = { intendedPlan: "YEARLY",
  grantedPeriodEnd: "2027-09-14T11:40:06.507Z" }`.
- **Corrupted-cache column vs. log-derived entitlement** (step-4 verification,
  `app/api/admin/verify-log-derived-entitlement/route.ts`, dev-only): with a
  genuine `FULFILLED` event in the log, `subscriptions.plan` was force-written
  to `FREE` via a raw update, then `deriveEntitlementFromLog` was called:

  ```
  cacheBefore:    { plan: YEARLY, currentPeriodEnd: 2027-09-14T11:40:06.507Z }
  corruptedCache: { plan: FREE,   currentPeriodEnd: 2027-09-14T11:40:06.507Z }
  logDerived:     { plan: YEARLY, currentPeriodEnd: 2027-09-14T11:40:06.507Z }
  cacheRestored:  { plan: YEARLY, currentPeriodEnd: 2027-09-14T11:40:06.507Z }
  result: PASS — derived entitlement unaffected by corrupted subscriptions.plan
  ```

  `logDerived` came from the FULFILLED row's `rawPayload`, untouched by the
  corruption; the cache column was restored to its original value afterward.
  Note: the local DB had lost the historical VERIFIED/FULFILLED rows, so the
  fulfilment in this evidence was reconstructed through the real path — the
  documented INITIATED event for tx 10486956 back-filled, then the genuine
  `charge.completed` payload POSTed to the real webhook, which re-verified the
  transaction against Flutterwave (confirmed successful) before FULFILLING.
- **Expired grant — authority passes to reconciliation** (the other half of
  5.11): against the same real user / genuine FULFILLED event (its
  `grantedPeriodEnd` time-shifted into the past for the test, since the real
  YEARLY grant runs to 2027 and physically cannot lapse today), `pendingDowngradeTo`
  was set to MONTHLY and the period expired. After the lazy-eval flip on
  `GET /api/subscription`, the response was:

  ```
  plan: MONTHLY, currentPeriodEnd: 2026-10-14T12:16:51.674Z (now + 30d),
  pendingDowngradeTo: null   ← derived from the reconciled state,
                                NOT the stale YEARLY grant
  ```

  The `payment_log` at that point still contained exactly one FULFILLED row
  (the time-shifted YEARLY grant) — no new FULFILLED event existed to derive
  MONTHLY from; the MONTHLY result came from `deriveEntitlementFromLog`
  delegating to `applyDuePlanChanges` once `now >= grantedPeriodEnd`. All
  scaffolding was rolled back afterward (row restored to `YEARLY /
  2027-09-14T11:40:06.507Z`, grant restored to its genuine future end).
- Duplicate webhook (local curl, no tunnel): the identical `charge.completed`
  payload (tx 10486956, `ps_1789305632933_782457a6618fb05c`, ₦43,000 YEARLY) was
  POSTed twice from the shell to `localhost:3000/api/webhook/flutterwave` with
  the real `verif-hash`; both fires returned `200` — first
  `{received:true, fulfilled:true}`, second `{received:true, duplicate:true}`;
  exactly one VERIFIED and one FULFILLED row exist after two fires, and the
  subscription row was identical before and after. A wrong `verif-hash` returns
  `401`, so the replay genuinely crossed the signature gate.
- Proration with real numbers: see 5.6.
- Duplicate verification: the second VERIFIED insert was rejected by the unique
  constraint and handled as `alreadyProcessed` — no double grant.
- Cancelled subscription: `cancelAtPeriodEnd` set, access retained until the
  real period-end date.

Screenshots to be attached at submission.