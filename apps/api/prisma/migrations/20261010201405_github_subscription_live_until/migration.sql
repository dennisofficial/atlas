-- AlterTable
ALTER TABLE "GithubSubscription" ADD COLUMN     "liveUntil" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "GithubSubscription_liveUntil_idx" ON "GithubSubscription"("liveUntil");
