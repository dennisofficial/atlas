-- CreateTable
CREATE TABLE "FactoryWorkItem" (
    "id" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "orchestratorThreadId" TEXT,
    "driveName" TEXT,
    "revisionCycles" INTEGER NOT NULL DEFAULT 0,
    "lastActivityAt" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "FactoryWorkItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactorySurfaceAlias" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,

    CONSTRAINT "FactorySurfaceAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactoryTranscriptEvent" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "author" TEXT,
    "authorAssociation" TEXT,
    "kind" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "receivedAt" TEXT NOT NULL,

    CONSTRAINT "FactoryTranscriptEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FactoryWorkItem_repo_status_idx" ON "FactoryWorkItem"("repo", "status");

-- CreateIndex
CREATE INDEX "FactoryWorkItem_status_lastActivityAt_idx" ON "FactoryWorkItem"("status", "lastActivityAt");

-- CreateIndex
CREATE UNIQUE INDEX "FactorySurfaceAlias_surface_externalId_key" ON "FactorySurfaceAlias"("surface", "externalId");

-- CreateIndex
CREATE INDEX "FactoryTranscriptEvent_workItemId_receivedAt_idx" ON "FactoryTranscriptEvent"("workItemId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FactoryTranscriptEvent_surface_deliveryId_key" ON "FactoryTranscriptEvent"("surface", "deliveryId");

-- AddForeignKey
ALTER TABLE "FactorySurfaceAlias" ADD CONSTRAINT "FactorySurfaceAlias_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "FactoryWorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactoryTranscriptEvent" ADD CONSTRAINT "FactoryTranscriptEvent_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "FactoryWorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
