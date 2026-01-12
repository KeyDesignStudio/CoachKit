-- CreateIndex
CREATE INDEX "CalendarItem_coachId_athleteId_date_idx" ON "CalendarItem"("coachId", "athleteId", "date");

-- CreateIndex
CREATE INDEX "CalendarItem_coachId_reviewedAt_status_idx" ON "CalendarItem"("coachId", "reviewedAt", "status");
