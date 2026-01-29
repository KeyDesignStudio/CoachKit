# AI Plan Builder (v1)

Tranche 1 is **scaffolding only**:
- Feature-flag gated behind `AI_PLAN_BUILDER_V1` (defaults false)
- No live LLM calls
- Deterministic, testable server logic only
- Data stored in additive Prisma models (no changes to existing plan flows)

This module is intentionally isolated under `apps/web/modules/ai-plan-builder`.

## Running tests (1-minute setup)

- Prereqs: Docker (Docker Desktop is fine)
- From `apps/web`:
	- `npm run test:ai-plan-builder`
	- `npm run test:ai-plan-builder:parallel` (stress: 4-way parallel + repeats)

What it does:

- Starts (or reuses) the repo-root Docker Postgres from `docker-compose.yml`
- Waits for Postgres readiness
- Generates Prisma client once (`prisma generate`)
- Creates a fresh Postgres database for Vitest + applies migrations (`prisma migrate deploy`)
- Runs:
	- Vitest Prisma integration tests (real DB)
	- Playwright flag-ON specs sharded in parallel (default 3 shards), each with its own Postgres database, webserver port, and Next.js `distDir`
	- Playwright flag-OFF 404 gating tests

Notes:

- The harness sets `DISABLE_AUTH=true` for deterministic local/CI runs.
- Next.js is started in dev mode per shard, but uses `NEXT_DIST_DIR=.next-apb-...` per shard to avoid `.next` output collisions.
- Example env is in `apps/web/.env.test.example`.

## Parallel stability

- Default sharding: 3 (configurable)
- Stress run: `npm run test:ai-plan-builder:parallel`

Tuning knobs (optional):

- `--pwShards=<N>` or `APB_PW_SHARDS=<N>`
- `--pwRepeatOn=<N>` or `APB_PW_REPEAT_ON=<N>`
- `--basePort=<N>` or `APB_BASE_PORT=<N>`
- `APB_VERBOSE=1` to print full subprocess output
