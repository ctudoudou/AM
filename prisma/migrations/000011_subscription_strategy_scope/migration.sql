ALTER TABLE "Subscription"
  ADD COLUMN "seasonMode" TEXT NOT NULL DEFAULT 'unknown_review',
  ADD COLUMN "seasonNumber" INTEGER,
  ADD COLUMN "episodeMode" TEXT NOT NULL DEFAULT 'future_only',
  ADD COLUMN "episodeStart" DOUBLE PRECISION,
  ADD COLUMN "episodeEnd" DOUBLE PRECISION,
  ADD COLUMN "batchPolicy" TEXT NOT NULL DEFAULT 'review';

CREATE INDEX "Subscription_candidateGroupId_seasonNumber_idx" ON "Subscription"("candidateGroupId", "seasonNumber");
