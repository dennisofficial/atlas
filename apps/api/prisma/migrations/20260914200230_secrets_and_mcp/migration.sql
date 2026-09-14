-- CreateTable
CREATE TABLE "SecretEntry" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sealedValue" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "SecretEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpServerConfig" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sealedSpec" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "McpServerConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SecretEntry_userId_name_key" ON "SecretEntry"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "McpServerConfig_userId_name_key" ON "McpServerConfig"("userId", "name");

-- AddForeignKey
ALTER TABLE "SecretEntry" ADD CONSTRAINT "SecretEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpServerConfig" ADD CONSTRAINT "McpServerConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
