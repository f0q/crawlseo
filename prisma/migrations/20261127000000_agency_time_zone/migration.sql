-- Agency fork (f0q/crawlseo): each user's display time zone, an IANA name (docs/agency/time-zone.md).
-- Times stay stored in UTC; users without a settings row get the same default in code.

-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'Asia/Makassar';
