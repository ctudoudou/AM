-- CreateEnum
CREATE TYPE "RssItemStatus" AS ENUM ('NEW', 'PARSED', 'GROUPED', 'FAILED');

-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('NEW', 'REVIEW', 'READY', 'SUBSCRIBED', 'DOWNLOADED', 'IGNORED');

-- AlterTable
ALTER TABLE "Download" ADD COLUMN "candidateId" TEXT,
ADD COLUMN "completedBytes" BIGINT,
ADD COLUMN "downloadDir" TEXT,
ADD COLUMN "downloadSpeed" BIGINT,
ADD COLUMN "errorMessage" TEXT,
ADD COLUMN "etaSeconds" INTEGER,
ADD COLUMN "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN "totalBytes" BIGINT;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "candidateGroupId" TEXT,
ADD COLUMN "fallbackPolicy" TEXT NOT NULL DEFAULT 'manual_review',
ADD COLUMN "preferredCodec" TEXT;

-- CreateTable
CREATE TABLE "RssItem" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'rss',
    "guid" TEXT,
    "title" TEXT NOT NULL,
    "link" TEXT,
    "magnetUrl" TEXT,
    "torrentFilePath" TEXT,
    "publishedAt" TIMESTAMP(3),
    "raw" JSONB NOT NULL,
    "status" "RssItemStatus" NOT NULL DEFAULT 'NEW',
    "parseError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RssItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseCandidateGroup" (
    "id" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "displayTitle" TEXT NOT NULL,
    "season" INTEGER,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewRequired" BOOLEAN NOT NULL DEFAULT true,
    "aiSummary" TEXT,
    "aliases" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleaseCandidateGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseCandidate" (
    "id" TEXT NOT NULL,
    "groupId" TEXT,
    "rssItemId" TEXT NOT NULL,
    "rawTitle" TEXT NOT NULL,
    "parsedTitle" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "subtitleGroup" TEXT,
    "episodeNumber" DOUBLE PRECISION,
    "season" INTEGER,
    "resolution" TEXT,
    "codec" TEXT,
    "audio" TEXT,
    "subtitleLanguage" TEXT,
    "releaseTags" JSONB,
    "magnetUrl" TEXT,
    "torrentUrl" TEXT,
    "torrentFilePath" TEXT,
    "sourceUrl" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "CandidateStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleaseCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Download_candidateId_idx" ON "Download"("candidateId");

-- CreateIndex
CREATE INDEX "Download_status_idx" ON "Download"("status");

-- CreateIndex
CREATE INDEX "Subscription_candidateGroupId_idx" ON "Subscription"("candidateGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "RssItem_sourceId_guid_key" ON "RssItem"("sourceId", "guid");

-- CreateIndex
CREATE UNIQUE INDEX "RssItem_sourceId_link_key" ON "RssItem"("sourceId", "link");

-- CreateIndex
CREATE INDEX "RssItem_status_idx" ON "RssItem"("status");

-- CreateIndex
CREATE INDEX "RssItem_publishedAt_idx" ON "RssItem"("publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseCandidateGroup_normalizedTitle_season_key" ON "ReleaseCandidateGroup"("normalizedTitle", "season");

-- CreateIndex
CREATE INDEX "ReleaseCandidateGroup_reviewRequired_idx" ON "ReleaseCandidateGroup"("reviewRequired");

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseCandidate_rssItemId_key" ON "ReleaseCandidate"("rssItemId");

-- CreateIndex
CREATE INDEX "ReleaseCandidate_groupId_idx" ON "ReleaseCandidate"("groupId");

-- CreateIndex
CREATE INDEX "ReleaseCandidate_status_idx" ON "ReleaseCandidate"("status");

-- CreateIndex
CREATE INDEX "ReleaseCandidate_normalizedTitle_idx" ON "ReleaseCandidate"("normalizedTitle");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_candidateGroupId_fkey" FOREIGN KEY ("candidateGroupId") REFERENCES "ReleaseCandidateGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Download" ADD CONSTRAINT "Download_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "ReleaseCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RssItem" ADD CONSTRAINT "RssItem_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "RssSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseCandidate" ADD CONSTRAINT "ReleaseCandidate_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ReleaseCandidateGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseCandidate" ADD CONSTRAINT "ReleaseCandidate_rssItemId_fkey" FOREIGN KEY ("rssItemId") REFERENCES "RssItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
