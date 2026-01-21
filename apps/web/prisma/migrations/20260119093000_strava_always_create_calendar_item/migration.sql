/*
  Strava trust fix: always surface Strava activities in calendar

  - Adds CalendarItem origin/planningStatus/sourceActivityId to persist provider-origin sessions
  - Adjusts CompletedActivity idempotency to be per-athlete
*/

-- CalendarItem: support provider-origin sessions
ALTER TABLE "CalendarItem" ADD COLUMN     "origin" TEXT;
ALTER TABLE "CalendarItem" ADD COLUMN     "planningStatus" TEXT;
ALTER TABLE "CalendarItem" ADD COLUMN     "sourceActivityId" TEXT;

-- Ensure idempotent CalendarItem creation per athlete+provider activity
CREATE UNIQUE INDEX "CalendarItem_athleteId_origin_sourceActivityId_key"
ON "CalendarItem"("athleteId", "origin", "sourceActivityId");

-- CompletedActivity: idempotency should include athleteId
DROP INDEX IF EXISTS "CompletedActivity_source_externalActivityId_key";

CREATE UNIQUE INDEX "CompletedActivity_athleteId_source_externalActivityId_key"
ON "CompletedActivity"("athleteId", "source", "externalActivityId");
