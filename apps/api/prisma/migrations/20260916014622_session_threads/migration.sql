-- CreateTable
CREATE TABLE "Thread" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "head" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    "parentThreadId" TEXT,
    "forkSeq" INTEGER,
    "forkMode" TEXT,
    "spawnerThreadId" TEXT,
    "agentType" TEXT,
    "workspace" TEXT,
    "repo" TEXT,
    "modelRef" TEXT,
    "modelEffort" TEXT,
    "executionLocation" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Thread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "runId" TEXT NOT NULL,
    "parentRunId" TEXT,
    "depth" INTEGER NOT NULL,
    "at" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "contextSlot" TEXT,
    "contextKey" TEXT,
    "contextDigest" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Turn" (
    "runId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "steps" INTEGER NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cacheReadTokens" INTEGER NOT NULL,
    "cacheWriteTokens" INTEGER NOT NULL,
    "startedAt" TEXT NOT NULL,
    "endedAt" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Turn_pkey" PRIMARY KEY ("runId")
);

-- CreateIndex
CREATE INDEX "Thread_userId_updatedAt_idx" ON "Thread"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "Thread_parentThreadId_idx" ON "Thread"("parentThreadId");

-- CreateIndex
CREATE INDEX "Thread_spawnerThreadId_idx" ON "Thread"("spawnerThreadId");

-- CreateIndex
CREATE INDEX "Thread_userId_workspace_updatedAt_idx" ON "Thread"("userId", "workspace", "updatedAt");

-- CreateIndex
CREATE INDEX "Thread_userId_repo_updatedAt_idx" ON "Thread"("userId", "repo", "updatedAt");

-- CreateIndex
CREATE INDEX "Event_threadId_type_idx" ON "Event"("threadId", "type");

-- CreateIndex
CREATE INDEX "Event_userId_idx" ON "Event"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Event_threadId_seq_key" ON "Event"("threadId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "Event_threadId_contextSlot_contextKey_contextDigest_key" ON "Event"("threadId", "contextSlot", "contextKey", "contextDigest");

-- CreateIndex
CREATE INDEX "Turn_threadId_startedAt_idx" ON "Turn"("threadId", "startedAt");

-- CreateIndex
CREATE INDEX "Turn_userId_idx" ON "Turn"("userId");

-- AddForeignKey
ALTER TABLE "Thread" ADD CONSTRAINT "Thread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Thread" ADD CONSTRAINT "Thread_parentThreadId_fkey" FOREIGN KEY ("parentThreadId") REFERENCES "Thread"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Thread" ADD CONSTRAINT "Thread_spawnerThreadId_fkey" FOREIGN KEY ("spawnerThreadId") REFERENCES "Thread"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Turn" ADD CONSTRAINT "Turn_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
