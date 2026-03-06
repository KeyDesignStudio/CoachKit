ALTER TABLE "PlanSourceSessionTemplate"
ADD COLUMN "recipeV2Json" JSONB,
ADD COLUMN "parserConfidence" DOUBLE PRECISION,
ADD COLUMN "parserWarningsJson" JSONB;

CREATE TYPE "CoachWorkoutExemplarSourceType" AS ENUM ('COACH_EDIT', 'MANUAL_PROMOTION');

CREATE TYPE "CoachWorkoutExemplarFeedbackType" AS ENUM (
  'PROMOTED',
  'UPDATED',
  'GOOD_FIT',
  'EDITED',
  'TOO_EASY',
  'TOO_HARD',
  'ARCHIVED'
);

CREATE TABLE "CoachWorkoutExemplar" (
  "id" TEXT NOT NULL,
  "coachId" TEXT NOT NULL,
  "athleteId" TEXT,
  "sourceType" "CoachWorkoutExemplarSourceType" NOT NULL DEFAULT 'COACH_EDIT',
  "sourceDraftId" TEXT,
  "sourceDraftSessionId" TEXT,
  "fingerprintSha256" TEXT NOT NULL,
  "discipline" TEXT NOT NULL,
  "sessionType" TEXT NOT NULL,
  "title" TEXT,
  "durationMinutes" INTEGER,
  "distanceKm" DOUBLE PRECISION,
  "objective" TEXT,
  "notes" TEXT,
  "recipeV2Json" JSONB NOT NULL,
  "detailJson" JSONB,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "usageCount" INTEGER NOT NULL DEFAULT 0,
  "positiveFeedbackCount" INTEGER NOT NULL DEFAULT 0,
  "editFeedbackCount" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CoachWorkoutExemplar_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CoachWorkoutExemplarFeedback" (
  "id" TEXT NOT NULL,
  "exemplarId" TEXT NOT NULL,
  "coachId" TEXT NOT NULL,
  "athleteId" TEXT,
  "draftId" TEXT,
  "draftSessionId" TEXT,
  "feedbackType" "CoachWorkoutExemplarFeedbackType" NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CoachWorkoutExemplarFeedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CoachWorkoutExemplar_coachId_fingerprintSha256_key"
ON "CoachWorkoutExemplar"("coachId", "fingerprintSha256");

CREATE INDEX "CoachWorkoutExemplar_coachId_discipline_sessionType_isActive_idx"
ON "CoachWorkoutExemplar"("coachId", "discipline", "sessionType", "isActive");

CREATE INDEX "CoachWorkoutExemplar_coachId_sourceDraftSessionId_idx"
ON "CoachWorkoutExemplar"("coachId", "sourceDraftSessionId");

CREATE INDEX "CoachWorkoutExemplarFeedback_exemplarId_createdAt_idx"
ON "CoachWorkoutExemplarFeedback"("exemplarId", "createdAt");

CREATE INDEX "CoachWorkoutExemplarFeedback_coachId_feedbackType_createdAt_idx"
ON "CoachWorkoutExemplarFeedback"("coachId", "feedbackType", "createdAt");

ALTER TABLE "CoachWorkoutExemplarFeedback"
ADD CONSTRAINT "CoachWorkoutExemplarFeedback_exemplarId_fkey"
FOREIGN KEY ("exemplarId") REFERENCES "CoachWorkoutExemplar"("id") ON DELETE CASCADE ON UPDATE CASCADE;
