-- CreateTable
CREATE TABLE "CoachBranding" (
    "coachId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL DEFAULT 'CoachKit',
    "logoUrl" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachBranding_pkey" PRIMARY KEY ("coachId")
);

-- AddForeignKey
ALTER TABLE "CoachBranding" ADD CONSTRAINT "CoachBranding_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
