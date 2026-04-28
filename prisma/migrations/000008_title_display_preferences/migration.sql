CREATE TYPE "TitleDisplayMode" AS ENUM ('GLOBAL', 'ZH_HANT', 'ZH_HANS', 'JA', 'EN', 'CUSTOM');

ALTER TABLE "MediaTitle"
ADD COLUMN "titleDisplayMode" "TitleDisplayMode" NOT NULL DEFAULT 'GLOBAL',
ADD COLUMN "customDisplayTitle" TEXT;
