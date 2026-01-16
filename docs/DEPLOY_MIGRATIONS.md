# Deploy migrations (Vercel + Neon)

We do **not** run Prisma migrations automatically during Vercel builds.

## When to run

Run migrations **whenever a PR includes changes under**:
- `apps/web/prisma/migrations/**`

For production: run them **after merging to `main` and before validating production UI**.

## Commands (run from repo root)

1) Ensure your environment points at **Neon PROD** (prefer the **Direct** connection string, not the pooled one):

- Option A (one-off for a single command):
  - `DATABASE_URL="<NEON_PROD_DATABASE_URL_DIRECT>" npm run migrate:prod`

- Option B (export then run):
  - `export DATABASE_URL="<NEON_PROD_DATABASE_URL_DIRECT>"`
  - `npm run migrate:prod`

Optional (local dev/typegen convenience):
- `npm run prisma:generate:web`

## Expected “good output”

### Case 1: migrations applied

Example output:

```
Environment variables loaded from .env
Prisma schema loaded from apps/web/prisma/schema.prisma
Datasource "db": PostgreSQL database
23 migrations found in prisma/migrations
Applying migration `20260116124208_workout_detail_fields`
The following migration(s) have been applied:
20260116124208_workout_detail_fields
```

### Case 2: nothing to do (already up-to-date)

Example output:

```
Environment variables loaded from .env
Prisma schema loaded from apps/web/prisma/schema.prisma
Datasource "db": PostgreSQL database
23 migrations found in prisma/migrations
No pending migrations to apply.
```

## Notes

- If `npm run migrate:prod` fails with “prisma: command not found”, run `npm install` once at repo root (the Prisma CLI is a dev dependency of the root package).
- Never paste Neon PROD credentials into PRs, Slack, or logs.
