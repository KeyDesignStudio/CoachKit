-- Add OAuth providers for scaffolded device integrations.
ALTER TYPE "OAuthProvider" ADD VALUE IF NOT EXISTS 'GARMIN';
ALTER TYPE "OAuthProvider" ADD VALUE IF NOT EXISTS 'WAHOO';
ALTER TYPE "OAuthProvider" ADD VALUE IF NOT EXISTS 'COROS';

-- Create external provider enum used by generic connection + webhook models.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExternalProvider') THEN
    CREATE TYPE "ExternalProvider" AS ENUM ('STRAVA', 'GARMIN', 'WAHOO', 'COROS', 'POLAR');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExternalWebhookEventStatus') THEN
    CREATE TYPE "ExternalWebhookEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ExternalConnection" (
  "id" TEXT NOT NULL,
  "athleteId" TEXT NOT NULL,
  "provider" "ExternalProvider" NOT NULL,
  "externalAthleteId" TEXT NOT NULL,
  "accessToken" TEXT NOT NULL,
  "refreshToken" TEXT,
  "expiresAt" TIMESTAMP(3),
  "scope" TEXT,
  "lastSyncAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ExternalConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ExternalConnection_athleteId_provider_key" ON "ExternalConnection"("athleteId", "provider");
CREATE UNIQUE INDEX IF NOT EXISTS "ExternalConnection_provider_externalAthleteId_key" ON "ExternalConnection"("provider", "externalAthleteId");
CREATE INDEX IF NOT EXISTS "ExternalConnection_provider_lastSyncAt_idx" ON "ExternalConnection"("provider", "lastSyncAt");

CREATE TABLE IF NOT EXISTS "ExternalWebhookEvent" (
  "id" TEXT NOT NULL,
  "provider" "ExternalProvider" NOT NULL,
  "athleteId" TEXT,
  "externalAthleteId" TEXT,
  "externalActivityId" TEXT,
  "eventType" TEXT,
  "status" "ExternalWebhookEventStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "payloadJson" JSONB NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ExternalWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ExternalWebhookEvent_provider_status_nextAttemptAt_idx" ON "ExternalWebhookEvent"("provider", "status", "nextAttemptAt");
CREATE INDEX IF NOT EXISTS "ExternalWebhookEvent_athleteId_provider_idx" ON "ExternalWebhookEvent"("athleteId", "provider");
CREATE INDEX IF NOT EXISTS "ExternalWebhookEvent_provider_externalActivityId_idx" ON "ExternalWebhookEvent"("provider", "externalActivityId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ExternalConnection_athleteId_fkey'
  ) THEN
    ALTER TABLE "ExternalConnection"
      ADD CONSTRAINT "ExternalConnection_athleteId_fkey"
      FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ExternalWebhookEvent_athleteId_fkey'
  ) THEN
    ALTER TABLE "ExternalWebhookEvent"
      ADD CONSTRAINT "ExternalWebhookEvent_athleteId_fkey"
      FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
