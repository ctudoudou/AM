CREATE TYPE "PlaybackMode" AS ENUM ('DIRECT', 'HLS_REMUX', 'HLS_TRANSCODE');

CREATE TYPE "TranscodeStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'PROCESSING', 'READY', 'FAILED');

ALTER TABLE "MediaFile"
  ADD COLUMN "sourceResolution" TEXT,
  ADD COLUMN "playbackMode" "PlaybackMode",
  ADD COLUMN "transcodeStatus" "TranscodeStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "transcodePath" TEXT,
  ADD COLUMN "transcodeError" TEXT,
  ADD COLUMN "transcodedAt" TIMESTAMP(3);

CREATE INDEX "MediaFile_transcodeStatus_idx" ON "MediaFile"("transcodeStatus");
