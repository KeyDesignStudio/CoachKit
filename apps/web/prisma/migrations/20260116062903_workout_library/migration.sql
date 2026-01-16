-- CreateEnum
CREATE TYPE "WorkoutLibraryDiscipline" AS ENUM ('RUN', 'BIKE', 'SWIM', 'BRICK', 'STRENGTH', 'OTHER');

-- CreateTable
CREATE TABLE "WorkoutLibrarySession" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "discipline" "WorkoutLibraryDiscipline" NOT NULL,
    "tags" TEXT[],
    "description" TEXT NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "intensityTarget" TEXT NOT NULL,
    "distanceMeters" DOUBLE PRECISION,
    "elevationGainMeters" DOUBLE PRECISION,
    "notes" TEXT,
    "equipment" TEXT[],
    "workoutStructure" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,

    CONSTRAINT "WorkoutLibrarySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutLibraryFavorite" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "librarySessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkoutLibraryFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutLibraryUsage" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "librarySessionId" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkoutLibraryUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkoutLibrarySession_discipline_idx" ON "WorkoutLibrarySession"("discipline");

-- CreateIndex
CREATE INDEX "WorkoutLibrarySession_title_idx" ON "WorkoutLibrarySession"("title");

-- CreateIndex
CREATE INDEX "WorkoutLibrarySession_tags_idx" ON "WorkoutLibrarySession" USING GIN ("tags");

-- CreateIndex
CREATE INDEX "WorkoutLibraryFavorite_coachId_idx" ON "WorkoutLibraryFavorite"("coachId");

-- CreateIndex
CREATE INDEX "WorkoutLibraryFavorite_librarySessionId_idx" ON "WorkoutLibraryFavorite"("librarySessionId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutLibraryFavorite_coachId_librarySessionId_key" ON "WorkoutLibraryFavorite"("coachId", "librarySessionId");

-- CreateIndex
CREATE INDEX "WorkoutLibraryUsage_librarySessionId_usedAt_idx" ON "WorkoutLibraryUsage"("librarySessionId", "usedAt");

-- CreateIndex
CREATE INDEX "WorkoutLibraryUsage_coachId_usedAt_idx" ON "WorkoutLibraryUsage"("coachId", "usedAt");

-- AddForeignKey
ALTER TABLE "WorkoutLibrarySession" ADD CONSTRAINT "WorkoutLibrarySession_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutLibraryFavorite" ADD CONSTRAINT "WorkoutLibraryFavorite_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutLibraryFavorite" ADD CONSTRAINT "WorkoutLibraryFavorite_librarySessionId_fkey" FOREIGN KEY ("librarySessionId") REFERENCES "WorkoutLibrarySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutLibraryUsage" ADD CONSTRAINT "WorkoutLibraryUsage_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutLibraryUsage" ADD CONSTRAINT "WorkoutLibraryUsage_librarySessionId_fkey" FOREIGN KEY ("librarySessionId") REFERENCES "WorkoutLibrarySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
