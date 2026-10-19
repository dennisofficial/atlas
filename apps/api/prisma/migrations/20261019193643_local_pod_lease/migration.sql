-- CreateTable
CREATE TABLE "LocalPodLease" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocalPodLease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LocalPodLease_tokenHash_key" ON "LocalPodLease"("tokenHash");

-- CreateIndex
CREATE INDEX "LocalPodLease_userId_idx" ON "LocalPodLease"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LocalPodLease_userId_threadId_key" ON "LocalPodLease"("userId", "threadId");

-- AddForeignKey
ALTER TABLE "LocalPodLease" ADD CONSTRAINT "LocalPodLease_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
