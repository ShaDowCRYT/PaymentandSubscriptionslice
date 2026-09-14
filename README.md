# Payment and Subscription Slice

A test-mode subscription system: one paid plan (MONTHLY / YEARLY) sold behind a
signed-in shell, with Flutterwave as the payment provider. Next.js (App Router,
Turbopack) / TypeScript / Prisma 6 / PostgreSQL 16. Auth is reused from
Assessment 1.

## Running locally

See DOCUMENTATION.md [Section 2](DOCUMENTATION.md#2-running-locally) for the
full setup, including required environment keys. In short:

1. `docker compose up -d` — starts Postgres 16
   (`paymentandsubscriptionslice-postgres`).
2. `cp .env.example .env` and fill `DATABASE_URL` plus Flutterwave test keys.
3. `npx prisma migrate dev` — applies migrations.
4. `npm run dev` — development server on http://localhost:3000.

## Documentation

- [DOCUMENTATION.md](DOCUMENTATION.md) — architecture, payment lifecycle,
  entitlement derivation, evidence gathered against the real database.
- [problems.md](problems.md) — real problems hit and how they were resolved.
- [Docs/PRD.md](Docs/PRD.md) — the locked product spec (data model).