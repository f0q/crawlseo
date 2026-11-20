-- Agency fork (f0q/crawlseo): positions from external rank trackers such as Labrika.
-- CreateTable
CREATE TABLE "ExternalRankEngine" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalSiteId" TEXT NOT NULL,
    "externalEngineId" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalRankEngine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalRank" (
    "id" TEXT NOT NULL,
    "engineId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "position" INTEGER,
    "url" TEXT,
    "frequency" INTEGER,
    "frequencyExact" INTEGER,

    CONSTRAINT "ExternalRank_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalRankEngine_siteId_source_externalSiteId_externalEng_key" ON "ExternalRankEngine"("siteId", "source", "externalSiteId", "externalEngineId");

-- CreateIndex
CREATE INDEX "ExternalRank_engineId_date_idx" ON "ExternalRank"("engineId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalRank_engineId_keyword_date_key" ON "ExternalRank"("engineId", "keyword", "date");

-- AddForeignKey
ALTER TABLE "ExternalRankEngine" ADD CONSTRAINT "ExternalRankEngine_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalRank" ADD CONSTRAINT "ExternalRank_engineId_fkey" FOREIGN KEY ("engineId") REFERENCES "ExternalRankEngine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

