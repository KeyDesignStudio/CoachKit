-- CreateEnum
CREATE TYPE "PlanWeekStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "PlanWeek" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "status" "PlanWeekStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanWeek_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanWeek_coachId_weekStart_idx" ON "PlanWeek"("coachId", "weekStart");

-- CreateIndex
CREATE INDEX "PlanWeek_athleteId_weekStart_idx" ON "PlanWeek"("athleteId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "PlanWeek_coachId_athleteId_weekStart_key" ON "PlanWeek"("coachId", "athleteId", "weekStart");

-- AddForeignKey
ALTER TABLE "PlanWeek" ADD CONSTRAINT "PlanWeek_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanWeek" ADD CONSTRAINT "PlanWeek_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
