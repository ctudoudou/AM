ALTER TABLE "OrganizerPlan"
ADD COLUMN "resolvedAt" TIMESTAMP(3),
ADD COLUMN "resolution" TEXT;

CREATE INDEX "OrganizerPlan_status_resolvedAt_idx"
ON "OrganizerPlan"("status", "resolvedAt");
