ALTER TABLE "Subscription"
  ADD COLUMN "preferredAudio" TEXT,
  ADD COLUMN "preferredSubtitleLanguage" TEXT,
  ADD COLUMN "preferredReleaseProfile" TEXT,
  ADD COLUMN "preferredSourceKind" TEXT,
  ADD COLUMN "preferredVariantKey" TEXT;

ALTER TABLE "ReleaseCandidate"
  ADD COLUMN "releaseProfile" TEXT,
  ADD COLUMN "sourceKind" TEXT,
  ADD COLUMN "variantKey" TEXT;

CREATE INDEX "ReleaseCandidate_variantKey_idx" ON "ReleaseCandidate"("variantKey");
