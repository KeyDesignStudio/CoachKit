/*
  Warnings:

  - Added the required column `updatedAt` to the `MessageThread` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "athleteReadAt" TIMESTAMP(3),
ADD COLUMN     "coachReadAt" TIMESTAMP(3),
ADD COLUMN     "coachReviewedAt" TIMESTAMP(3),
ADD COLUMN     "senderRole" "UserRole" NOT NULL DEFAULT 'COACH';

-- AlterTable
ALTER TABLE "MessageThread" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;
