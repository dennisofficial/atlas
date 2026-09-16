-- CreateTable
CREATE TABLE "CloudSandbox" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sandboxId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "driveName" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "lastActivityAt" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "CloudSandbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CloudSandbox_threadId_key" ON "CloudSandbox"("threadId");

-- CreateIndex
CREATE INDEX "CloudSandbox_userId_idx" ON "CloudSandbox"("userId");

-- CreateIndex
CREATE INDEX "CloudSandbox_state_lastActivityAt_idx" ON "CloudSandbox"("state", "lastActivityAt");

-- AddForeignKey
ALTER TABLE "CloudSandbox" ADD CONSTRAINT "CloudSandbox_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloudSandbox" ADD CONSTRAINT "CloudSandbox_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
