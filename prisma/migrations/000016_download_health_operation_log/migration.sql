ALTER TABLE "Download"
ADD COLUMN "lastProgressAt" TIMESTAMP(3),
ADD COLUMN "stalledSince" TIMESTAMP(3),
ADD COLUMN "lastPeerCount" INTEGER,
ADD COLUMN "lastSeederCount" INTEGER,
ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "nextRetryAt" TIMESTAMP(3);

CREATE INDEX "Download_status_stalledSince_idx"
ON "Download"("status", "stalledSince");

CREATE INDEX "Download_nextRetryAt_idx"
ON "Download"("nextRetryAt");

CREATE TABLE "OperationLog" (
  "id" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "externalId" TEXT,
  "planId" TEXT,
  "details" JSONB,
  "rollbackData" JSONB,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),

  CONSTRAINT "OperationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OperationLog_domain_createdAt_idx"
ON "OperationLog"("domain", "createdAt");

CREATE INDEX "OperationLog_entityType_entityId_idx"
ON "OperationLog"("entityType", "entityId");

CREATE INDEX "OperationLog_planId_idx"
ON "OperationLog"("planId");
