# Plan Library runbook (Admin)

This runbook describes how to ingest the Plan Library datasets from Vercel Blob into Postgres via admin-only endpoints.

## Safety model

- Imports are **admin-only** (`ADMIN` role required).
- **Dry-run is the default.** Writes require `dryRun=false` + `confirmApply=true`.
- Imports are **idempotent** (re-running does not duplicate rows).
- Plan Library imports write **only** to:
  - `PlanTemplate`
  - `PlanTemplateScheduleRow`
- Imports do **not** touch athlete history tables (`CalendarItem`, `CompletedActivity`, etc).
- Plan Library does **not** publish or create Workout Library templates.
  - Any attempt to write `WorkoutLibrarySession` with `source=PLAN_LIBRARY` is blocked with a structured `400` error:
    `PLAN_LIBRARY_TEMPLATES_DISABLED`.

## Datasets

The server fetches these CSVs from Vercel Blob (server-side):

- Plans: `plans_catalog_metric.csv`
- Sessions: `sessions_library_metric_enriched.csv`
- Schedule: `plan_schedule_metric.csv`

Optional overrides (Vercel env vars):

- `PLAN_LIBRARY_PLANS_URL`
- `PLAN_LIBRARY_SESSIONS_URL`
- `PLAN_LIBRARY_SCHEDULE_URL`

## Dry-run (recommended first)

From the Admin UI:

- Go to `/admin/workout-library` → Import tab → **Plan Library** panel
- Select dataset `ALL`
- Ensure **Dry run** is checked
- Set `limit`/`offset` as needed
- Click **Run Dry-Run**

From curl:

```bash
curl -s \
  -H 'content-type: application/json' \
  -d '{"dataset":"ALL","dryRun":true,"limit":20,"offset":0}' \
  http://localhost:3000/api/admin/plan-library/import
```

Expected outcome:

- `steps[].errorCount` is `0`
- `steps[].wouldCreate` is `> 0`
- `steps[].created` is `0`

## Apply (writes)

From the Admin UI:

- Uncheck **Dry run**
- Type `IMPORT`
- Click **Import Now**

From curl:

```bash
curl -s \
  -H 'content-type: application/json' \
  -d '{"dataset":"ALL","dryRun":false,"confirmApply":true,"limit":50,"offset":0}' \
  http://localhost:3000/api/admin/plan-library/import
```

Expected outcome:

- `steps[].created` is `> 0`
- `steps[].errorCount` is `0`

## Notes

- The `SESSIONS` dataset import step is validation/inspection only (kept for future athlete self-assign work).
- `PlanTemplateScheduleRow.rawText` is preserved exactly as imported (no trimming/normalization).

## Diagnostics

- `GET /api/admin/diagnostics/plan-library`
  - Confirms Plan Library tables exist + row counts

- `GET /api/admin/diagnostics/workout-library`
  - Confirms Workout Library totals

## Rollback (safe)

Preferred rollback is to **purge plan-derived Workout Library templates**, if any exist from legacy imports.

- Use the admin purge tool (dry-run first).

Notes:

- Avoid deleting rows from PlanTemplate/Schedule in production unless you are certain nothing references them.
- Avoid deleting rows from PlanTemplate/Schedule in production unless you are certain nothing references them.
