-- AlterTable
ALTER TABLE "AiPlanDraft" ADD COLUMN     "setupHash" TEXT,
ADD COLUMN     "setupJson" JSONB;

-- CreateTable
CREATE TABLE "AiPlanDraftWeek" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "weekIndex" INTEGER NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "sessionsCount" INTEGER NOT NULL DEFAULT 0,
    "totalMinutes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiPlanDraftWeek_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiPlanDraftSession" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "weekIndex" INTEGER NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "discipline" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "notes" TEXT,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiPlanDraftSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiPlanDraftWeek_draftId_weekIndex_idx" ON "AiPlanDraftWeek"("draftId", "weekIndex");

-- CreateIndex
CREATE UNIQUE INDEX "AiPlanDraftWeek_draftId_weekIndex_key" ON "AiPlanDraftWeek"("draftId", "weekIndex");

-- CreateIndex
CREATE INDEX "AiPlanDraftSession_draftId_weekIndex_idx" ON "AiPlanDraftSession"("draftId", "weekIndex");

-- CreateIndex
CREATE UNIQUE INDEX "AiPlanDraftSession_draftId_weekIndex_ordinal_key" ON "AiPlanDraftSession"("draftId", "weekIndex", "ordinal");

-- AddForeignKey
ALTER TABLE "AiPlanDraftWeek" ADD CONSTRAINT "AiPlanDraftWeek_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "AiPlanDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPlanDraftSession" ADD CONSTRAINT "AiPlanDraftSession_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "AiPlanDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
