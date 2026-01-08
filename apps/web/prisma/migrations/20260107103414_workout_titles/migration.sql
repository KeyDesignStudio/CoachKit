-- CreateTable
CREATE TABLE "WorkoutTitle" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "discipline" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkoutTitle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkoutTitle_coachId_discipline_isArchived_idx" ON "WorkoutTitle"("coachId", "discipline", "isArchived");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutTitle_coachId_discipline_title_key" ON "WorkoutTitle"("coachId", "discipline", "title");

-- AddForeignKey
ALTER TABLE "WorkoutTitle" ADD CONSTRAINT "WorkoutTitle_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
