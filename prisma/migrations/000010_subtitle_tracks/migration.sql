CREATE TABLE "SubtitleTrack" (
  "id" TEXT NOT NULL,
  "mediaFileId" TEXT,
  "episodeId" TEXT,
  "label" TEXT NOT NULL,
  "language" TEXT,
  "format" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'SIDECAR',
  "sourcePath" TEXT,
  "sourceUrl" TEXT,
  "sourceName" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SubtitleTrack_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubtitleTrack_mediaFileId_sourcePath_key"
ON "SubtitleTrack"("mediaFileId", "sourcePath");

CREATE INDEX "SubtitleTrack_mediaFileId_idx" ON "SubtitleTrack"("mediaFileId");
CREATE INDEX "SubtitleTrack_episodeId_idx" ON "SubtitleTrack"("episodeId");

ALTER TABLE "SubtitleTrack"
ADD CONSTRAINT "SubtitleTrack_mediaFileId_fkey"
FOREIGN KEY ("mediaFileId") REFERENCES "MediaFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SubtitleTrack"
ADD CONSTRAINT "SubtitleTrack_episodeId_fkey"
FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
