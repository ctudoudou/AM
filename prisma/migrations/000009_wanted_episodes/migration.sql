CREATE TYPE "WantedEpisodeStatus" AS ENUM (
  'MISSING',
  'CANDIDATE_FOUND',
  'DOWNLOADING',
  'DOWNLOADED',
  'NEEDS_REVIEW',
  'ARCHIVED',
  'IGNORED'
);

CREATE TABLE "WantedEpisode" (
  "id" TEXT NOT NULL,
  "mediaTitleId" TEXT NOT NULL,
  "seasonNumber" INTEGER NOT NULL,
  "episodeNumber" INTEGER NOT NULL,
  "status" "WantedEpisodeStatus" NOT NULL DEFAULT 'MISSING',
  "matchedCandidateId" TEXT,
  "ignored" BOOLEAN NOT NULL DEFAULT false,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WantedEpisode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WantedEpisode_mediaTitleId_seasonNumber_episodeNumber_key"
ON "WantedEpisode"("mediaTitleId", "seasonNumber", "episodeNumber");

CREATE INDEX "WantedEpisode_status_idx" ON "WantedEpisode"("status");
CREATE INDEX "WantedEpisode_matchedCandidateId_idx" ON "WantedEpisode"("matchedCandidateId");

ALTER TABLE "WantedEpisode"
ADD CONSTRAINT "WantedEpisode_mediaTitleId_fkey"
FOREIGN KEY ("mediaTitleId") REFERENCES "MediaTitle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WantedEpisode"
ADD CONSTRAINT "WantedEpisode_matchedCandidateId_fkey"
FOREIGN KEY ("matchedCandidateId") REFERENCES "ReleaseCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
