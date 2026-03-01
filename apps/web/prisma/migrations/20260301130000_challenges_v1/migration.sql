-- CreateEnum
CREATE TYPE "ChallengeStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ChallengeType" AS ENUM ('VOLUME', 'FREQUENCY', 'PERFORMANCE', 'POINTS');

-- CreateEnum
CREATE TYPE "ChallengeBadgeType" AS ENUM ('PARTICIPATION', 'GOLD', 'SILVER', 'BRONZE');

-- CreateTable
CREATE TABLE "ChallengeSeries" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "squadId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChallengeSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Challenge" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "squadId" TEXT NOT NULL,
    "seriesId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "ChallengeStatus" NOT NULL DEFAULT 'DRAFT',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "isOngoing" BOOLEAN NOT NULL DEFAULT false,
    "disciplineScope" TEXT[] NOT NULL,
    "type" "ChallengeType" NOT NULL,
    "scoringConfig" JSONB NOT NULL,
    "participationConfig" JSONB NOT NULL,
    "rewardConfig" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeParticipant" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sessionsCount" INTEGER NOT NULL DEFAULT 0,
    "lastContributingActivityAt" TIMESTAMP(3),
    "rank" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChallengeParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BadgeAward" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "type" "ChallengeBadgeType" NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BadgeAward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChallengeSeries_coachId_squadId_idx" ON "ChallengeSeries"("coachId", "squadId");

-- CreateIndex
CREATE INDEX "Challenge_coachId_status_startAt_idx" ON "Challenge"("coachId", "status", "startAt");

-- CreateIndex
CREATE INDEX "Challenge_squadId_status_startAt_idx" ON "Challenge"("squadId", "status", "startAt");

-- CreateIndex
CREATE INDEX "Challenge_status_startAt_endAt_idx" ON "Challenge"("status", "startAt", "endAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeParticipant_challengeId_athleteId_key" ON "ChallengeParticipant"("challengeId", "athleteId");

-- CreateIndex
CREATE INDEX "ChallengeParticipant_athleteId_challengeId_idx" ON "ChallengeParticipant"("athleteId", "challengeId");

-- CreateIndex
CREATE INDEX "ChallengeParticipant_challengeId_rank_score_idx" ON "ChallengeParticipant"("challengeId", "rank", "score");

-- CreateIndex
CREATE UNIQUE INDEX "BadgeAward_athleteId_challengeId_type_key" ON "BadgeAward"("athleteId", "challengeId", "type");

-- CreateIndex
CREATE INDEX "BadgeAward_challengeId_type_awardedAt_idx" ON "BadgeAward"("challengeId", "type", "awardedAt");

-- CreateIndex
CREATE INDEX "BadgeAward_athleteId_awardedAt_idx" ON "BadgeAward"("athleteId", "awardedAt");

-- AddForeignKey
ALTER TABLE "ChallengeSeries" ADD CONSTRAINT "ChallengeSeries_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeSeries" ADD CONSTRAINT "ChallengeSeries_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "ChallengeSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeParticipant" ADD CONSTRAINT "ChallengeParticipant_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeParticipant" ADD CONSTRAINT "ChallengeParticipant_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BadgeAward" ADD CONSTRAINT "BadgeAward_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BadgeAward" ADD CONSTRAINT "BadgeAward_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
