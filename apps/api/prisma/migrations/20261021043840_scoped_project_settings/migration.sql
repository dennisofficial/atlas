-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Thread" ADD COLUMN     "projectId" TEXT;

-- CreateTable
CREATE TABLE "ProjectSetting" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceVercelCredential" (
    "organizationId" TEXT NOT NULL,
    "sealedToken" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceVercelCredential_pkey" PRIMARY KEY ("organizationId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectSetting_projectId_key_key" ON "ProjectSetting"("projectId", "key");

-- CreateIndex
CREATE INDEX "Project_organizationId_idx" ON "Project"("organizationId");

-- CreateIndex
CREATE INDEX "Thread_projectId_idx" ON "Thread"("projectId");

-- AddForeignKey
ALTER TABLE "Thread" ADD CONSTRAINT "Thread_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSetting" ADD CONSTRAINT "ProjectSetting_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceVercelCredential" ADD CONSTRAINT "WorkspaceVercelCredential_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
