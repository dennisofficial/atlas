-- Branch-keyed subscriptions: a branch with no open PR subscribes with prNumber NULL and the
-- webhook fans out by head branch. Backward-compatible with the previous release: only adds a
-- defaulted column, widens prNumber to nullable, and swaps the unique key.
--
-- Number-keyed rows store the sentinel branch '#<prNumber>' rather than '': the key
-- (userId, repoFullName, branch) must hold both kinds, and a shared '' would collide for every
-- pair of watched PRs on the same repo. A real git branch can never start with '#', so a branch
-- subscribe never collides with the sentinel.

-- AlterTable
ALTER TABLE "GithubSubscription" ADD COLUMN "branch" TEXT NOT NULL DEFAULT '';
ALTER TABLE "GithubSubscription" ALTER COLUMN "prNumber" DROP NOT NULL;
ALTER TABLE "GithubPrState" ADD COLUMN "headRepoFullName" TEXT;

-- Backfill: existing rows are all number-keyed (branch '' by default), so give each its sentinel.
UPDATE "GithubSubscription" SET branch = '#' || "prNumber"::text WHERE branch = '' AND "prNumber" IS NOT NULL;

-- DropIndex
DROP INDEX "GithubSubscription_userId_repoFullName_prNumber_key";

-- CreateIndex
CREATE UNIQUE INDEX "GithubSubscription_userId_repoFullName_branch_key" ON "GithubSubscription"("userId", "repoFullName", "branch");

-- CreateIndex
CREATE INDEX "GithubSubscription_repoFullName_branch_idx" ON "GithubSubscription"("repoFullName", "branch");
