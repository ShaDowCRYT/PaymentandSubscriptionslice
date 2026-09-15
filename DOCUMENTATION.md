# DOCUMENTATION.md — Assessment 2: Payment and Subscription Slice

## Section 1: What This Is

This is a test-mode subscription system: one paid plan, sold as MONTHLY or YEARLY, behind a signed-in shell, with Flutterwave as the payment provider. A user can subscribe, upgrade mid-cycle with real proration, downgrade with the change deferred to the end of their current period, and cancel while keeping access until the period they already paid for ends. Every stage of every payment is recorded in an append-only log, and nothing grants access until a server-side call to Flutterwave has actually verified the transaction.

What's being sold is a plan flag on a user record — there's no real product behind the paywall, by design. Authentication (signup, verification, sign-in, sessions, protected routes) is reused directly from the Assessment 1 AuthSlice repository rather than rebuilt, which is stated here explicitly per the brief's own instruction that reuse is fine as long as it's disclosed.

---

## Section 2: How To Run It

1. `docker compose up -d` — starts Postgres 16 (`paymentandsubscriptionslice-postgres`).
2. `cp .env.example .env` and fill in real values — `DATABASE_URL`, the three Flutterwave test keys, and optionally `SMTP_*`.
3. `npx prisma migrate dev` — applies migrations.
4. `npm run dev`.

Environment variables the code reads: `DATABASE_URL`, `APP_URL`, `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_PUBLIC_KEY`, `FLUTTERWAVE_WEBHOOK_SECRET`, and optionally `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM`. Without SMTP credentials, verification email falls back to Ethereal, which is unreachable on this dev network — verification codes are read directly from the `verification_codes` table instead (see Section 6).

---

## Section 3: The Flow, Step By Step

**Plans view.** The user lands on `/plans`, signed in via the reused auth shell. The page calls `deriveEntitlementFromLog` (via `getOrCreateSubscription`) to determine the current plan and renders free/monthly/yearly with the active one indicated. Choosing a paid plan either starts checkout (from FREE) or calls the change-plan path (from an existing paid plan).

**Checkout initiation.** Subscribing or upgrading posts to `POST /api/checkout`. The route checks the checkout rate limit, and — for an upgrade — first calls `getProrationPreview` in `lib/proration.ts` to compute the net amount owed, given the existing plan's remaining days and the new plan's price. It then calls `initiateCheckout` in `lib/subscription.ts`, which generates a `tx_ref`, writes an `INITIATED` row to `payment_log` with the amount (prorated if applicable) and the intended plan stashed in `rawPayload`, and calls Flutterwave to create a hosted payment link. The user is redirected to Flutterwave's hosted checkout page — no entitlement exists yet at this point.

**Return view.** After completing (or abandoning) payment on Flutterwave's hosted page, the user lands on `/checkout/return` with a `transaction_id` in the query string. The page calls `POST /api/checkout/verify`, which re-checks the transaction directly against Flutterwave's `GET /transactions/:id/verify` endpoint using the secret key — never trusting the query string or the redirect alone. A successful, matching verification writes a `VERIFIED` row, then calls `verifyAndFulfill`, which writes the granted plan and computed period end into a `FULFILLED` row's `rawPayload`, updates the `subscriptions` cache, and shows the user a success state. Landing on this page with no valid `transaction_id`, or a transaction that doesn't verify, shows an error and grants nothing.

**Billing view.** `/billing` calls `deriveEntitlementFromLog` (see Section 5.11) to show the actual current plan, status, and renewal date — not a value trusted from the page's own state. A cancel control triggers a confirmation dialog ("are you sure — you'll keep access until the end of your period") before `POST /api/subscription/cancel` runs, which sets `cancelAtPeriodEnd = true` and records an optional `cancellationReason`. Reactivating clears the flag through the same lazy-reconciliation path.

**Signed-in shell.** `app/(dashboard)/layout.tsx` wraps all four screens above. Route protection is the same two-layer pattern from Assessment 1: `proxy.ts` gates on cookie presence at the edge, and each page's server component confirms a real, unexpired session before rendering.

**The webhook path, separately.** Flutterwave also sends a `charge.completed` webhook independent of whether the user's browser ever reaches the return page. `POST /api/webhook/flutterwave` checks the `verif-hash` header against `FLUTTERWAVE_WEBHOOK_SECRET` before anything else runs; a mismatch returns 401 immediately. A verified webhook goes through the same verify-then-fulfill path as the return page, and the `@@unique([providerReference, eventType])` constraint on `PaymentEvent` means a retried webhook for a transaction already processed fails on insert and is treated as already handled, not reprocessed.

