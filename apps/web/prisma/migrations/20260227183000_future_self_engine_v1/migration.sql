-- Future Self Engine (V1) additive schema

CREATE TABLE "AthleteTwin" (
  "athleteId" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "sportProfile" JSONB,
  "baselineMetrics" JSONB,
  "rollingMetrics" JSONB,
  "dataQuality" JSONB,
  "lastInputs" JSONB,
  "modelVersion" TEXT NOT NULL DEFAULT 'future-self-v1',
  CONSTRAINT "AthleteTwin_pkey" PRIMARY KEY ("athleteId")
);

CREATE TABLE "ProjectionSnapshot" (
  "id" TEXT NOT NULL,
  "athleteId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  "createdByType" TEXT NOT NULL DEFAULT 'SYSTEM',
  "scenario" JSONB NOT NULL,
  "horizonWeeks" INTEGER NOT NULL,
  "outputs" JSONB NOT NULL,
  "assumptions" JSONB NOT NULL,
  "confidence" JSONB NOT NULL,
  "visibility" JSONB NOT NULL,
  "modelVersion" TEXT NOT NULL DEFAULT 'future-self-v1',
  CONSTRAINT "ProjectionSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AthleteCheckin" (
  "id" TEXT NOT NULL,
  "athleteId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "weight" DOUBLE PRECISION,
  "waist" DOUBLE PRECISION,
  "sleepHours" DOUBLE PRECISION,
  "perceivedStress" INTEGER,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AthleteCheckin_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AthleteTwin_updatedAt_idx" ON "AthleteTwin"("updatedAt");
CREATE INDEX "ProjectionSnapshot_athleteId_createdAt_idx" ON "ProjectionSnapshot"("athleteId", "createdAt" DESC);
CREATE INDEX "ProjectionSnapshot_createdBy_createdAt_idx" ON "ProjectionSnapshot"("createdBy", "createdAt" DESC);
CREATE INDEX "AthleteCheckin_athleteId_date_idx" ON "AthleteCheckin"("athleteId", "date" DESC);

ALTER TABLE "AthleteTwin"
  ADD CONSTRAINT "AthleteTwin_athleteId_fkey"
  FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectionSnapshot"
  ADD CONSTRAINT "ProjectionSnapshot_athleteId_fkey"
  FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AthleteCheckin"
  ADD CONSTRAINT "AthleteCheckin_athleteId_fkey"
  FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
