-- Canonical AthleteProfile fields
ALTER TABLE "AthleteProfile"
  ADD COLUMN "firstName" TEXT,
  ADD COLUMN "lastName" TEXT,
  ADD COLUMN "gender" TEXT,
  ADD COLUMN "timezone" TEXT,
  ADD COLUMN "trainingSuburb" TEXT,
  ADD COLUMN "email" TEXT,
  ADD COLUMN "mobilePhone" TEXT,
  ADD COLUMN "primaryGoal" TEXT,
  ADD COLUMN "secondaryGoals" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "focus" TEXT,
  ADD COLUMN "eventName" TEXT,
  ADD COLUMN "eventDate" TIMESTAMP(3),
  ADD COLUMN "timelineWeeks" INTEGER,
  ADD COLUMN "experienceLevel" TEXT,
  ADD COLUMN "weeklyMinutesTarget" INTEGER,
  ADD COLUMN "consistencyLevel" TEXT,
  ADD COLUMN "swimConfidence" INTEGER,
  ADD COLUMN "bikeConfidence" INTEGER,
  ADD COLUMN "runConfidence" INTEGER,
  ADD COLUMN "availableDays" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "scheduleVariability" TEXT,
  ADD COLUMN "sleepQuality" TEXT,
  ADD COLUMN "equipmentAccess" TEXT,
  ADD COLUMN "travelConstraints" TEXT,
  ADD COLUMN "injuryStatus" TEXT,
  ADD COLUMN "constraintsNotes" TEXT,
  ADD COLUMN "feedbackStyle" TEXT,
  ADD COLUMN "tonePreference" TEXT,
  ADD COLUMN "checkInCadence" TEXT,
  ADD COLUMN "structurePreference" INTEGER,
  ADD COLUMN "motivationStyle" TEXT,
  ADD COLUMN "trainingPlanSchedule" JSONB,
  ADD COLUMN "painHistory" JSONB,
  ADD COLUMN "coachJournal" TEXT;

-- Backfill canonical fields from legacy/user data where available
UPDATE "AthleteProfile" AS ap
SET
  "primaryGoal" = COALESCE(ap."primaryGoal", ap."goalsText"),
  "trainingPlanSchedule" = COALESCE(
    ap."trainingPlanSchedule",
    jsonb_build_object(
      'frequency', ap."trainingPlanFrequency",
      'dayOfWeek', ap."trainingPlanDayOfWeek",
      'weekOfMonth', ap."trainingPlanWeekOfMonth"
    )
  ),
  "timezone" = COALESCE(ap."timezone", u."timezone"),
  "email" = COALESCE(ap."email", u."email"),
  "firstName" = COALESCE(ap."firstName", u."name")
FROM "User" AS u
WHERE ap."userId" = u."id";
