ALTER TABLE "RssSource" ADD COLUMN "mediaType" "MediaType" NOT NULL DEFAULT 'ANIME';
ALTER TABLE "RssItem" ADD COLUMN "mediaType" "MediaType" NOT NULL DEFAULT 'ANIME';
ALTER TABLE "ReleaseCandidate" ADD COLUMN "mediaType" "MediaType" NOT NULL DEFAULT 'ANIME';
ALTER TABLE "ReleaseCandidateGroup" ADD COLUMN "mediaType" "MediaType" NOT NULL DEFAULT 'ANIME';
ALTER TABLE "Subscription" ADD COLUMN "mediaType" "MediaType" NOT NULL DEFAULT 'ANIME';
ALTER TABLE "OrganizerPlan" ADD COLUMN "mediaType" "MediaType" NOT NULL DEFAULT 'ANIME';
ALTER TABLE "Download" ADD COLUMN "aria2Files" JSONB;

DROP INDEX "ReleaseCandidateGroup_normalizedTitle_season_key";
CREATE UNIQUE INDEX "ReleaseCandidateGroup_mediaType_normalizedTitle_season_key" ON "ReleaseCandidateGroup"("mediaType", "normalizedTitle", "season");
CREATE INDEX "ReleaseCandidateGroup_mediaType_idx" ON "ReleaseCandidateGroup"("mediaType");
CREATE INDEX "ReleaseCandidate_mediaType_idx" ON "ReleaseCandidate"("mediaType");
CREATE INDEX "OrganizerPlan_mediaType_idx" ON "OrganizerPlan"("mediaType");
