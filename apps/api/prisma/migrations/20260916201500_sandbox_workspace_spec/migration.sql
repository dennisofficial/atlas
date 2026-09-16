-- AlterTable
ALTER TABLE "CloudSandbox" DROP COLUMN "driveName",
ADD COLUMN "workspaceRemoteUrl" TEXT,
ADD COLUMN "workspaceBranch" TEXT,
ADD COLUMN "workspaceCommit" TEXT,
ADD COLUMN "workspacePatch" TEXT;
