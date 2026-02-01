-- APB: Persist intake source + mode metadata

ALTER TABLE "AthleteIntakeResponse" ADD COLUMN "source" TEXT;
ALTER TABLE "AthleteIntakeResponse" ADD COLUMN "aiMode" TEXT;

-- Helpful lookup indexes
CREATE INDEX "AthleteIntakeResponse_source_createdAt_idx" ON "AthleteIntakeResponse"("source", "createdAt");
CREATE INDEX "AthleteIntakeResponse_aiMode_createdAt_idx" ON "AthleteIntakeResponse"("aiMode", "createdAt");
