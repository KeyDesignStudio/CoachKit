-- Add default workout location fields to AthleteProfile

ALTER TABLE "AthleteProfile"
ADD COLUMN "defaultLat" DOUBLE PRECISION,
ADD COLUMN "defaultLon" DOUBLE PRECISION,
ADD COLUMN "defaultLocationLabel" TEXT;
