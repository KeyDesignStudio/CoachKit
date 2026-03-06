CREATE TYPE "PlanSourceAnnotationType" AS ENUM ('WEEK_HEADER', 'DAY_LABEL', 'SESSION_CELL', 'BLOCK_TITLE', 'IGNORE_REGION', 'LEGEND', 'NOTE');

CREATE TABLE "PlanSourceAnnotation" (
  "id" TEXT NOT NULL,
  "planSourceId" TEXT NOT NULL,
  "pageNumber" INTEGER NOT NULL,
  "annotationType" "PlanSourceAnnotationType" NOT NULL,
  "label" TEXT,
  "bboxJson" JSONB NOT NULL,
  "note" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdByEmail" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PlanSourceAnnotation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlanSourceAnnotation_planSourceId_pageNumber_annotationType_idx" ON "PlanSourceAnnotation"("planSourceId", "pageNumber", "annotationType");
CREATE INDEX "PlanSourceAnnotation_planSourceId_createdAt_idx" ON "PlanSourceAnnotation"("planSourceId", "createdAt");

ALTER TABLE "PlanSourceAnnotation"
ADD CONSTRAINT "PlanSourceAnnotation_planSourceId_fkey"
FOREIGN KEY ("planSourceId") REFERENCES "PlanSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
