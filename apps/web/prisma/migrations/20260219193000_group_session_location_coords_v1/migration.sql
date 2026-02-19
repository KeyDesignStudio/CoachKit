ALTER TABLE "GroupSession"
  ADD COLUMN "locationLat" DOUBLE PRECISION,
  ADD COLUMN "locationLon" DOUBLE PRECISION;

CREATE INDEX "GroupSession_locationLat_locationLon_idx" ON "GroupSession"("locationLat", "locationLon");
