-- CreateTable
CREATE TABLE "GithubSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "prNumber" INTEGER NOT NULL,
    "pollBacked" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GithubSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GithubRepoHook" (
    "repoFullName" TEXT NOT NULL,
    "hookId" BIGINT NOT NULL,
    "secret" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "idleSince" TIMESTAMP(3),
    "sweepLeaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GithubRepoHook_pkey" PRIMARY KEY ("repoFullName")
);

-- CreateTable
CREATE TABLE "GithubPrState" (
    "repoFullName" TEXT NOT NULL,
    "prNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "headBranch" TEXT NOT NULL,
    "headSha" TEXT NOT NULL,
    "checksRunning" INTEGER NOT NULL DEFAULT 0,
    "checksPassed" INTEGER NOT NULL DEFAULT 0,
    "checksFailed" INTEGER NOT NULL DEFAULT 0,
    "mergeable" BOOLEAN,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GithubPrState_pkey" PRIMARY KEY ("repoFullName","prNumber")
);

-- CreateIndex
CREATE UNIQUE INDEX "GithubSubscription_userId_repoFullName_prNumber_key" ON "GithubSubscription"("userId", "repoFullName", "prNumber");

-- CreateIndex
CREATE INDEX "GithubSubscription_repoFullName_prNumber_idx" ON "GithubSubscription"("repoFullName", "prNumber");

-- CreateIndex
CREATE INDEX "GithubSubscription_expiresAt_idx" ON "GithubSubscription"("expiresAt");

-- CreateIndex
CREATE INDEX "GithubPrState_repoFullName_idx" ON "GithubPrState"("repoFullName");
