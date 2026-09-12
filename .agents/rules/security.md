# Security Rules — Assessment 2

These are enforceable, not aspirational. Every rule below maps directly to a graded engineering requirement.

## Money

- Every monetary amount is an integer in minor units (kobo for NGN). Never a `Float`, `Decimal`, or any type that can carry a fractional value incorrectly.
- The currency is stored alongside every amount — never assumed or hardcoded implicitly.
- Any arithmetic on money (proration, totals) is done in integer minor units throughout — never converted to a decimal mid-calculation and back.

## Entitlement

- Entitlement (marking a subscription active, changing `plan`, extending `currentPeriodEnd`) is granted in exactly one place: after a server-side call to Flutterwave's transaction verification endpoint confirms the transaction succeeded.
- The return/success page a user lands on after paying never grants entitlement itself. It only displays status — the actual grant already happened (or didn't) via the webhook and server-side verification, independent of whether the user's browser ever reaches the return URL.
- Never trust a query parameter, a redirect, or any client-supplied claim about payment status for anything security-relevant.

## Webhooks

- Every incoming webhook is checked against Flutterwave's `verif-hash` header before any other processing. A missing or mismatched hash means the request is rejected immediately — nothing downstream runs.
- Processing order is fixed: (1) verify signature, (2) check idempotency, (3) process. Never reordered.
- A webhook handler must always respond quickly (Flutterwave will retry on timeout) — do the minimum synchronous work needed to record the event, defer anything slow.

## Idempotency

- The `@@unique([providerReference, eventType])` constraint on `PaymentEvent` is the actual enforcement mechanism, not a courtesy check in application code beforehand.
- A duplicate webhook (same provider reference, same event type) must fail that constraint on insert and be treated by the handler as "already processed" — logged, not surfaced as an error, and not reprocessed.
- Never key idempotency on anything the client controls (e.g. a value from the request body) — only on the provider's own reference.

## The Payment Log

- Every stage of every transaction (initiated, verified, fulfilled, failed) gets its own `PaymentEvent` row. Never update a row in place to reflect a new stage — insert a new row instead.
- The payment log is the thing a dispute is resolved against. If a row can be edited or deleted, this makes it worthless as evidence — so nothing in the application ever updates or deletes a `PaymentEvent` row after creation.

## Cancellation

- Cancelling a subscription never immediately revokes access. It sets `cancelAtPeriodEnd = true`; the plan and `currentPeriodEnd` stay as they are until the period actually ends.
- Cancellation requires an explicit confirmation step in the UI before the cancel request is sent — not a single-click action.
- The cancellation reason is optional and stored as given — never inferred or defaulted to something the user didn't select.

## Cards

- No card number, expiry, CVV, or any card-identifying detail is ever received, logged, or stored by this system in any form, at any layer — including in logs, error messages, or the raw webhook payload stored in `PaymentEvent.rawPayload` (strip card fields before storing the payload if Flutterwave's webhook payload includes any).

## Rate Limiting

- The checkout-initiation endpoint is rate-limited per user/IP, same pattern as Assessment 1's auth routes.
- A rate-limited request returns HTTP 429 with a retry indication.

## Never do this

- Never grant a plan change or extend access from inside the return/success page's own logic — that logic only reads and displays state that was already set by server-side verification.
- Never let a Prisma or Flutterwave API error reach the client as a raw exception — every payment-path error returns a clean, generic message; nothing renders a blank page or a 404.
- Never commit `.env`. Only `.env.example` with placeholders is committed.
