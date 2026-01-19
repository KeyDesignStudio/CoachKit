-- Add ingestion safety fields for Workout Library sessions.

-- 1) Enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WorkoutLibrarySessionStatus') THEN
    CREATE TYPE "WorkoutLibrarySessionStatus" AS ENUM ('DRAFT', 'PUBLISHED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WorkoutLibrarySource') THEN
    CREATE TYPE "WorkoutLibrarySource" AS ENUM ('MANUAL');
  END IF;
END $$;

-- 2) Columns
ALTER TABLE "WorkoutLibrarySession"
  ADD COLUMN IF NOT EXISTS "status" "WorkoutLibrarySessionStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS "source" "WorkoutLibrarySource" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS "fingerprint" TEXT;

-- 3) Backfill: existing sessions should remain visible to coaches.
UPDATE "WorkoutLibrarySession" SET "status" = 'PUBLISHED' WHERE "status" = 'DRAFT';

-- 4) Indexes / constraints
CREATE UNIQUE INDEX IF NOT EXISTS "WorkoutLibrarySession_fingerprint_key" ON "WorkoutLibrarySession" ("fingerprint");
CREATE INDEX IF NOT EXISTS "WorkoutLibrarySession_status_idx" ON "WorkoutLibrarySession" ("status");
CREATE INDEX IF NOT EXISTS "WorkoutLibrarySession_source_idx" ON "WorkoutLibrarySession" ("source");
