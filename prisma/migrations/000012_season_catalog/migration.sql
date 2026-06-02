CREATE TABLE "SeasonCatalog" (
    "id" TEXT NOT NULL,
    "mediaTitleId" TEXT NOT NULL,
    "seasonNumber" INTEGER NOT NULL,
    "episodeCount" INTEGER NOT NULL,
    "absoluteStart" INTEGER,
    "absoluteEnd" INTEGER,
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "sourceUrl" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeasonCatalog_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SeasonCatalog_episodeCount_positive" CHECK ("episodeCount" > 0),
    CONSTRAINT "SeasonCatalog_seasonNumber_positive" CHECK ("seasonNumber" > 0),
    CONSTRAINT "SeasonCatalog_absolute_range_valid" CHECK (
      ("absoluteStart" IS NULL AND "absoluteEnd" IS NULL) OR
      ("absoluteStart" IS NOT NULL AND "absoluteEnd" IS NOT NULL AND "absoluteStart" > 0 AND "absoluteEnd" >= "absoluteStart")
    )
);

CREATE UNIQUE INDEX "SeasonCatalog_mediaTitleId_seasonNumber_provider_key" ON "SeasonCatalog"("mediaTitleId", "seasonNumber", "provider");
CREATE INDEX "SeasonCatalog_mediaTitleId_idx" ON "SeasonCatalog"("mediaTitleId");
CREATE INDEX "SeasonCatalog_provider_idx" ON "SeasonCatalog"("provider");

ALTER TABLE "SeasonCatalog" ADD CONSTRAINT "SeasonCatalog_mediaTitleId_fkey" FOREIGN KEY ("mediaTitleId") REFERENCES "MediaTitle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
