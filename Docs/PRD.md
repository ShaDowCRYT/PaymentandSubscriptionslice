# PRD — Assessment 2: The Payment and Subscription Slice

## Overview

A working subscription system in test mode, with one paid plan sold on two intervals: monthly and yearly. This is a single slice — not an application. The thing being sold is a plan flag on a user record and nothing more.

**Stack:** Next.js / TypeScript / Prisma / PostgreSQL
**Payment provider:** Flutterwave (test mode)
**Time budget:** 20–26 hours — the largest of the four assessments
**Deadline:** Wednesday, 17 September 2026

## Screens (exactly these, nothing more)

1. Plans view — free / monthly / yearly, current plan indicated
2. Checkout initiation — hands off to Flutterwave
3. Return view — where the user lands after paying
4. Billing view — plan, status, renewal date, cancel control
5. A minimal signed-in shell to hang these on

You may reuse the authentication slice from Assessment 1 to get a signed-in user. This must be stated explicitly in `DOCUMENTATION.md` if done — reuse is not a problem, hiding it is.

## User Behaviour (acceptance criteria)

- [ ] A user can subscribe to monthly
- [ ] A user can upgrade from monthly to yearly mid-cycle, and the amount charged is prorated
- [ ] A user can downgrade, with the change applied at the end of the current period
- [ ] A user can cancel, and keeps access until the period they paid for ends
- [ ] Every payment event is recorded — not just the current status

## Explicitly Out of Scope — do not build

- No landing page
- No pricing/marketing page
- No product features behind the paywall — the paywall gates a flag on the user record, not real functionality

## Engineering Requirements (all must be present and documented)

1. Money stored as whole numbers in minor units (kobo for NGN), with the currency stored alongside — never a decimal
2. A payment log table recording every event separately: initiation, verification, fulfilment, failure
3. Server-side verification before any entitlement is granted — never on the strength of a frontend claim or a redirect alone
4. Webhook handling with signature verification (Flutterwave's `verif-hash` header) before any processing
5. Idempotency keyed on the provider reference, so a repeated webhook is recorded once and acted on once
6. Proration on a mid-cycle interval change, calculated and shown
7. Cancellation that retains access to the end of the paid period, with a confirmation step
8. A cancellation reason column, populated from an optional post-cancellation prompt
9. Rate limiting on the checkout initiation endpoint
10. Error handling that never leaves a user on a blank page or a 404, at any point in the payment path
11. No card details stored anywhere in this system — Flutterwave handles that; this system never touches it

## Data Model (Locked)

This is the schema. Do not add, remove, or rename tables or fields, and do not change a constraint, without flagging it first.

```prisma
enum PlanType {
  FREE
  MONTHLY
  YEARLY
}

enum SubscriptionStatus {
  ACTIVE
  PAST_DUE
  CANCELED
}

enum PaymentEventType {
  INITIATED
  VERIFIED
  FULFILLED
  FAILED
}

model Subscription {
  id                 String             @id @default(cuid())
  userId             String             @unique
  user               User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  plan               PlanType           @default(FREE)
  status             SubscriptionStatus @default(ACTIVE)
  flutterwavePlanId  String?
  currentPeriodEnd   DateTime?
  cancelAtPeriodEnd  Boolean            @default(false)
  pendingDowngradeTo PlanType?
  cancellationReason String?
  createdAt          DateTime           @default(now())
  updatedAt          DateTime           @updatedAt

  paymentEvents      PaymentEvent[]

  @@map("subscriptions")
}

model PaymentEvent {
  id                 String            @id @default(cuid())
  userId             String
  user               User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  subscriptionId     String?
  subscription       Subscription?     @relation(fields: [subscriptionId], references: [id], onDelete: SetNull)
  eventType          PaymentEventType
  txRef              String
  providerReference  String?
  amountMinor        Int
  currency           String
  rawPayload         Json?
  createdAt          DateTime          @default(now())

  @@unique([providerReference, eventType])
  @@index([userId])
  @@index([txRef])
  @@map("payment_log")
}
```

**Why each locked constraint is what it is:**

- `amountMinor Int` + `currency String`, never a decimal type — the entire reason money bugs happen is floating-point rounding; an integer in the smallest unit (kobo) has no fractional part to round incorrectly.
- `PaymentEvent` is append-only in practice (enforced by convention, not a DB trigger) — one row per stage of one transaction, never updated in place. This is what makes it useful in a dispute: it's a history, not a snapshot.
- `@@unique([providerReference, eventType])` on `PaymentEvent` — the actual idempotency guarantee. A webhook retry with the same provider reference and event type fails the constraint on the second insert; the handler treats that as "already processed," not an error.
- `Subscription.userId @unique` — one subscription record per user; simplifies "current plan" to a single lookup rather than a most-recent-of-many query.
- `cancelAtPeriodEnd` + `currentPeriodEnd` together, rather than deleting or immediately downgrading on cancel — this is what makes "keep access until the period ends" possible to enforce: the record still says what it says until the date says otherwise.
- `pendingDowngradeTo` — holds the deferred plan change separately from the current `plan`, so a downgrade can be scheduled without touching what's actually active right now.
- `subscriptionId` on `PaymentEvent` is nullable with `onDelete: SetNull` — a payment event should be able to outlive the subscription record it was originally tied to, for audit purposes.

The agent implements types, indexes beyond what's shown, and migration details against this shape — it does not redesign the shape itself. If a requirement seems to need a field or table not listed here, stop and flag it before adding one.

## Concepts to Document (Section 5 of DOCUMENTATION.md)

- Minor units, and why money is never a decimal
- The payment lifecycle: initiation, verification, fulfilment — and why they're three separate things, not one
- The payment log, and what it would prove in a dispute
- Idempotency in payments specifically
- Webhook signature verification
- Proration, including the actual calculation shown with real numbers
- Cancellation and period-end access, including the reasoning (paid-for access isn't revoked early)
- Why cards are never stored — name PCI scope specifically
- Rate limiting on payment endpoints

## Required Evidence (for DOCUMENTATION.md)

- Screenshot of the subscription record before and after an upgrade — interval changed, period end moved
- Screenshot of the payment log for one complete transaction, each stage as its own row with timestamps
- The proration calculation written out with real numbers: days remaining, credit applied, amount charged, and the resulting log entries
- Evidence of firing the same webhook twice — the second one recorded and ignored, not double-processed
- Screenshot of a cancelled subscription showing access retained and the real period-end date

## Grading Bands (self-check before submission)

**Pass:** subscribe, upgrade with proration, downgrade, and cancel all work; the payment log records every stage; entitlement is granted only after server-side verification; database evidence provided for each.

**Excellent:** the payment log is append-only and entitlement is derived from it rather than stored-and-mutated; the duplicate-payment case is tested and handled (paying twice for an active plan extends correctly or is rejected, never silently absorbed); the proration calculation is correct to the day and shown.

## Known Traps (avoid these)

- Storing amounts as decimals
- Granting the subscription the moment a user lands on the success/return URL — visiting that URL directly must not itself grant anything
- Cancelling with an immediate cutoff after payment was already taken for the full period
- Skipping the payment log because the subscription table already shows a status — the status is the present; the log is the history, and the history is what a dispute needs
- Testing only the happy path and never actually firing a duplicate webhook
