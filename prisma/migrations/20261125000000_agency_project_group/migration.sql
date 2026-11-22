-- Agency fork (f0q/crawlseo): project groups, a free-text label that lists projects together (docs/agency/projects.md).

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "group" TEXT;
