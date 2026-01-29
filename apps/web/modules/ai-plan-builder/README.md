# AI Plan Builder (v1)

Tranche 1 is **scaffolding only**:
- Feature-flag gated behind `AI_PLAN_BUILDER_V1` (defaults false)
- No live LLM calls
- Deterministic, testable server logic only
- Data stored in additive Prisma models (no changes to existing plan flows)

This module is intentionally isolated under `apps/web/modules/ai-plan-builder`.

## Running tests (1-minute setup)

	- `npm run test:ai-plan-builder`
	- `npm run test:ai-plan-builder:parallel` (stress: 4-way parallel + repeats)

What it does:

	- Vitest Prisma integration tests (real DB)
	- Playwright flag-ON specs sharded in parallel (default 3 shards), each with its own Postgres database, webserver port, and Next.js `distDir`
	- Playwright flag-OFF 404 gating tests

### AI Plan Builder harness modes

- Fast (dev/iteration): `npm run test:ai-plan-builder:fast`
	- Runs the full Vitest suite.
	- Runs Playwright flag ON once (`--workers=1`).
	- Skips Playwright flag OFF.
	- Reuses a single per-run database (still isolated by `TEST_RUN_ID`).

- Full (CI / pre-push): `npm run test:ai-plan-builder:full` (same as `npm run test:ai-plan-builder`)
	- Runs the full Vitest suite.
	- Runs Playwright flag ON sharded (default 3 shards) with optional repeats.
	- Runs Playwright flag OFF.
	- Uses per-worker/per-shard databases.

CI should use the full mode (and may additionally run `npm run test:ai-plan-builder:parallel` as a stress check).

### Reproducing failures

The harness prints a one-line repro command at startup and on failure.
Run the command from `apps/web` with `APB_VERBOSE=1` to include full subprocess output.
Notes:

- The harness sets `DISABLE_AUTH=true` for deterministic local/CI runs.

## Parallel stability


- `--pwShards=<N>` or `APB_PW_SHARDS=<N>`
- `--pwRepeatOn=<N>` or `APB_PW_REPEAT_ON=<N>`
- `--basePort=<N>` or `APB_BASE_PORT=<N>`
- `APB_VERBOSE=1` to print full subprocess output
