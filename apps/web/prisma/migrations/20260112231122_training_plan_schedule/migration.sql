-- CreateEnum
CREATE TYPE "TrainingPlanFrequency" AS ENUM ('WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'AD_HOC');

-- AlterTable
ALTER TABLE "AthleteProfile" ADD COLUMN     "trainingPlanDayOfWeek" INTEGER,
ADD COLUMN     "trainingPlanFrequency" "TrainingPlanFrequency" NOT NULL DEFAULT 'AD_HOC',
ADD COLUMN     "trainingPlanWeekOfMonth" INTEGER;

-- Backfill Training Plan frequency from existing cadence
UPDATE "AthleteProfile"
SET "trainingPlanFrequency" = CASE
	WHEN "planCadenceDays" = 7 THEN 'WEEKLY'::"TrainingPlanFrequency"
	WHEN "planCadenceDays" = 14 THEN 'FORTNIGHTLY'::"TrainingPlanFrequency"
	ELSE 'AD_HOC'::"TrainingPlanFrequency"
END;
