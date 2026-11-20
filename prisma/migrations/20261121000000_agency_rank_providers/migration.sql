-- Agency fork (f0q/crawlseo): provider-agnostic rank tracking.
-- A user label for engines filled by a CSV import or the write API.
ALTER TABLE "ExternalRankEngine" ADD COLUMN "label" TEXT NOT NULL DEFAULT '';

-- Access key scope: "read" (every existing key) or "write".
ALTER TABLE "AccessKey" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'read';
