CREATE TYPE "VideoSourceImportStatus" AS ENUM ('RESOLVING', 'QUEUED', 'FAILED');

CREATE TABLE "VideoSourceImport" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sourceItemId" TEXT NOT NULL,
    "episodeKey" TEXT NOT NULL,
    "sourcePageUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "seasonNumber" INTEGER NOT NULL DEFAULT 1,
    "episodeNumber" DOUBLE PRECISION NOT NULL,
    "posterUrl" TEXT,
    "selectedSourceId" TEXT,
    "mediaFormat" TEXT,
    "mediaHost" TEXT,
    "sizeBytes" BIGINT,
    "outputFilename" TEXT,
    "status" "VideoSourceImportStatus" NOT NULL DEFAULT 'RESOLVING',
    "errorMessage" TEXT,
    "candidateId" TEXT,
    "downloadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoSourceImport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VideoSourceImport_candidateId_key" ON "VideoSourceImport"("candidateId");
CREATE UNIQUE INDEX "VideoSourceImport_downloadId_key" ON "VideoSourceImport"("downloadId");
CREATE UNIQUE INDEX "VideoSourceImport_provider_sourceItemId_episodeKey_key"
    ON "VideoSourceImport"("provider", "sourceItemId", "episodeKey");
CREATE INDEX "VideoSourceImport_status_updatedAt_idx"
    ON "VideoSourceImport"("status", "updatedAt");

ALTER TABLE "VideoSourceImport"
    ADD CONSTRAINT "VideoSourceImport_candidateId_fkey"
    FOREIGN KEY ("candidateId") REFERENCES "ReleaseCandidate"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VideoSourceImport"
    ADD CONSTRAINT "VideoSourceImport_downloadId_fkey"
    FOREIGN KEY ("downloadId") REFERENCES "Download"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
