-- AI Plan Builder (v1) — Tranche 4 (publish to athlete)
-- Additive, AI-domain only. No writes to existing plan tables.

-- Publish visibility enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'aiplandraftvisibilitystatus') THEN
    CREATE TYPE "AiPlanDraftVisibilityStatus" AS ENUM ('DRAFT', 'PUBLISHED');
  END IF;
END $$;

-- Extend AiPlanDraft with publish fields
ALTER TABLE "AiPlanDraft"
  ADD COLUMN IF NOT EXISTS "visibilityStatus" "AiPlanDraftVisibilityStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "publishedByCoachId" TEXT,
  ADD COLUMN IF NOT EXISTS "lastPublishedHash" TEXT,
  ADD COLUMN IF NOT EXISTS "lastPublishedSummaryText" TEXT;

CREATE INDEX IF NOT EXISTS "AiPlanDraft_visibilityStatus_publishedAt_idx" ON "AiPlanDraft"("visibilityStatus", "publishedAt");

-- Publish snapshots
CREATE TABLE IF NOT EXISTS "AiPlanDraftPublishSnapshot" (
  "id" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "athleteId" TEXT NOT NULL,
  "coachId" TEXT NOT NULL,
  "hash" TEXT NOT NULL,
  "planJson" JSONB NOT NULL,
  "summaryText" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedByCoachId" TEXT,
  CONSTRAINT "AiPlanDraftPublishSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AiPlanDraftPublishSnapshot_draftId_hash_key" ON "AiPlanDraftPublishSnapshot"("draftId", "hash");
CREATE INDEX IF NOT EXISTS "AiPlanDraftPublishSnapshot_draftId_publishedAt_idx" ON "AiPlanDraftPublishSnapshot"("draftId", "publishedAt");
CREATE INDEX IF NOT EXISTS "AiPlanDraftPublishSnapshot_athleteId_publishedAt_idx" ON "AiPlanDraftPublishSnapshot"("athleteId", "publishedAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiPlanDraftPublishSnapshot_draftId_fkey') THEN
    ALTER TABLE "AiPlanDraftPublishSnapshot" ADD CONSTRAINT "AiPlanDraftPublishSnapshot_draftId_fkey"
      FOREIGN KEY ("draftId") REFERENCES "AiPlanDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
