/*
  Strava autosync: per-activity intent queue

  - Replaces the per-athlete debounce intent with a per-activity intent queue
  - Enables webhook (fast 200) + cron drain by Strava activity id (idempotent)

  Note:
  - This migration drops and recreates StravaSyncIntent. Any pending intents will be lost.
*/

-- DropTable
DROP TABLE IF EXISTS "StravaSyncIntent";

-- DropEnum
DO $$ BEGIN
  DROP TYPE IF EXISTS "StravaSyncIntentStatus";
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

-- CreateEnum
CREATE TYPE "StravaSyncIntentStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "StravaSyncIntent" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "stravaAthleteId" TEXT NOT NULL,
    "stravaActivityId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" "StravaSyncIntentStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StravaSyncIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StravaSyncIntent_athleteId_stravaActivityId_key" ON "StravaSyncIntent"("athleteId", "stravaActivityId");

-- CreateIndex
CREATE INDEX "StravaSyncIntent_status_createdAt_idx" ON "StravaSyncIntent"("status", "createdAt");

-- CreateIndex
CREATE INDEX "StravaSyncIntent_athleteId_status_idx" ON "StravaSyncIntent"("athleteId", "status");

-- AddForeignKey
ALTER TABLE "StravaSyncIntent" ADD CONSTRAINT "StravaSyncIntent_athleteId_fkey"
FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
