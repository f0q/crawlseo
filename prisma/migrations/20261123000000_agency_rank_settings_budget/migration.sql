-- CreateTable
CREATE TABLE "ProjectRankSettings" (
    "projectId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'none',
    "frequency" TEXT NOT NULL DEFAULT 'manual',
    "engineIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectRankSettings_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "RankCheckRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "engineIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "details" JSONB,
    "estimatedChecks" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RankCheckRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankProviderPlan" (
    "provider" TEXT NOT NULL,
    "monthlyLimit" INTEGER NOT NULL,
    "planName" TEXT NOT NULL,
    "planPrice" DECIMAL(14,2) NOT NULL,
    "planChecks" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RankProviderPlan_pkey" PRIMARY KEY ("provider")
);

-- CreateTable
CREATE TABLE "ProjectBudget" (
    "projectId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "categories" TEXT[] DEFAULT ARRAY['work', 'services', 'ads', 'content', 'links', 'other']::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectBudget_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "BudgetPlanLine" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "month" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetPlanLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetEntry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "externalKey" TEXT,
    "author" TEXT NOT NULL,
    "authorKind" TEXT NOT NULL DEFAULT 'human',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RankCheckRun_projectId_createdAt_idx" ON "RankCheckRun"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "RankCheckRun_provider_createdAt_idx" ON "RankCheckRun"("provider", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetPlanLine_projectId_month_category_key" ON "BudgetPlanLine"("projectId", "month", "category");

-- CreateIndex
CREATE INDEX "BudgetEntry_projectId_date_idx" ON "BudgetEntry"("projectId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetEntry_projectId_externalKey_key" ON "BudgetEntry"("projectId", "externalKey");

-- AddForeignKey
ALTER TABLE "ProjectRankSettings" ADD CONSTRAINT "ProjectRankSettings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankCheckRun" ADD CONSTRAINT "RankCheckRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBudget" ADD CONSTRAINT "ProjectBudget_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetPlanLine" ADD CONSTRAINT "BudgetPlanLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetEntry" ADD CONSTRAINT "BudgetEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Every existing project gets its rank settings, turned off: nothing is
-- started until someone turns checks on for the project.
INSERT INTO "ProjectRankSettings" ("projectId", "enabled", "source", "frequency", "updatedAt")
SELECT "id", false, 'none', 'manual', CURRENT_TIMESTAMP FROM "Project"
ON CONFLICT ("projectId") DO NOTHING;
