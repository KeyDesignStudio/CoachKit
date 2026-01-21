-- Plan Library: idempotent schedule imports
--
-- This migration hardens PlanTemplateScheduleRow uniqueness by introducing an ordinal
-- and replacing the overly-broad unique constraint on (planTemplateId, dayIndex).

-- 1) Add ordinal (default 0 so existing rows remain stable)
ALTER TABLE "PlanTemplateScheduleRow"
ADD COLUMN IF NOT EXISTS "ordinal" INTEGER NOT NULL DEFAULT 0;

-- 2) Drop old unique index (created by Phase 1)
DROP INDEX IF EXISTS "PlanTemplateScheduleRow_planTemplateId_dayIndex_key";

-- 3) Add new unique index for idempotent imports
CREATE UNIQUE INDEX IF NOT EXISTS "PlanTemplateScheduleRow_planTemplateId_weekIndex_dayIndex_ordinal_key"
ON "PlanTemplateScheduleRow" ("planTemplateId", "weekIndex", "dayIndex", "ordinal");
