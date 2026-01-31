-- Tranche 10: controlled rollout + guardrails + metadata-only AI audits

-- CreateEnum
CREATE TYPE "AiInvocationActorType" AS ENUM ('COACH', 'ATHLETE', 'SYSTEM');

-- CreateTable
CREATE TABLE "AiLlmRateLimitEvent" (
  "id" TEXT NOT NULL,
  "actorType" "AiInvocationActorType" NOT NULL,
  "actorId" TEXT NOT NULL,
  "capability" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "coachId" TEXT,
  "athleteId" TEXT,

  CONSTRAINT "AiLlmRateLimitEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiInvocationAudit" (
  "id" TEXT NOT NULL,
  "actorType" "AiInvocationActorType" NOT NULL,
  "actorId" TEXT NOT NULL,
  "coachId" TEXT,
  "athleteId" TEXT,

  "capability" TEXT NOT NULL,
  "specVersion" TEXT NOT NULL,
  "effectiveMode" TEXT NOT NULL,

  "provider" TEXT NOT NULL,
  "model" TEXT,

  "inputHash" TEXT NOT NULL,
  "outputHash" TEXT NOT NULL,

  "durationMs" INTEGER NOT NULL,
  "retryCount" INTEGER NOT NULL,
  "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
  "errorCode" TEXT,

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AiInvocationAudit_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "AiLlmRateLimitEvent_actorType_actorId_createdAt_idx" ON "AiLlmRateLimitEvent"("actorType", "actorId", "createdAt");
CREATE INDEX "AiLlmRateLimitEvent_capability_createdAt_idx" ON "AiLlmRateLimitEvent"("capability", "createdAt");
CREATE INDEX "AiLlmRateLimitEvent_coachId_createdAt_idx" ON "AiLlmRateLimitEvent"("coachId", "createdAt");
CREATE INDEX "AiLlmRateLimitEvent_athleteId_createdAt_idx" ON "AiLlmRateLimitEvent"("athleteId", "createdAt");

CREATE INDEX "AiInvocationAudit_actorType_actorId_createdAt_idx" ON "AiInvocationAudit"("actorType", "actorId", "createdAt");
CREATE INDEX "AiInvocationAudit_capability_createdAt_idx" ON "AiInvocationAudit"("capability", "createdAt");
CREATE INDEX "AiInvocationAudit_coachId_createdAt_idx" ON "AiInvocationAudit"("coachId", "createdAt");
CREATE INDEX "AiInvocationAudit_athleteId_createdAt_idx" ON "AiInvocationAudit"("athleteId", "createdAt");

-- Foreign keys
ALTER TABLE "AiLlmRateLimitEvent" ADD CONSTRAINT "AiLlmRateLimitEvent_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiLlmRateLimitEvent" ADD CONSTRAINT "AiLlmRateLimitEvent_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AiInvocationAudit" ADD CONSTRAINT "AiInvocationAudit_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiInvocationAudit" ADD CONSTRAINT "AiInvocationAudit_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE SET NULL ON UPDATE CASCADE;
