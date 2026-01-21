-- AlterTable
ALTER TABLE "CalendarItem" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedByUserId" TEXT;

-- CreateIndex
CREATE INDEX "CalendarItem_deletedAt_idx" ON "CalendarItem"("deletedAt");
