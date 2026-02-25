-- CreateEnum
CREATE TYPE "AdminAuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

-- CreateTable
CREATE TABLE "AdminAuditEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" "AdminAuditAction" NOT NULL,
    "tableName" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "changeText" TEXT NOT NULL,
    "beforeValue" JSONB,
    "afterValue" JSONB,
    "actorUserId" TEXT,
    "actorEmail" TEXT,
    "actorRole" "UserRole",

    CONSTRAINT "AdminAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminAuditEvent_createdAt_idx" ON "AdminAuditEvent"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "AdminAuditEvent_tableName_createdAt_idx" ON "AdminAuditEvent"("tableName", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AdminAuditEvent_actorUserId_createdAt_idx" ON "AdminAuditEvent"("actorUserId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AdminAuditEvent_action_createdAt_idx" ON "AdminAuditEvent"("action", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "AdminAuditEvent" ADD CONSTRAINT "AdminAuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
