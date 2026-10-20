-- CreateTable
CREATE TABLE "SshSigningKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "sealedPrivateKey" TEXT NOT NULL,
    "githubKeyId" BIGINT NOT NULL,
    "userName" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SshSigningKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SshSigningKey_userId_key" ON "SshSigningKey"("userId");

-- AddForeignKey
ALTER TABLE "SshSigningKey" ADD CONSTRAINT "SshSigningKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
