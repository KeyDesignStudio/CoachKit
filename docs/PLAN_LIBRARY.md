# Plan Library (WIP)

This document describes the **Plan Library** feature foundations and the constraints for ingestion.

Related implementation spec:

- [Plan Library Workout Intelligence Tranche](/Volumes/DockSSD/Projects/CoachKit/docs/PLAN_LIBRARY_WORKOUT_INTELLIGENCE_TRANCHE.md)

## Kill switch

- **Server env var:** `ENABLE_PLAN_LIBRARY=1`
- Default: **off** (unset/0/false)

When disabled, Plan Library admin/coach UI should not be discoverable.

## Diagnostics

Admin-only endpoint:

- `GET /api/admin/diagnostics/plan-library`

Returns **safe** DB metadata (host/database/schema) plus Plan Library table presence and row counts.

Constraints:

- No secrets in responses or logs.
- Response is `Cache-Control: no-store`.

## Ingestion constraints (expected)

- CSV IDs must be treated as **strings** (never numeric parsing / scientific notation).
- Imports must be **idempotent** (re-running produces the same result; no dupes).
- Admin import should support **dry-run** vs **apply**.
- Assignments must be **reversible** (do not destroy athlete-authored data).

## Data model (planned)

## Phase 1 schema (implemented)

Phase 1 adds the following Prisma models/tables:

- `PlanTemplate`
- `PlanTemplateScheduleRow`
- `AthletePlanInstance`
- `AthletePlanInstanceItem`

## Current plan-source ingestion behavior

- Uploaded PDFs are parsed into structured plan-source records and, when `BLOB_READ_WRITE_TOKEN` is configured, the original PDF is also persisted to Vercel Blob so Admin can reopen the source document later.
- URL sources retain their original source URL; text sources retain extracted text only.
- Session templates now persist parser confidence, parser warnings, and a `recipeV2Json` workout structure payload for downstream AI use.

## Current exemplar loop

- Coach-edited APB session details can be promoted into `CoachWorkoutExemplar` records.
- APB session-detail generation can consume matching plan-library recipes plus coach exemplars as `referenceRecipes`.
- Coach feedback (`GOOD_FIT`, `EDITED`, `TOO_HARD`) is retained against exemplars and can be reviewed in Admin.
