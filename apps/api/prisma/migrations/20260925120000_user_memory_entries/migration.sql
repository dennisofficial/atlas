-- CreateTable
CREATE TABLE "UserMemoryEntry" (
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "mtimeMs" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMemoryEntry_pkey" PRIMARY KEY ("userId","key")
);

-- AddForeignKey
ALTER TABLE "UserMemoryEntry" ADD CONSTRAINT "UserMemoryEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
