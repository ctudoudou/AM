-- CreateEnum
CREATE TYPE "OrganizerPlanStatus" AS ENUM ('PENDING', 'NEEDS_REVIEW', 'AUTO_ARCHIVED', 'EXECUTED', 'REJECTED', 'CONFLICT', 'FAILED');

-- CreateEnum
CREATE TYPE "OrganizerAction" AS ENUM ('MOVE');

-- AlterTable
ALTER TABLE "Download" ADD COLUMN "archiveStatus" TEXT;

-- CreateTable
CREATE TABLE "MetadataProviderResult" (
    "id" TEXT NOT NULL,
    "candidateGroupId" TEXT,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "originalTitle" TEXT,
    "year" INTEGER,
    "synopsis" TEXT,
    "posterUrl" TEXT,
    "backdropUrl" TEXT,
    "language" TEXT,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetadataProviderResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizerPlan" (
    "id" TEXT NOT NULL,
    "downloadId" TEXT,
    "candidateId" TEXT,
    "mediaTitleId" TEXT,
    "status" "OrganizerPlanStatus" NOT NULL DEFAULT 'PENDING',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "autoExecutable" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "metadata" JSONB,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizerPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizerPlanItem" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "targetPath" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "action" "OrganizerAction" NOT NULL DEFAULT 'MOVE',
    "sizeBytes" BIGINT,
    "conflict" BOOLEAN NOT NULL DEFAULT false,
    "conflictReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizerPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetadataProviderResult_candidateGroupId_idx" ON "MetadataProviderResult"("candidateGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "MetadataProviderResult_provider_externalId_candidateGroupId_key" ON "MetadataProviderResult"("provider", "externalId", "candidateGroupId");

-- CreateIndex
CREATE INDEX "OrganizerPlan_downloadId_idx" ON "OrganizerPlan"("downloadId");

-- CreateIndex
CREATE INDEX "OrganizerPlan_candidateId_idx" ON "OrganizerPlan"("candidateId");

-- CreateIndex
CREATE INDEX "OrganizerPlan_status_idx" ON "OrganizerPlan"("status");

-- CreateIndex
CREATE INDEX "OrganizerPlanItem_planId_idx" ON "OrganizerPlanItem"("planId");

-- AddForeignKey
ALTER TABLE "MetadataProviderResult" ADD CONSTRAINT "MetadataProviderResult_candidateGroupId_fkey" FOREIGN KEY ("candidateGroupId") REFERENCES "ReleaseCandidateGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizerPlan" ADD CONSTRAINT "OrganizerPlan_downloadId_fkey" FOREIGN KEY ("downloadId") REFERENCES "Download"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizerPlan" ADD CONSTRAINT "OrganizerPlan_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "ReleaseCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizerPlan" ADD CONSTRAINT "OrganizerPlan_mediaTitleId_fkey" FOREIGN KEY ("mediaTitleId") REFERENCES "MediaTitle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizerPlanItem" ADD CONSTRAINT "OrganizerPlanItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "OrganizerPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
