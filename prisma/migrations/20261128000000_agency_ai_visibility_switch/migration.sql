-- Agency fork: the manual switch of the AI visibility check (paid, OpenRouter), off by default.
ALTER TABLE "Project" ADD COLUMN "aiVisibilityEnabled" BOOLEAN NOT NULL DEFAULT false;
