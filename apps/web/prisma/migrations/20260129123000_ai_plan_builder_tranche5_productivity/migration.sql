-- Tranche 5: athlete publish acknowledgements + performance indexes

-- CreateTable
CREATE TABLE "AiPlanPublishAck" (
  "id" TEXT NOT NULL,
  "athleteId" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "lastSeenPublishedHash" TEXT NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AiPlanPublishAck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiPlanPublishAck_athleteId_draftId_key" ON "AiPlanPublishAck"("athleteId", "draftId");
CREATE INDEX "AiPlanPublishAck_athleteId_draftId_idx" ON "AiPlanPublishAck"("athleteId", "draftId");

-- AddForeignKey
ALTER TABLE "AiPlanPublishAck" ADD CONSTRAINT "AiPlanPublishAck_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiPlanPublishAck" ADD CONSTRAINT "AiPlanPublishAck_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "AiPlanDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hot-path indexes
CREATE INDEX "AdaptationTrigger_draftId_triggerType_createdAt_idx" ON "AdaptationTrigger"("draftId", "triggerType", "createdAt");
CREATE INDEX "PlanChangeProposal_draftPlanId_status_createdAt_idx" ON "PlanChangeProposal"("draftPlanId", "status", "createdAt");
