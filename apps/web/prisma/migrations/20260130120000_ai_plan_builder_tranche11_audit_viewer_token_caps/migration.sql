-- Tranche 11A: admin audit viewer support (token caps + timeout metadata)

ALTER TABLE "AiInvocationAudit" ADD COLUMN "maxOutputTokens" INTEGER;
ALTER TABLE "AiInvocationAudit" ADD COLUMN "timeoutMs" INTEGER;
