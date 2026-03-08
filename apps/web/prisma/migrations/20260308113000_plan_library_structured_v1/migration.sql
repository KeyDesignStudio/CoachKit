-- CreateEnum
CREATE TYPE "PlanLibraryImportSourceType" AS ENUM ('CSV', 'XLSX', 'PDF_ASSIST');

-- CreateEnum
CREATE TYPE "PlanLibraryImportJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "PlanLibraryTemplateReviewStatus" AS ENUM ('DRAFT', 'REVIEWED', 'PUBLISHED', 'REJECTED');

-- CreateTable
CREATE TABLE "PlanLibraryTemplate" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sport" "PlanSport" NOT NULL,
    "distance" "PlanDistance" NOT NULL,
    "level" "PlanLevel" NOT NULL,
    "durationWeeks" INTEGER NOT NULL,
    "author" TEXT,
    "publisher" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "qualityScore" DOUBLE PRECISION,
    "reviewStatus" "PlanLibraryTemplateReviewStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanLibraryTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanLibraryImportJob" (
    "id" TEXT NOT NULL,
    "sourceType" "PlanLibraryImportSourceType" NOT NULL,
    "status" "PlanLibraryImportJobStatus" NOT NULL DEFAULT 'PENDING',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorJson" JSONB,
    "rawFileUrl" TEXT,
    "rawFileName" TEXT,
    "checksum" TEXT,
    "parseStatsJson" JSONB,
    "draftJson" JSONB,
    "templateId" TEXT,

    CONSTRAINT "PlanLibraryImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanLibraryTemplateWeek" (
    "id" TEXT NOT NULL,
    "planTemplateId" TEXT NOT NULL,
    "weekIndex" INTEGER NOT NULL,
    "blockName" TEXT,
    "phaseTag" TEXT,
    "targetLoadScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanLibraryTemplateWeek_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanLibraryTemplateSession" (
    "id" TEXT NOT NULL,
    "planTemplateWeekId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "discipline" "PlanSourceDiscipline" NOT NULL,
    "sessionType" TEXT NOT NULL,
    "title" TEXT,
    "durationMinutes" INTEGER,
    "distanceKm" DOUBLE PRECISION,
    "intensityType" TEXT,
    "intensityTargetJson" JSONB,
    "recipeV2Json" JSONB,
    "notes" TEXT,
    "sourceConfidence" DOUBLE PRECISION,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanLibraryTemplateSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanLibraryTemplateValidationRun" (
    "id" TEXT NOT NULL,
    "planTemplateId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "issuesJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanLibraryTemplateValidationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanLibraryTemplateExemplarLink" (
    "id" TEXT NOT NULL,
    "planTemplateId" TEXT NOT NULL,
    "planSessionId" TEXT,
    "retrievalKey" TEXT NOT NULL,
    "retrievalWeight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanLibraryTemplateExemplarLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanLibraryTemplate_isPublished_reviewStatus_updatedAt_idx" ON "PlanLibraryTemplate"("isPublished", "reviewStatus", "updatedAt");

-- CreateIndex
CREATE INDEX "PlanLibraryTemplate_sport_distance_level_durationWeeks_idx" ON "PlanLibraryTemplate"("sport", "distance", "level", "durationWeeks");

-- CreateIndex
CREATE INDEX "PlanLibraryImportJob_createdAt_idx" ON "PlanLibraryImportJob"("createdAt");

-- CreateIndex
CREATE INDEX "PlanLibraryImportJob_status_createdAt_idx" ON "PlanLibraryImportJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PlanLibraryImportJob_templateId_idx" ON "PlanLibraryImportJob"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanLibraryTemplateWeek_planTemplateId_weekIndex_key" ON "PlanLibraryTemplateWeek"("planTemplateId", "weekIndex");

-- CreateIndex
CREATE INDEX "PlanLibraryTemplateWeek_planTemplateId_weekIndex_idx" ON "PlanLibraryTemplateWeek"("planTemplateId", "weekIndex");

-- CreateIndex
CREATE INDEX "PlanLibraryTemplateSession_planTemplateWeekId_dayOfWeek_idx" ON "PlanLibraryTemplateSession"("planTemplateWeekId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "PlanLibraryTemplateSession_discipline_sessionType_idx" ON "PlanLibraryTemplateSession"("discipline", "sessionType");

-- CreateIndex
CREATE INDEX "PlanLibraryTemplateValidationRun_planTemplateId_createdAt_idx" ON "PlanLibraryTemplateValidationRun"("planTemplateId", "createdAt");

-- CreateIndex
CREATE INDEX "PlanLibraryTemplateExemplarLink_planTemplateId_isActive_idx" ON "PlanLibraryTemplateExemplarLink"("planTemplateId", "isActive");

-- CreateIndex
CREATE INDEX "PlanLibraryTemplateExemplarLink_retrievalKey_isActive_idx" ON "PlanLibraryTemplateExemplarLink"("retrievalKey", "isActive");

-- AddForeignKey
ALTER TABLE "PlanLibraryImportJob" ADD CONSTRAINT "PlanLibraryImportJob_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PlanLibraryTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanLibraryTemplateWeek" ADD CONSTRAINT "PlanLibraryTemplateWeek_planTemplateId_fkey" FOREIGN KEY ("planTemplateId") REFERENCES "PlanLibraryTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanLibraryTemplateSession" ADD CONSTRAINT "PlanLibraryTemplateSession_planTemplateWeekId_fkey" FOREIGN KEY ("planTemplateWeekId") REFERENCES "PlanLibraryTemplateWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanLibraryTemplateValidationRun" ADD CONSTRAINT "PlanLibraryTemplateValidationRun_planTemplateId_fkey" FOREIGN KEY ("planTemplateId") REFERENCES "PlanLibraryTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanLibraryTemplateExemplarLink" ADD CONSTRAINT "PlanLibraryTemplateExemplarLink_planTemplateId_fkey" FOREIGN KEY ("planTemplateId") REFERENCES "PlanLibraryTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
