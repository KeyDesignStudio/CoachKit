-- APB: Persist per-session detail JSON + idempotency hash

ALTER TABLE "AiPlanDraftSession" ADD COLUMN "detailJson" JSONB;
ALTER TABLE "AiPlanDraftSession" ADD COLUMN "detailInputHash" TEXT;
ALTER TABLE "AiPlanDraftSession" ADD COLUMN "detailGeneratedAt" TIMESTAMP(3);
ALTER TABLE "AiPlanDraftSession" ADD COLUMN "detailMode" TEXT;

-- Helpful lookup indexes
CREATE INDEX "AiPlanDraftSession_draftId_id_idx" ON "AiPlanDraftSession"("draftId", "id");
CREATE INDEX "AiPlanDraftSession_draftId_detailInputHash_idx" ON "AiPlanDraftSession"("draftId", "detailInputHash");
