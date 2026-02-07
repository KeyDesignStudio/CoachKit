-- Add CronRun observability and Strava match metadata.

-- AlterTable
ALTER TABLE "CompletedActivity"
  ADD COLUMN "matchConfidence" TEXT,
  ADD COLUMN "matchScore" INTEGER,
  ADD COLUMN "matchDayDiff" INTEGER,
  ADD COLUMN "matchTimeDiffMinutes" INTEGER;

-- CreateTable
CREATE TABLE "CronRun" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "durationMs" INTEGER,
  "processedAthletes" INTEGER,
  "importedActivities" INTEGER,
  "matchedActivities" INTEGER,
  "unplannedActivities" INTEGER,
  "errorCount" INTEGER,
  "firstError" TEXT,
  "summaryJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CronRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CronRun_kind_startedAt_idx" ON "CronRun"("kind", "startedAt");

-- CreateIndex
CREATE INDEX "CronRun_status_startedAt_idx" ON "CronRun"("status", "startedAt");
