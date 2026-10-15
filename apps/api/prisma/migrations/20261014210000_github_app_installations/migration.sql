-- CreateTable
CREATE TABLE "GithubAppInstallation" (
    "installationId" BIGINT NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "repos" TEXT[],
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GithubAppInstallation_pkey" PRIMARY KEY ("installationId")
);

-- CreateTable
CREATE TABLE "GithubAppNoticeDismissal" (
    "userId" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GithubAppNoticeDismissal_pkey" PRIMARY KEY ("userId","repoFullName")
);

-- CreateIndex
CREATE INDEX "GithubAppInstallation_accountLogin_idx" ON "GithubAppInstallation"("accountLogin");
