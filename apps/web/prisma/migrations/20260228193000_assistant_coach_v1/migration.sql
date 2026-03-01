-- Assistant Coach V1 (additive)

-- Enums
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'assistantpatterncategory') THEN
    CREATE TYPE "AssistantPatternCategory" AS ENUM ('ADHERENCE', 'READINESS', 'DURABILITY', 'ENVIRONMENT', 'RISK');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'assistantdefinitionstatus') THEN
    CREATE TYPE "AssistantDefinitionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DEPRECATED');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'assistantseverity') THEN
    CREATE TYPE "AssistantSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'assistantdetectionstate') THEN
    CREATE TYPE "AssistantDetectionState" AS ENUM ('NEW', 'VIEWED', 'DISMISSED', 'SNOOZED', 'ACTIONED');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'assistantrecommendationtype') THEN
    CREATE TYPE "AssistantRecommendationType" AS ENUM (
      'PLAN_ADJUSTMENT',
      'SESSION_SWAP',
      'INTENSITY_REDUCE',
      'SCHEDULE_SHIFT',
      'EDUCATION',
      'MESSAGE_ONLY'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'assistantllmoutputtype') THEN
    CREATE TYPE "AssistantLlmOutputType" AS ENUM ('COACH_SUMMARY', 'ATHLETE_MESSAGE_DRAFT', 'RATIONALE', 'CHATBOT_CONTEXT_PACK');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'assistantactiontype') THEN
    CREATE TYPE "AssistantActionType" AS ENUM ('APPLY_PLAN_CHANGE', 'SEND_MESSAGE', 'EDIT_MESSAGE', 'DISMISS', 'SNOOZE', 'OPEN_CHAT');
  END IF;
END $$;

