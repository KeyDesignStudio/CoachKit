/*
  Warnings:

  - You are about to drop the column `coachId` on the `PlanTemplate` table. All the data in the column will be lost.
  - You are about to drop the column `itemsJson` on the `PlanTemplate` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[externalPlanId]` on the table `PlanTemplate` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[externalSessionId]` on the table `WorkoutLibrarySession` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `externalPlanId` to the `PlanTemplate` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `PlanTemplate` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "AthletePlanStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- AlterEnum
ALTER TYPE "WorkoutLibrarySource" ADD VALUE 'PLAN_LIBRARY';

-- DropForeignKey
ALTER TABLE "PlanTemplate" DROP CONSTRAINT "PlanTemplate_coachId_fkey";

-- DropIndex
DROP INDEX "PlanTemplate_coachId_idx";

-- AlterTable
ALTER TABLE "CalendarItem" ADD COLUMN     "athletePlanInstanceId" TEXT;

-- AlterTable
ALTER TABLE "PlanTemplate" DROP COLUMN "coachId",
DROP COLUMN "itemsJson",
ADD COLUMN     "externalPlanId" TEXT NOT NULL,
ADD COLUMN     "goalDistancesJson" JSONB,
ADD COLUMN     "goalTimesJson" JSONB,
ADD COLUMN     "level" TEXT,
ADD COLUMN     "sourceFile" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "durationDays" DROP NOT NULL;

-- AlterTable
ALTER TABLE "WorkoutLibrarySession" ADD COLUMN     "category" TEXT,
ADD COLUMN     "externalSessionId" TEXT,
ADD COLUMN     "paceTargetsJson" JSONB,
ADD COLUMN     "prescriptionJson" JSONB,
ADD COLUMN     "rawText" TEXT;

-- CreateTable
CREATE TABLE "PlanTemplateScheduleRow" (
    "id" TEXT NOT NULL,
    "planTemplateId" TEXT NOT NULL,
    "workoutLibrarySessionId" TEXT,
    "weekIndex" INTEGER NOT NULL,
    "dayIndex" INTEGER NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "isOff" BOOLEAN NOT NULL DEFAULT false,
    "rawText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanTemplateScheduleRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AthletePlanInstance" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "planTemplateId" TEXT NOT NULL,
    "startDateLocal" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" "AthletePlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByCoachId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AthletePlanInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AthletePlanInstanceItem" (
    "id" TEXT NOT NULL,
    "athletePlanInstanceId" TEXT NOT NULL,
    "planTemplateScheduleRowId" TEXT NOT NULL,
    "calendarItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AthletePlanInstanceItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanTemplateScheduleRow_planTemplateId_weekIndex_idx" ON "PlanTemplateScheduleRow"("planTemplateId", "weekIndex");

-- CreateIndex
CREATE INDEX "PlanTemplateScheduleRow_planTemplateId_dayOfWeek_idx" ON "PlanTemplateScheduleRow"("planTemplateId", "dayOfWeek");

-- CreateIndex
CREATE UNIQUE INDEX "PlanTemplateScheduleRow_planTemplateId_dayIndex_key" ON "PlanTemplateScheduleRow"("planTemplateId", "dayIndex");

-- CreateIndex
CREATE INDEX "AthletePlanInstance_athleteId_status_idx" ON "AthletePlanInstance"("athleteId", "status");

-- CreateIndex
CREATE INDEX "AthletePlanInstance_planTemplateId_idx" ON "AthletePlanInstance"("planTemplateId");

-- CreateIndex
CREATE INDEX "AthletePlanInstance_createdByCoachId_idx" ON "AthletePlanInstance"("createdByCoachId");

-- CreateIndex
CREATE INDEX "AthletePlanInstanceItem_calendarItemId_idx" ON "AthletePlanInstanceItem"("calendarItemId");

-- CreateIndex
CREATE UNIQUE INDEX "AthletePlanInstanceItem_athletePlanInstanceId_planTemplateS_key" ON "AthletePlanInstanceItem"("athletePlanInstanceId", "planTemplateScheduleRowId");

-- CreateIndex
CREATE INDEX "CalendarItem_athletePlanInstanceId_idx" ON "CalendarItem"("athletePlanInstanceId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanTemplate_externalPlanId_key" ON "PlanTemplate"("externalPlanId");

-- CreateIndex
CREATE INDEX "PlanTemplate_externalPlanId_idx" ON "PlanTemplate"("externalPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutLibrarySession_externalSessionId_key" ON "WorkoutLibrarySession"("externalSessionId");

-- AddForeignKey
ALTER TABLE "PlanTemplateScheduleRow" ADD CONSTRAINT "PlanTemplateScheduleRow_planTemplateId_fkey" FOREIGN KEY ("planTemplateId") REFERENCES "PlanTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTemplateScheduleRow" ADD CONSTRAINT "PlanTemplateScheduleRow_workoutLibrarySessionId_fkey" FOREIGN KEY ("workoutLibrarySessionId") REFERENCES "WorkoutLibrarySession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AthletePlanInstance" ADD CONSTRAINT "AthletePlanInstance_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AthletePlanInstance" ADD CONSTRAINT "AthletePlanInstance_planTemplateId_fkey" FOREIGN KEY ("planTemplateId") REFERENCES "PlanTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AthletePlanInstance" ADD CONSTRAINT "AthletePlanInstance_createdByCoachId_fkey" FOREIGN KEY ("createdByCoachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AthletePlanInstanceItem" ADD CONSTRAINT "AthletePlanInstanceItem_athletePlanInstanceId_fkey" FOREIGN KEY ("athletePlanInstanceId") REFERENCES "AthletePlanInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AthletePlanInstanceItem" ADD CONSTRAINT "AthletePlanInstanceItem_planTemplateScheduleRowId_fkey" FOREIGN KEY ("planTemplateScheduleRowId") REFERENCES "PlanTemplateScheduleRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AthletePlanInstanceItem" ADD CONSTRAINT "AthletePlanInstanceItem_calendarItemId_fkey" FOREIGN KEY ("calendarItemId") REFERENCES "CalendarItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarItem" ADD CONSTRAINT "CalendarItem_athletePlanInstanceId_fkey" FOREIGN KEY ("athletePlanInstanceId") REFERENCES "AthletePlanInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
