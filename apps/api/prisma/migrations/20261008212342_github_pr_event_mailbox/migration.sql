-- CreateTable
CREATE TABLE "GithubPrEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "prNumber" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GithubPrEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GithubPrEvent_userId_deliveredAt_idx" ON "GithubPrEvent"("userId", "deliveredAt");

-- CreateIndex
CREATE INDEX "GithubPrEvent_repoFullName_prNumber_idx" ON "GithubPrEvent"("repoFullName", "prNumber");