-- Tables
CREATE TABLE IF NOT EXISTS "AssistantDailyMetric" (
  "id" TEXT NOT NULL,
  "athleteId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "sleepHours" DOUBLE PRECISION,
  "fatigueScore" INTEGER,
  "hrv" DOUBLE PRECISION,
  "restingHr" DOUBLE PRECISION,
  "stressScore" INTEGER,
  "moodScore" INTEGER,
  "notes" TEXT,
  "source" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssistantDailyMetric_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AssistantPatternDefinition" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" "AssistantPatternCategory" NOT NULL,
  "description" TEXT NOT NULL,
  "status" "AssistantDefinitionStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL,
  "severityDefault" "AssistantSeverity" NOT NULL DEFAULT 'MEDIUM',
  "cooldownDays" INTEGER NOT NULL DEFAULT 7,
  "logicConfig" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssistantPatternDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AssistantDetection" (
  "id" TEXT NOT NULL,
  "athleteId" TEXT NOT NULL,
  "coachId" TEXT NOT NULL,
  "patternDefinitionId" TEXT NOT NULL,
  "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "severity" "AssistantSeverity" NOT NULL,
  "confidenceScore" INTEGER NOT NULL,
  "evidence" JSONB NOT NULL,
  "state" "AssistantDetectionState" NOT NULL DEFAULT 'NEW',
  "dismissReason" TEXT,
  "snoozedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssistantDetection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AssistantRecommendation" (
  "id" TEXT NOT NULL,
  "detectionId" TEXT NOT NULL,
  "recommendationType" "AssistantRecommendationType" NOT NULL,
  "title" TEXT NOT NULL,
  "details" JSONB NOT NULL,
  "estimatedImpact" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssistantRecommendation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AssistantLlmOutput" (
  "id" TEXT NOT NULL,
  "detectionId" TEXT NOT NULL,
  "outputType" "AssistantLlmOutputType" NOT NULL,
  "content" TEXT NOT NULL,
  "model" TEXT,
  "promptVersion" TEXT NOT NULL,
  "tokenUsage" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssistantLlmOutput_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AssistantAction" (
  "id" TEXT NOT NULL,
  "coachId" TEXT NOT NULL,
  "athleteId" TEXT NOT NULL,
  "detectionId" TEXT NOT NULL,
  "actionType" "AssistantActionType" NOT NULL,
  "actionPayload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssistantAction_pkey" PRIMARY KEY ("id")
);

-- Unique indexes
CREATE UNIQUE INDEX IF NOT EXISTS "AssistantDailyMetric_athleteId_date_key" ON "AssistantDailyMetric"("athleteId", "date");
CREATE UNIQUE INDEX IF NOT EXISTS "AssistantPatternDefinition_key_key" ON "AssistantPatternDefinition"("key");
CREATE UNIQUE INDEX IF NOT EXISTS "AssistantPatternDefinition_key_version_key" ON "AssistantPatternDefinition"("key", "version");

-- Secondary indexes
CREATE INDEX IF NOT EXISTS "AssistantDailyMetric_athleteId_date_idx" ON "AssistantDailyMetric"("athleteId", "date");
CREATE INDEX IF NOT EXISTS "AssistantPatternDefinition_status_category_idx" ON "AssistantPatternDefinition"("status", "category");
CREATE INDEX IF NOT EXISTS "AssistantDetection_coachId_state_detectedAt_idx" ON "AssistantDetection"("coachId", "state", "detectedAt");
CREATE INDEX IF NOT EXISTS "AssistantDetection_athleteId_detectedAt_idx" ON "AssistantDetection"("athleteId", "detectedAt");
CREATE INDEX IF NOT EXISTS "AssistantDetection_patternDefinitionId_detectedAt_idx" ON "AssistantDetection"("patternDefinitionId", "detectedAt");
CREATE INDEX IF NOT EXISTS "AssistantRecommendation_detectionId_idx" ON "AssistantRecommendation"("detectionId");
CREATE INDEX IF NOT EXISTS "AssistantLlmOutput_detectionId_outputType_createdAt_idx" ON "AssistantLlmOutput"("detectionId", "outputType", "createdAt");
CREATE INDEX IF NOT EXISTS "AssistantAction_coachId_createdAt_idx" ON "AssistantAction"("coachId", "createdAt");
CREATE INDEX IF NOT EXISTS "AssistantAction_athleteId_createdAt_idx" ON "AssistantAction"("athleteId", "createdAt");
CREATE INDEX IF NOT EXISTS "AssistantAction_detectionId_createdAt_idx" ON "AssistantAction"("detectionId", "createdAt");

-- Foreign keys
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssistantDailyMetric_athleteId_fkey') THEN
    ALTER TABLE "AssistantDailyMetric" ADD CONSTRAINT "AssistantDailyMetric_athleteId_fkey"
      FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssistantDetection_athleteId_fkey') THEN
    ALTER TABLE "AssistantDetection" ADD CONSTRAINT "AssistantDetection_athleteId_fkey"
      FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssistantDetection_coachId_fkey') THEN
    ALTER TABLE "AssistantDetection" ADD CONSTRAINT "AssistantDetection_coachId_fkey"
      FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssistantDetection_patternDefinitionId_fkey') THEN
    ALTER TABLE "AssistantDetection" ADD CONSTRAINT "AssistantDetection_patternDefinitionId_fkey"
      FOREIGN KEY ("patternDefinitionId") REFERENCES "AssistantPatternDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssistantRecommendation_detectionId_fkey') THEN
    ALTER TABLE "AssistantRecommendation" ADD CONSTRAINT "AssistantRecommendation_detectionId_fkey"
      FOREIGN KEY ("detectionId") REFERENCES "AssistantDetection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssistantLlmOutput_detectionId_fkey') THEN
    ALTER TABLE "AssistantLlmOutput" ADD CONSTRAINT "AssistantLlmOutput_detectionId_fkey"
      FOREIGN KEY ("detectionId") REFERENCES "AssistantDetection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssistantAction_coachId_fkey') THEN
    ALTER TABLE "AssistantAction" ADD CONSTRAINT "AssistantAction_coachId_fkey"
      FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssistantAction_athleteId_fkey') THEN
    ALTER TABLE "AssistantAction" ADD CONSTRAINT "AssistantAction_athleteId_fkey"
      FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssistantAction_detectionId_fkey') THEN
    ALTER TABLE "AssistantAction" ADD CONSTRAINT "AssistantAction_detectionId_fkey"
      FOREIGN KEY ("detectionId") REFERENCES "AssistantDetection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
