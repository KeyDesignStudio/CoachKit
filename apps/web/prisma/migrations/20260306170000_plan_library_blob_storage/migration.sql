ALTER TABLE "PlanSource"
ADD COLUMN "storedDocumentUrl" TEXT,
ADD COLUMN "storedDocumentKey" TEXT,
ADD COLUMN "storedDocumentContentType" TEXT,
ADD COLUMN "storedDocumentUploadedAt" TIMESTAMP(3);
