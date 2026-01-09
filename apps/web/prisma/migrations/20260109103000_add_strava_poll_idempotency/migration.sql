/*
  Strava polling sync support

  - Adds idempotency fields to CompletedActivity for external provider imports
  - Adds lastSyncAt watermark to StravaConnection
*/

-- AlterTable
ALTER TABLE "CompletedActivity" ADD COLUMN     "externalProvider" TEXT;
ALTER TABLE "CompletedActivity" ADD COLUMN     "externalActivityId" TEXT;

-- AlterTable
ALTER TABLE "StravaConnection" ADD COLUMN     "lastSyncAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "CompletedActivity_source_externalActivityId_key" ON "CompletedActivity"("source", "externalActivityId");
