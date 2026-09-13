# Problems Encountered

Log of real problems hit while standing up the project against a real Postgres
database and a real Flutterwave test account. Each entry: symptom, root cause,
resolution, and status. Files/line numbers reference the state at the time of
writing.

## 1. `prisma migrate dev` fails with P1012 — `DATABASE_URL` not found

- **Symptom:** `npx prisma migrate dev --name init` errored:
  `Environment variable not found: DATABASE_URL.` (P1012).
- **Root cause:** With a `prisma.config.ts` present, Prisma 6 skips its
  automatic `.env` loading ("Prisma config detected, skipping environment
  variable loading."). The config file was an empty `defineConfig({})`, so the
  CLI never saw the variable.
- **Resolution:** Added `import "dotenv/config"` to the top of
  `prisma.config.ts`. Migration then applied cleanly.
- **Status:** FIXED.

## 2. Verification emails never arrive (Ethereal unreachable)

- **Symptom:** Signup/verify flows work against the DB, but the verification
  email is not delivered.
- **Root cause:** `lib/email.ts` falls back to a fresh Ethereal test account
  unless `SMTP_HOST` is set. Ethereal is unreachable from this network (see
  the comment at `lib/email.ts:8`), and no real SMTP credentials were
  configured.
- **Resolution (current):** Verification codes are read directly from the
  `verification_codes` table in Postgres during development.
- **Status:** OPEN — resolve by setting `SMTP_*` in `.env`
  (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`,
  `SMTP_FROM`) or switching to a reachable dev inbox.

## 3. Checkout 500 — `FLUTTERWAVE_SECRET_KEY is not set`

- **Symptom:** `POST /api/checkout` returned 500 with
  `"Something went wrong. Please try again."`; server log:
  `Error: FLUTTERWAVE_SECRET_KEY is not set` at `lib/flutterwave.ts:11`.
- **Root cause:** The three `FLUTTERWAVE_*` keys were absent from `.env`, and
  `initializePayment` throws when the key is missing.
- **Resolution:** User supplied test keys; validated live with
  `GET /v3/balances` (HTTP 200).
- **Status:** FIXED.

## 4. Webhook hash appears to be missing

- **Symptom:** No Flutterwave webhook secret value existed to fill
  `FLUTTERWAVE_WEBHOOK_SECRET`.
- **Root cause:** Flutterwave does not auto-generate one. The "Secret Hash" is
  self-assigned in the dashboard (Settings → API → Webhooks), and the same
  value is sent on every webhook as the `verif-hash` header, which
  `verifyWebhookSignature` (`lib/flutterwave.ts:130`) compares. Without a
  match the webhook is rejected with 401 (`app/api/webhook/flutterwave/route.ts:18`).
- **Resolution:** Generated a random 64-hex value, placed it in both the
  dashboard Secret Hash field and `.env`.
- **Status:** FIXED (webhook path still requires a public URL / tunnel to be
  exercised — see #5).

## 5. Webhook path can't be exercised from localhost

- **Symptom:** Flutterwave webhooks never arrive.
- **Root cause:** The dashboard Webhook URL must be publicly reachable;
  `localhost` is not.
- **Resolution (workaround):** Fulfillment for this session used the checkout
  **return-page** path (`/api/checkout/verify`), which passed the explicit
  `plan` in the redirect URL and verified server-side.
- **Status:** OPEN — use a tunnel (ngrok/cloudflared) or deploy to exercise
  webhook-driven fulfillment. Note this hides the bug in #7.

## 6. `.env` keys were entered on commented lines and ignored

- **Symptom:** Values looked present in `.env` but the app still reported
  keys as unset.
- **Root cause:** dotenv ignores any line starting with `#`. The Flutterwave
  values had been typed into the commented template lines.
- **Resolution:** Uncommented the three `FLUTTERWAVE_*` lines.
- **Status:** FIXED.

## 7. CRITICAL — Webhook plan inference uses the prorated amount

- **Symptom (latent):** On a prorated upgrade the charged amount stored in the
  INITIATED payment event is the net-after-credit figure. The webhook handler
  (`app/api/webhook/flutterwave/route.ts:64`) infers the plan via
  `amountMinor >= 4_800_000`, which misclassifies prorated YEARLY charges
  (e.g. ₦43,000 = 4,300,000 kobo) as MONTHLY.
- **Evidence:** The live YEARLY upgrade was charged ₦43,000 and fulfilled
  correctly only because the return-page path supplied `plan=YEARLY`; the
  webhook path was never exercised.
- **Resolution:** NOT FIXED (deferred). Options: store the original plan in the
  INITIATED event / `rawPayload` and resolve it from there; store a
  `pendingUpgradeTo` on the subscription; or pass the plan through
  Flutterwave `custom_metadata` and read it back on the webhook.

## 8. Proration audit findings (not yet fixed)

Analysis of `lib/proration.ts` / `lib/subscription.ts` / the change-plan route:

- **HIGH — Deferred downgrades never execute.** ~~`cancelAtPeriodEnd` and
  `pendingDowngradeTo` are set (`app/api/subscription/change-plan/route.ts`) but
  nothing (cron job, background worker, or lazy check on request) flips the plan
  when `currentPeriodEnd` passes.~~ **FIXED** with lazy evaluation:
  `applyDuePlanChanges` in `lib/subscription.ts` runs inside
  `getOrCreateSubscription` and at the start of the cancel/reactivate service
  functions, flipping plan, clearing flags, and resetting `currentPeriodEnd`
  once the period has passed. The tradeoff (flip happens on next user activity,
  not exactly at period end) is documented in DOCUMENTATION.md §5.8.
- **MEDIUM — `Math.ceil` over-credits.** `lib/proration.ts:50` rounds days
  remaining up: even a millisecond left in the period grants a full extra day of
  credit. `Math.floor` is the platform-favoring convention.
- **MEDIUM — The daily rate assumes the configured period length.**
  `totalDays = PLANS[currentPlan].intervalDays` (`lib/proration.ts:45`); the
  actual billing period is never stored (`currentPeriodStart` is absent from
  the schema), so the credit can be slightly off.
- **LOW — No downgrade visibility.** Proration preview is returned only for
  upgrades; downgrades are silently deferred with no credit/effective-date
  shown to the user.

**Status:** OPEN — audit complete, fixes deliberately not implemented yet.

## 9. Windows / PowerShell 5.1 tooling quirks (not app bugs)

- `curl.exe -d '{"plan":"MONTHLY"}'` loses the inner double quotes (PS 5.1
  argument mangling) → `JSON.parse` error at the server. Use
  `--data-binary @file.json`.
- `Invoke-WebRequest` silently drops a manually supplied `Cookie` header →
  `401 Unauthorized` from authenticated API routes. Use `curl.exe -H "Cookie:
  session_id=..."`.
- Mixed-case Prisma columns (e.g. `"userId"`, `"emailVerified"`, `"amountMinor"`)
  must be double-quoted in SQL; unquoted identifiers fold to lowercase and
  error with "column does not exist". In PowerShell, pipe SQL to
  `docker exec -i ... psql` and use single-quoted here-strings (`@'...'@`) so
  embedded double quotes survive.