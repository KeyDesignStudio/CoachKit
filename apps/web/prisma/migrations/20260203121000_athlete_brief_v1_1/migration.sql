-- Add v1.1 athlete brief metadata columns
ALTER TABLE "AthleteBrief" ADD COLUMN "summaryText" TEXT;
ALTER TABLE "AthleteBrief" ADD COLUMN "riskFlags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "AthleteBrief" ADD COLUMN "sourcesPresent" JSONB;
ALTER TABLE "AthleteBrief" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
