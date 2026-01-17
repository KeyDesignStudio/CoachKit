-- CreateEnum
CREATE TYPE "WorkoutLibraryIntensityCategory" AS ENUM ('Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'RPE', 'OTHER');

-- AlterTable
ALTER TABLE "WorkoutLibrarySession" ADD COLUMN     "intensityCategory" "WorkoutLibraryIntensityCategory";

-- Backfill (best-effort)
UPDATE "WorkoutLibrarySession" SET "intensityCategory" = 'Z1'
WHERE "intensityTarget" ~* '(^|\\W)z1(\\W|$)';

UPDATE "WorkoutLibrarySession" SET "intensityCategory" = 'Z2'
WHERE "intensityTarget" ~* '(^|\\W)z2(\\W|$)';

UPDATE "WorkoutLibrarySession" SET "intensityCategory" = 'Z3'
WHERE "intensityTarget" ~* '(^|\\W)z3(\\W|$)';

UPDATE "WorkoutLibrarySession" SET "intensityCategory" = 'Z4'
WHERE "intensityTarget" ~* '(^|\\W)z4(\\W|$)';

UPDATE "WorkoutLibrarySession" SET "intensityCategory" = 'Z5'
WHERE "intensityTarget" ~* '(^|\\W)z5(\\W|$)';

UPDATE "WorkoutLibrarySession" SET "intensityCategory" = 'RPE'
WHERE "intensityTarget" ~* '(^|\\W)rpe(\\W|$)';

UPDATE "WorkoutLibrarySession" SET "intensityCategory" = 'OTHER'
WHERE "intensityCategory" IS NULL;

-- CreateIndex
CREATE INDEX "WorkoutLibrarySession_intensityCategory_idx" ON "WorkoutLibrarySession"("intensityCategory");
