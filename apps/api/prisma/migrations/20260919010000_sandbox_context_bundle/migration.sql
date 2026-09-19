ALTER TABLE "CloudSandbox" ADD COLUMN "workspaceContext" TEXT;

UPDATE "CloudSandbox" SET "workspaceContext" = "workspaceSkills";
