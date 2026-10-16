# CareHouse One · web app

Next.js 16 (App Router) and TypeScript, PostgreSQL through Drizzle ORM.

## Run it locally

Requires Node.js 22 or newer. No database install needed: without `DATABASE_URL`, the app uses PGlite, an embedded PostgreSQL stored in `.data/`.

```bash
npm install
npm run db:seed      # demo organization with two homes and four accounts
npm run dev          # http://localhost:3000
```

Sign in with a seeded email (printed by `db:seed`) and the demo password in `src/server/seed.ts`. For the two-step code, run `npm run dev:code`, or add the demo key from `seed.ts` to an authenticator app. These demo values only exist in local databases.

Invitation and password-reset emails are printed to the dev server log (and stored in the `outbox` table) until an email provider is configured.

To start over, stop the dev server and delete `.data/`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm test` | Unit and integration tests (in-memory PostgreSQL) |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run build` | Production build |
| `npm run db:generate` | Create a migration after changing `src/db/schema.ts` |
| `npm run db:seed` | Seed the local database (refuses to run against `DATABASE_URL`) |

## How it's put together

| Path | Purpose |
| --- | --- |
| `src/db/schema.ts` | Tables. Every row carries `org_id`. |
| `drizzle/` | SQL migrations. `0001_security.sql` adds row-level security and the audit-log lock. |
| `src/db/client.ts` | Database connection and `withTenant()`, which scopes a transaction to one organization. |
| `src/server/` | Business logic, independent of Next.js and covered by tests: `auth.ts`, `staff.ts`, `audit.ts`. |
| `src/lib/` | Passwords (Argon2id), two-step codes (TOTP), encryption (AES-256-GCM), permissions, cookies. |
| `src/app/(auth)/` | Sign-in, two-step verification, setup, password reset, invitations. |
| `src/app/(app)/` | Signed-in pages: home, staff, audit log. |
| `tests/` | Vitest. `flows.test.ts` runs the real flows against PostgreSQL, including tenant isolation. |

## Security model

- **Sign-in:** email and password (Argon2id), then a required authenticator code. 5 wrong attempts lock the account for 15 minutes. Unknown emails and wrong passwords get the same answer.
- **Sessions:** random 256-bit tokens in an HttpOnly cookie; only their SHA-256 is stored. Pending until two-step passes. End after 15 minutes idle (`SESSION_IDLE_MINUTES`) or 12 hours.
- **Tenant isolation:** request code runs as the restricted `app_user` role with `app.org_id` set, and row-level security limits every table to that organization.
- **Audit log:** append-only; a trigger rejects updates and deletes.
- **Secrets:** two-step keys are encrypted with `DATA_ENCRYPTION_KEY`.

## Before production

These are tracked in the build spec's production plan. Code-side items still open:

- Email provider for invitations and resets (messages contain no resident details).
- Breached-password check against the Have I Been Pwned range API.
- Per-IP rate limiting on sign-in and reset, and a Content Security Policy.
- Migrations as a deploy step against Cloud SQL, with the app connecting as a least-privilege role.
- Independent security review.
