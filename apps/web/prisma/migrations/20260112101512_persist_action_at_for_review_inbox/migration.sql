-- AlterTable
ALTER TABLE "CalendarItem" ADD COLUMN     "actionAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "CalendarItem_coachId_reviewedAt_actionAt_idx" ON "CalendarItem"("coachId", "reviewedAt", "actionAt");
