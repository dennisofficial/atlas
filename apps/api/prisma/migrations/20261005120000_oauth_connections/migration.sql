-- CreateTable
CREATE TABLE "OauthConnection" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sealedTokens" TEXT NOT NULL,
    "authorizationId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "refreshAttempt" TEXT,
    "refreshStartedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "OauthConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OauthConnectionSandbox" (
    "connectionId" TEXT NOT NULL,
    "sandboxId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OauthConnectionSandbox_pkey" PRIMARY KEY ("connectionId","sandboxId")
);

-- CreateIndex
CREATE INDEX "OauthConnection_userId_idx" ON "OauthConnection"("userId");

-- CreateIndex
CREATE INDEX "OauthConnectionSandbox_sandboxId_idx" ON "OauthConnectionSandbox"("sandboxId");

-- AddForeignKey
ALTER TABLE "OauthConnection" ADD CONSTRAINT "OauthConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OauthConnectionSandbox" ADD CONSTRAINT "OauthConnectionSandbox_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "OauthConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OauthConnectionSandbox" ADD CONSTRAINT "OauthConnectionSandbox_sandboxId_fkey" FOREIGN KEY ("sandboxId") REFERENCES "CloudSandbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
