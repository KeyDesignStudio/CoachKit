# Plan Library runbook (Admin)

This runbook describes how to ingest the Plan Library datasets from Vercel Blob into Postgres via admin-only endpoints.

## Safety model

- Imports are **admin-only** (`ADMIN` role required).
- **Dry-run is the default.** Writes require `dryRun=false` + `confirmApply=true`.
- Imports are **idempotent** (re-running does not duplicate rows).
- Imports write **only** to:
  - `PlanTemplate`
  - `WorkoutLibrarySession` (with `source=PLAN_LIBRARY`, `status=DRAFT`)
  - `PlanTemplateScheduleRow`
- Imports do **not** touch athlete history tables (`CalendarItem`, `CompletedActivity`, etc).

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

## Publish imported sessions

Coaches only see **PUBLISHED** sessions.

From the Admin UI:

- In the Plan Library panel, type `PUBLISH`
- Click **Publish now**

From curl:

```bash
curl -s \
  -H 'content-type: application/json' \
  -d '{"confirmApply":true}' \
  http://localhost:3000/api/admin/plan-library/publish
```

## Diagnostics

- `GET /api/admin/diagnostics/plan-library`
  - Confirms Plan Library tables exist + row counts
  - Shows `WorkoutLibrarySession` counts for `source=PLAN_LIBRARY` by status

- `GET /api/admin/diagnostics/workout-library`
  - Confirms Workout Library totals

## Rollback (safe)

Preferred rollback is **unpublish**, then **purge by source**:

1) Unpublish PLAN_LIBRARY sessions (admin tooling)
2) Purge drafts by source via Workout Library maintenance tooling

Notes:

- Avoid deleting rows from PlanTemplate/Schedule in production unless you are certain nothing references them.
- If you need a hard delete strategy later, add a dedicated admin-only purge endpoint that deletes in a safe order and refuses if athlete plan instances exist.
