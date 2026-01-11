-- Draft-until-confirm Strava sync

-- 1) Add new CalendarItemStatus enum value for draft synced completions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'CalendarItemStatus'
      AND e.enumlabel = 'COMPLETED_SYNCED_DRAFT'
  ) THEN
    ALTER TYPE "CalendarItemStatus" ADD VALUE 'COMPLETED_SYNCED_DRAFT';
  END IF;
END $$;

-- 2) Add confirmedAt to CompletedActivity (null = draft/unconfirmed)
ALTER TABLE "CompletedActivity"
ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3);
