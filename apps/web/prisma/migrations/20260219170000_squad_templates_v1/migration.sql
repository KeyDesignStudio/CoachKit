-- Add reusable squad templates for group session scheduling.
CREATE TABLE "SquadTemplate" (
  "id" TEXT NOT NULL,
  "coachId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "targetPresetJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SquadTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SquadTemplateTarget" (
  "id" TEXT NOT NULL,
  "squadTemplateId" TEXT NOT NULL,
  "squadId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SquadTemplateTarget_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SquadTemplate_coachId_name_key" ON "SquadTemplate"("coachId", "name");
CREATE INDEX "SquadTemplate_coachId_createdAt_idx" ON "SquadTemplate"("coachId", "createdAt");

CREATE UNIQUE INDEX "SquadTemplateTarget_squadTemplateId_squadId_key" ON "SquadTemplateTarget"("squadTemplateId", "squadId");
CREATE INDEX "SquadTemplateTarget_squadTemplateId_idx" ON "SquadTemplateTarget"("squadTemplateId");
CREATE INDEX "SquadTemplateTarget_squadId_idx" ON "SquadTemplateTarget"("squadId");

ALTER TABLE "SquadTemplate"
  ADD CONSTRAINT "SquadTemplate_coachId_fkey"
  FOREIGN KEY ("coachId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SquadTemplateTarget"
  ADD CONSTRAINT "SquadTemplateTarget_squadTemplateId_fkey"
  FOREIGN KEY ("squadTemplateId") REFERENCES "SquadTemplate"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SquadTemplateTarget"
  ADD CONSTRAINT "SquadTemplateTarget_squadId_fkey"
  FOREIGN KEY ("squadId") REFERENCES "Squad"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
