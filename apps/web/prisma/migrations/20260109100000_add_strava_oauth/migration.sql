/*
  Strava OAuth integration

  - Adds OAuthProvider enum
  - Adds OAuthState table for DB-backed OAuth state (CSRF protection)
  - Adds StravaConnection table for server-side token storage
*/

-- CreateEnum
CREATE TYPE "OAuthProvider" AS ENUM ('STRAVA');

-- CreateTable
CREATE TABLE "OAuthState" (
    "id" TEXT NOT NULL,
    "provider" "OAuthProvider" NOT NULL,
    "userId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "redirectTo" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StravaConnection" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "stravaAthleteId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "scope" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StravaConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OAuthState_state_key" ON "OAuthState"("state");

-- CreateIndex
CREATE INDEX "OAuthState_provider_userId_idx" ON "OAuthState"("provider", "userId");

-- CreateIndex
CREATE INDEX "OAuthState_expiresAt_idx" ON "OAuthState"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "StravaConnection_athleteId_key" ON "StravaConnection"("athleteId");

-- CreateIndex
CREATE UNIQUE INDEX "StravaConnection_stravaAthleteId_key" ON "StravaConnection"("stravaAthleteId");

-- CreateIndex
CREATE INDEX "StravaConnection_athleteId_idx" ON "StravaConnection"("athleteId");

-- CreateIndex
CREATE INDEX "StravaConnection_stravaAthleteId_idx" ON "StravaConnection"("stravaAthleteId");

-- CreateIndex
CREATE INDEX "StravaConnection_expiresAt_idx" ON "StravaConnection"("expiresAt");

-- AddForeignKey
ALTER TABLE "OAuthState" ADD CONSTRAINT "OAuthState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StravaConnection" ADD CONSTRAINT "StravaConnection_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
