/*
  Strava autosync: webhook debounce + cron batching

  - Adds StravaSyncIntent to record webhook-triggered sync intents
  - Supports per-athlete backoff/lease to avoid sync storms
*/

-- CreateTable
CREATE TABLE "StravaSyncIntent" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "pending" BOOLEAN NOT NULL DEFAULT true,
    "lastEventAt" TIMESTAMP(3) NOT NULL,
    "lastActivityId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StravaSyncIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StravaSyncIntent_athleteId_key" ON "StravaSyncIntent"("athleteId");

-- CreateIndex
CREATE INDEX "StravaSyncIntent_pending_nextAttemptAt_idx" ON "StravaSyncIntent"("pending", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "StravaSyncIntent_pending_lockedUntil_idx" ON "StravaSyncIntent"("pending", "lockedUntil");

-- CreateIndex
CREATE INDEX "StravaSyncIntent_lastEventAt_idx" ON "StravaSyncIntent"("lastEventAt" DESC);

-- AddForeignKey
ALTER TABLE "StravaSyncIntent" ADD CONSTRAINT "StravaSyncIntent_athleteId_fkey"
FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
