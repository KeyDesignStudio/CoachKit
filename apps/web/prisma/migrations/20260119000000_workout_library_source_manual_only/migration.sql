-- Make WorkoutLibrarySource MANUAL-only.
--
-- This migration is intentionally written without referencing any removed enum labels.
-- It normalizes any non-MANUAL values to MANUAL, then rebuilds the enum type.

-- 1) Normalize any existing non-MANUAL sources to MANUAL.
UPDATE "WorkoutLibrarySession"
SET "source" = 'MANUAL'
WHERE "source"::text <> 'MANUAL';

-- 2) Rebuild enum type to ensure it only contains 'MANUAL'.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WorkoutLibrarySource') THEN
    -- Use a unique temporary type name to avoid collisions on retry.
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WorkoutLibrarySource__only_manual') THEN
      CREATE TYPE "WorkoutLibrarySource__only_manual" AS ENUM ('MANUAL');
    END IF;

    -- Drop default before type swap; otherwise Postgres may fail to cast it.
    ALTER TABLE "WorkoutLibrarySession"
      ALTER COLUMN "source" DROP DEFAULT;

    ALTER TABLE "WorkoutLibrarySession"
      ALTER COLUMN "source" TYPE "WorkoutLibrarySource__only_manual"
      USING ("source"::text::"WorkoutLibrarySource__only_manual");

    DROP TYPE "WorkoutLibrarySource";
    ALTER TYPE "WorkoutLibrarySource__only_manual" RENAME TO "WorkoutLibrarySource";

    ALTER TABLE "WorkoutLibrarySession"
      ALTER COLUMN "source" SET DEFAULT 'MANUAL';
  ELSE
    CREATE TYPE "WorkoutLibrarySource" AS ENUM ('MANUAL');

    -- Column should already be MANUAL-compatible, but ensure it uses the enum type.
    ALTER TABLE "WorkoutLibrarySession"
      ALTER COLUMN "source" DROP DEFAULT;

    ALTER TABLE "WorkoutLibrarySession"
      ALTER COLUMN "source" TYPE "WorkoutLibrarySource"
      USING ("source"::text::"WorkoutLibrarySource");

    ALTER TABLE "WorkoutLibrarySession"
      ALTER COLUMN "source" SET DEFAULT 'MANUAL';
  END IF;
END $$;
