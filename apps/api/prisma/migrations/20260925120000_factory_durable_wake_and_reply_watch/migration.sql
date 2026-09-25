-- CreateTable
CREATE TABLE "FactoryWakeOutbox" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "repo" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    "deliveredAt" TEXT,

    CONSTRAINT "FactoryWakeOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactoryReplyWatch" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "commentId" TEXT,
    "organizationId" TEXT,
    "eventId" TEXT NOT NULL,
    "nudgeAt" TEXT NOT NULL,
    "graceAt" TEXT NOT NULL,
    "nudged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "FactoryReplyWatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FactoryWakeOutbox_status_createdAt_idx" ON "FactoryWakeOutbox"("status", "createdAt");

-- CreateIndex
CREATE INDEX "FactoryWakeOutbox_workItemId_status_idx" ON "FactoryWakeOutbox"("workItemId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FactoryReplyWatch_workItemId_key" ON "FactoryReplyWatch"("workItemId");

-- AddForeignKey
ALTER TABLE "FactoryWakeOutbox" ADD CONSTRAINT "FactoryWakeOutbox_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "FactoryWorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactoryReplyWatch" ADD CONSTRAINT "FactoryReplyWatch_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "FactoryWorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
