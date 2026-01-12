-- Backfill actionAt for existing acted items.
-- Safe one-time migration: only updates rows where actionAt IS NULL.

-- COMPLETED_*: use the most recent CompletedActivity.startTime (fallback to CompletedActivity.createdAt, then CalendarItem.updatedAt).
UPDATE "CalendarItem"
SET "actionAt" = COALESCE(
  (
    SELECT MAX(ca."startTime")
    FROM "CompletedActivity" ca
    WHERE ca."calendarItemId" = "CalendarItem"."id"
  ),
  (
    SELECT MAX(ca."createdAt")
    FROM "CompletedActivity" ca
    WHERE ca."calendarItemId" = "CalendarItem"."id"
  ),
  "CalendarItem"."updatedAt",
  "CalendarItem"."createdAt"
)
WHERE "actionAt" IS NULL
  AND "status" IN ('COMPLETED_MANUAL', 'COMPLETED_SYNCED', 'COMPLETED_SYNCED_DRAFT');

-- SKIPPED: use updatedAt (fallback to createdAt).
UPDATE "CalendarItem"
SET "actionAt" = COALESCE("updatedAt", "createdAt")
WHERE "actionAt" IS NULL
  AND "status" = 'SKIPPED';
