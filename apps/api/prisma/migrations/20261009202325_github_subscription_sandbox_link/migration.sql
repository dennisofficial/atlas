-- AlterTable
ALTER TABLE "GithubSubscription" ADD COLUMN     "sandboxId" TEXT,
ADD COLUMN     "threadId" TEXT;

-- CreateIndex
CREATE INDEX "GithubSubscription_threadId_idx" ON "GithubSubscription"("threadId");

-- AddForeignKey
ALTER TABLE "GithubSubscription" ADD CONSTRAINT "GithubSubscription_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CloudSandbox"("threadId") ON DELETE SET NULL ON UPDATE CASCADE;
