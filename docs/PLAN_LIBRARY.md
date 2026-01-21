# Plan Library (WIP)

This document describes the **Plan Library** feature foundations and the constraints for ingestion.

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
