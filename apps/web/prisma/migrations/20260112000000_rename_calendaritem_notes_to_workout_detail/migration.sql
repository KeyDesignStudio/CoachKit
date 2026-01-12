-- Rename CalendarItem.notes -> CalendarItem.workoutDetail while preserving existing data
ALTER TABLE "CalendarItem" RENAME COLUMN "notes" TO "workoutDetail";
