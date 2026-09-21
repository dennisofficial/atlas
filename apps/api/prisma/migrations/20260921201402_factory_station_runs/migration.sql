-- AlterTable
ALTER TABLE "CloudSandbox" ADD COLUMN     "driveMode" TEXT,
ADD COLUMN     "driveName" TEXT,
ADD COLUMN     "pinnedModel" TEXT;

-- CreateTable
CREATE TABLE "FactoryStationRun" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "driveMode" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    "finishedAt" TEXT,

    CONSTRAINT "FactoryStationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FactoryStationRun_threadId_key" ON "FactoryStationRun"("threadId");

-- CreateIndex
CREATE INDEX "FactoryStationRun_workItemId_status_idx" ON "FactoryStationRun"("workItemId", "status");

-- AddForeignKey
ALTER TABLE "FactoryStationRun" ADD CONSTRAINT "FactoryStationRun_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "FactoryWorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
