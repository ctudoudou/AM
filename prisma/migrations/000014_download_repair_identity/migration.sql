ALTER TABLE "Download"
ADD COLUMN "infoHash" TEXT,
ADD COLUMN "supersededById" TEXT,
ADD COLUMN "repairNote" TEXT;

CREATE INDEX "Download_infoHash_idx" ON "Download"("infoHash");
CREATE INDEX "Download_supersededById_idx" ON "Download"("supersededById");

ALTER TABLE "Download"
ADD CONSTRAINT "Download_supersededById_fkey"
FOREIGN KEY ("supersededById") REFERENCES "Download"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
