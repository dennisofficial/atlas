-- CreateTable
CREATE TABLE "AgentAccount" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "email" TEXT,
    "subscription" TEXT,
    "importedFrom" TEXT,
    "sealedSecret" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "AgentAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActiveAccount" (
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActiveAccount_pkey" PRIMARY KEY ("userId","provider")
);

-- CreateIndex
CREATE INDEX "AgentAccount_userId_provider_idx" ON "AgentAccount"("userId", "provider");

-- AddForeignKey
ALTER TABLE "AgentAccount" ADD CONSTRAINT "AgentAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
