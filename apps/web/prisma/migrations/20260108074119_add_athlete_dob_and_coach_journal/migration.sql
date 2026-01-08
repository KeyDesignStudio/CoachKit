-- AlterTable
ALTER TABLE "AthleteProfile" ADD COLUMN     "dateOfBirth" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CoachJournalEntry" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachJournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoachJournalEntry_athleteId_entryDate_idx" ON "CoachJournalEntry"("athleteId", "entryDate" DESC);

-- CreateIndex
CREATE INDEX "CoachJournalEntry_coachId_idx" ON "CoachJournalEntry"("coachId");

-- AddForeignKey
ALTER TABLE "CoachJournalEntry" ADD CONSTRAINT "CoachJournalEntry_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachJournalEntry" ADD CONSTRAINT "CoachJournalEntry_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
