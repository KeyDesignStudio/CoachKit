# Deployment environment checklist (Vercel + Neon)

This doc is about **runtime connectivity** (can the deployed app reach Postgres?) rather than schema migrations.
For migrations, see [docs/DEPLOY_MIGRATIONS.md](docs/DEPLOY_MIGRATIONS.md).

## Required Vercel environment variables

Set these in **Vercel → Project → Settings → Environment Variables**.

- `DATABASE_URL` (required)
  - Used by Prisma at runtime.
  - For Vercel serverless/edge runtimes, prefer the **Neon pooled** connection string (the `-pooler` host) to reduce connection pressure.

- `DIRECT_URL` (recommended)
  - Use the **direct** (non-pooler) connection string.
  - Used as a fallback if `DATABASE_URL` is missing, and is useful for scripts/migrations.

Important: never log or paste full connection strings.

## Preview vs Production

Vercel keeps separate values per environment:

- **Production**: used for the `main` deployment users see.
- **Preview**: used for PR deployments.

It’s common to set variables in Preview and forget to set them in Production (or vice versa). If Production can’t reach the DB, confirm the variables are set under **Production**.

## Health check

Use the DB health check endpoint to confirm connectivity from the deployed environment:

- `GET /api/health/db`

Expected responses:

- `200` → `{ ok: true, host, timestamp }`
- `500` → `{ ok: false, error: "DB_UNREACHABLE", host, requestId }`

If it returns `500`, use `requestId` to locate the corresponding Vercel runtime log entry.

## Neon notes

- Neon computes can be **suspended** due to inactivity. If a deployment suddenly can’t connect, open the Neon console and confirm the compute is active.
- Waking a suspended compute can be done by running any query (Neon console, psql, or the `/api/health/db` endpoint once env vars are correct).

## Common failure modes

- Wrong env var scope (Preview set, Production missing)
- Old/rotated Neon connection string
- Using direct URL in serverless without pooling (connection limits)
- Network/DNS issues (rare); use the requestId + log output to confirm host and environment
