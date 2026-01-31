-- AI Plan Builder (v1) — Tranche 3 (adaptations)
-- Additive, draft-only. No coupling to active plan tables.

-- Create enums (idempotent-ish: CREATE TYPE IF NOT EXISTS isn't supported for enums on older PG)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'athletesessionfeedbackcompletedstatus') THEN
    CREATE TYPE "AthleteSessionFeedbackCompletedStatus" AS ENUM ('DONE', 'PARTIAL', 'SKIPPED');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'athletesessionfeedbackfeel') THEN
    CREATE TYPE "AthleteSessionFeedbackFeel" AS ENUM ('EASY', 'OK', 'HARD', 'TOO_HARD');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'adaptationtriggertype') THEN
    CREATE TYPE "AdaptationTriggerType" AS ENUM ('MISSED_KEY', 'SORENESS', 'TOO_HARD', 'HIGH_COMPLIANCE');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'planchangeauditactortype') THEN
    CREATE TYPE "PlanChangeAuditActorType" AS ENUM ('COACH', 'AI_SYSTEM');
  END IF;
END $$;

-- Expand proposal status enum (safe if values already exist)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'planchangeproposalstatus' AND e.enumlabel = 'PROPOSED'
  ) THEN
    ALTER TYPE "PlanChangeProposalStatus" ADD VALUE 'PROPOSED';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'planchangeproposalstatus' AND e.enumlabel = 'APPROVED'
  ) THEN
    ALTER TYPE "PlanChangeProposalStatus" ADD VALUE 'APPROVED';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'planchangeproposalstatus' AND e.enumlabel = 'REJECTED'
  ) THEN
    ALTER TYPE "PlanChangeProposalStatus" ADD VALUE 'REJECTED';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'planchangeproposalstatus' AND e.enumlabel = 'APPLIED'
  ) THEN
    ALTER TYPE "PlanChangeProposalStatus" ADD VALUE 'APPLIED';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'planchangeproposalstatus' AND e.enumlabel = 'EXPIRED'
  ) THEN
    ALTER TYPE "PlanChangeProposalStatus" ADD VALUE 'EXPIRED';
  END IF;
END $$;

-- New tables
CREATE TABLE IF NOT EXISTS "AthleteSessionFeedback" (
  "id" TEXT NOT NULL,
  "athleteId" TEXT NOT NULL,
  "coachId" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "completedStatus" "AthleteSessionFeedbackCompletedStatus" NOT NULL,
  "rpe" INTEGER,
  "feel" "AthleteSessionFeedbackFeel",
  "sorenessFlag" BOOLEAN NOT NULL DEFAULT false,
  "sorenessNotes" TEXT,
  "sleepQuality" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AthleteSessionFeedback_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AdaptationTrigger" (
  "id" TEXT NOT NULL,
  "athleteId" TEXT NOT NULL,
  "coachId" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "triggerType" "AdaptationTriggerType" NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "windowEnd" TIMESTAMP(3) NOT NULL,
  "evidenceJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdaptationTrigger_pkey" PRIMARY KEY ("id")
);

-- Proposal + audit extensions
ALTER TABLE "PlanChangeProposal"
  ADD COLUMN IF NOT EXISTS "rationaleText" TEXT,
  ADD COLUMN IF NOT EXISTS "diffJson" JSONB,
  ADD COLUMN IF NOT EXISTS "triggerIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "respectsLocks" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "coachDecisionAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "appliedAt" TIMESTAMP(3);

ALTER TABLE "PlanChangeAudit"
  ADD COLUMN IF NOT EXISTS "actorType" "PlanChangeAuditActorType" NOT NULL DEFAULT 'COACH',
  ADD COLUMN IF NOT EXISTS "changeSummaryText" TEXT,
  ADD COLUMN IF NOT EXISTS "draftPlanId" TEXT;

-- Indexes
CREATE INDEX IF NOT EXISTS "AthleteSessionFeedback_athleteId_createdAt_idx" ON "AthleteSessionFeedback"("athleteId", "createdAt");
CREATE INDEX IF NOT EXISTS "AthleteSessionFeedback_draftId_createdAt_idx" ON "AthleteSessionFeedback"("draftId", "createdAt");
CREATE INDEX IF NOT EXISTS "AthleteSessionFeedback_sessionId_createdAt_idx" ON "AthleteSessionFeedback"("sessionId", "createdAt");

CREATE INDEX IF NOT EXISTS "AdaptationTrigger_athleteId_createdAt_idx" ON "AdaptationTrigger"("athleteId", "createdAt");
CREATE INDEX IF NOT EXISTS "AdaptationTrigger_draftId_createdAt_idx" ON "AdaptationTrigger"("draftId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "AdaptationTrigger_draftId_triggerType_windowStart_windowEnd_key" ON "AdaptationTrigger"("draftId", "triggerType", "windowStart", "windowEnd");

CREATE INDEX IF NOT EXISTS "PlanChangeAudit_draftPlanId_createdAt_idx" ON "PlanChangeAudit"("draftPlanId", "createdAt");

-- Foreign keys (add only if missing)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AthleteSessionFeedback_athleteId_fkey') THEN
    ALTER TABLE "AthleteSessionFeedback" ADD CONSTRAINT "AthleteSessionFeedback_athleteId_fkey"
      FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AthleteSessionFeedback_coachId_fkey') THEN
    ALTER TABLE "AthleteSessionFeedback" ADD CONSTRAINT "AthleteSessionFeedback_coachId_fkey"
      FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AthleteSessionFeedback_draftId_fkey') THEN
    ALTER TABLE "AthleteSessionFeedback" ADD CONSTRAINT "AthleteSessionFeedback_draftId_fkey"
      FOREIGN KEY ("draftId") REFERENCES "AiPlanDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AthleteSessionFeedback_sessionId_fkey') THEN
    ALTER TABLE "AthleteSessionFeedback" ADD CONSTRAINT "AthleteSessionFeedback_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "AiPlanDraftSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdaptationTrigger_athleteId_fkey') THEN
    ALTER TABLE "AdaptationTrigger" ADD CONSTRAINT "AdaptationTrigger_athleteId_fkey"
      FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdaptationTrigger_coachId_fkey') THEN
    ALTER TABLE "AdaptationTrigger" ADD CONSTRAINT "AdaptationTrigger_coachId_fkey"
      FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdaptationTrigger_draftId_fkey') THEN
    ALTER TABLE "AdaptationTrigger" ADD CONSTRAINT "AdaptationTrigger_draftId_fkey"
      FOREIGN KEY ("draftId") REFERENCES "AiPlanDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PlanChangeAudit_draftPlanId_fkey') THEN
    ALTER TABLE "PlanChangeAudit" ADD CONSTRAINT "PlanChangeAudit_draftPlanId_fkey"
      FOREIGN KEY ("draftPlanId") REFERENCES "AiPlanDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