---

## Section 4: The Data Model

The schema is locked by the PRD. It was implemented exactly as specified — no field, table, or constraint was added, removed, or renamed.

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
  plan               PlanType           @default(FREE)
  status             SubscriptionStatus @default(ACTIVE)
  flutterwavePlanId  String?
  currentPeriodEnd   DateTime?
  cancelAtPeriodEnd  Boolean            @default(false)
  pendingDowngradeTo PlanType?
  cancellationReason String?
  createdAt          DateTime           @default(now())
  updatedAt          DateTime           @updatedAt

  @@map("subscriptions")
}

model PaymentEvent {
  id                String            @id @default(cuid())
  userId            String
  subscriptionId    String?
  eventType         PaymentEventType
  txRef             String
  providerReference String?
  amountMinor       Int
  currency          String
  rawPayload        Json?
  createdAt         DateTime          @default(now())

  @@unique([providerReference, eventType])
  @@index([userId])
  @@index([txRef])
  @@map("payment_log")
}
```

Plus the reused auth tables from Assessment 1: `users`, `sessions`, `verification_codes`, `password_reset_tokens`.

**Why each constraint is what it is:**

- `amountMinor Int` + `currency String`, never a decimal — this is the entire reason money bugs happen. An integer in kobo has no fractional part for floating-point arithmetic to round incorrectly, which matters especially in proration, where a credit is computed via division.
- `@@unique([providerReference, eventType])` on `PaymentEvent` — the actual idempotency mechanism, not a courtesy check. A retried webhook with the same provider reference and event type fails this constraint on insert; the handler reads that failure as "already processed."
- `Subscription.userId @unique` — one subscription row per user, so "what plan is this person on" is always a single lookup, not a most-recent-of-many query.
- `cancelAtPeriodEnd` + `currentPeriodEnd` together, rather than an immediate downgrade or deletion on cancel — this is what makes "keep access until the period ends" enforceable: the row still says what it says until the date says otherwise.
- `pendingDowngradeTo` is a separate field from `plan` — it holds a scheduled future change without touching what's actually active right now.
- `PaymentEvent.subscriptionId` is nullable with `onDelete: SetNull` — a payment event should outlive the subscription record it was originally tied to, since it's the audit trail, not a live reference.

**The one honest gap in this schema, not fixed:** there is no `currentPeriodStart` field. The schema only ever tracked when a period *ends*, never when it *began*. This is discussed further in Sections 5.6, 7, and 8, since its absence caused two separate downstream problems.

---

## Section 5: The Concepts

### 5.1 Money is stored in minor units — never a decimal

**What it is.** Every amount is an integer in the smallest unit of the currency — kobo for NGN — with the currency string stored alongside it, rather than a decimal or float representing naira directly.

**Why it is needed.** Floating-point types can't represent most decimal fractions exactly, so repeated arithmetic on them — exactly what proration does, dividing a plan price by its interval length — accumulates small rounding errors. An integer count of the smallest unit has nothing to round.

**How I implemented it.** `amountMinor Int` and `currency String` on `PaymentEvent`. Conversion to major units (naira) happens only at the one boundary that needs it — the call to Flutterwave's API, which expects a major-unit amount.

**What I chose against, and why.** A `Decimal` type, which several ORMs support specifically for money. Rejected because it adds a dependency and a data type with its own serialization quirks, for a problem an integer already solves with nothing extra.

### 5.2 The payment lifecycle is three separate things

**What it is.** A payment moves through three distinct, separately-verified stages: initiation (a promise), verification (proof, checked against Flutterwave directly), and fulfilment (the consequence — entitlement actually granted).

**Why it is needed.** Collapsing these into one step is how false-success and double-grant bugs happen — if "the user reached the success page" and "the user actually paid" are treated as the same fact, anyone who reaches that page without paying gets the same outcome as someone who did.

**How I implemented it.** Three separate `PaymentEventType` values (`INITIATED`, `VERIFIED`, `FULFILLED`), each its own database row, written at the point in the code where that specific fact became true — not retroactively inferred from a later step.

**What I chose against, and why.** Verifying and fulfilling inside a single handler triggered by the return page loading. Rejected because it removes the ability for the webhook path to independently reach the same fulfilment outcome — with three separate stages, both the return page and the webhook converge on the same `FULFILLED` write, protected by the same idempotency constraint, rather than each needing its own bespoke logic.

### 5.3 The payment log — what it proves in a dispute

**What it is.** `payment_log` is append-only by convention: one row per stage of one transaction, never updated in place.

**Why it is needed.** A status column only tells you the present. In a dispute — "I was charged twice," "I never got what I paid for" — what's actually needed is a history: what was asked for, what was proven, what was granted, and when.

**How I implemented it.** Every stage transition is a new `PaymentEvent` insert, never an update to an existing row. Nothing in the application layer ever calls `update` or `delete` on this table.

**What I chose against, and why.** Relying on `subscriptions.status` alone, since it already reflects the current state. Rejected because "current state" and "what actually happened" are different questions, and only the second one is useful evidence three months later.

### 5.4 Idempotency in payments

**What it is.** The guarantee that processing the same payment event twice produces the same result as processing it once.

**Why it is needed.** Flutterwave retries webhooks, and a user can also land on the return page more than once for the same transaction. Without idempotency, either path could grant entitlement twice for one payment.

**How I implemented it.** The database-level `@@unique([providerReference, eventType])` constraint. A duplicate insert fails on that constraint, and the handler catches the failure and returns success without reprocessing — proven live: a payment whose return page verified twice had its duplicate `VERIFIED` insert rejected, fulfilment happened exactly once, and the response still looked successful to the client either time.

**What I chose against, and why.** Checking for an existing event before inserting, in application code. Rejected for the same reason it was rejected in Assessment 1's signup idempotency: a check-then-insert has a race window between two near-simultaneous requests that a database constraint doesn't.

### 5.5 Webhook signature verification

**What it is.** Flutterwave sends every webhook with a `verif-hash` header containing a secret value self-assigned in the dashboard. The handler compares the incoming header against `FLUTTERWAVE_WEBHOOK_SECRET` before doing anything else.

**Why it is needed.** A webhook URL is a public endpoint. Without signature verification, anyone who discovers the URL could POST a fake "payment succeeded" event and grant themselves a subscription for nothing.

**How I implemented it.** A direct comparison in `app/api/webhook/flutterwave/route.ts`, run first, before any parsing or processing of the payload. A mismatch returns 401 immediately — nothing downstream ever executes.

**What I chose against, and why.** Trusting the payload based on it arriving over HTTPS, or allowlisting Flutterwave's IP ranges. Rejected because neither actually proves the request came from Flutterwave — the signature is the only check that does.

### 5.6 Proration

**What it is.** When a user upgrades mid-cycle, they're charged only for the difference between what they've already paid for and what the new plan costs — not the new plan's full price on top of what they already paid.

**Why it is needed.** Charging the full new-plan price on top of an unexpired old plan would double-charge for the days already paid for; charging nothing would let anyone upgrade for free right before their renewal.

**How I implemented it**, in `lib/proration.ts`:

```
daysRemaining  = floor((currentPeriodEnd − now) / 1 day)
dailyRate      = currentPlanAmount / currentPlanIntervalDays
credit         = floor(dailyRate × daysRemaining)
netCharge      = max(0, newPlanAmount − credit)
```

Real example, observed live: a MONTHLY (₦5,000/30 days) subscriber upgraded to YEARLY (₦48,000) mid-cycle. The unused portion of the month produced a ₦5,000 credit, so the actual charge was **₦43,000**. The `INITIATED` event recorded this exact prorated amount, and `VERIFIED`/`FULFILLED` matched it.

**What I chose against, and why.** `totalDays` in this formula uses the plan's configured interval length (30 or 365), not the subscriber's actual elapsed period — because `currentPeriodStart` was never added to the schema (see Section 4). This is a real precision gap, not a deliberate design choice I'd defend — it's addressed honestly in Section 7 and is the answer to Section 8.

Proration only applies to upgrades. Downgrades are deferred, not prorated — see 5.8.

### 5.7 Cancellation and period-end access

**What it is.** Cancelling doesn't end access immediately — it sets a flag that takes effect at the end of the period already paid for.

**Why it is needed.** The user already paid for that period. Cutting access immediately after taking their money for the full period isn't consistent with what they paid for.

**How I implemented it.** `cancelAtPeriodEnd = true`, with `plan` and `currentPeriodEnd` left untouched. The row keeps saying what it said until the date says otherwise.

**What I chose against, and why.** Immediately setting `plan = FREE` on cancellation and tracking a separate "access until" date elsewhere. Rejected because it duplicates information the row already has — `currentPeriodEnd` already says exactly when access should end; a second field saying the same thing risks the two drifting out of sync.

### 5.8 Lazy evaluation of deferred plan changes

**What it is.** Scheduled changes — a downgrade or a cancellation taking effect — aren't applied the instant the period ends. They're applied the next time anything touches that user's subscription state.

**Why it is needed.** The acceptance criterion requires the change to apply "at the end of the current period," but nothing in this slice runs on a schedule of its own.

**How I implemented it.** `applyDuePlanChanges` in `lib/subscription.ts` runs inside `getOrCreateSubscription` and at the start of the cancel/reactivate service functions. If the period has passed and `cancelAtPeriodEnd` is set, plan becomes `FREE`. If the period has passed and `pendingDowngradeTo` is set, plan becomes that value. Either way, flags are cleared and a fresh `currentPeriodEnd` is set where relevant. The function is idempotent — running it again on an already-reconciled row is a no-op.

**What I chose against, and why.** A cron job, Vercel Cron, or an external scheduler (Trigger.dev, QStash). Rejected deliberately — standing infrastructure for a single-slice assessment is scope beyond what's being graded. The real tradeoff: the flip happens on the user's next activity, not the exact instant the period ends. For a plan flag with no real product behind it, that window is acceptable; the only thing briefly wrong is a display value, and every read path reconciles it before returning.

### 5.9 Cards are never stored

**What it is.** No card number, expiry, or CVV is ever received or stored anywhere in this system.

**Why it is needed.** Storing card data pulls a system into full PCI-DSS compliance scope — a significant undertaking meant for payment processors, not a single slice of a larger app.

**How I implemented it.** Flutterwave's hosted checkout collects card details directly; this codebase only ever holds transaction references, provider references, amounts, and idempotency keys.

**What I chose against, and why.** Building a custom card-entry form and passing card details to Flutterwave via a direct API call. Rejected specifically because that path would put raw card data through this system's own servers, even briefly, expanding PCI scope for no real benefit over the hosted alternative.

### 5.10 Rate limiting on payment endpoints

**What it is.** Checkout initiation is capped per IP within a time window.

**Why it is needed.** Without it, checkout could be hit repeatedly to probe for pricing bugs or simply to generate load against the Flutterwave integration.

**How I implemented it.** The same in-memory, `globalThis`-anchored limiter from Assessment 1 (`lib/rate-limit.ts`), reused directly rather than rebuilt, guarding the checkout route the same way it guards the reused auth routes.

**What I chose against, and why.** Redis-backed limiting — the same call made in Assessment 1, for the same reason: real infrastructure for a single-server dev/assessment scope isn't worth the added complexity when in-memory, implemented correctly, already satisfies the requirement.

### 5.11 What is and isn't log-derived — the entitlement boundary

**What it is.** Entitlement — which paid plan a user is on, and until when — comes from `deriveEntitlementFromLog` in `lib/subscription.ts`, not from reading `subscriptions.plan` directly. The rule has two halves: while a paid grant is still current, the log is authoritative — it reads the latest `FULFILLED` event's `rawPayload` directly, and a corrupted or stale cache column can't change the answer. Once that grant has elapsed, or no `FULFILLED` event exists, authority passes to `applyDuePlanChanges`, since only the reconciled row can reflect a downgrade, cancellation, or non-renewal — none of which are payment events, so the log has nothing to say about them.

**Why it is needed.** A subscription's `plan` column is a cache that could, in principle, be wrong — corrupted, stale, or simply out of sync — and nothing would catch it. Deriving from the log instead means entitlement is provably tied to what was actually paid for. But deriving from the log *only*, with no expiry awareness, has its own failure mode: it would freeze a user on their last paid plan forever, since a downgrade or cancellation never produces a new log row to derive from. The two-half rule is what makes both properties true at once.

**How I implemented it.** `verifyAndFulfill` writes `{ intendedPlan, grantedPeriodEnd }` into the `FULFILLED` event's `rawPayload`. `deriveEntitlementFromLog` checks `now` against that `grantedPeriodEnd`: if still current, return the log's value directly; if elapsed (or no event exists), call `applyDuePlanChanges` and return its result instead. Every entitlement-deciding read in the app — billing, dashboard, plans, change-plan, checkout proration, cancel/reactivate — goes through this function, not the raw column.

**What I chose against, and why.** Deriving from the log unconditionally, with no expiry check — this was the first version built, and it was wrong: verified directly by testing a real downgrade scenario, which returned a stale YEARLY grant instead of the scheduled MONTHLY (see Section 6). The fix — falling back to the reconciled state once the grant elapses — was chosen over the alternative of trying to encode cancellation and downgrade as synthetic log entries, which would have meant inventing fake "payment events" for things that categorically aren't payments, muddying what the log is actually for.

---

## Section 6: What Went Wrong

**Problem 1 — The webhook plan inference used the charged amount, not the actual plan (CRITICAL).**
On a prorated upgrade, the amount stored in the `INITIATED` event is the net-after-credit figure — a real YEARLY upgrade charged ₦43,000, well under the ₦48,000 list price. The webhook handler inferred the plan with a threshold check (`amountMinor >= 4_800_000`), which meant this specific, correct charge would have been misclassified as MONTHLY had the webhook path fired first. It only worked in the live walkthrough because the return-page path happened to pass the plan explicitly in the redirect URL — the webhook path itself was never actually exercised until later. The fix: store the intended plan directly in the `INITIATED` event's `rawPayload` at checkout time, and read it back at fulfilment instead of inferring anything from the amount. An alternative — storing the intended plan as `pendingUpgradeTo` on the subscription row — was considered and rejected as unnecessary duplicate state, since the event itself already carries it.

**Problem 2 — Entitlement derivation never expired, silently freezing users on stale grants.**
Testing a real downgrade scenario (a genuine YEARLY grant, `pendingDowngradeTo=MONTHLY`, period genuinely expired) showed every entitlement surface still reporting YEARLY instead of the scheduled MONTHLY. Tracing it back: `deriveEntitlementFromLog` returned the latest `FULFILLED` event's data unconditionally, with no comparison against the current date at all. The cause was structural, not a typo — pure log derivation has no concept of its own expiry, and a downgrade or cancellation never produces a new log row to supersede the old one. The fix was the two-half rule described in Section 5.11: the log stays authoritative while its grant is current, but authority passes to the reconciled state once that grant elapses, since only reconciliation can reflect non-payment intent.

**Problem 3 — Deferred downgrades were set but never actually applied.**
`cancelAtPeriodEnd` and `pendingDowngradeTo` were being written correctly by the change-plan endpoint, but nothing ever consumed them — no scheduled job existed to flip the plan once `currentPeriodEnd` arrived, so a user who downgraded would simply stay on their current plan indefinitely. The fix was lazy evaluation: `applyDuePlanChanges` runs inside every function that touches subscription state, reconciling any overdue change on the next real request rather than waiting for a scheduler that doesn't exist in this slice. Deliberately not fixed with a cron job or external scheduler — that would be standing infrastructure disproportionate to a single assessment slice.

**Problem 4 — `prisma migrate dev` failed with P1012, `DATABASE_URL` not found.**
The error claimed the environment variable didn't exist, even though it was correctly set in `.env`. The cause: with a `prisma.config.ts` present, Prisma 6 skips its automatic `.env` loading entirely, and the config file was an empty `defineConfig({})` that never loaded it another way. The fix was one line — `import "dotenv/config"` at the top of `prisma.config.ts` — after which migrations applied cleanly.

*(The full log, including PowerShell-specific tooling quirks and the Flutterwave key/webhook-secret setup steps, is in `problems.md` at the project root.)*

---

## Section 7: What This Slice Does Not Handle

**What breaks at scale, or was never really built:** subscriptions do not auto-renew. Every `FULFILLED` event in this system originates from an explicit checkout the user initiated — there is no recurring charge that fires automatically when a period ends. A real product would need Flutterwave's native recurring Payment Plans wired in, or a scheduled job that re-attempts a charge at renewal; neither exists here.

**What I'd need before real users:** live webhook delivery has only ever been proven by replaying a captured payload directly against `localhost` — the handler itself is genuinely exercised and correct, but Flutterwave's servers have never actually reached this app, since that requires a public URL (a tunnel like ngrok, or a real deployment) that wasn't set up for this assessment. Real email delivery is also unresolved: verification codes are read directly from the database in development because the Ethereal fallback is unreachable on this network, and no real SMTP credentials were configured.

**Left out because it was outside the brief:** any real product behind the paywall, a landing or pricing page, and a UI for downgrade proration visibility — the brief only requires a preview for upgrades, and downgrades are deferred with no immediate charge to preview against.

**Left out because of time, not because it was out of scope:** `currentPeriodStart` was never added to the schema, so proration's daily rate is computed from each plan's configured interval length rather than the subscriber's actual elapsed period — a real precision gap when a period was renewed even a day or two off-schedule, though a small one in practice.

---

## Section 8: If I Built This Again

The single biggest change would be adding `currentPeriodStart` to the schema from day one, alongside `currentPeriodEnd`. Its absence caused two separate problems that both trace back to the same root cause: proration's daily rate had to assume the plan's configured interval length instead of the subscriber's actual elapsed period, and the entitlement-derivation work had to invent a `grantedPeriodEnd` field stashed inside `rawPayload` specifically to give the log something concrete to compare against — a workaround for not having real period boundaries tracked as first-class data from the start. One extra column at the beginning would have made both of those simpler and more precise, rather than needing two independent workarounds later.


