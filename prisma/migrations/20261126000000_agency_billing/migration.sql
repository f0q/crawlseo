-- Agency fork (f0q/crawlseo): client billing of a project and the auto-pause of paid collection (docs/agency/sources-and-billing.md).
-- Additive only: nullable columns and one boolean with a default; existing projects are not tracked (paidUntil null).

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "paidUntil" TIMESTAMP(3),
ADD COLUMN "contractEnd" TIMESTAMP(3),
ADD COLUMN "billingNeverPause" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "paidPausedAt" TIMESTAMP(3),
ADD COLUMN "paidPauseReason" TEXT;
