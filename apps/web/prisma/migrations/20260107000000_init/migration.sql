-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('COACH', 'ATHLETE');

-- CreateEnum
CREATE TYPE "CalendarItemStatus" AS ENUM ('PLANNED', 'COMPLETED_MANUAL', 'COMPLETED_SYNCED', 'SKIPPED', 'MODIFIED');

-- CreateEnum
CREATE TYPE "CompletionSource" AS ENUM ('MANUAL', 'STRAVA', 'GARMIN', 'FILE');

-- CreateEnum
CREATE TYPE "GroupVisibilityType" AS ENUM ('ALL', 'SQUAD', 'SELECTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "UserRole" NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Australia/Brisbane',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AthleteProfile" (
    "userId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "disciplines" TEXT[],
    "goalsText" TEXT,
    "planCadenceDays" INTEGER NOT NULL DEFAULT 7,
    "zonesJson" JSONB,
    "coachNotes" TEXT,

    CONSTRAINT "AthleteProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Squad" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Squad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SquadMember" (
    "squadId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SquadMember_pkey" PRIMARY KEY ("squadId","athleteId")
);

-- CreateTable
CREATE TABLE "WorkoutTemplate" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "discipline" TEXT NOT NULL,
    "subtype" TEXT,
    "title" TEXT NOT NULL,
    "structureJson" JSONB,
    "defaultTargetsJson" JSONB,
    "notes" TEXT,
    "attachmentsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkoutTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanTemplate" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "itemsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupSession" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "discipline" TEXT NOT NULL,
    "location" TEXT,
    "startTimeLocal" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "description" TEXT,
    "recurrenceRule" TEXT NOT NULL,
    "visibilityType" "GroupVisibilityType" NOT NULL DEFAULT 'ALL',
    "optionalFlag" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupSessionTarget" (
    "id" TEXT NOT NULL,
    "groupSessionId" TEXT NOT NULL,
    "athleteId" TEXT,
    "squadId" TEXT,

    CONSTRAINT "GroupSessionTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarItem" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "plannedStartTimeLocal" TEXT,
    "discipline" TEXT NOT NULL,
    "subtype" TEXT,
    "title" TEXT NOT NULL,
    "plannedDurationMinutes" INTEGER,
    "plannedDistanceKm" DOUBLE PRECISION,
    "intensityType" TEXT,
    "intensityTargetJson" JSONB,
    "notes" TEXT,
    "attachmentsJson" JSONB,
    "status" "CalendarItemStatus" NOT NULL DEFAULT 'PLANNED',
    "templateId" TEXT,
    "groupSessionId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompletedActivity" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "calendarItemId" TEXT,
    "source" "CompletionSource" NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "distanceKm" DOUBLE PRECISION,
    "rpe" INTEGER,
    "notes" TEXT,
    "metricsJson" JSONB,
    "fileUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompletedActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "calendarItemId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageThread" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PainReport" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "bodyLocation" TEXT NOT NULL,
    "severity" INTEGER NOT NULL,
    "durationDays" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PainReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "AthleteProfile_coachId_idx" ON "AthleteProfile"("coachId");

-- CreateIndex
CREATE INDEX "Squad_coachId_idx" ON "Squad"("coachId");

-- CreateIndex
CREATE UNIQUE INDEX "Squad_coachId_name_key" ON "Squad"("coachId", "name");

-- CreateIndex
CREATE INDEX "SquadMember_athleteId_idx" ON "SquadMember"("athleteId");

-- CreateIndex
CREATE INDEX "WorkoutTemplate_coachId_idx" ON "WorkoutTemplate"("coachId");

-- CreateIndex
CREATE INDEX "WorkoutTemplate_discipline_idx" ON "WorkoutTemplate"("discipline");

-- CreateIndex
CREATE INDEX "PlanTemplate_coachId_idx" ON "PlanTemplate"("coachId");

-- CreateIndex
CREATE INDEX "GroupSession_coachId_idx" ON "GroupSession"("coachId");

-- CreateIndex
CREATE INDEX "GroupSessionTarget_groupSessionId_idx" ON "GroupSessionTarget"("groupSessionId");

-- CreateIndex
CREATE INDEX "GroupSessionTarget_athleteId_idx" ON "GroupSessionTarget"("athleteId");

-- CreateIndex
CREATE INDEX "GroupSessionTarget_squadId_idx" ON "GroupSessionTarget"("squadId");

-- CreateIndex
CREATE INDEX "CalendarItem_athleteId_date_idx" ON "CalendarItem"("athleteId", "date");

-- CreateIndex
CREATE INDEX "CalendarItem_coachId_date_idx" ON "CalendarItem"("coachId", "date");

-- CreateIndex
CREATE INDEX "CalendarItem_reviewedAt_idx" ON "CalendarItem"("reviewedAt");

-- CreateIndex
CREATE INDEX "CalendarItem_status_idx" ON "CalendarItem"("status");

-- CreateIndex
CREATE INDEX "CompletedActivity_athleteId_startTime_idx" ON "CompletedActivity"("athleteId", "startTime");

-- CreateIndex
CREATE INDEX "CompletedActivity_calendarItemId_idx" ON "CompletedActivity"("calendarItemId");

-- CreateIndex
CREATE INDEX "Comment_calendarItemId_createdAt_idx" ON "Comment"("calendarItemId", "createdAt");

-- CreateIndex
CREATE INDEX "MessageThread_coachId_idx" ON "MessageThread"("coachId");

-- CreateIndex
CREATE INDEX "MessageThread_athleteId_idx" ON "MessageThread"("athleteId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageThread_coachId_athleteId_key" ON "MessageThread"("coachId", "athleteId");

-- CreateIndex
CREATE INDEX "Message_threadId_createdAt_idx" ON "Message"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "PainReport_athleteId_date_idx" ON "PainReport"("athleteId", "date");

-- AddForeignKey
ALTER TABLE "AthleteProfile" ADD CONSTRAINT "AthleteProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AthleteProfile" ADD CONSTRAINT "AthleteProfile_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Squad" ADD CONSTRAINT "Squad_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquadMember" ADD CONSTRAINT "SquadMember_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquadMember" ADD CONSTRAINT "SquadMember_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutTemplate" ADD CONSTRAINT "WorkoutTemplate_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTemplate" ADD CONSTRAINT "PlanTemplate_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupSession" ADD CONSTRAINT "GroupSession_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupSessionTarget" ADD CONSTRAINT "GroupSessionTarget_groupSessionId_fkey" FOREIGN KEY ("groupSessionId") REFERENCES "GroupSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupSessionTarget" ADD CONSTRAINT "GroupSessionTarget_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupSessionTarget" ADD CONSTRAINT "GroupSessionTarget_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarItem" ADD CONSTRAINT "CalendarItem_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarItem" ADD CONSTRAINT "CalendarItem_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarItem" ADD CONSTRAINT "CalendarItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WorkoutTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarItem" ADD CONSTRAINT "CalendarItem_groupSessionId_fkey" FOREIGN KEY ("groupSessionId") REFERENCES "GroupSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompletedActivity" ADD CONSTRAINT "CompletedActivity_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompletedActivity" ADD CONSTRAINT "CompletedActivity_calendarItemId_fkey" FOREIGN KEY ("calendarItemId") REFERENCES "CalendarItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_calendarItemId_fkey" FOREIGN KEY ("calendarItemId") REFERENCES "CalendarItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "MessageThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PainReport" ADD CONSTRAINT "PainReport_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

