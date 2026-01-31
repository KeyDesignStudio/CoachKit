-- CreateEnum
CREATE TYPE "AthleteIntakeResponseStatus" AS ENUM ('DRAFT', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "AthleteProfileAIStatus" AS ENUM ('DRAFT', 'APPROVED');

-- CreateEnum
CREATE TYPE "AiPlanDraftSource" AS ENUM ('AI_DRAFT');

-- CreateEnum
CREATE TYPE "AiPlanDraftStatus" AS ENUM ('DRAFT');

-- CreateEnum
CREATE TYPE "PlanChangeProposalStatus" AS ENUM ('DRAFT');

-- CreateTable
CREATE TABLE "AthleteIntakeResponse" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "status" "AthleteIntakeResponseStatus" NOT NULL DEFAULT 'DRAFT',
    "draftJson" JSONB,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AthleteIntakeResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakeEvidence" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "intakeResponseId" TEXT NOT NULL,
    "questionKey" TEXT NOT NULL,
    "answerJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntakeEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AthleteProfileAI" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "extractedProfileJson" JSONB NOT NULL,
    "extractedSummaryText" TEXT NOT NULL,
    "extractedFlagsJson" JSONB,
    "evidenceHash" TEXT NOT NULL,
    "coachOverridesJson" JSONB,
    "status" "AthleteProfileAIStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AthleteProfileAI_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachIntent" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "intentText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiPlanDraft" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "source" "AiPlanDraftSource" NOT NULL DEFAULT 'AI_DRAFT',
    "status" "AiPlanDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "planJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiPlanDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanChangeProposal" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "status" "PlanChangeProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "draftPlanId" TEXT,
    "targetPlanRef" TEXT,
    "proposalJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanChangeProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanChangeAudit" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "proposalId" TEXT,
    "eventType" TEXT NOT NULL,
    "diffJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanChangeAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AthleteIntakeResponse_athleteId_createdAt_idx" ON "AthleteIntakeResponse"("athleteId", "createdAt");

-- CreateIndex
CREATE INDEX "AthleteIntakeResponse_coachId_createdAt_idx" ON "AthleteIntakeResponse"("coachId", "createdAt");

-- CreateIndex
CREATE INDEX "AthleteIntakeResponse_status_createdAt_idx" ON "AthleteIntakeResponse"("status", "createdAt");

-- CreateIndex
CREATE INDEX "IntakeEvidence_intakeResponseId_idx" ON "IntakeEvidence"("intakeResponseId");

-- CreateIndex
CREATE INDEX "IntakeEvidence_athleteId_createdAt_idx" ON "IntakeEvidence"("athleteId", "createdAt");

-- CreateIndex
CREATE INDEX "IntakeEvidence_coachId_createdAt_idx" ON "IntakeEvidence"("coachId", "createdAt");

-- CreateIndex
CREATE INDEX "AthleteProfileAI_athleteId_createdAt_idx" ON "AthleteProfileAI"("athleteId", "createdAt");

-- CreateIndex
CREATE INDEX "AthleteProfileAI_coachId_createdAt_idx" ON "AthleteProfileAI"("coachId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AthleteProfileAI_athleteId_evidenceHash_key" ON "AthleteProfileAI"("athleteId", "evidenceHash");

-- CreateIndex
CREATE INDEX "CoachIntent_athleteId_createdAt_idx" ON "CoachIntent"("athleteId", "createdAt");

-- CreateIndex
CREATE INDEX "CoachIntent_coachId_createdAt_idx" ON "CoachIntent"("coachId", "createdAt");

-- CreateIndex
CREATE INDEX "AiPlanDraft_athleteId_createdAt_idx" ON "AiPlanDraft"("athleteId", "createdAt");

-- CreateIndex
CREATE INDEX "AiPlanDraft_coachId_createdAt_idx" ON "AiPlanDraft"("coachId", "createdAt");

-- CreateIndex
CREATE INDEX "AiPlanDraft_status_createdAt_idx" ON "AiPlanDraft"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PlanChangeProposal_athleteId_createdAt_idx" ON "PlanChangeProposal"("athleteId", "createdAt");

-- CreateIndex
CREATE INDEX "PlanChangeProposal_coachId_createdAt_idx" ON "PlanChangeProposal"("coachId", "createdAt");

-- CreateIndex
CREATE INDEX "PlanChangeProposal_status_createdAt_idx" ON "PlanChangeProposal"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PlanChangeAudit_athleteId_createdAt_idx" ON "PlanChangeAudit"("athleteId", "createdAt");

-- CreateIndex
CREATE INDEX "PlanChangeAudit_coachId_createdAt_idx" ON "PlanChangeAudit"("coachId", "createdAt");

-- CreateIndex
CREATE INDEX "PlanChangeAudit_proposalId_createdAt_idx" ON "PlanChangeAudit"("proposalId", "createdAt");

-- AddForeignKey
ALTER TABLE "AthleteIntakeResponse" ADD CONSTRAINT "AthleteIntakeResponse_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AthleteIntakeResponse" ADD CONSTRAINT "AthleteIntakeResponse_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeEvidence" ADD CONSTRAINT "IntakeEvidence_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeEvidence" ADD CONSTRAINT "IntakeEvidence_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeEvidence" ADD CONSTRAINT "IntakeEvidence_intakeResponseId_fkey" FOREIGN KEY ("intakeResponseId") REFERENCES "AthleteIntakeResponse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AthleteProfileAI" ADD CONSTRAINT "AthleteProfileAI_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AthleteProfileAI" ADD CONSTRAINT "AthleteProfileAI_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachIntent" ADD CONSTRAINT "CoachIntent_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachIntent" ADD CONSTRAINT "CoachIntent_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPlanDraft" ADD CONSTRAINT "AiPlanDraft_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPlanDraft" ADD CONSTRAINT "AiPlanDraft_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanChangeProposal" ADD CONSTRAINT "PlanChangeProposal_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanChangeProposal" ADD CONSTRAINT "PlanChangeProposal_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanChangeProposal" ADD CONSTRAINT "PlanChangeProposal_draftPlanId_fkey" FOREIGN KEY ("draftPlanId") REFERENCES "AiPlanDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanChangeAudit" ADD CONSTRAINT "PlanChangeAudit_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanChangeAudit" ADD CONSTRAINT "PlanChangeAudit_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanChangeAudit" ADD CONSTRAINT "PlanChangeAudit_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "PlanChangeProposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

