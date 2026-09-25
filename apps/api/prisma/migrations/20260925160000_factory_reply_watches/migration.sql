-- CreateTable
CREATE TABLE "FactoryReplyWatch" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "commentId" TEXT,
    "eventId" TEXT NOT NULL,
    "organizationId" TEXT,
    "status" TEXT NOT NULL,
    "nudgeAt" TEXT NOT NULL,
    "expireAt" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "FactoryReplyWatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FactoryReplyWatch_status_nudgeAt_idx" ON "FactoryReplyWatch"("status", "nudgeAt");

-- AddForeignKey
ALTER TABLE "FactoryReplyWatch" ADD CONSTRAINT "FactoryReplyWatch_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "FactoryWorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
