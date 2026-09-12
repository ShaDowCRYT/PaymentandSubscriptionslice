# Validation & Structure Rules — Assessment 2

## Validation

- Every input (checkout initiation, cancellation reason, any admin/testing form) has exactly one Zod schema, defined once in `lib/schemas/payments.ts`.
- The client imports and uses the same schema for inline feedback where a form exists (e.g. the cancellation reason prompt).
- The API route imports and uses the same schema again server-side before doing anything. Never assume client validation was sufficient.

## Proration as a Pure Function

- `lib/payments/proration.ts` exports a function that takes the plan change and days remaining and returns the calculation — no side effects, no database calls, no Flutterwave calls inside it.
- This is a structural rule, not a style preference: a pure function can be called directly with known inputs to produce the exact numbers that go into Section 5's documentation, and can be verified independently of the rest of the payment flow.

## Accessibility (the one UI requirement that's graded)

- Every input has a label programmatically bound to it.
- Default focus outlines stay visible unless replaced by an equally visible custom style.
- No design system, no custom component library, no visual branding work.

## Scope discipline

- If a task isn't listed in `PRD.md`, don't build it — even something that seems like an obvious addition (e.g. a plan comparison table, an invoice PDF). Flag it instead of adding it silently.
- The billing view shows exactly what's required: plan, status, renewal date, cancel control. Resist adding more.

## Error handling on the payment path

- Every route in the payment path (`/api/payments/*`) catches its own failure modes and returns a clean response — no unhandled exception should ever produce a raw 500 with a stack trace, and no page in the payment flow should ever render a blank screen or a 404 as its failure state.
- If Flutterwave itself is unreachable or times out, the user sees a clear, honest message — not a hang, not a silent failure.

## Environment & secrets

- `.env.example` lists every environment variable by name with a comment on where its real value comes from (Flutterwave test API keys, webhook secret hash) — no real values, ever.
- The agent does not write real secrets into `.env` under any circumstance.

## Commit hygiene

See `rules/git.md`.
