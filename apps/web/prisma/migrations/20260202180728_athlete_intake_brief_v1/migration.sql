-- CreateTable
CREATE TABLE "AthleteIntakeSubmission" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "answersJson" JSONB NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AthleteIntakeSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AthleteBrief" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inputHash" TEXT NOT NULL,
    "briefJson" JSONB NOT NULL,
    "aiMode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AthleteBrief_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AthleteIntakeSubmission_athleteId_submittedAt_idx" ON "AthleteIntakeSubmission"("athleteId", "submittedAt");

-- CreateIndex
CREATE INDEX "AthleteIntakeSubmission_coachId_submittedAt_idx" ON "AthleteIntakeSubmission"("coachId", "submittedAt");

-- CreateIndex
CREATE INDEX "AthleteBrief_athleteId_generatedAt_idx" ON "AthleteBrief"("athleteId", "generatedAt");

-- CreateIndex
CREATE INDEX "AthleteBrief_coachId_generatedAt_idx" ON "AthleteBrief"("coachId", "generatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AthleteBrief_athleteId_inputHash_key" ON "AthleteBrief"("athleteId", "inputHash");

-- AddForeignKey
ALTER TABLE "AthleteIntakeSubmission" ADD CONSTRAINT "AthleteIntakeSubmission_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AthleteIntakeSubmission" ADD CONSTRAINT "AthleteIntakeSubmission_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AthleteBrief" ADD CONSTRAINT "AthleteBrief_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AthleteBrief" ADD CONSTRAINT "AthleteBrief_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
