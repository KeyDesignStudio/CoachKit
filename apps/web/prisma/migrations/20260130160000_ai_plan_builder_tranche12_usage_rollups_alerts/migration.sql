-- Tranche 12: daily usage rollups + directional cost estimates + soft alerts

-- CreateEnum
CREATE TYPE "AiUsageAlertSeverity" AS ENUM ('INFO', 'WARN', 'ERROR');
CREATE TYPE "AiUsageAlertType" AS ENUM (
  'HIGH_CALL_VOLUME',
  'HIGH_FALLBACK_RATE',
  'HIGH_ERROR_RATE',
  'HIGH_RETRY_RATE',
  'HIGH_P95_LATENCY',
  'HIGH_COST_ESTIMATE'
);
CREATE TYPE "AiUsageAlertScope" AS ENUM ('GLOBAL', 'CAPABILITY', 'COACH');

-- CreateTable
CREATE TABLE "AiInvocationDailyRollup" (
  "id" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "capability" TEXT NOT NULL,
  "effectiveMode" TEXT NOT NULL,

  "callCount" INTEGER NOT NULL,
  "fallbackCount" INTEGER NOT NULL,
  "errorCount" INTEGER NOT NULL,
  "retryCountTotal" INTEGER NOT NULL,

  "avgDurationMs" INTEGER NOT NULL,
  "p95DurationMs" INTEGER,

  "maxOutputTokensAvg" INTEGER NOT NULL,
  "estimatedOutputTokens" INTEGER NOT NULL,
  "estimatedCostUsd" DOUBLE PRECISION NOT NULL,

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AiInvocationDailyRollup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsageAlert" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dateRangeStart" TIMESTAMP(3) NOT NULL,
  "dateRangeEnd" TIMESTAMP(3) NOT NULL,

  "dedupeKey" TEXT NOT NULL,

  "severity" "AiUsageAlertSeverity" NOT NULL,
  "alertType" "AiUsageAlertType" NOT NULL,
  "scope" "AiUsageAlertScope" NOT NULL,

  "capability" TEXT,
  "provider" TEXT,
  "model" TEXT,

  "observedValue" DOUBLE PRECISION NOT NULL,
  "thresholdValue" DOUBLE PRECISION NOT NULL,
  "message" TEXT NOT NULL,

  "acknowledgedAt" TIMESTAMP(3),
  "acknowledgedBy" TEXT,

  CONSTRAINT "AiUsageAlert_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
CREATE UNIQUE INDEX "AiInvocationDailyRollup_date_provider_model_capability_effectiveMode_key" ON "AiInvocationDailyRollup"(
  "date", "provider", "model", "capability", "effectiveMode"
);

CREATE UNIQUE INDEX "AiUsageAlert_dedupeKey_key" ON "AiUsageAlert"("dedupeKey");

-- Indexes
CREATE INDEX "AiInvocationDailyRollup_date_idx" ON "AiInvocationDailyRollup"("date");
CREATE INDEX "AiInvocationDailyRollup_capability_date_idx" ON "AiInvocationDailyRollup"("capability", "date");

CREATE INDEX "AiUsageAlert_createdAt_idx" ON "AiUsageAlert"("createdAt" DESC);
CREATE INDEX "AiUsageAlert_alertType_createdAt_idx" ON "AiUsageAlert"("alertType", "createdAt" DESC);
CREATE INDEX "AiUsageAlert_dateRangeStart_idx" ON "AiUsageAlert"("dateRangeStart");
