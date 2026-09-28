-- Drops the tables that fed the superseded webhook-cache + app-installation PR/CI tracker.
-- The realtime fan-out (#827) replaced them with GithubSubscription/GithubRepoHook/GithubPrState;
-- the code that read these tables was deleted in #829. Backward-compatible only forward: the
-- previous release is already off these tables, so nothing live reads them.

DROP TABLE IF EXISTS "GithubPullRequest";
DROP TABLE IF EXISTS "GithubWebhookEvent";
