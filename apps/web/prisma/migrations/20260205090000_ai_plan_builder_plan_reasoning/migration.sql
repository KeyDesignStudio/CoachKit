-- Add plan reasoning to draft plans
ALTER TABLE "AiPlanDraft" ADD COLUMN "reasoningJson" JSONB;
