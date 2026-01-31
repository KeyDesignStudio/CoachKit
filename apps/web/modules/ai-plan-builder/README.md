# AI Plan Builder (v1)

Tranche 1 is **scaffolding only**:
- Feature-flag gated behind `AI_PLAN_BUILDER_V1` (defaults false)
- No live LLM calls
- Deterministic, testable server logic only
- Data stored in additive Prisma models (no changes to existing plan flows)

Tranche 8 adds an **LLM seam**:
- All “AI-like” behavior flows through a single capability interface.
- The default implementation remains deterministic.
- `AI_PLAN_BUILDER_AI_MODE=llm` selects an LLM-backed implementation (with deterministic fallback).
- Optional hash-only usage auditing (no payload storage).

Tranche 9 adds **real OpenAI provider wiring** behind the seam:
- Server-side only (never from client code).
- Guardrails: timeouts, 1 retry on retryable failures, JSON validation, deterministic fallback.
- CI/test uses the mock provider (no external calls).

Tranche 10 adds **controlled rollout + cost guardrails + safer ops**:
- Per-capability overrides (inherit/global, deterministic, llm).
- Per-capability token limits.
- DB-backed rate limiting (per actor per hour) with deterministic fallback.
- Metadata-only DB audit record for every invocation (hashes only; no raw prompts/outputs).

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

## AI seam mode switch

- Env var: `AI_PLAN_BUILDER_AI_MODE`
	- `deterministic` (default)
	- `llm`

LLM provider config (server-side only):
- `AI_PLAN_BUILDER_LLM_PROVIDER` (`openai` | `mock`)
- `AI_PLAN_BUILDER_LLM_MODEL`
- `OPENAI_API_KEY`
- `AI_PLAN_BUILDER_LLM_TIMEOUT_MS` (default `20000`)
- `AI_PLAN_BUILDER_LLM_MAX_OUTPUT_TOKENS` (default `1200`)

Controlled rollout (per capability, optional):
- `AI_PLAN_BUILDER_AI_CAP_SUMMARIZE_INTAKE` (`inherit` | `deterministic` | `llm`)
- `AI_PLAN_BUILDER_AI_CAP_SUGGEST_DRAFT_PLAN` (`inherit` | `deterministic` | `llm`)
- `AI_PLAN_BUILDER_AI_CAP_SUGGEST_PROPOSAL_DIFFS` (`inherit` | `deterministic` | `llm`)

Per-capability token limits (optional; overrides global max output tokens):
- `AI_PLAN_BUILDER_LLM_MAX_OUTPUT_TOKENS_SUMMARIZE_INTAKE`
- `AI_PLAN_BUILDER_LLM_MAX_OUTPUT_TOKENS_SUGGEST_DRAFT_PLAN`
- `AI_PLAN_BUILDER_LLM_MAX_OUTPUT_TOKENS_SUGGEST_PROPOSAL_DIFFS`

Central retry/rate-limit policy (server-side):
- `AI_PLAN_BUILDER_LLM_RETRY_COUNT` (default `1`, max `2`)
- `AI_PLAN_BUILDER_LLM_RATE_LIMIT_PER_HOUR` (default `20`)

Admin audit viewer (Tranche 11A):
- UI routes:
	- `/admin/ai-audits` (list + filters + pagination)
	- `/admin/ai-audits/[id]` (detail)
- Optional API routes:
	- `GET /api/admin/ai-audits?range=24h|7d|30d&limit=&offset=&capability=&fallbackUsed=&errorCode=&actorType=`
	- `GET /api/admin/ai-audits/[id]`
- Access control:
	- Allowed if the authenticated user has DB role `ADMIN`, OR their email is listed in `AI_PLAN_BUILDER_ADMIN_EMAILS`.
	- Non-admins receive `404` (feature remains effectively non-existent).
	- Admin check runs server-side only; no audit data is exposed to non-admins.

Usage rollups + cost estimates + alerts (Tranche 12):
- UI route:
	- `/admin/ai-usage` (summary + capability breakdown + alerts)
- API routes:
	- `POST /api/admin/ai-usage/rollup` body: `{ days: 7|30|90 }` (default 30)
	- `GET /api/admin/ai-usage/rollups?days=7|30|90`
	- `POST /api/admin/ai-usage/evaluate-alerts` body: `{ days: 7|30|90 }` (default 7)
	- `GET /api/admin/ai-usage/alerts?limit=&offset=`
	- `POST /api/admin/ai-usage/alerts/:id/ack`
- Alert thresholds (optional; defaults apply if unset):
	- `AI_USAGE_ALERT_CALLS_PER_DAY_THRESHOLD` (default `500`)
	- `AI_USAGE_ALERT_FALLBACK_RATE_THRESHOLD` (default `0.15`)
	- `AI_USAGE_ALERT_ERROR_RATE_THRESHOLD` (default `0.05`)
	- `AI_USAGE_ALERT_P95_LATENCY_MS_THRESHOLD` (default `25000`)
	- `AI_USAGE_ALERT_COST_USD_PER_DAY_THRESHOLD` (default `10`)
- Costs are estimates (directional only; not billing-grade).

Eval fixtures (Tranche 11B):
- Stored under `modules/ai-plan-builder/evals/fixtures/`
- Purpose: lightweight drift detection for schemas/specs/redaction behavior.
- Run via the standard harness (`npm run test:ai-plan-builder:fast` / `:full`).

Safety guarantees in this repo version:
- No client-side LLM requests.
- CI/test forces the mock provider; no external calls and no `OPENAI_API_KEY` required.
- Logs never include raw prompts or raw LLM outputs.
- Audit helpers use stable hashes of input/output only.

DB ops guarantees:
- `AiInvocationAudit` stores metadata only (hashes, timing, retry/fallback flags, error codes).
- `AiLlmRateLimitEvent` stores usage counters only.

No raw prompt or raw model output is persisted anywhere.

### Enabling LLM mode locally

Set these in your local env (server-side only):
- `AI_PLAN_BUILDER_AI_MODE=llm`
- `AI_PLAN_BUILDER_LLM_PROVIDER=openai`
- `AI_PLAN_BUILDER_LLM_MODEL=<model id>`
- `OPENAI_API_KEY=<secret>`

Never commit keys and never expose them to client-side env vars.

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
