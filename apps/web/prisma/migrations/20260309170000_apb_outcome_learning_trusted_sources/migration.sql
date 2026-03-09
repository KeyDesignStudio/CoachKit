-- CreateTable
CREATE TABLE "PlanTemplateUsageTrace" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "influenceScore" DOUBLE PRECISION NOT NULL,
    "matchScore" DOUBLE PRECISION,
    "sourceOrigin" TEXT,
    "matchedSignalsJson" JSONB,
    "feedbackCount" INTEGER NOT NULL DEFAULT 0,
    "outcomeScore" DOUBLE PRECISION,
    "lastOutcomeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanTemplateUsageTrace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExemplarWeightHistory" (
    "id" TEXT NOT NULL,
    "exemplarId" TEXT,
    "coachId" TEXT NOT NULL,
    "discipline" TEXT NOT NULL,
    "sessionType" TEXT NOT NULL,
    "retrievalKey" TEXT,
    "oldWeight" DOUBLE PRECISION NOT NULL,
    "newWeight" DOUBLE PRECISION NOT NULL,
    "delta" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "feedbackType" TEXT,
    "draftId" TEXT,
    "draftSessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExemplarWeightHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustedKnowledgeSource" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "authority" TEXT NOT NULL,
    "trustTier" INTEGER NOT NULL DEFAULT 1,
    "planningEnabled" BOOLEAN NOT NULL DEFAULT false,
    "qaEnabled" BOOLEAN NOT NULL DEFAULT true,
    "citationRequired" BOOLEAN NOT NULL DEFAULT true,
    "summaryText" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrustedKnowledgeSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApbOutcomeSignal" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "sessionFeedbackCount" INTEGER NOT NULL DEFAULT 0,
    "completionRate" DOUBLE PRECISION,
    "skipRate" DOUBLE PRECISION,
    "avgRpe" DOUBLE PRECISION,
    "sorenessRate" DOUBLE PRECISION,
    "tooHardRate" DOUBLE PRECISION,
    "outcomeScore" DOUBLE PRECISION,
    "summaryJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApbOutcomeSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanTemplateUsageTrace_templateId_createdAt_idx" ON "PlanTemplateUsageTrace"("templateId", "createdAt");

-- CreateIndex
CREATE INDEX "PlanTemplateUsageTrace_athleteId_createdAt_idx" ON "PlanTemplateUsageTrace"("athleteId", "createdAt");

-- CreateIndex
CREATE INDEX "PlanTemplateUsageTrace_coachId_createdAt_idx" ON "PlanTemplateUsageTrace"("coachId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlanTemplateUsageTrace_draftId_templateId_key" ON "PlanTemplateUsageTrace"("draftId", "templateId");

-- CreateIndex
CREATE INDEX "ExemplarWeightHistory_coachId_createdAt_idx" ON "ExemplarWeightHistory"("coachId", "createdAt");

-- CreateIndex
CREATE INDEX "ExemplarWeightHistory_exemplarId_createdAt_idx" ON "ExemplarWeightHistory"("exemplarId", "createdAt");

-- CreateIndex
CREATE INDEX "ExemplarWeightHistory_discipline_sessionType_createdAt_idx" ON "ExemplarWeightHistory"("discipline", "sessionType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrustedKnowledgeSource_slug_key" ON "TrustedKnowledgeSource"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "TrustedKnowledgeSource_url_key" ON "TrustedKnowledgeSource"("url");

-- CreateIndex
CREATE INDEX "TrustedKnowledgeSource_isActive_qaEnabled_idx" ON "TrustedKnowledgeSource"("isActive", "qaEnabled");

-- CreateIndex
CREATE INDEX "TrustedKnowledgeSource_isActive_planningEnabled_idx" ON "TrustedKnowledgeSource"("isActive", "planningEnabled");

-- CreateIndex
CREATE INDEX "TrustedKnowledgeSource_category_trustTier_idx" ON "TrustedKnowledgeSource"("category", "trustTier");

-- CreateIndex
CREATE INDEX "ApbOutcomeSignal_athleteId_createdAt_idx" ON "ApbOutcomeSignal"("athleteId", "createdAt");

-- CreateIndex
CREATE INDEX "ApbOutcomeSignal_coachId_createdAt_idx" ON "ApbOutcomeSignal"("coachId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApbOutcomeSignal_draftId_key" ON "ApbOutcomeSignal"("draftId");

-- AddForeignKey
ALTER TABLE "PlanTemplateUsageTrace" ADD CONSTRAINT "PlanTemplateUsageTrace_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "AiPlanDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTemplateUsageTrace" ADD CONSTRAINT "PlanTemplateUsageTrace_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PlanLibraryTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTemplateUsageTrace" ADD CONSTRAINT "PlanTemplateUsageTrace_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTemplateUsageTrace" ADD CONSTRAINT "PlanTemplateUsageTrace_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExemplarWeightHistory" ADD CONSTRAINT "ExemplarWeightHistory_exemplarId_fkey" FOREIGN KEY ("exemplarId") REFERENCES "CoachWorkoutExemplar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExemplarWeightHistory" ADD CONSTRAINT "ExemplarWeightHistory_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApbOutcomeSignal" ADD CONSTRAINT "ApbOutcomeSignal_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "AiPlanDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApbOutcomeSignal" ADD CONSTRAINT "ApbOutcomeSignal_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApbOutcomeSignal" ADD CONSTRAINT "ApbOutcomeSignal_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

