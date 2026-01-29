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

What it does:

- Starts (or reuses) the repo-root Docker Postgres from `docker-compose.yml`
- Waits for Postgres readiness
- Resets the database (`prisma migrate reset --force --skip-seed`) and runs all migrations
- Regenerates Prisma client (`prisma generate`)
- Runs:
	- Vitest Prisma integration tests (real DB)
	- Playwright API-flow test (flag ON)
	- Playwright flag-OFF 404 gating tests

Notes:

- The harness sets `DISABLE_AUTH=true` for deterministic local/CI runs.
- Example env is in `apps/web/.env.test.example`.
