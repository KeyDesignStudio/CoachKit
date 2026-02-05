-- Create enums for PlanSource v1
CREATE TYPE "PlanSourceType" AS ENUM ('PDF', 'URL', 'TEXT');
CREATE TYPE "PlanSport" AS ENUM ('TRIATHLON', 'DUATHLON', 'RUN', 'BIKE', 'SWIM');
CREATE TYPE "PlanDistance" AS ENUM (
  'SPRINT',
  'OLYMPIC',
  'HALF_IRONMAN',
  'IRONMAN',
  'DUATHLON_STD',
  'DUATHLON_SPRINT',
  'FIVE_K',
  'TEN_K',
  'HALF_MARATHON',
  'MARATHON',
  'OTHER'
);
CREATE TYPE "PlanLevel" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');
CREATE TYPE "PlanSeason" AS ENUM ('IN_SEASON', 'BASE', 'WINTER', 'BUILD', 'PEAK', 'TAPER');
CREATE TYPE "PlanPhase" AS ENUM ('BASE', 'BUILD', 'PEAK', 'TAPER', 'RACE', 'RECOVERY');
CREATE TYPE "RuleType" AS ENUM (
  'DISCIPLINE_SPLIT',
  'WEEKLY_VOLUME',
  'LONG_SESSION',
  'INTENSITY_DENSITY',
  'BRICKS',
  'DELoad',
  'FREQUENCY',
  'REST_DAYS',
  'PROGRESSION_CAP',
  'EQUIPMENT_ASSUMPTIONS',
  'RISK_GUARDS',
  'NOTES_STYLE'
);
CREATE TYPE "PlanSourceDiscipline" AS ENUM ('SWIM', 'BIKE', 'RUN', 'STRENGTH', 'REST');

-- PlanSource tables
CREATE TABLE "PlanSource" (
  "id" TEXT NOT NULL,
  "type" "PlanSourceType" NOT NULL,
  "title" TEXT NOT NULL,
  "sport" "PlanSport" NOT NULL,
  "distance" "PlanDistance" NOT NULL,
  "level" "PlanLevel" NOT NULL,
  "durationWeeks" INTEGER NOT NULL,
  "season" "PlanSeason",
  "author" TEXT,
  "publisher" TEXT,
  "licenseText" TEXT,
  "sourceUrl" TEXT,
  "sourceFilePath" TEXT,
  "checksumSha256" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "rawText" TEXT NOT NULL,
  "rawJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PlanSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlanSource_checksumSha256_key" ON "PlanSource"("checksumSha256");

CREATE TABLE "PlanSourceVersion" (
  "id" TEXT NOT NULL,
  "planSourceId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "extractionMetaJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PlanSourceVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlanSourceVersion_planSourceId_version_key" ON "PlanSourceVersion"("planSourceId", "version");
CREATE INDEX "PlanSourceVersion_planSourceId_version_idx" ON "PlanSourceVersion"("planSourceId", "version");

CREATE TABLE "PlanSourceWeekTemplate" (
  "id" TEXT NOT NULL,
  "planSourceVersionId" TEXT NOT NULL,
  "weekIndex" INTEGER NOT NULL,
  "phase" "PlanPhase",
  "totalMinutes" INTEGER,
  "totalSessions" INTEGER,
  "notes" TEXT,

  CONSTRAINT "PlanSourceWeekTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlanSourceWeekTemplate_planSourceVersionId_weekIndex_key" ON "PlanSourceWeekTemplate"("planSourceVersionId", "weekIndex");
CREATE INDEX "PlanSourceWeekTemplate_planSourceVersionId_weekIndex_idx" ON "PlanSourceWeekTemplate"("planSourceVersionId", "weekIndex");

CREATE TABLE "PlanSourceSessionTemplate" (
  "id" TEXT NOT NULL,
  "planSourceWeekTemplateId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "dayOfWeek" INTEGER,
  "discipline" "PlanSourceDiscipline" NOT NULL,
  "sessionType" TEXT NOT NULL,
  "title" TEXT,
  "durationMinutes" INTEGER,
  "distanceKm" DOUBLE PRECISION,
  "intensityType" TEXT,
  "intensityTargetJson" JSONB,
  "structureJson" JSONB,
  "notes" TEXT,

  CONSTRAINT "PlanSourceSessionTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlanSourceSessionTemplate_planSourceWeekTemplateId_ordinal_key" ON "PlanSourceSessionTemplate"("planSourceWeekTemplateId", "ordinal");
CREATE INDEX "PlanSourceSessionTemplate_planSourceWeekTemplateId_dayOfWeek_idx" ON "PlanSourceSessionTemplate"("planSourceWeekTemplateId", "dayOfWeek");

CREATE TABLE "PlanSourceRule" (
  "id" TEXT NOT NULL,
  "planSourceVersionId" TEXT NOT NULL,
  "ruleType" "RuleType" NOT NULL,
  "phase" "PlanPhase",
  "appliesJson" JSONB NOT NULL,
  "ruleJson" JSONB NOT NULL,
  "explanation" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PlanSourceRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlanSourceRule_planSourceVersionId_ruleType_idx" ON "PlanSourceRule"("planSourceVersionId", "ruleType");
CREATE INDEX "PlanSourceRule_planSourceVersionId_phase_idx" ON "PlanSourceRule"("planSourceVersionId", "phase");

ALTER TABLE "PlanSourceVersion" ADD CONSTRAINT "PlanSourceVersion_planSourceId_fkey" FOREIGN KEY ("planSourceId") REFERENCES "PlanSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanSourceWeekTemplate" ADD CONSTRAINT "PlanSourceWeekTemplate_planSourceVersionId_fkey" FOREIGN KEY ("planSourceVersionId") REFERENCES "PlanSourceVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanSourceSessionTemplate" ADD CONSTRAINT "PlanSourceSessionTemplate_planSourceWeekTemplateId_fkey" FOREIGN KEY ("planSourceWeekTemplateId") REFERENCES "PlanSourceWeekTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanSourceRule" ADD CONSTRAINT "PlanSourceRule_planSourceVersionId_fkey" FOREIGN KEY ("planSourceVersionId") REFERENCES "PlanSourceVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Draft selection metadata
ALTER TABLE "AiPlanDraft" ADD COLUMN "planSourceSelectionJson" JSONB;
