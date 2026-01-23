-- AlterTable
ALTER TABLE "AthleteProfile" ADD COLUMN     "icalToken" TEXT,
ADD COLUMN     "icalTokenRotatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "AthleteProfile_icalToken_key" ON "AthleteProfile"("icalToken");
