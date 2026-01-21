-- Add publish audit fields for Workout Library sessions.

ALTER TABLE "WorkoutLibrarySession"
  ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "publishedByUserId" TEXT;

-- Foreign key (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'WorkoutLibrarySession_publishedByUserId_fkey'
  ) THEN
    ALTER TABLE "WorkoutLibrarySession"
      ADD CONSTRAINT "WorkoutLibrarySession_publishedByUserId_fkey"
      FOREIGN KEY ("publishedByUserId")
      REFERENCES "User"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "WorkoutLibrarySession_publishedAt_idx" ON "WorkoutLibrarySession"("publishedAt");
