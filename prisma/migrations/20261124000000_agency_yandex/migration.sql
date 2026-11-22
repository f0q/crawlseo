-- Agency fork (f0q/crawlseo): Yandex Webmaster and Metrika (lib/yandex, docs/agency/yandex.md).

-- CreateTable
CREATE TABLE "YandexConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "encryptedAccessToken" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "scope" TEXT NOT NULL DEFAULT '',
    "login" TEXT,
    "webmasterUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YandexConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YandexSiteLink" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "webmasterHostId" TEXT,
    "webmasterHostUrl" TEXT,
    "metrikaCounterId" TEXT,
    "metrikaCounterName" TEXT,
    "metrikaGoalIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metrikaGoalNames" JSONB,
    "webmasterProblems" JSONB,
    "webmasterSitemaps" JSONB,
    "webmasterSyncedAt" TIMESTAMP(3),
    "metrikaSyncedAt" TIMESTAMP(3),
    "webmasterError" TEXT,
    "metrikaError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YandexSiteLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YandexWebmasterDaily" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "sqi" INTEGER,
    "searchablePages" INTEGER,
    "excludedPages" INTEGER,
    "problemsFatal" INTEGER,
    "problemsCritical" INTEGER,
    "problemsPossible" INTEGER,
    "problemsRecommendation" INTEGER,
    "http2xx" INTEGER,
    "http3xx" INTEGER,
    "http4xx" INTEGER,
    "http5xx" INTEGER,
    "httpOther" INTEGER,

    CONSTRAINT "YandexWebmasterDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YandexQueryWeekly" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "query" TEXT NOT NULL,
    "shows" INTEGER,
    "clicks" INTEGER,
    "avgShowPosition" DOUBLE PRECISION,
    "avgClickPosition" DOUBLE PRECISION,

    CONSTRAINT "YandexQueryWeekly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YandexMetrikaDaily" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "visits" INTEGER NOT NULL,
    "users" INTEGER NOT NULL,
    "bounceRate" DOUBLE PRECISION,
    "pageDepth" DOUBLE PRECISION,
    "avgDuration" DOUBLE PRECISION,

    CONSTRAINT "YandexMetrikaDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YandexGoalDaily" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "goalId" TEXT NOT NULL,
    "reaches" INTEGER NOT NULL,

    CONSTRAINT "YandexGoalDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "YandexConnection_userId_key" ON "YandexConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "YandexSiteLink_siteId_key" ON "YandexSiteLink"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "YandexWebmasterDaily_siteId_date_key" ON "YandexWebmasterDaily"("siteId", "date");

-- CreateIndex
CREATE INDEX "YandexQueryWeekly_siteId_weekStart_idx" ON "YandexQueryWeekly"("siteId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "YandexQueryWeekly_siteId_weekStart_query_key" ON "YandexQueryWeekly"("siteId", "weekStart", "query");

-- CreateIndex
CREATE INDEX "YandexMetrikaDaily_siteId_date_idx" ON "YandexMetrikaDaily"("siteId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "YandexMetrikaDaily_siteId_kind_key_date_key" ON "YandexMetrikaDaily"("siteId", "kind", "key", "date");

-- CreateIndex
CREATE INDEX "YandexGoalDaily_siteId_date_idx" ON "YandexGoalDaily"("siteId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "YandexGoalDaily_siteId_goalId_date_key" ON "YandexGoalDaily"("siteId", "goalId", "date");

-- AddForeignKey
ALTER TABLE "YandexConnection" ADD CONSTRAINT "YandexConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YandexSiteLink" ADD CONSTRAINT "YandexSiteLink_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YandexWebmasterDaily" ADD CONSTRAINT "YandexWebmasterDaily_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YandexQueryWeekly" ADD CONSTRAINT "YandexQueryWeekly_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YandexMetrikaDaily" ADD CONSTRAINT "YandexMetrikaDaily_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YandexGoalDaily" ADD CONSTRAINT "YandexGoalDaily_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

