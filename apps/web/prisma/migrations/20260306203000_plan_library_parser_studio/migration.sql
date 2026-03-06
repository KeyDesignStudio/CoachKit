CREATE TYPE "PlanSourceExtractionReviewStatus" AS ENUM ('NEEDS_REVIEW', 'APPROVED', 'REJECTED');

ALTER TABLE "PlanSource"
ADD COLUMN "layoutFamilyId" TEXT;

CREATE TABLE "PlanSourceLayoutFamily" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "familyType" TEXT NOT NULL,
  "description" TEXT,
  "extractorHintsJson" JSONB,
  "isPreset" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PlanSourceLayoutFamily_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlanSourceExtractionRun" (
  "id" TEXT NOT NULL,
  "planSourceId" TEXT NOT NULL,
  "planSourceVersionId" TEXT,
  "layoutFamilyId" TEXT,
  "extractorVersion" TEXT NOT NULL,
  "reviewStatus" "PlanSourceExtractionReviewStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
  "summaryJson" JSONB,
  "confidence" DOUBLE PRECISION,
  "warningCount" INTEGER NOT NULL DEFAULT 0,
  "sessionCount" INTEGER NOT NULL DEFAULT 0,
  "weekCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PlanSourceExtractionRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlanSourceExtractionReview" (
  "id" TEXT NOT NULL,
  "extractionRunId" TEXT NOT NULL,
  "reviewerUserId" TEXT NOT NULL,
  "reviewerEmail" TEXT NOT NULL,
  "status" "PlanSourceExtractionReviewStatus" NOT NULL,
  "notes" TEXT,
  "correctionSummaryJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PlanSourceExtractionReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlanSourceLayoutFamily_slug_key" ON "PlanSourceLayoutFamily"("slug");
CREATE INDEX "PlanSource_layoutFamilyId_idx" ON "PlanSource"("layoutFamilyId");
CREATE INDEX "PlanSourceExtractionRun_planSourceId_createdAt_idx" ON "PlanSourceExtractionRun"("planSourceId", "createdAt");
CREATE INDEX "PlanSourceExtractionRun_planSourceVersionId_idx" ON "PlanSourceExtractionRun"("planSourceVersionId");
CREATE INDEX "PlanSourceExtractionRun_layoutFamilyId_idx" ON "PlanSourceExtractionRun"("layoutFamilyId");
CREATE INDEX "PlanSourceExtractionRun_reviewStatus_createdAt_idx" ON "PlanSourceExtractionRun"("reviewStatus", "createdAt");
CREATE INDEX "PlanSourceExtractionReview_extractionRunId_createdAt_idx" ON "PlanSourceExtractionReview"("extractionRunId", "createdAt");
CREATE INDEX "PlanSourceExtractionReview_reviewerUserId_createdAt_idx" ON "PlanSourceExtractionReview"("reviewerUserId", "createdAt");

ALTER TABLE "PlanSource"
ADD CONSTRAINT "PlanSource_layoutFamilyId_fkey"
FOREIGN KEY ("layoutFamilyId") REFERENCES "PlanSourceLayoutFamily"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PlanSourceExtractionRun"
ADD CONSTRAINT "PlanSourceExtractionRun_planSourceId_fkey"
FOREIGN KEY ("planSourceId") REFERENCES "PlanSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlanSourceExtractionRun"
ADD CONSTRAINT "PlanSourceExtractionRun_planSourceVersionId_fkey"
FOREIGN KEY ("planSourceVersionId") REFERENCES "PlanSourceVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PlanSourceExtractionRun"
ADD CONSTRAINT "PlanSourceExtractionRun_layoutFamilyId_fkey"
FOREIGN KEY ("layoutFamilyId") REFERENCES "PlanSourceLayoutFamily"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PlanSourceExtractionReview"
ADD CONSTRAINT "PlanSourceExtractionReview_extractionRunId_fkey"
FOREIGN KEY ("extractionRunId") REFERENCES "PlanSourceExtractionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
