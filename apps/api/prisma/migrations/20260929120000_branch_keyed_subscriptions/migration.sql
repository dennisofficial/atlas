-- Branch-keyed subscriptions: a branch with no open PR subscribes with prNumber NULL and the
-- webhook fans out by head branch. Backward-compatible with the previous release: only adds a
-- defaulted column, widens prNumber to nullable, and swaps the unique key. '' stands in for a
-- number-keyed row's branch so the new key never holds a NULL (NULL != NULL would defeat it).

-- AlterTable
ALTER TABLE "GithubSubscription" ADD COLUMN "branch" TEXT NOT NULL DEFAULT '';
ALTER TABLE "GithubSubscription" ALTER COLUMN "prNumber" DROP NOT NULL;
ALTER TABLE "GithubPrState" ADD COLUMN "headRepoFullName" TEXT;

-- DropIndex
DROP INDEX "GithubSubscription_userId_repoFullName_prNumber_key";

-- CreateIndex
CREATE UNIQUE INDEX "GithubSubscription_userId_repoFullName_branch_key" ON "GithubSubscription"("userId", "repoFullName", "branch");

-- CreateIndex
CREATE INDEX "GithubSubscription_repoFullName_branch_idx" ON "GithubSubscription"("repoFullName", "branch");
